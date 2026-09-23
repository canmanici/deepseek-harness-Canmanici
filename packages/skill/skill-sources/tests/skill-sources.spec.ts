import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SkillSources, { parseManifest, parseSourcesState, resolveSkillSourcesSpec, type Config } from '../src/index.ts'
import { serveRepo, skillText, startServer, tempDir, zipOf, type FixtureServer } from './fixtures.ts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

interface Harness {
  ctx: Context
  home: string
  server: FixtureServer
}

async function harness(): Promise<{ home: string; server: FixtureServer }> {
  const temp = await tempDir()
  const server = await startServer()
  cleanups.push(temp.cleanup, () => server.close())
  return { home: temp.path, server }
}

async function boot(home: string, server: FixtureServer, config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillSources, {
    dshHome: home,
    githubApiUrl: server.url,
    allowHttpLoopback: true,
    autoSyncOnStart: false,
    ...config,
  })
  await vi.waitFor(() => { expect(ctx.get('skillSources')).toBeDefined() })
  cleanups.unshift(async () => { await ctx.fiber.dispose() })
  return ctx
}

async function names(ctx: Context): Promise<string[]> {
  return (await ctx.skills.list()).map(skill => `${skill.name}@${skill.source}`)
}

const anthropic = { id: 'anthropic-skills', url: 'https://github.com/o/r', enabled: true }

async function withGitHubApi(h: { home: string; server: FixtureServer }, config: Config): Promise<Harness> {
  const ctx = await boot(h.home, h.server, config)
  return { ctx, ...h }
}

describe('SkillSources GitHub sync', () => {
  it('syncs a default source on start, exposes its skills, and loads bodies from disk', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, {
      'skills/pdf/SKILL.md': skillText('pdf', 'Work with PDFs', 'Use pdftotext.'),
      'skills/pdf/scripts/run.py': 'print(1)',
      'README.md': '# repo',
    })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic], autoSyncOnStart: true })
    await vi.waitFor(async () => { expect(await names(ctx)).toEqual(['pdf@remote:anthropic-skills']) })

    const [view] = ctx.skillSources.list()
    expect(view).toMatchObject({ id: 'anthropic-skills', origin: 'default', kind: 'github', enabled: true, sync: { state: 'ok', commit: SHA_A, skillCount: 1 } })
    const skill = await ctx.skills.get('pdf')
    expect(skill).toMatchObject({ content: 'Use pdftotext.', provider: 'skill-sources', source: 'remote:anthropic-skills' })
    expect(skill?.resourceBase).toEqual({ kind: 'directory', path: join(h.home, 'skill-sources', 'anthropic-skills', SHA_A, 'skills', 'pdf') })
    expect(await readFile(join(h.home, 'skill-sources', 'anthropic-skills', SHA_A, 'skills', 'pdf', 'scripts', 'run.py'), 'utf8')).toBe('print(1)')
    expect(h.server.requests[0]?.headers.accept).toBe('application/vnd.github.sha')
  })

  it('skips unchanged commits, replaces changed generations, and keeps the last good generation on failure', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first') })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic] })
    let changes = 0
    ctx.on('skill-sources/change', () => { changes += 1 })
    await ctx.skillSources.sync('anthropic-skills')
    expect(changes).toBe(2)
    const zipRequests = (): number => h.server.requests.filter(request => request.path.includes('zipball')).length
    await ctx.skillSources.sync('anthropic-skills')
    expect(zipRequests()).toBe(1)

    serveRepo(h.server, 'o/r', SHA_B, { 'a/SKILL.md': skillText('second') })
    await ctx.skillSources.sync('anthropic-skills')
    expect(await names(ctx)).toEqual(['second@remote:anthropic-skills'])
    expect((await readdir(join(h.home, 'skill-sources', 'anthropic-skills'))).sort()).toEqual([SHA_B, 'current.json'])

    h.server.routes.set('/repos/o/r/commits/HEAD', { status: 503, body: 'down' })
    const failed = await ctx.skillSources.sync('anthropic-skills')
    expect(failed.sync).toMatchObject({ state: 'error', commit: SHA_B })
    expect(failed.sync.error).toContain('HTTP 503')
    expect(await names(ctx)).toEqual(['second@remote:anthropic-skills'])
  })

  it('shares one sync between concurrent callers and rejects malformed commits', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first') })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic] })
    const [left, right] = await Promise.all([ctx.skillSources.sync('anthropic-skills'), ctx.skillSources.sync('anthropic-skills')])
    expect(left).toEqual(right)
    expect(h.server.requests.filter(request => request.path.includes('/commits/')).length).toBe(1)

    h.server.routes.set('/repos/o/r/commits/HEAD', { body: 'not-a-sha' })
    expect((await ctx.skillSources.sync('anthropic-skills')).sync.error).toContain('invalid commit')
  })

  it('sends a GitHub token from the configured credential reference', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first') }, 'v1')
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async (ref: string) => (ref === 'MY_TOKEN' ? { value: 'secret', source: 'env' } : undefined) } as never)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillSources, {
      dshHome: h.home, githubApiUrl: h.server.url, allowHttpLoopback: true, autoSyncOnStart: false,
      githubTokenRef: 'MY_TOKEN', defaultSources: [{ ...anthropic, ref: 'v1' }],
    })
    await vi.waitFor(() => { expect(ctx.get('skillSources')).toBeDefined() })
    await ctx.skillSources.sync('anthropic-skills')
    expect(h.server.requests[0]?.headers.authorization).toBe('Bearer secret')
    expect(h.server.requests[0]?.path).toBe('/repos/o/r/commits/v1')
  })
})

describe('SkillSources management', () => {
  it('disables, re-enables, and removes a default source without resurrecting it', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first') })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic] })
    await ctx.skillSources.sync('anthropic-skills')

    expect((await ctx.skillSources.setEnabled('anthropic-skills', false)).enabled).toBe(false)
    expect(await names(ctx)).toEqual([])
    await ctx.skillSources.setEnabled('anthropic-skills', true)
    expect(await names(ctx)).toEqual(['first@remote:anthropic-skills'])

    await ctx.skillSources.remove('anthropic-skills')
    expect(ctx.skillSources.list()).toEqual([])
    expect(await names(ctx)).toEqual([])
    await expect(readdir(join(h.home, 'skill-sources', 'anthropic-skills'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(h.home, 'skill-sources.json'), 'utf8'))).toEqual({
      version: 1, sources: [], defaults: { 'anthropic-skills': { removed: true } },
    })
    await expect(ctx.skillSources.add({ url: 'github:o/r', id: 'anthropic-skills' })).rejects.toThrow('already exists')
    await expect(ctx.skillSources.sync('anthropic-skills')).rejects.toThrow('unknown skill source')
  })

  it('installs a selection of a source, lists every offer, and changes the selection without downloading', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'skills/pdf/SKILL.md': skillText('pdf'), 'skills/doc-dir/SKILL.md': skillText('docx'), 'x/SKILL.md': skillText('other') })
    const { ctx } = await withGitHubApi(h, { defaultSources: [{ ...anthropic, skills: ['pdf'] }] })
    await ctx.skillSources.sync('anthropic-skills')
    expect(await names(ctx)).toEqual(['pdf@remote:anthropic-skills'])
    expect(ctx.skillSources.list()[0]).toMatchObject({ skills: ['pdf'], sync: { skillCount: 1, availableCount: 3, updateAvailable: false } })
    expect(ctx.skillSources.offers('anthropic-skills').map(offer => `${offer.name}:${offer.installed}`)).toEqual(['docx:false', 'pdf:true', 'other:false'])

    const downloads = h.server.requests.length
    await ctx.skillSources.setSkills('anthropic-skills', [' doc-dir ', 'pdf', 'pdf', ''])
    expect((await names(ctx)).sort()).toEqual(['docx@remote:anthropic-skills', 'pdf@remote:anthropic-skills'])
    await ctx.skillSources.setSkills('anthropic-skills', undefined)
    expect(await names(ctx)).toEqual(['pdf@remote:anthropic-skills'])
    expect(h.server.requests.length).toBe(downloads)

    const added = await ctx.skillSources.add({ url: 'https://github.com/o/r', id: 'mine', skills: ['other'] })
    expect(added.skills).toEqual(['other'])
    await ctx.skillSources.sync('mine')
    await ctx.skillSources.add({ url: 'github:o/elsewhere', id: 'second' })
    await ctx.skillSources.setSkills('mine', ['pdf'])
    await ctx.skillSources.setSkills('mine', undefined)
    await ctx.skillSources.setSkills('anthropic-skills', [])
    const saved = JSON.parse(await readFile(join(h.home, 'skill-sources.json'), 'utf8')) as { sources: Array<Record<string, unknown>>; defaults: Record<string, unknown> }
    expect(saved.sources[0]).not.toHaveProperty('skills')
    expect(saved.sources[1]).toMatchObject({ id: 'second' })
    expect(saved.defaults['anthropic-skills']).toEqual({ skills: [] })
    expect(ctx.skillSources.offers('anthropic-skills').every(offer => !offer.installed)).toBe(true)
    await ctx.skillSources.remove('mine')
    expect(() => ctx.skillSources.offers('mine')).toThrow('unknown skill source')
  })

  it('reports offers only after a sync and checks upstream commits for updates', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first') })
    h.server.routes.set('/z.zip', { body: zipOf({ 'b/SKILL.md': skillText('zipped') }) })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic] })
    expect(ctx.skillSources.offers('anthropic-skills')).toEqual([])
    await ctx.skillSources.sync('anthropic-skills')

    const current = await ctx.skillSources.checkUpdate('anthropic-skills')
    expect(current.sync).toMatchObject({ updateAvailable: false, latest: SHA_A })
    expect(typeof current.sync.checkedAt).toBe('string')
    serveRepo(h.server, 'o/r', SHA_B, { 'a/SKILL.md': skillText('first') })
    expect((await ctx.skillSources.checkUpdate('anthropic-skills')).sync).toMatchObject({ updateAvailable: true, latest: SHA_B })
    await ctx.skillSources.sync('anthropic-skills')
    expect(ctx.skillSources.list()[0]?.sync.updateAvailable).toBe(false)

    h.server.routes.delete('/repos/o/r/commits/HEAD')
    expect((await ctx.skillSources.checkUpdate('anthropic-skills')).sync.error).toContain('HTTP 404')
    serveRepo(h.server, 'o/r', SHA_B, { 'a/SKILL.md': skillText('first') })
    expect((await ctx.skillSources.checkUpdate('anthropic-skills')).sync.error).toBeUndefined()

    await ctx.skillSources.add({ url: `${h.server.url}/z.zip`, id: 'zip' })
    await ctx.skillSources.sync('zip')
    expect((await ctx.skillSources.checkUpdate('zip')).sync).toMatchObject({ updateAvailable: false })
    expect(ctx.skillSources.list().find(source => source.id === 'zip')?.sync).not.toHaveProperty('latest')
  })

  it('rejects an update check interrupted by disposal', async () => {
    const h = await harness()
    h.server.routes.set('/repos/o/r/commits/HEAD', { body: SHA_A, delayMs: 200 })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic] })
    const check = ctx.skillSources.checkUpdate('anthropic-skills')
    await ctx.fiber.dispose()
    await expect(check).rejects.toThrow()
  })

  it('adds archive and skill-file sources, syncs them, and persists them across restarts', async () => {
    const h = await harness()
    h.server.routes.set('/pack.zip', { body: zipOf({ 'pack/skills/zip-skill/SKILL.md': skillText('zip-skill') }) })
    h.server.routes.set('/one/SKILL.md', { body: skillText('single-file') })
    const ctx = await boot(h.home, h.server)

    const archive = await ctx.skillSources.add({ url: `${h.server.url}/pack.zip`, path: 'skills' })
    expect(archive).toMatchObject({ id: '127-0-0-1-pack', origin: 'user', kind: 'archive', path: 'skills', sync: { state: 'syncing' } })
    const single = await ctx.skillSources.add({ url: `${h.server.url}/one/SKILL.md`, id: 'single', ref: ' ' })
    await vi.waitFor(async () => {
      expect(await names(ctx)).toEqual(['single-file@remote:single', 'zip-skill@remote:127-0-0-1-pack'])
    })
    expect(single.kind).toBe('skill-file')
    await ctx.skillSources.setEnabled('single', false)
    await ctx.skillSources.sync('single')
    expect(ctx.skillSources.list().map(view => view.sync.state)).toEqual(['ok', 'ok'])

    const restarted = await boot(h.home, h.server)
    expect(await names(restarted)).toEqual(['zip-skill@remote:127-0-0-1-pack'])
    expect(restarted.skillSources.list().map(view => [view.id, view.enabled])).toEqual([['127-0-0-1-pack', true], ['single', false]])

    await restarted.skillSources.remove('single')
    expect(restarted.skillSources.list().map(view => view.id)).toEqual(['127-0-0-1-pack'])
  })

  it('reports oversized and invalid single-file sources', async () => {
    const h = await harness()
    h.server.routes.set('/big.md', { body: skillText('big', 'x'.repeat(200)) })
    h.server.routes.set('/bad.md', { body: 'no frontmatter' })
    const ctx = await boot(h.home, h.server, { maxSkillBytes: 100 })
    await ctx.skillSources.add({ url: `${h.server.url}/big.md`, id: 'big' })
    await ctx.skillSources.add({ url: `${h.server.url}/bad.md`, id: 'bad' })
    await vi.waitFor(() => { expect(ctx.skillSources.list().map(view => view.sync.state)).toEqual(['error', 'error']) })
    expect(ctx.skillSources.list().map(view => view.sync.error)).toEqual([
      expect.stringContaining('larger than 100 bytes'),
      'missing YAML frontmatter',
    ])
  })

  it('starts a first sync when a never-synced source is enabled and discards syncs of removed sources', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first') })
    const ctx = await boot(h.home, h.server, { defaultSources: [{ ...anthropic, enabled: false }] })
    expect(ctx.skillSources.list()[0]?.sync.state).toBe('never')
    await ctx.skillSources.setEnabled('anthropic-skills', true)
    await vi.waitFor(async () => { expect(await names(ctx)).toEqual(['first@remote:anthropic-skills']) })

    h.server.routes.set('/late.zip', { body: zipOf({ 'late/SKILL.md': skillText('late') }) })
    await ctx.skillSources.add({ url: `${h.server.url}/late.zip`, id: 'late' })
    await ctx.skillSources.remove('late')
    await vi.waitFor(() => { expect(h.server.requests.some(request => request.path === '/late.zip')).toBe(true) })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(await names(ctx)).toEqual(['first@remote:anthropic-skills'])
    await expect(readdir(join(h.home, 'skill-sources', 'late'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('treats a deleted skill file as no longer loadable and propagates other read failures', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('first'), 'b/SKILL.md': skillText('second') })
    const { ctx } = await withGitHubApi(h, { defaultSources: [anthropic] })
    await ctx.skillSources.sync('anthropic-skills')
    const generation = join(h.home, 'skill-sources', 'anthropic-skills', SHA_A)
    const { rm } = await import('node:fs/promises')
    await rm(join(generation, 'a', 'SKILL.md'))
    expect(await ctx.skills.get('first')).toBeUndefined()
    await rm(join(generation, 'b', 'SKILL.md'))
    await mkdir(join(generation, 'b', 'SKILL.md'))
    await expect(ctx.skills.get('second')).rejects.toMatchObject({ code: 'EISDIR' })
  })
})

describe('SkillSources edge cases', () => {
  it('parses optional frontmatter, reports discovery warnings, and resumes without syncing already-synced sources', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, {
      'rich/SKILL.md': '---\nname: rich\ndescription: Rich\nwhenToUse: Always\nmetadata:\n  team: docs\n---\n\nBody.\n',
      'broken/SKILL.md': 'nope',
    })
    const warnings: string[] = []
    const ctx = await boot(h.home, h.server, { defaultSources: [{ id: 'docs', url: 'github:o/r', path: '' }] })
    ctx.logger.warn = (message: string) => { warnings.push(message) }
    await ctx.skillSources.sync('docs')
    expect(await ctx.skills.list()).toMatchObject([{ name: 'rich', whenToUse: 'Always' }])
    expect((await ctx.skills.get('rich'))?.metadata).toEqual({ team: 'docs' })
    expect(warnings).toEqual(['skill source "docs": broken/SKILL.md ignored: missing YAML frontmatter'])

    const requests = h.server.requests.length
    const resumed = await boot(h.home, h.server, { defaultSources: [{ id: 'docs', url: 'github:o/r' }], autoSyncOnStart: true })
    expect(await names(resumed)).toEqual(['rich@remote:docs'])
    expect(h.server.requests.length).toBe(requests)
  })

  it('adds GitHub sources with a ref, skips unchanged archives, and ignores an unresolved token', async () => {
    const h = await harness()
    serveRepo(h.server, 'o/r', SHA_A, { 'a/SKILL.md': skillText('pinned') }, 'main')
    h.server.routes.set('/pack.zip', { body: zipOf({ 'a/SKILL.md': skillText('zipped') }) })
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined } as never)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillSources, { dshHome: h.home, githubApiUrl: h.server.url, allowHttpLoopback: true, autoSyncOnStart: false })
    await vi.waitFor(() => { expect(ctx.get('skillSources')).toBeDefined() })
    cleanups.unshift(async () => { await ctx.fiber.dispose() })

    const added = await ctx.skillSources.add({ url: 'github:o/r', ref: 'main' })
    expect(added).toMatchObject({ id: 'o-r', ref: 'main' })
    await ctx.skillSources.sync('o-r')
    expect(h.server.requests[0]?.headers.authorization).toBeUndefined()
    await ctx.skillSources.add({ url: `${h.server.url}/pack.zip`, id: 'pack' })
    await ctx.skillSources.sync('pack')
    const before = ctx.skillSources.list().find(view => view.id === 'pack')?.sync.syncedAt
    await ctx.skillSources.sync('pack')
    expect(ctx.skillSources.list().find(view => view.id === 'pack')?.sync.syncedAt).toBe(before)
    expect(await names(ctx)).toEqual(['pinned@remote:o-r', 'zipped@remote:pack'])
  })

  it('rejects a sync interrupted by disposal', async () => {
    const h = await harness()
    h.server.routes.set('/slow.zip', { body: zipOf({ 'a/SKILL.md': skillText('slow') }), delayMs: 5_000 })
    const ctx = await boot(h.home, h.server)
    await ctx.skillSources.add({ url: `${h.server.url}/slow.zip`, id: 'slow' }).catch(() => {})
    const pending = ctx.skillSources.sync('slow')
    await vi.waitFor(() => { expect(h.server.requests.some(request => request.path === '/slow.zip')).toBe(true) })
    await ctx.fiber.dispose()
    await expect(pending).rejects.toThrow('skill-sources disposed')
  })

  it('applies configuration defaults and refuses an unreadable source list', async () => {
    expect(resolveSkillSourcesSpec({ defaultSources: [{ id: 'x', url: 'github:o/r' }] })).toMatchObject({
      githubApiUrl: 'https://api.github.com', githubTokenRef: 'GITHUB_TOKEN', autoSyncOnStart: true, defaultSources: [{ id: 'x', enabled: true }],
    })
    const h = await harness()
    await mkdir(join(h.home, 'skill-sources.json'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await expect(ctx.plugin(SkillSources, { dshHome: h.home, autoSyncOnStart: false })).rejects.toMatchObject({ code: 'EISDIR' })
  })
})

describe('SkillSources validation', () => {
  it('validates configuration', () => {
    expect(resolveSkillSourcesSpec({ dshHome: '/h', githubApiUrl: 'https://api/', githubTokenRef: '' })).toMatchObject({
      stateFile: '/h/skill-sources.json', cacheDir: '/h/skill-sources', rank: 450, githubApiUrl: 'https://api', githubTokenRef: undefined,
    })
    expect(() => resolveSkillSourcesSpec({ defaultSources: [anthropic, anthropic] })).toThrow('duplicate default source id')
    expect(() => resolveSkillSourcesSpec({ defaultSources: [{ id: 'Bad', url: 'github:o/r' }] })).toThrow('invalid skill source id')
    expect(() => resolveSkillSourcesSpec({ defaultSources: [{ id: 'x', url: 'ftp://x' }] })).toThrow('unsupported source URL')
    expect(() => resolveSkillSourcesSpec({ githubTokenRef: 'not valid' })).toThrow('invalid githubTokenRef')
    expect(resolveSkillSourcesSpec({ defaultSources: [{ ...anthropic, skills: [] }, { id: 'b', url: 'github:o/b', skills: ['x'] }] }).defaultSources.map(source => source.skills)).toEqual([undefined, ['x']])
  })

  it('validates the persisted source list', () => {
    const parse = (value: unknown): unknown => parseSourcesState(JSON.stringify(value), '/s.json')
    expect(parse({ version: 1, sources: [{ id: 'a', url: 'github:o/r', ref: 'main', path: 'x', enabled: false }], defaults: { d: { enabled: false, removed: true, extra: 1 } } }))
      .toEqual({ sources: [{ id: 'a', url: 'github:o/r', ref: 'main', path: 'x', enabled: false }], defaults: { d: { enabled: false, removed: true } } })
    expect(() => parseSourcesState('{', '/s.json')).toThrow('invalid skill sources file /s.json')
    expect(() => parse({ version: 2 })).toThrow('with version 1')
    expect(() => parse({ version: 1, sources: {}, defaults: {} })).toThrow('"sources" must be an array')
    expect(() => parse({ version: 1, sources: [{ id: 'a' }], defaults: {} })).toThrow('sources[0] needs')
    expect(parse({ version: 1, sources: [{ id: 'a', url: 'github:o/r', enabled: true, skills: ['x'] }], defaults: { d: { skills: [] } } }))
      .toEqual({ sources: [{ id: 'a', url: 'github:o/r', enabled: true, skills: ['x'] }], defaults: { d: { skills: [] } } })
    expect(() => parse({ version: 1, sources: [{ id: 'a', url: 'github:o/r', enabled: true, skills: [1] }], defaults: {} })).toThrow('sources[0].skills must be an array of strings')
    expect(() => parse({ version: 1, sources: [], defaults: { d: { skills: 'x' } } })).toThrow('defaults["d"].skills must be')
    expect(() => parse({ version: 1, sources: [{ id: 'A', url: 'github:o/r', enabled: true }], defaults: {} })).toThrow('invalid id "A"')
    expect(() => parse({ version: 1, sources: [{ id: 'a', url: 'ftp://x', enabled: true }], defaults: {} })).toThrow('sources[0]: unsupported source URL')
    expect(() => parse({ version: 1, sources: [], defaults: { d: 1 } })).toThrow('defaults["d"] must be an object')
  })

  it('validates generation manifests and pointers', async () => {
    const skill = { name: 'a', description: 'A', dir: 'a', invocation: { modelInvocable: true, userInvocable: false } }
    expect(parseManifest(JSON.stringify({ version: 1, commit: 'c', syncedAt: 't', skills: [{ ...skill, whenToUse: 'w', metadata: { k: 1 } }] }), '/m'))
      .toEqual({ version: 1, commit: 'c', syncedAt: 't', skills: [{ ...skill, whenToUse: 'w', metadata: { k: 1 } }] })
    expect(() => parseManifest(JSON.stringify({ version: 1 }), '/m')).toThrow('missing version')
    expect(() => parseManifest(JSON.stringify({ version: 1, commit: 'c', syncedAt: 't', skills: [{ ...skill, dir: '../x' }] }), '/m')).toThrow('skills[0] is malformed')
    expect(() => parseManifest(JSON.stringify({ version: 1, commit: 'c', syncedAt: 't', skills: [{ ...skill, invocation: {} }] }), '/m')).toThrow('skills[0] is malformed')

    const h = await harness()
    const base = join(h.home, 'skill-sources', 'anthropic-skills')
    await mkdir(base, { recursive: true })
    await writeFile(join(base, 'current.json'), '{"generation":"../etc"}')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await expect(ctx.plugin(SkillSources, { dshHome: h.home, autoSyncOnStart: false, defaultSources: [anthropic] })).rejects.toThrow('invalid skill source pointer')
    await writeFile(join(base, 'current.json'), '{')
    await expect(ctx.plugin(SkillSources, { dshHome: h.home, autoSyncOnStart: false, defaultSources: [anthropic] })).rejects.toThrow('invalid skill source pointer')
    await writeFile(join(h.home, 'skill-sources.json'), '[]')
    await expect(ctx.plugin(SkillSources, { dshHome: h.home, autoSyncOnStart: false })).rejects.toThrow('invalid skill sources file')
  })
})
