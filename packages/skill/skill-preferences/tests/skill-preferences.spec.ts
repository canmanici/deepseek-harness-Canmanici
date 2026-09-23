import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'
import SkillPreferences, { parseState, resolveSkillPreferencesSpec } from '../src/index.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-preferences-'))
  tempDirs.push(dir)
  return dir
}

function candidate(name: string): SkillCandidate {
  return {
    name,
    description: `${name} skill`,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'memory',
    source: 'memory',
    rank: 10,
    locator: undefined,
  }
}

const provider: SkillProvider = {
  name: 'memory',
  list: async () => [candidate('alpha'), candidate('beta')],
  get: async skill => ({ ...skill, content: `${skill.name} body` }),
}

async function boot(options: { watch?: boolean } = {}): Promise<{ ctx: Context; file: string; project: string; nested: string }> {
  const home = await tempDir()
  const project = await tempDir()
  await mkdir(join(project, '.git'))
  const nested = join(project, 'src', 'deep')
  await mkdir(nested, { recursive: true })
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  ctx.skills.registerProvider(() => provider)
  await ctx.plugin(SkillPreferences, { dshHome: home, watch: options.watch ?? false })
  await vi.waitFor(() => { expect(ctx.get('skillPreferences')).toBeDefined() })
  return { ctx, file: join(home, 'skill-preferences.json'), project, nested }
}

async function names(ctx: Context, cwd?: string): Promise<string[]> {
  return (await ctx.skills.list({ cwd })).map(skill => skill.name)
}

describe('SkillPreferences', () => {
  it('resolves the file under the configured DSH home or an explicit path', () => {
    expect(resolveSkillPreferencesSpec({ dshHome: '/home/u/.dsh' })).toEqual({ file: '/home/u/.dsh/skill-preferences.json', watch: true })
    expect(resolveSkillPreferencesSpec({ file: '/etc/prefs.json', watch: false })).toEqual({ file: '/etc/prefs.json', watch: false })
  })

  it('enables everything without a file, then persists a global disable', async () => {
    const { ctx, file } = await boot()
    expect(await names(ctx)).toEqual(['alpha', 'beta'])
    let changes = 0
    ctx.on('skill-preferences/change', () => { changes += 1 })

    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: false })
    expect(changes).toBe(1)
    expect(await names(ctx)).toEqual(['beta'])
    expect(await ctx.skills.get('alpha')).toBeUndefined()
    expect(ctx.skillPreferences.decide('alpha')).toEqual({ enabled: false, origin: 'global' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, global: { disabled: ['alpha'] }, projects: {} })

    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: true })
    expect(await names(ctx)).toEqual(['alpha', 'beta'])
    expect(ctx.skillPreferences.decide('alpha')).toEqual({ enabled: true, origin: 'default' })
  })

  it('applies project overrides to lookups from any directory inside the project', async () => {
    const { ctx, project, nested } = await boot()
    const projectRoot = await ctx.skillPreferences.projectRootOf(nested)
    expect(projectRoot).toBe(project)

    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: false })
    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: true, projectRoot })
    await ctx.skillPreferences.setEnabled({ name: 'beta', enabled: false, projectRoot })
    expect(await names(ctx)).toEqual(['beta'])
    expect(await names(ctx, nested)).toEqual(['alpha'])
    expect(ctx.skillPreferences.decide('alpha', projectRoot)).toEqual({ enabled: true, origin: 'project' })
    expect(ctx.skillPreferences.decide('beta', projectRoot)).toEqual({ enabled: false, origin: 'project' })
    const inventory = await ctx.skills.inventory({ cwd: nested })
    expect(inventory.skills.map(({ name, disabledBy }) => ({ name, disabledBy }))).toEqual([
      { name: 'alpha', disabledBy: [] },
      { name: 'beta', disabledBy: ['skill-preferences'] },
    ])

    await ctx.skillPreferences.clearOverride({ name: 'beta', projectRoot })
    expect(await names(ctx, nested)).toEqual(['alpha', 'beta'])
    await ctx.skillPreferences.setEnabled({ name: 'beta', enabled: false, projectRoot })
    await ctx.skillPreferences.setEnabled({ name: 'beta', enabled: true, projectRoot })
    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: false, projectRoot })
    expect(ctx.skillPreferences.state().projects).toEqual({})
  })

  it('rejects invalid names and relative project roots before writing', async () => {
    const { ctx, file } = await boot()
    await expect(ctx.skillPreferences.setEnabled({ name: 'Bad Name', enabled: false })).rejects.toThrow('invalid skill name')
    await expect(ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: false, projectRoot: 'relative' })).rejects.toThrow('must be absolute')
    await expect(ctx.skillPreferences.clearOverride({ name: 'alpha', projectRoot: 'relative' })).rejects.toThrow('must be absolute')
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reloads external edits, fails closed while the file is malformed, and never overwrites it', async () => {
    const { ctx, file } = await boot({ watch: true })
    await writeFile(file, JSON.stringify({ version: 1, global: { disabled: ['beta'] }, projects: {} }))
    await vi.waitFor(async () => { expect(await names(ctx)).toEqual(['alpha']) }, { timeout: 5000 })

    await writeFile(file, '{ not json')
    await vi.waitFor(async () => { await expect(ctx.skills.list()).rejects.toThrow('invalid skill preferences file') }, { timeout: 5000 })

    await expect(ctx.skillPreferences.setEnabled({ name: 'beta', enabled: true })).rejects.toThrow('invalid skill preferences file')
    expect(await readFile(file, 'utf8')).toBe('{ not json')

    await writeFile(file, JSON.stringify({ version: 1, global: { disabled: ['beta'] }, projects: {} }))
    await vi.waitFor(async () => { expect(await names(ctx)).toEqual(['alpha']) }, { timeout: 5000 })

    let changes = 0
    ctx.on('skill-preferences/change', () => { changes += 1 })
    await writeFile(join(file, '..', 'unrelated.json'), '{}')
    await ctx.skillPreferences.setEnabled({ name: 'beta', enabled: true })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(changes).toBe(1)
  }, 15_000)

  it('restores every skill when the plugin is disposed', async () => {
    const home = await tempDir()
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.registerProvider(() => provider)
    await writeFile(join(home, 'skill-preferences.json'), JSON.stringify({ version: 1, global: { disabled: ['alpha'] }, projects: {} }))
    const fiber = await ctx.plugin(SkillPreferences, { dshHome: home, watch: true })
    await vi.waitFor(async () => { expect(await names(ctx)).toEqual(['beta']) })
    await fiber.dispose()
    expect(await names(ctx)).toEqual(['alpha', 'beta'])
  })
})

describe('SkillPreferences load failures', () => {
  it('refuses to start when the preferences path cannot be read', async () => {
    const dir = await tempDir()
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = ctx.plugin(SkillPreferences, { file: dir, watch: false })
    await expect(fiber).rejects.toMatchObject({ code: 'EISDIR' })
    expect(ctx.get('skillPreferences')).toBeUndefined()
  })
})

describe('parseState', () => {
  const parse = (value: unknown): unknown => parseState(JSON.stringify(value), '/p.json')

  it('normalizes valid content', () => {
    const projects = { '/s': { enabled: [], disabled: ['y'] }, '/r': { enabled: ['x'], disabled: [] }, '/t': { enabled: ['z'], disabled: [] } }
    const parsed = parse({ version: 1, global: { disabled: ['b', 'a', 'a'] }, projects })
    expect(parsed).toEqual({ global: { disabled: ['a', 'b'] }, projects })
    expect(Object.keys((parsed as { projects: object }).projects)).toEqual(['/r', '/s', '/t'])
  })

  it.each([
    ['not json', '{', 'invalid skill preferences file /p.json'],
    ['non-object', '[]', 'expected an object'],
    ['version', JSON.stringify({ version: 2 }), 'unsupported version 2'],
    ['global', JSON.stringify({ version: 1, global: [] }), '"global" must be an object'],
    ['global list', JSON.stringify({ version: 1, global: { disabled: 'a' } }), '"global.disabled" must be an array'],
    ['name', JSON.stringify({ version: 1, global: { disabled: ['Bad'] }, projects: {} }), 'invalid skill name "Bad"'],
    ['projects', JSON.stringify({ version: 1, global: { disabled: [] }, projects: [] }), '"projects" must be an object'],
    ['relative root', JSON.stringify({ version: 1, global: { disabled: [] }, projects: { rel: {} } }), 'must be absolute'],
    ['project value', JSON.stringify({ version: 1, global: { disabled: [] }, projects: { '/r': 1 } }), 'must be an object'],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseState(raw, '/p.json')).toThrow(message)
  })
})
