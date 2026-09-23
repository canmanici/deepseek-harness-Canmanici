import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillMarketplace, { resolveSkillMarketplaceSpec, type Config, type MarketplaceConfig } from '../src/index.ts'
import { catalogServer, type CatalogServer } from './server.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

async function boot(config: Config, server: CatalogServer): Promise<{ ctx: Context; market: SkillMarketplace }> {
  const ctx = new Context()
  await ctx.plugin(SkillMarketplace, { githubApiUrl: server.url, githubRawUrl: `${server.url}/raw`, allowHttpLoopback: true, githubTokenRef: '', ...config })
  await vi.waitFor(() => { expect(ctx.get('skillMarketplace')).toBeDefined() })
  cleanups.unshift(async () => { await ctx.fiber.dispose() })
  return { ctx, market: ctx.skillMarketplace }
}

async function server(): Promise<CatalogServer> {
  const instance = await catalogServer()
  cleanups.push(() => instance.close())
  return instance
}

const skillText = (name: string): string => `---\nname: ${name}\ndescription: ${name} description\n---\n\nBody.\n`

function serveTree(s: CatalogServer, paths: string[]): void {
  s.routes.set('/repos/o/r/git/trees/HEAD?recursive=1', { body: JSON.stringify({ tree: paths.map(path => ({ path, type: 'blob' })) }) })
}

describe('SkillMarketplace', () => {
  it('lists a GitHub repository from one tree request and reads descriptions for the shown page only', async () => {
    const s = await server()
    serveTree(s, ['skills/alpha/SKILL.md', 'skills/beta/SKILL.md', 'skills/broken/SKILL.md'])
    s.routes.set('/raw/o/r/HEAD/skills/alpha/SKILL.md', { body: skillText('alpha') })
    s.routes.set('/raw/o/r/HEAD/skills/beta/SKILL.md', { body: skillText('beta') })
    const repo: MarketplaceConfig = { id: 'repo', title: 'Repo', kind: 'github', url: 'https://github.com/o/r' }
    const { ctx, market } = await boot({ marketplaces: [repo] }, s)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    expect(await market.refreshCounts()).toEqual([{ id: 'repo', title: 'Repo', kind: 'github', url: 'https://github.com/o/r', enabled: true, browsable: true, available: 3 }])
    const first = await market.search({ query: '', limit: 2 })
    expect(first).toMatchObject({ totals: { repo: 3 }, hasMore: true, nextOffset: 2, errors: [] })
    expect(first.skills.map(skill => [skill.name, skill.description])).toEqual([['alpha', 'alpha description'], ['beta', 'beta description']])
    expect(s.hits.filter(hit => hit.startsWith('/raw/'))).toHaveLength(2)

    const rest = await market.search({ query: 'BRO', marketplace: 'repo', offset: 0 })
    expect(rest.skills).toEqual([expect.objectContaining({ name: 'broken', dir: 'skills/broken', url: 'https://github.com/o/r/tree/HEAD/skills/broken' })])
    expect(rest.skills[0]?.description).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot read'))
    expect(s.hits.filter(hit => hit.startsWith('/repos/'))).toHaveLength(1)
  })

  it('names a root skill after the repository and honors a pinned ref and subdirectory', async () => {
    const s = await server()
    s.routes.set('/repos/o/r/git/trees/v1?recursive=1', { body: JSON.stringify({ tree: [{ path: 'SKILL.md', type: 'blob' }, { path: 'pkg/one/SKILL.md', type: 'blob' }] }) })
    s.routes.set('/raw/o/r/v1/pkg/one/SKILL.md', { body: skillText('one') })
    const { ctx, market } = await boot({
      marketplaces: [
        { id: 'root', title: 'Root', kind: 'github', url: 'https://github.com/o/r/tree/v1' },
        { id: 'sub', title: 'Sub', kind: 'github', url: 'https://github.com/o/r/tree/v1/pkg' },
      ],
    }, s)
    vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const root = await market.search({ query: '', marketplace: 'root' })
    expect(root.skills.map(skill => skill.name)).toEqual(['r', 'one'])
    expect((await market.search({ query: '', marketplace: 'sub' })).skills.map(skill => skill.key)).toEqual(['o/r/one'])
  })

  it('queries search APIs, interleaves and deduplicates results, and reports failing marketplaces', async () => {
    const s = await server()
    s.routes.set('/cpd/api/skills?q=pdf&limit=2&offset=0', { body: JSON.stringify({ total: 3, skills: [
      { name: 'pdf', description: 'A', sourceUrl: 'https://github.com/a/s/tree/main/skills/pdf' },
      { name: 'pdf-two', sourceUrl: 'https://github.com/a/s/tree/main/skills/pdf-two' },
    ] }) })
    s.routes.set('/smp/api/v1/skills/search?q=pdf&limit=2&page=1', { body: JSON.stringify({ data: { skills: [
      { name: 'pdf', githubUrl: 'https://github.com/a/s/tree/main/skills/pdf' },
      { name: 'nano', githubUrl: 'https://github.com/b/t/tree/main/nano' },
    ] } }) })
    s.routes.set('/ssh/api/search?q=pdf&limit=2', { body: JSON.stringify({ skills: [
      { id: 'c/u/pdf', skillId: 'pdf', source: 'c/u' },
      { id: 'c/u/doc', skillId: 'doc', source: 'c/u' },
    ] }) })
    s.routes.set('/down/api/skills?q=pdf&limit=2&offset=0', { status: 503, body: 'down' })
    s.routes.set('/bad/api/skills?q=pdf&limit=2&offset=0', { body: 'not json' })
    const { market } = await boot({
      maxPageSize: 2,
      marketplaces: [
        { id: 'cpd', title: 'CPD', kind: 'claude-plugins-dev', url: `${s.url}/cpd` },
        { id: 'smp', title: 'SMP', kind: 'skillsmp', url: `${s.url}/smp/` },
        { id: 'ssh', title: 'SSH', kind: 'skills-sh', url: `${s.url}/ssh` },
        { id: 'down', title: 'Down', kind: 'claude-plugins-dev', url: `${s.url}/down` },
        { id: 'bad', title: 'Bad', kind: 'claude-plugins-dev', url: `${s.url}/bad` },
        { id: 'off', title: 'Off', kind: 'skills-sh', url: `${s.url}/off`, enabled: false },
      ],
    }, s)
    const result = await market.search({ query: ' pdf ', limit: 50 })
    expect(result.skills.map(skill => `${skill.marketplace}:${skill.key}`)).toEqual([
      'cpd:a/s/pdf', 'ssh:c/u/pdf', 'cpd:a/s/pdf-two', 'smp:b/t/nano', 'ssh:c/u/doc',
    ])
    expect(result.totals).toEqual({ cpd: 3 })
    expect(result.hasMore).toBe(true)
    expect(result.errors.map(error => error.marketplace).sort()).toEqual(['bad', 'down'])
    expect(result.errors.find(error => error.marketplace === 'bad')?.message).toContain('invalid JSON')

    s.routes.set('/cpd/api/skills?q=&limit=1&offset=0', { body: JSON.stringify({ skills: [] }) })
    s.routes.set('/bad/api/skills?q=&limit=1&offset=0', { body: JSON.stringify({ total: 7, skills: [] }) })
    const counts = await market.refreshCounts()
    expect(counts.find(view => view.id === 'cpd')).not.toHaveProperty('available')
    expect(counts.find(view => view.id === 'bad')).toMatchObject({ available: 7 })
    expect(counts.find(view => view.id === 'down')?.error).toContain('HTTP 404')
    expect(counts.find(view => view.id === 'ssh')).toMatchObject({ browsable: false })

    await expect(market.search({ query: 'x', marketplace: 'nope' })).rejects.toThrow('unknown skill marketplace')
    await expect(market.search({ query: 'x', marketplace: 'off' })).rejects.toThrow('is disabled')
  })

  it('skips search-only marketplaces for short queries and pages through skills.sh and SkillsMP', async () => {
    const s = await server()
    s.routes.set('/ssh/api/search?q=ab&limit=2', { body: JSON.stringify({ skills: [{ id: 'c/u/a', skillId: 'a', source: 'c/u' }, { id: 'c/u/b', skillId: 'b', source: 'c/u' }] }) })
    s.routes.set('/smp/api/v1/skills/search?q=ab&limit=1&page=2', { body: JSON.stringify({ data: { skills: [{ name: 'z', githubUrl: 'https://github.com/o/r/tree/main/z' }], pagination: { total: 2 } } }) })
    s.routes.set('/cpd/api/skills?q=ab&limit=1&offset=1', { body: JSON.stringify({ skills: [{ name: 'y', sourceUrl: 'https://github.com/o/r/tree/main/y' }] }) })
    const { market } = await boot({
      marketplaces: [
        { id: 'ssh', title: 'SSH', kind: 'skills-sh', url: `${s.url}/ssh` },
        { id: 'smp', title: 'SMP', kind: 'skillsmp', url: `${s.url}/smp` },
        { id: 'cpd', title: 'CPD', kind: 'claude-plugins-dev', url: `${s.url}/cpd` },
      ],
    }, s)
    expect(await market.search({ query: 'a' })).toMatchObject({ skills: [], hasMore: false })
    expect((await market.search({ query: '', marketplace: 'smp' })).skills).toEqual([])
    const page = await market.search({ query: 'ab', offset: 1, limit: 1 })
    expect(page.skills.map(skill => skill.key)).toEqual(['c/u/b', 'o/r/z', 'o/r/y'])
    expect(page.hasMore).toBe(true)
  })

  it('shares cached responses until they expire and retries after a failure', async () => {
    const s = await server()
    serveTree(s, ['a/SKILL.md'])
    s.routes.set('/raw/o/r/HEAD/a/SKILL.md', { body: skillText('a') })
    const { market } = await boot({ cacheTtlMs: 0, marketplaces: [{ id: 'repo', title: 'Repo', kind: 'github', url: 'https://github.com/o/r' }] }, s)
    await market.search({ query: '' })
    await market.search({ query: '' })
    expect(s.hits.filter(hit => hit.startsWith('/repos/'))).toHaveLength(2)
    s.routes.delete('/repos/o/r/git/trees/HEAD?recursive=1')
    expect((await market.search({ query: '' })).errors).toHaveLength(1)
  })

  it('sends a GitHub token when the credential resolves', async () => {
    const s = await server()
    serveTree(s, [])
    const ctx = new Context()
    ctx.provide('credentials')
    const resolve = vi.fn(async () => ({ value: 'tok' })).mockResolvedValueOnce(undefined as never)
    ctx.set('credentials', { resolve })
    await ctx.plugin(SkillMarketplace, { githubApiUrl: s.url, allowHttpLoopback: true, cacheTtlMs: 0, marketplaces: [{ id: 'repo', title: 'Repo', kind: 'github', url: 'https://github.com/o/r' }] })
    cleanups.unshift(async () => { await ctx.fiber.dispose() })
    const market = ctx.get('skillMarketplace') as SkillMarketplace
    expect(await market.refreshCounts()).toEqual([expect.objectContaining({ available: 0 })])
    expect(await market.refreshCounts()).toEqual([expect.objectContaining({ available: 0 })])
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('validates configuration', () => {
    const spec = resolveSkillMarketplaceSpec({ githubApiUrl: 'https://api/', githubRawUrl: 'https://raw/', githubTokenRef: '' })
    expect(spec).toMatchObject({ marketplaces: [], pageSize: 24, mixedPageSize: 6, githubApiUrl: 'https://api', githubRawUrl: 'https://raw', githubTokenRef: undefined })
    expect(resolveSkillMarketplaceSpec({}).githubTokenRef).toBe('GITHUB_TOKEN')
    const entry = (patch: Partial<MarketplaceConfig>): MarketplaceConfig => ({ id: 'a', title: 'A', kind: 'skills-sh', url: 'https://x', ...patch })
    expect(() => resolveSkillMarketplaceSpec({ marketplaces: [entry({ id: 'Bad' })] })).toThrow('invalid marketplace id')
    expect(() => resolveSkillMarketplaceSpec({ marketplaces: [entry({}), entry({})] })).toThrow('duplicate')
    expect(() => resolveSkillMarketplaceSpec({ marketplaces: [entry({ kind: 'nope' as never })] })).toThrow('unknown kind')
    expect(() => resolveSkillMarketplaceSpec({ marketplaces: [entry({ kind: 'github', url: 'https://x/a.zip' })] })).toThrow('needs a GitHub repository URL')
    expect(() => resolveSkillMarketplaceSpec({ marketplaces: [entry({ url: 'not a url' })] })).toThrow()
    expect(() => resolveSkillMarketplaceSpec({ githubTokenRef: 'bad ref!' })).toThrow('invalid githubTokenRef')
  })
})
