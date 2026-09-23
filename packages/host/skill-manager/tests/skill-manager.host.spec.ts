import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'
import SkillPreferences from '@deepseek-ai/dsh-skill-preferences'
import SkillSources from '@deepseek-ai/dsh-skill-sources'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillManager } from '../src/index.ts'

const temps: string[] = []
afterEach(async () => { await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-manager-'))
  temps.push(dir)
  return dir
}

function candidate(name: string, source: string, invocation = { modelInvocable: true, userInvocable: true }): SkillCandidate {
  return { name, description: `${name} skill`, invocation, provider: 'memory', source, rank: 10, locator: undefined, path: `/skills/${name}/SKILL.md` }
}

const provider: SkillProvider = {
  name: 'memory',
  list: async () => [
    candidate('alpha', 'user-dsh'),
    { ...candidate('beta', 'bundled', { modelInvocable: true, userInvocable: false }), whenToUse: 'Sometimes' },
  ],
  get: async skill => ({ ...skill, content: 'body' }),
}

interface BootOptions { preferences?: boolean; sources?: boolean; workspaces?: boolean }

async function boot(options: BootOptions = {}): Promise<{ ctx: Context; manager: SkillManager; project: string }> {
  const home = await temp()
  const project = await temp()
  await mkdir(join(project, '.git'))
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  ctx.skills.registerProvider(() => provider)
  if (options.preferences !== false) await ctx.plugin(SkillPreferences, { dshHome: home, watch: false })
  if (options.sources !== false) await ctx.plugin(SkillSources, { dshHome: home, autoSyncOnStart: false })
  await vi.waitFor(() => {
    if (options.preferences !== false) expect(ctx.get('skillPreferences')).toBeDefined()
    if (options.sources !== false) expect(ctx.get('skillSources')).toBeDefined()
  })
  if (options.workspaces !== false) ctx.provide('workspaceRegistry', {
    list: () => [
      { path: join(project, 'src'), title: 'Report' },
      { path: project, title: 'Report again' },
    ],
  } as never)
  return { ctx, manager: new SkillManager(ctx), project }
}

describe('SkillManager', () => {
  it('lists skills with enablement, preference origin, projects, and mounted services', async () => {
    const { ctx, manager, project } = await boot()
    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: false })
    await ctx.skillPreferences.setEnabled({ name: 'beta', enabled: false, projectRoot: project })

    const global = await manager.inventory({})
    expect(global).toEqual({
      skills: [
        { name: 'alpha', description: 'alpha skill', source: 'user-dsh', provider: 'memory', path: '/skills/alpha/SKILL.md', modelInvocable: true, userInvocable: true, enabled: false, preference: 'global', editable: true, deletable: false, customizable: false, uninstallable: false },
        { name: 'beta', description: 'beta skill', whenToUse: 'Sometimes', source: 'bundled', provider: 'memory', path: '/skills/beta/SKILL.md', modelInvocable: true, userInvocable: false, enabled: true, preference: 'default', editable: false, deletable: false, customizable: true, uninstallable: false },
      ],
      complete: true,
      projects: [{ root: project, title: 'Report' }],
      preferencesAvailable: true,
      sourcesAvailable: true,
    })
    const scoped = await manager.inventory({ projectRoot: project })
    expect(scoped.skills.map(skill => [skill.name, skill.enabled, skill.preference])).toEqual([['alpha', false, 'global'], ['beta', false, 'project']])
  })

  it('writes and clears enablement through skill preferences', async () => {
    const { manager, project } = await boot()
    await manager.setEnabled({ name: 'alpha', enabled: false })
    await manager.setEnabled({ name: 'alpha', enabled: true, projectRoot: project })
    expect((await manager.inventory({ projectRoot: project })).skills[0]).toMatchObject({ enabled: true, preference: 'project' })
    await manager.clearOverride({ name: 'alpha', projectRoot: project })
    expect((await manager.inventory({ projectRoot: project })).skills[0]).toMatchObject({ enabled: false, preference: 'global' })
    await expect(manager.setEnabled({ name: 'Bad', enabled: false })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    await expect(manager.inventory({ projectRoot: 'relative' })).rejects.toBeInstanceOf(RemoteError)
  })

  it('manages sources and reports sync failures on the source', async () => {
    const { manager } = await boot()
    const added = await manager.addSource({ url: 'https://127.0.0.1:1/pack.zip' })
    expect(added.source).toMatchObject({ id: '127-0-0-1-pack', kind: 'archive', origin: 'user', enabled: true, skillCount: 0 })
    const synced = await manager.syncSource({ id: added.source.id })
    expect(synced.source.syncState).toBe('error')
    expect(synced.source.error).toBeTypeOf('string')
    expect((await manager.setSourceEnabled({ id: added.source.id, enabled: false })).source.enabled).toBe(false)
    expect((await manager.sources()).sources.map(source => source.id)).toEqual(['127-0-0-1-pack'])
    await manager.removeSource({ id: added.source.id })
    expect((await manager.sources()).sources).toEqual([])
    await expect(manager.addSource({ url: 'ftp://nope' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    await expect(manager.syncSource({ id: 'missing' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
  })

  it('reports missing services as unavailable and still lists the catalog', async () => {
    const { manager } = await boot({ preferences: false, sources: false })
    const inventory = await manager.inventory({})
    expect(inventory).toMatchObject({ preferencesAvailable: false, sourcesAvailable: false, projects: [{ title: 'Report' }, { title: 'Report again' }] })
    expect(inventory.skills.every(skill => skill.preference === 'default')).toBe(true)
    expect(await manager.sources()).toEqual({ sources: [] })
    for (const call of [
      () => manager.setEnabled({ name: 'alpha', enabled: false }),
      () => manager.clearOverride({ name: 'alpha', projectRoot: '/p' }),
      () => manager.addSource({ url: 'github:o/r' }),
      () => manager.syncSource({ id: 'x' }),
      () => manager.setSourceEnabled({ id: 'x', enabled: true }),
      () => manager.removeSource({ id: 'x' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'skill-manager/unavailable' })
    }
  })

  it('reads the default preset scope and falls back to the global layer when it is unusable', async () => {
    const { ctx, manager } = await boot()
    const dispose = vi.fn(async () => {})
    const acquireScope = vi.fn(async () => ({ key: {}, [Symbol.asyncDispose]: dispose }))
    ctx.provide('agentPresets', { acquireScope } as never)
    const inventory = vi.spyOn(ctx.skills, 'inventory')
    await manager.inventory({})
    expect(acquireScope).toHaveBeenCalledWith(undefined)
    expect(dispose).toHaveBeenCalledOnce()
    expect(inventory.mock.calls[0]?.[0]?.scope).toBeDefined()

    acquireScope.mockRejectedValueOnce(new Error('no default preset'))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    expect((await manager.inventory({})).skills).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no default preset'))
  })

  it('forwards catalog, preference, and source changes as skill-manager/changed', async () => {
    const { ctx } = await boot()
    let changes = 0
    ctx.on('skill-manager/changed', () => { changes += 1 })
    await ctx.skillPreferences.setEnabled({ name: 'alpha', enabled: false })
    expect(changes).toBeGreaterThanOrEqual(2)
    const before = changes
    ctx.emit('skill-sources/change')
    expect(changes).toBe(before + 1)
  })

  it('projects every optional source and skill field', async () => {
    const { ctx, manager } = await boot({ sources: false })
    ctx.provide('skillSources', {
      list: () => [{
        id: 'docs', url: 'github:o/r', ref: 'main', path: 'skills', enabled: true, origin: 'user', kind: 'github',
        skills: ['a'],
        sync: { state: 'ok', commit: 'c'.repeat(40), syncedAt: '2026-09-23T00:00:00.000Z', skillCount: 3, availableCount: 5, updateAvailable: true, latest: 'd'.repeat(40), checkedAt: '2026-09-23T01:00:00.000Z' },
      }],
    } as never)
    expect((await manager.sources()).sources).toEqual([{
      id: 'docs', url: 'github:o/r', ref: 'main', path: 'skills', enabled: true, origin: 'user', kind: 'github',
      skills: ['a'], syncState: 'ok', commit: 'c'.repeat(40), syncedAt: '2026-09-23T00:00:00.000Z', skillCount: 3,
      availableCount: 5, updateAvailable: true, latest: 'd'.repeat(40), checkedAt: '2026-09-23T01:00:00.000Z',
    }])
    ctx.skills.register({ name: 'virtual', description: 'No file', source: 'runtime', content: 'body' })
    expect((await manager.inventory({})).skills.find(skill => skill.name === 'virtual')).not.toHaveProperty('path')
  })

  it('offers no project scopes without a workspace registry', async () => {
    const { manager } = await boot({ workspaces: false })
    expect((await manager.inventory({})).projects).toEqual([])
  })
})
