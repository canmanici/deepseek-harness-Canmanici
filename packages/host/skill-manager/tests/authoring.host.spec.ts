import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSkillFile, renderSkillFile, SkillManager, UserSkillRoot } from '../src/index.ts'

const temps: string[] = []
afterEach(async () => { await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-authoring-'))
  temps.push(dir)
  return dir
}

const draft = { name: 'release-notes', description: 'Draft release notes', body: '# Steps\n\n1. Read the log.', modelInvocable: true, userInvocable: true }

async function boot(): Promise<{ ctx: Context; manager: SkillManager; home: string }> {
  const home = await temp()
  await mkdir(join(home, 'skills'), { recursive: true })
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: home, includeDefaultRoots: true, agentsHome: join(home, 'agents'), watchStabilityThresholdMs: 20 })
  temps.unshift(home)
  const manager = new SkillManager(ctx, { dshHome: home })
  return { ctx, manager, home }
}

async function names(manager: SkillManager): Promise<Array<[string, boolean]>> {
  return (await manager.inventory({})).skills.map(skill => [skill.name, skill.editable])
}

describe('renderSkillFile and readSkillFile', () => {
  it('round-trips drafts, writes invocation keys only when they differ from the defaults, and keeps unknown keys', () => {
    const text = renderSkillFile({ ...draft, whenToUse: '  After a release  ', modelInvocable: false, userInvocable: false }, { metadata: { team: 'docs' }, name: 'ignored' })
    expect(text).toBe('---\nname: release-notes\ndescription: Draft release notes\nwhenToUse: After a release\ndisable-model-invocation: true\nuser-invocable: false\nmetadata:\n  team: docs\n---\n\n# Steps\n\n1. Read the log.\n')
    expect(readSkillFile(text)).toEqual({
      draft: { ...draft, whenToUse: 'After a release', modelInvocable: false, userInvocable: false },
      preserved: { metadata: { team: 'docs' } },
    })
    expect(renderSkillFile({ ...draft, whenToUse: ' ' })).not.toContain('whenToUse')
  })

  it('rejects drafts that do not form a valid skill', () => {
    expect(() => renderSkillFile({ ...draft, name: 'Bad Name' })).toThrow('invalid skill name')
    expect(() => renderSkillFile({ ...draft, description: ' ' })).toThrow('frontmatter requires name and description')
  })
})

describe('SkillManager authoring', () => {
  it('creates, reads, updates, and deletes a user skill that the catalog picks up', async () => {
    const { ctx, manager, home } = await boot()
    const changed: string[] = []
    ctx.on('skill-filesystem/changed', (path) => { changed.push(path) })
    const created = await manager.createSkill(draft)
    expect(changed).toEqual([created.path])
    expect(created.path).toBe(join(home, 'skills', 'release-notes', 'SKILL.md'))
    await vi.waitFor(async () => { expect(await names(manager)).toEqual([['release-notes', true]]) }, { timeout: 5000 })

    const stored = await readFile(created.path, 'utf8')
    await writeFile(created.path, stored.replace('---\n\n', 'metadata:\n  owner: me\n---\n\n'))
    expect(await manager.readSkill({ name: 'release-notes' })).toMatchObject({ skill: draft, editable: true })
    await manager.updateSkill({ ...draft, body: 'New body.', userInvocable: false })
    const updated = await readFile(created.path, 'utf8')
    expect(updated).toContain('owner: me')
    expect(updated).toContain('user-invocable: false')
    expect(updated).toContain('New body.')

    await manager.deleteSkill({ name: 'release-notes' })
    expect(changed).toEqual([created.path, created.path, created.path])
    await expect(stat(join(home, 'skills', 'release-notes'))).rejects.toMatchObject({ code: 'ENOENT' })
    await vi.waitFor(async () => { expect(await names(manager)).toEqual([]) }, { timeout: 5000 })
  }, 15_000)

  it('refuses names already taken, invalid drafts, renames, and skills outside the user directory', async () => {
    const { ctx, manager, home } = await boot()
    ctx.skills.register({ name: 'taken', description: 'Runtime skill', source: 'runtime', content: 'body' })
    await expect(manager.createSkill({ ...draft, name: 'taken' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request', message: expect.stringContaining('(runtime)') as string })
    await expect(manager.createSkill({ ...draft, name: 'Bad' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    await expect(manager.readSkill({ name: 'taken' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
    await expect(manager.readSkill({ name: 'missing' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
    await expect(manager.deleteSkill({ name: 'missing' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })

    await manager.createSkill(draft)
    await vi.waitFor(async () => { expect((await names(manager)).map(([name]) => name)).toContain('release-notes') }, { timeout: 5000 })
    await expect(manager.updateSkill({ ...draft, description: '' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    await expect(new UserSkillRoot(join(home, 'skills')).create(draft)).rejects.toThrow('already exists')
  }, 15_000)

  it('edits flat Markdown skills in place and deletes only that file', async () => {
    const { manager, home } = await boot()
    await writeFile(join(home, 'skills', 'flat.md'), renderSkillFile({ ...draft, name: 'flat' }))
    await writeFile(join(home, 'skills', 'keep.txt'), 'x')
    await vi.waitFor(async () => { expect(await names(manager)).toEqual([['flat', true]]) }, { timeout: 5000 })
    await manager.updateSkill({ ...draft, name: 'flat', body: 'Changed.' })
    expect(await readFile(join(home, 'skills', 'flat.md'), 'utf8')).toContain('Changed.')
    await manager.deleteSkill({ name: 'flat' })
    await expect(stat(join(home, 'skills', 'flat.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(home, 'skills', 'keep.txt'), 'utf8')).toBe('x')
  }, 15_000)
})

describe('SkillManager read-only preview', () => {
  it('edits a local skill outside the user directory in place and reports an unreadable file', async () => {
    const { manager, home } = await boot()
    const other = join(home, 'agents', 'skills', 'shared')
    await mkdir(other, { recursive: true })
    await writeFile(join(other, 'SKILL.md'), renderSkillFile({ ...draft, name: 'shared' }))
    await vi.waitFor(async () => { expect((await names(manager)).map(([name]) => name)).toContain('shared') }, { timeout: 5000 })
    expect(await manager.readSkill({ name: 'shared' })).toMatchObject({ skill: { name: 'shared' }, editable: true })
    expect((await manager.inventory({})).skills.find(skill => skill.name === 'shared')).toMatchObject({ editable: true, deletable: false, customizable: false })
    await manager.updateSkill({ ...draft, name: 'shared', body: 'Edited in place.' })
    expect(await readFile(join(other, 'SKILL.md'), 'utf8')).toContain('Edited in place.')
    await expect(manager.customizeSkill({ name: 'shared' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
    await writeFile(join(other, 'SKILL.md'), 'broken')
    await expect(manager.readSkill({ name: 'shared' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
  }, 15_000)
})

describe('UserSkillRoot', () => {
  it('owns only its own bundle and flat paths, resolving a symlinked root', async () => {
    const real = await temp()
    const link = join(await temp(), 'linked-skills')
    await symlink(real, link)
    const root = new UserSkillRoot(link)
    expect(await root.owns('a', join(real, 'a', 'SKILL.md'))).toBe(true)
    expect(await root.owns('a', join(real, 'a.md'))).toBe(true)
    expect(await root.owns('a', join(real, 'b', 'SKILL.md'))).toBe(false)
    expect(await root.owns('a', undefined)).toBe(false)
    expect(await root.owns('Bad', join(real, 'Bad.md'))).toBe(false)
    expect(await new UserSkillRoot(join(real, 'missing')).owns('a', join(real, 'missing', 'a.md'))).toBe(true)
    expect(() => root.bundlePath('Bad')).toThrow('not a valid skill name')
  })

  it('refuses to rename a skill through an update', async () => {
    const dir = await temp()
    const root = new UserSkillRoot(dir)
    const path = await root.create(draft)
    await expect(root.update(path, { ...draft, name: 'renamed' })).rejects.toThrow('renaming "release-notes" to "renamed" is not supported')
  })

  it('refuses a name whose flat file exists and rethrows unexpected stat failures', async () => {
    const dir = await temp()
    await writeFile(join(dir, 'release-notes.md'), 'x')
    await expect(new UserSkillRoot(dir).create(draft)).rejects.toThrow('already exists')
    const file = join(dir, 'file')
    await writeFile(file, 'x')
    await expect(new UserSkillRoot(join(file, 'skills')).create(draft)).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(new UserSkillRoot(join(file, 'skills')).owns('a', '/x')).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
