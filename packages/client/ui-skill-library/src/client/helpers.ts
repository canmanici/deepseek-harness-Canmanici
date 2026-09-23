/** Pure view helpers for the skill library. */

import type { ManagedSkill, ManagedSource, MarketplaceEntry } from '@deepseek-ai/dsh-api-remotes/client'

/** Where a skill comes from, as the library groups it. */
export type SkillOrigin = 'project' | 'user' | 'remote' | 'builtin'

/** One origin group of skills. */
export interface SkillGroup {
  /** Stable key: the origin, or `remote:<id>` for one remote source. */
  readonly key: string
  readonly origin: SkillOrigin
  /** Remote source id for remote groups. */
  readonly sourceId?: string
  readonly skills: readonly ManagedSkill[]
}

const ORIGIN_ORDER: Readonly<Record<SkillOrigin, number>> = { project: 0, user: 1, remote: 2, builtin: 3 }

/**
 * Classify a discovery source label.
 * @param source - skill source label from the Host.
 * @returns the library origin.
 */
export function originOf(source: string): SkillOrigin {
  if (source.startsWith('remote:')) return 'remote'
  if (source === 'project-dsh' || source === 'project-agents') return 'project'
  if (source === 'user-dsh' || source === 'user-agents' || source === 'custom') return 'user'
  return 'builtin'
}

/**
 * Group skills by origin, each remote source separately, in a fixed origin order.
 * @param skills - skills to group, already sorted by name.
 * @returns non-empty groups.
 */
export function groupSkills(skills: readonly ManagedSkill[]): SkillGroup[] {
  const groups = new Map<string, { origin: SkillOrigin; skills: ManagedSkill[] }>()
  for (const skill of skills) {
    const origin = originOf(skill.source)
    const key = origin === 'remote' ? skill.source : origin
    const group = groups.get(key) ?? { origin, skills: [] }
    group.skills.push(skill)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]): SkillGroup => ({
      key,
      origin: group.origin,
      ...group.origin === 'remote' ? { sourceId: key.slice('remote:'.length) } : {},
      skills: group.skills,
    }))
    .sort((left, right) => ORIGIN_ORDER[left.origin] - ORIGIN_ORDER[right.origin] || (left.key < right.key ? -1 : 1))
}

/**
 * A compact display name for a source URL: `owner/repo` for a GitHub repository,
 * `owner/repo/<folder>` for a subfolder or single file inside one, host and file otherwise.
 * @param source - source URL, id, and optional subfolder.
 * @returns the display name.
 */
export function sourceLabel(source: Pick<ManagedSource, 'url' | 'id' | 'path'>): string {
  const shorthand = /^github:([^/]+\/[^/]+)/.exec(source.url)
  if (shorthand !== null) return withFolder(shorthand[1] as string, source.path?.split('/').at(-1))
  try {
    const url = new URL(source.url)
    const segments = url.pathname.split('/').filter(segment => segment.length > 0)
    if (url.hostname.endsWith('github.com') && segments.length >= 2) {
      const repo = `${segments[0]}/${segments[1]?.replace(/\.git$/, '')}`
      // `/blob/<ref>/<dir>/SKILL.md` names the skill by its folder; `/tree/<ref>/<dir>` by its last folder.
      const inner = segments.slice(4)
      const folder = segments[2] === 'blob' ? inner.at(-2) : segments[2] === 'tree' ? inner.at(-1) : undefined
      return withFolder(repo, source.path?.split('/').at(-1) ?? folder)
    }
    return `${url.hostname}/${segments.at(-1) ?? ''}`.replace(/\/$/, '')
  } catch {
    // A malformed URL never reaches the Host store; show the id the Host assigned.
    return source.id
  }
}

function withFolder(repo: string, folder: string | undefined): string {
  return folder === undefined ? repo : `${repo}/${folder}`
}

/**
 * Detect the source kind a pasted link resolves to, for the live format readout.
 * @param url - link as typed.
 * @returns the kind, or `undefined` for an unsupported or empty link.
 */
export function detectKind(url: string): ManagedSource['kind'] | undefined {
  const value = url.trim().toLowerCase()
  if (value.length === 0) return undefined
  if (value.startsWith('github:') || /^https:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/.test(value)) {
    return /\/blob\/.+\.md$/.test(value) ? 'skill-file' : 'github'
  }
  if (/^https:\/\/.+\.zip(\?.*)?$/.test(value)) return 'archive'
  if (/^https:\/\/.+\.md(\?.*)?$/.test(value)) return 'skill-file'
  return undefined
}

/**
 * A relative age such as "3 minutes ago" in the viewer's language.
 * @param iso - ISO timestamp.
 * @param now - reference time in milliseconds.
 * @returns the localized relative time.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(seconds, 'second')
}

/**
 * An entry's install state as of the latest inventory: an installing entry
 * becomes installed once a remote skill of its name appears, and an installed
 * entry becomes available again once no remote skill of its name remains.
 * @param entry - marketplace entry with the state the search reported.
 * @param skills - current inventory skills, or `undefined` before the first load.
 * @returns the state to display.
 */
export function entryState(entry: MarketplaceEntry, skills: readonly ManagedSkill[] | undefined): MarketplaceEntry['state'] {
  if (skills === undefined) return entry.state
  const remote = skills.some(skill => skill.name === entry.name && skill.source.startsWith('remote:'))
  if (entry.state === 'installing') return remote ? 'installed' : 'installing'
  if (entry.state === 'installed' && !remote) return 'available'
  return entry.state
}

/**
 * A compact count such as 1.2k or 47k.
 * @param value - count.
 * @returns the localized compact number.
 */
export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** The skill-name grammar the Host enforces, mirrored for immediate feedback. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
