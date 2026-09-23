/**
 * Source URL parsing: turns a user-supplied location into the fetch plan a
 * sync executes.
 * @module
 */

/** A GitHub repository, optionally pinned to a ref and narrowed to a subdirectory. */
export interface GitHubSourceSpec {
  readonly kind: 'github'
  /** Repository owner. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
  /** Branch, tag, or commit; omitted follows the default branch. */
  readonly ref?: string
  /** Repository subdirectory that bounds discovery; omitted scans the whole repository. */
  readonly path?: string
}

/** A ZIP archive at an HTTPS URL. */
export interface ArchiveSourceSpec {
  readonly kind: 'archive'
  /** Archive URL. */
  readonly url: string
  /** Archive subdirectory that bounds discovery. */
  readonly path?: string
}

/** One Markdown skill file at an HTTPS URL. */
export interface SkillFileSourceSpec {
  readonly kind: 'skill-file'
  /** File URL. */
  readonly url: string
}

/** Fetch plan for one source. */
export type SourceSpec = GitHubSourceSpec | ArchiveSourceSpec | SkillFileSourceSpec

/** User-supplied location of one source. */
export interface SourceLocation {
  /** Source URL or `github:owner/repo` shorthand. */
  readonly url: string
  /** Git ref for GitHub sources; overrides a ref embedded in a `/tree/<ref>` URL. */
  readonly ref?: string | undefined
  /** Subdirectory for repository and archive sources; overrides a path embedded in the URL. */
  readonly path?: string | undefined
}

const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/

/**
 * Resolve a user-supplied location into a fetch plan.
 * @param location - URL plus optional ref and subdirectory.
 * @returns the fetch plan.
 * @throws Error when the URL is not a supported source.
 */
export function resolveSourceSpec(location: SourceLocation): SourceSpec {
  const raw = location.url.trim()
  const path = normalizeSubpath(location.path)
  if (raw.startsWith('github:')) {
    const [owner, repo, ...rest] = raw.slice('github:'.length).split('/')
    return githubSpec(owner, repo, location.ref, path ?? normalizeSubpath(rest.join('/')))
  }
  const url = parseUrl(raw)
  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const [owner, repo, marker, ref, ...rest] = url.pathname.split('/').filter(segment => segment.length > 0)
    if (marker === undefined) return githubSpec(owner, repo?.replace(/\.git$/, ''), location.ref, path)
    if (marker === 'tree' && ref !== undefined) {
      return githubSpec(owner, repo, location.ref ?? ref, path ?? normalizeSubpath(rest.join('/')))
    }
    if (marker === 'blob' && ref !== undefined && rest.length > 0) {
      return skillFileSpec(new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join('/')}`))
    }
    throw new Error(`unsupported GitHub URL "${raw}"; use a repository, /tree/<ref>/<path>, or /blob/<ref>/<file>.md URL`)
  }
  if (url.pathname.toLowerCase().endsWith('.zip')) {
    return { kind: 'archive', url: url.href, ...path === undefined ? {} : { path } }
  }
  if (url.pathname.toLowerCase().endsWith('.md')) return skillFileSpec(url)
  throw new Error(`unsupported source URL "${raw}"; use a GitHub repository, a .zip archive, or a .md skill file`)
}

/**
 * Suggest a stable source id for a location.
 * @param spec - resolved fetch plan.
 * @returns a lowercase hyphenated id.
 */
export function suggestSourceId(spec: SourceSpec): string {
  const words = spec.kind === 'github'
    ? [spec.owner, spec.repo, ...(spec.path?.split('/') ?? [])]
    : [new URL(spec.url).hostname, ...new URL(spec.url).pathname.replace(/\.(zip|md)$/i, '').split('/')]
  const id = words.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return id.length === 0 ? 'source' : id.slice(0, 64).replace(/-+$/, '')
}

function githubSpec(
  owner: string | undefined,
  repo: string | undefined,
  ref: string | undefined,
  path: string | undefined,
): GitHubSourceSpec {
  if (owner === undefined || repo === undefined || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    throw new Error('GitHub sources need an owner and a repository')
  }
  if (ref !== undefined && (ref.length === 0 || ref.includes('..') || /[\s~^:?*[\\]/.test(ref))) {
    throw new Error(`invalid git ref "${ref}"`)
  }
  return { kind: 'github', owner, repo, ...ref === undefined ? {} : { ref }, ...path === undefined ? {} : { path } }
}

function skillFileSpec(url: URL): SkillFileSourceSpec {
  return { kind: 'skill-file', url: url.href }
}

function parseUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    // The URL constructor's message omits the input; report the value the user typed.
    throw new Error(`"${raw}" is not a URL`)
  }
  if (url.username !== '' || url.password !== '') throw new Error('source URLs must not contain credentials')
  return url
}

/**
 * Normalize a subdirectory to slash-separated segments without dot segments.
 * @param path - user-supplied subdirectory.
 * @returns the normalized path, or `undefined` for the root.
 */
export function normalizeSubpath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const segments = path.split(/[\\/]+/).filter(segment => segment.length > 0 && segment !== '.')
  if (segments.includes('..')) throw new Error(`subdirectory "${path}" must not contain ".."`)
  return segments.length === 0 ? undefined : segments.join('/')
}
