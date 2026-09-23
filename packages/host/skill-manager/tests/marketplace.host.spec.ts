import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillSourceView } from '@deepseek-ai/dsh-skill-sources'
import type { MarketplaceSkill } from '@deepseek-ai/dsh-skill-marketplace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderSkillFile, SkillManager } from '../src/index.ts'

const temps: string[] = []
afterEach(async () => { await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-skill-market-'))
  temps.push(dir)
  return dir
}

function view(id: string, url: string, patch: Omit<Partial<SkillSourceView>, 'sync'> & { sync?: Partial<SkillSourceView['sync']> } = {}): SkillSourceView {
  const { sync, ...rest } = patch
  return {
    id, url, enabled: true, origin: 'user', kind: 'github',
    ...rest,
    sync: { state: 'ok', skillCount: 1, availableCount: 1, updateAvailable: false, ...sync },
  }
}

/** In-memory `ctx.skillSources` recording each call. */
type Offers = Record<string, Array<{ name: string; description: string; dir: string; installed: boolean }>>

function fakeSources(initial: SkillSourceView[], offers: Offers = {}) {
  const sources = [...initial]
  const replace = (id: string, patch: Partial<SkillSourceView>): SkillSourceView => {
    const index = sources.findIndex(source => source.id === id)
    const next = { ...sources[index] as SkillSourceView, ...patch }
    sources[index] = next
    return next
  }
  return {
    sources,
    list: vi.fn(() => [...sources]),
    add: vi.fn(async (request: { url: string; skills?: string[]; id: string }) => {
      const added = view(request.id, request.url, { ...request.skills === undefined ? {} : { skills: request.skills }, sync: { state: 'syncing' } })
      sources.push(added)
      return added
    }),
    setSkills: vi.fn(async (id: string, skills: readonly string[] | undefined) => {
      const { skills: _skills, ...rest } = sources.find(source => source.id === id) as SkillSourceView
      const next = skills === undefined ? rest : { ...rest, skills }
      sources[sources.findIndex(source => source.id === id)] = next
      return next
    }),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => replace(id, { enabled })),
    sync: vi.fn(async (id: string) => replace(id, { sync: { state: 'ok', skillCount: 1, availableCount: 1, updateAvailable: false } })),
    remove: vi.fn(async (id: string) => { sources.splice(sources.findIndex(source => source.id === id), 1) }),
    offers: vi.fn((id: string) => {
      const found = offers[id]
      if (found !== undefined) return found
      const source = sources.find(entry => entry.id === id)
      if (source === undefined) throw new Error(`unknown skill source "${id}"`)
      // Without explicit offers, a source offers its selection, or a fixed set when it installs everything.
      return (source.skills ?? ['x', 'one', 'two']).map(name => ({ name, description: '', dir: `skills/${name}`, installed: true }))
    }),
    checkUpdate: vi.fn(async (id: string) => {
      const current = sources.find(source => source.id === id) as SkillSourceView
      return replace(id, { sync: { ...current.sync, updateAvailable: true } })
    }),
  }
}

function entry(key: string, name: string, dir?: string): MarketplaceSkill {
  const [owner, repo] = key.split('/')
  return { marketplace: 'm', key, name, repository: `${owner}/${repo}`, url: `https://github.com/${key}`, ...dir === undefined ? {} : { dir } }
}

interface BootOptions { sources?: ReturnType<typeof fakeSources>; market?: unknown; candidates?: SkillCandidate[] }

async function boot(options: BootOptions = {}): Promise<{ ctx: Context; manager: SkillManager; home: string }> {
  const home = await temp()
  await mkdir(join(home, 'skills'), { recursive: true })
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: home, includeDefaultRoots: true, agentsHome: join(home, 'agents'), watchStabilityThresholdMs: 20 })
  const candidates = options.candidates ?? []
  ctx.skills.registerProvider(() => ({ name: 'memory', list: async () => candidates, get: async skill => ({ ...skill, content: 'body' }) }))
  if (options.sources !== undefined) ctx.provide('skillSources', options.sources as never)
  if (options.market !== undefined) ctx.provide('skillMarketplace', options.market as never)
  return { ctx, manager: new SkillManager(ctx, { dshHome: home }), home }
}

function remote(name: string, source: string, path?: string, rank = 450): SkillCandidate {
  return { name, description: `${name} skill`, invocation: { modelInvocable: true, userInvocable: true }, provider: 'memory', source, rank, locator: undefined, ...path === undefined ? {} : { path } }
}

describe('SkillManager marketplace', () => {
  it('lists marketplaces, refreshing counts on request, and reports a missing service', async () => {
    const market = { list: vi.fn(() => [{ id: 'm' }]), refreshCounts: vi.fn(async () => [{ id: 'm', available: 3 }]) }
    const { manager } = await boot({ market })
    expect(await manager.marketplaces({})).toEqual({ marketplaces: [{ id: 'm' }], available: true })
    expect(await manager.marketplaces({ refresh: true })).toEqual({ marketplaces: [{ id: 'm', available: 3 }], available: true })
    const noSources = await boot({ market: { search: async () => ({ skills: [entry('a/b/c', 'c')], totals: {}, hasMore: false, nextOffset: 1, errors: [] }) } })
    expect((await noSources.manager.searchMarketplace({ query: '' })).skills[0]?.state).toBe('available')
    const bare = await boot()
    expect(await bare.manager.marketplaces({})).toEqual({ marketplaces: [], available: false })
    await expect(bare.manager.searchMarketplace({ query: '' })).rejects.toMatchObject({ code: 'skill-manager/unavailable' })
  })

  it('marks search results available, installing, or installed, and flags same-name skills', async () => {
    const sources = fakeSources([
      view('whole', 'https://github.com/a/whole'),
      view('picked', 'https://github.com/a/picked', { skills: ['one'] }),
      view('fresh', 'https://github.com/a/fresh', { skills: ['new'], sync: { state: 'never' } }),
      view('pinned', 'https://github.com/a/pinned', { ref: 'v1' }),
      view('zip', 'https://x/a.zip', { kind: 'archive' }),
    ])
    const market = {
      search: vi.fn(async () => ({
        skills: [
          entry('a/whole/x', 'x', 'skills/x'),
          entry('a/picked/one', 'one', 'skills/one'),
          entry('a/picked/two', 'two', 'skills/two'),
          entry('a/fresh/new', 'new'),
          entry('a/pinned/p', 'p', 'p'),
          entry('b/other/local', 'local', 'local'),
        ],
        totals: { m: 6 },
        hasMore: false,
        nextOffset: 24,
        errors: [],
      })),
    }
    const { manager } = await boot({ sources, market, candidates: [remote('x', 'remote:whole'), remote('local', 'user-dsh')] })
    const result = await manager.searchMarketplace({ query: 'q' })
    expect(result.skills.map(skill => [skill.key, skill.state, skill.conflict])).toEqual([
      ['a/whole/x', 'installed', undefined],
      ['a/picked/one', 'installed', undefined],
      ['a/picked/two', 'available', undefined],
      ['a/fresh/new', 'installing', undefined],
      ['a/pinned/p', 'available', undefined],
      ['b/other/local', 'available', 'user-dsh'],
    ])
    expect(result).toMatchObject({ totals: { m: 6 }, hasMore: false, nextOffset: 24, errors: [] })
    market.search.mockRejectedValueOnce(new Error('unknown skill marketplace "z"'))
    await expect(manager.searchMarketplace({ query: '', marketplace: 'z' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
  })

  it('installs into the source that tracks the repository or adds a source for one skill', async () => {
    const sources = fakeSources([
      view('a-picked', 'https://github.com/a/picked', { skills: ['one'], enabled: false }),
      view('a-whole', 'https://github.com/A/Whole'),
      view('a-broken', 'https://github.com/a/broken', { skills: ['x'], sync: { state: 'error' } }),
      view('a-new', 'https://github.com/a/other-thing'),
    ])
    const { manager } = await boot({ sources })

    expect((await manager.installSkill({ repository: 'a/picked', dir: 'skills/two/', name: 'Two' })).source).toMatchObject({ id: 'a-picked', skills: ['one', 'two'], enabled: true })
    await manager.installSkill({ repository: 'a/picked', name: 'one' })
    expect(sources.setSkills).toHaveBeenCalledTimes(1)
    expect((await manager.installSkill({ repository: 'a/whole', name: 'x' })).source.id).toBe('a-whole')
    await manager.installSkill({ repository: 'a/broken', name: 'x' })
    expect(sources.sync).toHaveBeenCalledWith('a-broken')

    const added = await manager.installSkill({ repository: 'a/new', dir: 'skills/pdf', name: 'pdf' })
    expect(sources.add).toHaveBeenCalledWith({ url: 'https://github.com/a/new', skills: ['pdf'], id: 'a-new-2' })
    expect(sources.sync).toHaveBeenLastCalledWith('a-new-2')
    expect(added.source).toMatchObject({ id: 'a-new-2', syncState: 'ok' })
    await expect(manager.installSkill({ repository: 'not a repo', name: 'x' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    await expect((await boot()).manager.installSkill({ repository: 'a/b', name: 'x' })).rejects.toMatchObject({ code: 'skill-manager/unavailable' })
  })

  it('narrows a disabled whole-repository source and undoes an install whose skill the repository lacks', async () => {
    const offers = { empty: [], off: [{ name: 'keep', description: '', dir: 'keep', installed: false }] }
    const sources = fakeSources([
      view('whole', 'https://github.com/a/whole', { enabled: false }),
      view('empty', 'https://github.com/a/empty', { skills: ['old'] }),
      view('off', 'https://github.com/a/off', { skills: ['keep'], enabled: false }),
    ], offers)
    const { manager } = await boot({ sources })
    expect((await manager.installSkill({ repository: 'a/whole', name: 'x' })).source).toMatchObject({ skills: ['x'], enabled: true })

    await expect(manager.installSkill({ repository: 'a/empty', dir: 'deep/missing', name: 'missing' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    expect(sources.setSkills).toHaveBeenLastCalledWith('empty', ['old'])
    await expect(manager.installSkill({ repository: 'a/off', name: 'gone' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    expect(sources.setEnabled).toHaveBeenLastCalledWith('off', false)

    offers.empty.length = 0
    sources.add.mockImplementationOnce(async (request: { url: string; skills?: string[]; id: string }) => {
      const added = view(request.id, request.url, { skills: request.skills ?? [] })
      sources.sources.push(added)
      offers[request.id as 'empty'] = []
      return added
    })
    await expect(manager.installSkill({ repository: 'b/none', name: 'nothing' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    expect(sources.remove).toHaveBeenCalledWith('b-none')
  })

  it('uninstalls a remote skill from its selection and removes an emptied user source', async () => {
    const offers = {
      shared: [
        { name: 'pdf', description: '', dir: 'skills/pdf', installed: true },
        { name: 'docx', description: '', dir: 'skills/doc-dir', installed: true },
        { name: 'root', description: '', dir: '', installed: true },
        { name: 'skip', description: '', dir: 'skills/skip', installed: false },
      ],
      solo: [{ name: 'only', description: '', dir: 'only', installed: true }],
      base: [{ name: 'basic', description: '', dir: 'basic', installed: true }],
    }
    const sources = fakeSources([view('shared', 'https://github.com/a/s'), view('solo', 'https://github.com/a/solo', { skills: ['only'] }), view('base', 'https://github.com/a/b', { origin: 'default' })], offers)
    const { manager } = await boot({ sources, candidates: [remote('pdf', 'remote:shared'), remote('only', 'remote:solo'), remote('basic', 'remote:base'), remote('mine', 'user-dsh')] })
    await manager.uninstallSkill({ name: 'pdf' })
    expect(sources.setSkills).toHaveBeenCalledWith('shared', ['doc-dir', 'root'])
    await manager.uninstallSkill({ name: 'only' })
    expect(sources.remove).toHaveBeenCalledWith('solo')
    await manager.uninstallSkill({ name: 'basic' })
    expect(sources.setSkills).toHaveBeenLastCalledWith('base', [])
    await expect(manager.uninstallSkill({ name: 'mine' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
    await expect(manager.uninstallSkill({ name: 'missing' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
  })

  it('lists and replaces a source selection and checks GitHub sources for updates', async () => {
    const sources = fakeSources([view('gh', 'https://github.com/a/b'), view('off', 'https://github.com/a/c', { enabled: false }), view('zip', 'https://x/a.zip', { kind: 'archive' })], { gh: [{ name: 'a', description: 'A', dir: 'a', installed: true }] })
    const { manager } = await boot({ sources })
    expect(await manager.sourceSkills({ id: 'gh' })).toEqual({ skills: [{ name: 'a', description: 'A', dir: 'a', installed: true }] })
    await expect(manager.sourceSkills({ id: 'nope' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
    expect((await manager.setSourceSkills({ id: 'gh', skills: ['a'] })).source.skills).toEqual(['a'])
    const checked = await manager.checkUpdates()
    expect(sources.checkUpdate.mock.calls).toEqual([['gh']])
    expect(checked.sources.find(source => source.id === 'gh')?.updateAvailable).toBe(true)
    expect(await (await boot()).manager.checkUpdates()).toEqual({ sources: [] })
  })
})

describe('SkillManager customize', () => {
  it('copies a remote skill directory into the user skills directory, where the copy takes its place', async () => {
    const remoteDir = await temp()
    await mkdir(join(remoteDir, 'pdf', 'scripts'), { recursive: true })
    await writeFile(join(remoteDir, 'pdf', 'SKILL.md'), renderSkillFile({ name: 'pdf', description: 'PDFs', body: 'Original.', modelInvocable: true, userInvocable: true }))
    await writeFile(join(remoteDir, 'pdf', 'scripts', 'run.py'), 'print(1)')
    await writeFile(join(remoteDir, 'pdf', '.git-keep'), '')
    await writeFile(join(remoteDir, 'flat.md'), renderSkillFile({ name: 'flat', description: 'Flat', body: 'Flat.', modelInvocable: true, userInvocable: true }))
    const { manager, home } = await boot({ candidates: [
      remote('pdf', 'remote:anthropic', join(remoteDir, 'pdf', 'SKILL.md')),
      remote('flat', 'bundled', join(remoteDir, 'flat.md'), 600),
      remote('virtual', 'bundled'),
    ] })
    expect((await manager.inventory({})).skills.find(skill => skill.name === 'pdf')).toMatchObject({ editable: false, customizable: true, uninstallable: true, deletable: false })

    const copy = await manager.customizeSkill({ name: 'pdf' })
    expect(copy).toMatchObject({ skill: { name: 'pdf', body: 'Original.' }, path: join(home, 'skills', 'pdf', 'SKILL.md'), editable: true })
    expect(await readFile(join(home, 'skills', 'pdf', 'scripts', 'run.py'), 'utf8')).toBe('print(1)')
    await expect(stat(join(home, 'skills', 'pdf', '.git-keep'))).rejects.toMatchObject({ code: 'ENOENT' })
    await vi.waitFor(async () => {
      expect((await manager.inventory({})).skills.find(skill => skill.name === 'pdf')).toMatchObject({ source: 'user-dsh', editable: true, deletable: true })
    }, { timeout: 5000 })
    await manager.updateSkill({ ...copy.skill, body: 'Mine.' })
    expect(await readFile(copy.path, 'utf8')).toContain('Mine.')

    expect((await manager.customizeSkill({ name: 'flat' })).path).toBe(join(home, 'skills', 'flat', 'SKILL.md'))
    await expect(manager.customizeSkill({ name: 'virtual' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
    await expect(manager.customizeSkill({ name: 'pdf' })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
    await expect(manager.updateSkill({ name: 'virtual', description: 'x', body: '', modelInvocable: true, userInvocable: true })).rejects.toMatchObject({ code: 'skill-manager/read-only' })
  }, 15_000)

  it('refuses to overwrite an existing user skill folder and reports stat failures', async () => {
    const remoteDir = await temp()
    await mkdir(join(remoteDir, 'dup'), { recursive: true })
    await writeFile(join(remoteDir, 'dup', 'SKILL.md'), renderSkillFile({ name: 'dup', description: 'Dup', body: 'x', modelInvocable: true, userInvocable: true }))
    const { manager, home } = await boot({ candidates: [remote('dup', 'remote:x', join(remoteDir, 'dup', 'SKILL.md'), 100)] })
    await mkdir(join(home, 'skills', 'dup'))
    await expect(manager.customizeSkill({ name: 'dup' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request', message: expect.stringContaining('already exists') as string })
    await rm(join(home, 'skills'), { recursive: true })
    await writeFile(join(home, 'skills'), 'not a directory')
    await expect(manager.customizeSkill({ name: 'dup' })).rejects.toMatchObject({ code: 'skill-manager/invalid-request' })
  }, 15_000)
})
