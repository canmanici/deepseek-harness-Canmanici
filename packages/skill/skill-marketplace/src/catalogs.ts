/**
 * Response parsers for public skill catalogs. Each parser validates one
 * catalog's JSON and maps its entries to {@link MarketplaceSkill} values that
 * point at a GitHub repository, so installation always goes through a skill
 * source; entries without a usable GitHub location are dropped.
 * @module
 */

import { resolveSourceSpec } from '@deepseek-ai/dsh-skill-sources'

/** One installable skill a marketplace lists. */
export interface MarketplaceSkill {
  /** Marketplace id that returned the entry. */
  readonly marketplace: string
  /** Stable identity across marketplaces: `<owner>/<repo>/<directory or name>`, lowercase. */
  readonly key: string
  /** Skill name. */
  readonly name: string
  /** Routing description, when the marketplace reports one. */
  readonly description?: string
  /** GitHub repository as `owner/repo`. */
  readonly repository: string
  /** Skill directory inside the repository, when the marketplace reports one. */
  readonly dir?: string
  /** Web page describing the skill. */
  readonly url: string
  /** Install count the marketplace reports. */
  readonly installs?: number
  /** Repository stars the marketplace reports. */
  readonly stars?: number
}

/** One page of parsed entries. */
export interface CatalogPage {
  readonly skills: MarketplaceSkill[]
  /** Total matches the marketplace reports, when it reports one. */
  readonly total?: number
}

/**
 * Parse a `skills.sh` `/api/search` response.
 * @param marketplace - marketplace id.
 * @param base - marketplace base URL.
 * @param body - decoded JSON.
 * @returns entries whose `source` is an `owner/repo` pair.
 */
export function parseSkillsSh(marketplace: string, base: string, body: unknown): CatalogPage {
  const skills: MarketplaceSkill[] = []
  for (const entry of records(field(body, 'skills'))) {
    const id = text(entry.id)
    const name = text(entry.skillId) ?? text(entry.name)
    const repository = text(entry.source)
    if (id === undefined || name === undefined || repository === undefined || !isRepository(repository)) continue
    skills.push(skill({
      marketplace,
      name,
      repository,
      url: new URL(id, withSlash(base)).href,
      installs: count(entry.installs),
    }))
  }
  return { skills }
}

/**
 * Parse a `claude-plugins.dev` `/api/skills` response.
 * @param marketplace - marketplace id.
 * @param body - decoded JSON.
 * @returns entries with a GitHub `sourceUrl`, and the reported total.
 */
export function parseClaudePluginsDev(marketplace: string, body: unknown): CatalogPage {
  const skills: MarketplaceSkill[] = []
  for (const entry of records(field(body, 'skills'))) {
    const location = githubLocation(text(entry.sourceUrl))
    const name = text(entry.name)
    if (location === undefined || name === undefined) continue
    skills.push(skill({
      marketplace,
      name,
      description: text(entry.description),
      ...location,
      url: location.web,
      installs: count(entry.installs),
      stars: count(entry.stars),
    }))
  }
  return { skills, ...optionalTotal(count(field(body, 'total'))) }
}

/**
 * Parse a SkillsMP `/api/v1/skills/search` response.
 * @param marketplace - marketplace id.
 * @param body - decoded JSON.
 * @returns entries with a GitHub `githubUrl`, and the reported total.
 */
export function parseSkillsMp(marketplace: string, body: unknown): CatalogPage {
  const data = field(body, 'data')
  const skills: MarketplaceSkill[] = []
  for (const entry of records(field(data, 'skills'))) {
    const location = githubLocation(text(entry.githubUrl))
    const name = text(entry.name)
    if (location === undefined || name === undefined) continue
    skills.push(skill({
      marketplace,
      name,
      description: text(entry.description),
      ...location,
      url: text(entry.skillUrl) ?? location.web,
      stars: count(entry.stars),
    }))
  }
  return { skills, ...optionalTotal(count(field(field(data, 'pagination'), 'total'))) }
}

/**
 * Parse a GitHub `git/trees?recursive=1` response into `SKILL.md` directories.
 * @param body - decoded JSON.
 * @param within - repository subdirectory that bounds the scan.
 * @param maxDepth - deepest directory level below `within`.
 * @returns skill directories relative to the repository root, in tree order; `''` is the root.
 */
export function parseSkillTree(body: unknown, within: string | undefined, maxDepth: number): string[] {
  const prefix = within === undefined ? '' : `${within}/`
  const dirs: string[] = []
  for (const entry of records(field(body, 'tree'))) {
    const path = text(entry.path)
    if (entry.type !== 'blob' || path === undefined || !path.startsWith(prefix)) continue
    const segments = path.split('/')
    if (segments.at(-1) !== 'SKILL.md') continue
    const dir = segments.slice(0, -1).join('/')
    if (dir.slice(prefix.length).split('/').filter(segment => segment.length > 0).length > maxDepth) continue
    dirs.push(dir)
  }
  return dirs
}

/**
 * Build one entry, deriving its key and dropping absent optional fields.
 * @param input - entry fields; `dir` and numeric fields may be absent.
 * @returns the entry.
 */
export function skill(input: {
  readonly marketplace: string
  readonly name: string
  readonly repository: string
  readonly url: string
  readonly description?: string | undefined
  readonly dir?: string | undefined
  readonly installs?: number | undefined
  readonly stars?: number | undefined
}): MarketplaceSkill {
  const leaf = input.dir === undefined || input.dir === '' ? input.name : input.dir.split('/').at(-1) as string
  return {
    marketplace: input.marketplace,
    key: `${input.repository}/${leaf}`.toLowerCase(),
    name: input.name,
    ...input.description === undefined ? {} : { description: input.description },
    repository: input.repository,
    ...input.dir === undefined ? {} : { dir: input.dir },
    url: input.url,
    ...input.installs === undefined ? {} : { installs: input.installs },
    ...input.stars === undefined ? {} : { stars: input.stars },
  }
}

/** A GitHub `/tree/<ref>/<path>` URL split into repository and directory. */
function githubLocation(url: string | undefined): { repository: string; dir?: string; web: string } | undefined {
  if (url === undefined) return undefined
  try {
    const spec = resolveSourceSpec({ url })
    if (spec.kind !== 'github') return undefined
    return { repository: `${spec.owner}/${spec.repo}`, ...spec.path === undefined ? {} : { dir: spec.path }, web: url }
  } catch {
    // An entry pointing outside GitHub or at a malformed URL is not installable; drop it.
    return undefined
  }
}

function isRepository(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
}

function withSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

function optionalTotal(total: number | undefined): { total?: number } {
  return total === undefined ? {} : { total }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}
