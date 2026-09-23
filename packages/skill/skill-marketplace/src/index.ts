/**
 * Public skill marketplaces as one searchable catalog. Each configured
 * marketplace is a public search API or a GitHub repository scanned for
 * `SKILL.md` files; results name the GitHub repository and directory that
 * `dsh-skill-sources` installs from. Nothing is installed here, and no skill
 * list is built in: every entry comes from the network at request time.
 * @module @deepseek-ai/dsh-skill-marketplace
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import { parseSkillDocument } from '@deepseek-ai/dsh-skill-filesystem'
import { fetchBytes, resolveSourceSpec, type FetchPolicy, type GitHubSourceSpec } from '@deepseek-ai/dsh-skill-sources'
import {
  parseClaudePluginsDev,
  parseSkillsMp,
  parseSkillsSh,
  parseSkillTree,
  skill,
  type CatalogPage,
  type MarketplaceSkill,
} from './catalogs.ts'

export { parseClaudePluginsDev, parseSkillsMp, parseSkillsSh, parseSkillTree } from './catalogs.ts'
export type { CatalogPage, MarketplaceSkill } from './catalogs.ts'

/**
 * How a marketplace is queried:
 * - `github`: one repository scanned for `SKILL.md` files; browsable without a query.
 * - `claude-plugins-dev`: the claude-plugins.dev skills API; browsable without a query.
 * - `skillsmp`: the SkillsMP search API; needs a query.
 * - `skills-sh`: the skills.sh search API; needs a query of at least two characters.
 */
export type MarketplaceKind = 'github' | 'claude-plugins-dev' | 'skillsmp' | 'skills-sh'

/** One configured marketplace. */
export interface MarketplaceConfig {
  /** Stable lowercase hyphenated id. */
  readonly id: string
  /** Display name. */
  readonly title: string
  /** How the marketplace is queried. */
  readonly kind: MarketplaceKind
  /** API base URL, or the repository URL for `github`. */
  readonly url: string
  /** Whether searches include the marketplace. */
  readonly enabled?: boolean
}

/** Skill marketplace configuration. */
export interface Config {
  /** Marketplaces in display order. */
  readonly marketplaces?: readonly MarketplaceConfig[]
  /** Results per page of one marketplace when a search names no limit. */
  readonly pageSize?: number
  /** Results per marketplace when a search spans every marketplace and names no limit. */
  readonly mixedPageSize?: number
  /** Largest page a search may request. */
  readonly maxPageSize?: number
  /** How long a response stays cached, in milliseconds. */
  readonly cacheTtlMs?: number
  /** Per-request timeout in milliseconds. */
  readonly fetchTimeoutMs?: number
  /** Largest accepted response body in bytes. */
  readonly maxResponseBytes?: number
  /** Most skill directories listed from one `github` marketplace. */
  readonly maxRepositorySkills?: number
  /** Deepest directory level scanned for `SKILL.md` in a `github` marketplace. */
  readonly maxDiscoveryDepth?: number
  /** Parallel `SKILL.md` downloads when a page of a `github` marketplace loads descriptions. */
  readonly scanConcurrency?: number
  /** GitHub REST API base URL. */
  readonly githubApiUrl?: string
  /** Base URL serving raw repository files. */
  readonly githubRawUrl?: string
  /** Credential reference holding a GitHub token for API rate limits. */
  readonly githubTokenRef?: string
  /** Permit plain HTTP to loopback hosts, for test fixtures. */
  readonly allowHttpLoopback?: boolean
}

/** Resolved configuration. */
export interface SkillMarketplaceSpec {
  readonly marketplaces: ReadonlyArray<Required<MarketplaceConfig>>
  readonly pageSize: number
  readonly mixedPageSize: number
  readonly maxPageSize: number
  readonly cacheTtlMs: number
  readonly fetch: FetchPolicy
  readonly maxRepositorySkills: number
  readonly maxDiscoveryDepth: number
  readonly scanConcurrency: number
  readonly githubApiUrl: string
  readonly githubRawUrl: string
  readonly githubTokenRef: string | undefined
}

const KINDS: readonly MarketplaceKind[] = ['github', 'claude-plugins-dev', 'skillsmp', 'skills-sh']
const MARKETPLACE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const ConfigSchema: Schema<Config> = z.object({
  marketplaces: z.array(z.object({
    id: z.string().required(),
    title: z.string().required(),
    kind: z.union(KINDS).required(),
    url: z.string().required(),
    enabled: z.boolean().default(true),
  })).default([]),
  pageSize: z.natural().min(1).default(24),
  mixedPageSize: z.natural().min(1).default(6),
  maxPageSize: z.natural().min(1).default(100),
  cacheTtlMs: z.natural().default(30 * 60_000),
  fetchTimeoutMs: z.natural().default(20_000),
  maxResponseBytes: z.natural().default(8 * 1024 * 1024),
  maxRepositorySkills: z.natural().default(2000),
  maxDiscoveryDepth: z.natural().default(6),
  scanConcurrency: z.natural().min(1).default(8),
  githubApiUrl: z.string().default('https://api.github.com'),
  githubRawUrl: z.string().default('https://raw.githubusercontent.com'),
  githubTokenRef: z.string().default('GITHUB_TOKEN'),
  allowHttpLoopback: z.boolean().default(false),
  // Schemastery infers `T | null` for optional nested fields, which exactOptionalPropertyTypes rejects against the declared Config.
}) as Schema<Config>

/**
 * Apply defaults and validate marketplaces.
 * @param config - plugin configuration.
 * @returns the resolved specification.
 * @throws Error on a malformed or repeated id, an unknown kind, or an unusable URL.
 */
export function resolveSkillMarketplaceSpec(config: Config): SkillMarketplaceSpec {
  const ids = new Set<string>()
  const marketplaces = (config.marketplaces ?? []).map((entry) => {
    if (!MARKETPLACE_ID.test(entry.id)) throw new Error(`skill-marketplace: invalid marketplace id "${entry.id}"`)
    if (ids.has(entry.id)) throw new Error(`skill-marketplace: duplicate marketplace id "${entry.id}"`)
    ids.add(entry.id)
    if (!KINDS.includes(entry.kind)) throw new Error(`skill-marketplace: marketplace "${entry.id}" has unknown kind "${entry.kind}"`)
    if (entry.kind === 'github') githubSpec(entry.url, entry.id)
    else new URL(entry.url)
    return { ...entry, enabled: entry.enabled ?? true }
  })
  const tokenRef = config.githubTokenRef ?? 'GITHUB_TOKEN'
  if (tokenRef !== '' && !isCredentialRefName(tokenRef)) throw new Error(`skill-marketplace: invalid githubTokenRef "${tokenRef}"`)
  return {
    marketplaces,
    pageSize: config.pageSize ?? 24,
    mixedPageSize: config.mixedPageSize ?? 6,
    maxPageSize: config.maxPageSize ?? 100,
    cacheTtlMs: config.cacheTtlMs ?? 30 * 60_000,
    fetch: {
      maxBytes: config.maxResponseBytes ?? 8 * 1024 * 1024,
      timeoutMs: config.fetchTimeoutMs ?? 20_000,
      allowHttpLoopback: config.allowHttpLoopback ?? false,
    },
    maxRepositorySkills: config.maxRepositorySkills ?? 2000,
    maxDiscoveryDepth: config.maxDiscoveryDepth ?? 6,
    scanConcurrency: config.scanConcurrency ?? 8,
    githubApiUrl: (config.githubApiUrl ?? 'https://api.github.com').replace(/\/+$/, ''),
    githubRawUrl: (config.githubRawUrl ?? 'https://raw.githubusercontent.com').replace(/\/+$/, ''),
    githubTokenRef: tokenRef === '' ? undefined : tokenRef,
  }
}

/** One marketplace as management surfaces display it. */
export interface MarketplaceView {
  readonly id: string
  readonly title: string
  readonly kind: MarketplaceKind
  readonly url: string
  readonly enabled: boolean
  /** Whether an empty query lists skills; otherwise the marketplace answers searches only. */
  readonly browsable: boolean
  /** Skills the marketplace offers, when it reports a count. */
  readonly available?: number
  /** Failure message of the latest count. */
  readonly error?: string
}

/** Search input. */
export interface MarketplaceSearchRequest {
  /** Free text; empty browses the marketplaces that list without a query. */
  readonly query: string
  /** Marketplace id; omitted searches every enabled marketplace. */
  readonly marketplace?: string | undefined
  /** Entries to skip in each marketplace. */
  readonly offset?: number | undefined
  /** Entries per marketplace; omitted uses `pageSize` for one marketplace and `mixedPageSize` for all. */
  readonly limit?: number | undefined
}

/** Search output. */
export interface MarketplaceSearchResult {
  /** Entries deduplicated by key, interleaved across marketplaces in configuration order. */
  readonly skills: MarketplaceSkill[]
  /** Reported matches per marketplace id. */
  readonly totals: Record<string, number>
  /** Whether any marketplace has entries past this page. */
  readonly hasMore: boolean
  /** Offset that requests the next page. */
  readonly nextOffset: number
  /** Marketplaces that failed, with their messages. */
  readonly errors: Array<{ readonly marketplace: string; readonly message: string }>
}

/** A `github` marketplace entry, whose directory is always known; `''` is the repository root. */
type RepositorySkill = MarketplaceSkill & { readonly dir: string }

interface CacheEntry {
  readonly expires: number
  readonly value: Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillMarketplace: SkillMarketplace
  }
}

/**
 * Searches public skill marketplaces. Responses are cached per URL for
 * `cacheTtlMs`; a failed marketplace is reported beside the others' results
 * instead of failing the search.
 */
export class SkillMarketplace extends Service {
  static Config: Schema<Config> = ConfigSchema

  private readonly spec: SkillMarketplaceSpec
  private readonly cache = new Map<string, CacheEntry>()
  private readonly counts = new Map<string, { available?: number; error?: string }>()
  private readonly lifecycle = new AbortController()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillMarketplace')
    this.spec = resolveSkillMarketplaceSpec(config)
    ctx.effect(() => () => { this.lifecycle.abort(new Error('skill-marketplace disposed')) }, 'skillMarketplace.lifecycle')
  }

  /**
   * List marketplaces with the counts the latest {@link refreshCounts} found.
   * @returns marketplaces in configuration order.
   */
  list(): MarketplaceView[] {
    return this.spec.marketplaces.map((entry) => {
      const known = this.counts.get(entry.id)
      return {
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        url: entry.url,
        enabled: entry.enabled,
        browsable: entry.kind === 'github' || entry.kind === 'claude-plugins-dev',
        ...known?.available === undefined ? {} : { available: known.available },
        ...known?.error === undefined ? {} : { error: known.error },
      }
    })
  }

  /**
   * Ask every enabled browsable marketplace how many skills it offers.
   * @returns the refreshed list.
   */
  async refreshCounts(): Promise<MarketplaceView[]> {
    await Promise.all(this.spec.marketplaces.filter(entry => entry.enabled).map(async (entry) => {
      try {
        if (entry.kind === 'github') this.counts.set(entry.id, { available: (await this.repository(entry)).length })
        else if (entry.kind === 'claude-plugins-dev') {
          const page = await this.claudePluginsDev(entry, '', 0, 1)
          this.counts.set(entry.id, page.total === undefined ? {} : { available: page.total })
        }
      } catch (error) {
        this.counts.set(entry.id, { error: (error as Error).message })
      }
    }))
    return this.list()
  }

  /**
   * Search one or every enabled marketplace.
   * @param request - query, optional marketplace, offset, and page size.
   * @returns merged entries, totals, and per-marketplace failures.
   * @throws Error when `marketplace` names an unknown or disabled marketplace.
   */
  async search(request: MarketplaceSearchRequest): Promise<MarketplaceSearchResult> {
    const query = request.query.trim()
    const offset = Math.max(0, Math.floor(request.offset ?? 0))
    const fallback = request.marketplace === undefined ? this.spec.mixedPageSize : this.spec.pageSize
    const limit = Math.min(this.spec.maxPageSize, Math.max(1, Math.floor(request.limit ?? fallback)))
    const selected = request.marketplace === undefined
      ? this.spec.marketplaces.filter(entry => entry.enabled)
      : [this.requireMarketplace(request.marketplace)]
    const totals: Record<string, number> = {}
    const errors: MarketplaceSearchResult['errors'] = []
    let hasMore = false
    const pages = await Promise.all(selected.map(async (entry): Promise<MarketplaceSkill[]> => {
      try {
        const page = await this.page(entry, query, offset, limit)
        if (page.total !== undefined) totals[entry.id] = page.total
        if (page.more) hasMore = true
        return page.skills
      } catch (error) {
        errors.push({ marketplace: entry.id, message: (error as Error).message })
        return []
      }
    }))
    return { skills: interleave(pages), totals, hasMore, nextOffset: offset + limit, errors }
  }

  private async page(
    entry: Required<MarketplaceConfig>,
    query: string,
    offset: number,
    limit: number,
  ): Promise<CatalogPage & { more: boolean }> {
    switch (entry.kind) {
      case 'github': {
        const needle = query.toLocaleLowerCase()
        const matches = (await this.repository(entry)).filter(item => needle === '' || item.dir.toLocaleLowerCase().includes(needle))
        const skills = await this.hydrate(entry, matches.slice(offset, offset + limit))
        return { skills, total: matches.length, more: offset + limit < matches.length }
      }
      case 'claude-plugins-dev': {
        const page = await this.claudePluginsDev(entry, query, offset, limit)
        return { ...page, more: page.total === undefined ? page.skills.length === limit : offset + limit < page.total }
      }
      case 'skillsmp': {
        if (query.length === 0) return { skills: [], more: false }
        const url = endpoint(entry.url, 'api/v1/skills/search', { q: query, limit: String(limit), page: String(Math.floor(offset / limit) + 1) })
        const page = parseSkillsMp(entry.id, await this.json(url, {}))
        return { ...page, more: page.total === undefined ? page.skills.length === limit : offset + limit < page.total }
      }
      case 'skills-sh': {
        // The search API rejects queries shorter than two characters and takes no offset.
        if (query.length < 2) return { skills: [], more: false }
        const url = endpoint(entry.url, 'api/search', { q: query, limit: String(offset + limit) })
        const page = parseSkillsSh(entry.id, entry.url, await this.json(url, {}))
        return { skills: page.skills.slice(offset), more: page.skills.length === offset + limit }
      }
    }
  }

  private claudePluginsDev(entry: Required<MarketplaceConfig>, query: string, offset: number, limit: number): Promise<CatalogPage> {
    const url = endpoint(entry.url, 'api/skills', { q: query, limit: String(limit), offset: String(offset) })
    return this.json(url, {}).then(body => parseClaudePluginsDev(entry.id, body))
  }

  /**
   * Skill directories of a `github` marketplace from one recursive tree request.
   * Entries carry the directory name only; {@link hydrate} reads descriptions
   * for the entries a page shows.
   */
  private repository(entry: Required<MarketplaceConfig>): Promise<RepositorySkill[]> {
    return this.cached(`repository:${entry.url}`, async () => {
      const spec = githubSpec(entry.url, entry.id)
      const tree = await this.json(`${this.spec.githubApiUrl}/repos/${spec.owner}/${spec.repo}/git/trees/${encodeURIComponent(spec.ref ?? 'HEAD')}?recursive=1`, await this.githubHeaders())
      return parseSkillTree(tree, spec.path, this.spec.maxDiscoveryDepth).slice(0, this.spec.maxRepositorySkills).map(dir => ({ ...skill({
        marketplace: entry.id,
        name: dir === '' ? spec.repo.toLowerCase() : dir.split('/').at(-1) as string,
        repository: `${spec.owner}/${spec.repo}`,
        dir,
        url: `https://github.com/${spec.owner}/${spec.repo}/tree/${spec.ref ?? 'HEAD'}${dir === '' ? '' : `/${dir}`}`,
      }), dir }))
    })
  }

  /** Read each entry's `SKILL.md` for its declared name and description; an unreadable file keeps the directory name. */
  private async hydrate(entry: Required<MarketplaceConfig>, items: readonly RepositorySkill[]): Promise<MarketplaceSkill[]> {
    const spec = githubSpec(entry.url, entry.id)
    const result: RepositorySkill[] = [...items]
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < result.length) {
        const index = next++
        const item = result[index] as RepositorySkill
        const dir = item.dir
        const file = `${this.spec.githubRawUrl}/${spec.owner}/${spec.repo}/${spec.ref ?? 'HEAD'}/${dir === '' ? '' : `${dir}/`}SKILL.md`
        try {
          const read = async (): Promise<ReturnType<typeof parseSkillDocument>> =>
            parseSkillDocument(new TextDecoder().decode(await this.fetch(file, userAgent())))
          const document = await this.cached(file, read)
          result[index] = { ...item, name: document.name, description: document.description }
        } catch (error) {
          this.ctx.logger.warn(`skill marketplace "${entry.id}": cannot read ${file}: ${(error as Error).message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.spec.scanConcurrency, result.length) }, worker))
    return result
  }

  private requireMarketplace(id: string): Required<MarketplaceConfig> {
    const entry = this.spec.marketplaces.find(candidate => candidate.id === id)
    if (entry === undefined) throw new Error(`unknown skill marketplace "${id}"`)
    if (!entry.enabled) throw new Error(`skill marketplace "${id}" is disabled`)
    return entry
  }

  private json(url: string, headers: Record<string, string>): Promise<unknown> {
    return this.cached(url, async () => {
      const body = new TextDecoder().decode(await this.fetch(url, { ...userAgent(), Accept: 'application/json', ...headers }))
      try {
        const parsed: unknown = JSON.parse(body)
        return parsed
      } catch (error) {
        throw new Error(`GET ${url} returned invalid JSON: ${(error as Error).message}`, { cause: error })
      }
    })
  }

  private fetch(url: string, headers: Record<string, string>): Promise<Uint8Array> {
    return fetchBytes(url, headers, this.spec.fetch, this.lifecycle.signal)
  }

  /** Share one in-flight or fresh result per key; a failure is evicted so the next call retries. */
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const hit = this.cache.get(key)
    if (hit !== undefined && hit.expires > now) return hit.value as Promise<T>
    const value = load()
    this.cache.set(key, { expires: now + this.spec.cacheTtlMs, value })
    value.catch(() => { this.cache.delete(key) })
    return value
  }

  private async githubHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...userAgent(), 'X-GitHub-Api-Version': '2022-11-28' }
    const ref = this.spec.githubTokenRef
    const credentials = this.ctx.get('credentials')
    if (ref !== undefined && credentials !== undefined) {
      const token = await credentials.resolve(credentialRef(ref))
      if (token !== undefined) headers.Authorization = `Bearer ${token.value}`
    }
    return headers
  }
}

function githubSpec(url: string, id: string): GitHubSourceSpec {
  const spec = resolveSourceSpec({ url })
  if (spec.kind !== 'github') throw new Error(`skill-marketplace: marketplace "${id}" of kind github needs a GitHub repository URL`)
  return spec
}

function endpoint(base: string, path: string, params: Record<string, string>): string {
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.href
}

/** Round-robin merge so every marketplace's best matches lead, dropping repeated keys. */
function interleave(pages: readonly MarketplaceSkill[][]): MarketplaceSkill[] {
  const seen = new Set<string>()
  const merged: MarketplaceSkill[] = []
  const longest = Math.max(0, ...pages.map(page => page.length))
  for (let index = 0; index < longest; index += 1) {
    for (const page of pages) {
      const item = page[index]
      if (item === undefined || seen.has(item.key)) continue
      seen.add(item.key)
      merged.push(item)
    }
  }
  return merged
}

function userAgent(): Record<string, string> {
  return { 'User-Agent': 'deepseek-harness-skill-marketplace' }
}

export default SkillMarketplace
