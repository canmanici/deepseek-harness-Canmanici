/**
 * Remote skill sources.
 *
 * This package is a Service Provider on the `ctx.skills` seam and owns the
 * `ctx.skillSources` service. A source is a GitHub repository, a ZIP archive,
 * or a single Markdown skill file. A sync downloads the source, extracts it
 * into a commit-named generation under the DSH home, records the discovered
 * skill directories in a manifest, and atomically switches the source's
 * current generation. The provider lists skills from the current manifests of
 * enabled sources; lookups never touch the network.
 *
 * @module @deepseek-ai/dsh-skill-sources
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isSkillName, type SkillCandidate, type SkillDefinition, type SkillInvocationPolicy, type SkillProvider, type SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { parseSkillDocument } from '@deepseek-ai/dsh-skill-filesystem'
import { discoverSkills, extractZip, type DiscoveredSkill } from './archive.ts'
import { fetchBytes, type FetchPolicy } from './fetch.ts'
import { normalizeSubpath, resolveSourceSpec, suggestSourceId, type GitHubSourceSpec, type SourceSpec } from './source-spec.ts'

export { normalizeSubpath, resolveSourceSpec, suggestSourceId } from './source-spec.ts'
export { assertFetchable, fetchBytes } from './fetch.ts'
export type { FetchPolicy } from './fetch.ts'
export type { ArchiveSourceSpec, GitHubSourceSpec, SkillFileSourceSpec, SourceLocation, SourceSpec } from './source-spec.ts'

const PROVIDER_NAME = 'skill-sources'
const STATE_VERSION = 1
const MANIFEST_VERSION = 1
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One configured source. */
export interface SkillSourceConfig {
  /** Stable lowercase hyphenated id; also the `remote:<id>` skill source label. */
  readonly id: string
  /** GitHub repository URL, `github:owner/repo`, `.zip` archive URL, or `.md` skill file URL. */
  readonly url: string
  /** Git ref for GitHub sources. */
  readonly ref?: string
  /** Subdirectory that bounds discovery. */
  readonly path?: string
  /** Skill names or directory names to install; omitted installs every discovered skill. */
  readonly skills?: readonly string[]
  /** Whether the source contributes skills. */
  readonly enabled?: boolean
}

/** Skill sources configuration. */
export interface Config {
  /** Sources every user starts with; users may disable or remove them. */
  readonly defaultSources?: readonly SkillSourceConfig[]
  /** DSH home holding the source list and synced files; omitted resolves `$DSH_HOME`, then `~/.dsh`. */
  readonly dshHome?: string
  /** Precedence rank of remote skills; lower wins a duplicate name within one registry layer. */
  readonly rank?: number
  /** Sync enabled sources that have never synced when the plugin starts. */
  readonly autoSyncOnStart?: boolean
  /** Largest downloaded archive or file in bytes. */
  readonly maxDownloadBytes?: number
  /** Largest total extracted size in bytes. */
  readonly maxExtractedBytes?: number
  /** Largest number of extracted files per source. */
  readonly maxFiles?: number
  /** Largest `SKILL.md` accepted in bytes. */
  readonly maxSkillBytes?: number
  /** Deepest directory level searched for `SKILL.md`. */
  readonly maxDiscoveryDepth?: number
  /** Per-request timeout in milliseconds. */
  readonly fetchTimeoutMs?: number
  /** GitHub REST API base URL. */
  readonly githubApiUrl?: string
  /** Credential reference holding a GitHub token for rate limits and private repositories. */
  readonly githubTokenRef?: string
  /** Permit plain HTTP to loopback hosts, for local mirrors and test fixtures. */
  readonly allowHttpLoopback?: boolean
}

/** Resolved configuration with every default applied. */
export interface SkillSourcesSpec {
  readonly defaultSources: ReadonlyArray<SkillSourceConfig & { readonly enabled: boolean }>
  readonly stateFile: string
  readonly cacheDir: string
  readonly rank: number
  readonly autoSyncOnStart: boolean
  readonly fetch: FetchPolicy
  readonly maxExtractedBytes: number
  readonly maxFiles: number
  readonly maxSkillBytes: number
  readonly maxDiscoveryDepth: number
  readonly githubApiUrl: string
  readonly githubTokenRef: string | undefined
}

const ConfigSchema: Schema<Config> = z.object({
  defaultSources: z.array(z.object({
    id: z.string().required(),
    url: z.string().required(),
    ref: z.string(),
    path: z.string(),
    skills: z.array(z.string()),
    enabled: z.boolean().default(true),
  })).default([]),
  dshHome: z.string(),
  rank: z.number().default(450),
  autoSyncOnStart: z.boolean().default(true),
  maxDownloadBytes: z.natural().default(64 * 1024 * 1024),
  maxExtractedBytes: z.natural().default(256 * 1024 * 1024),
  maxFiles: z.natural().default(10_000),
  maxSkillBytes: z.natural().default(1024 * 1024),
  maxDiscoveryDepth: z.natural().default(6),
  fetchTimeoutMs: z.natural().default(120_000),
  githubApiUrl: z.string().default('https://api.github.com'),
  githubTokenRef: z.string().default('GITHUB_TOKEN'),
  allowHttpLoopback: z.boolean().default(false),
  // Schemastery infers `T | null` for optional nested fields, which exactOptionalPropertyTypes rejects against the declared Config.
}) as Schema<Config>

/**
 * Apply configuration defaults and validate default sources.
 * @param config - plugin configuration after schema defaults.
 * @returns the resolved specification.
 * @throws Error when a default source id or URL is invalid or ids repeat.
 */
export function resolveSkillSourcesSpec(config: Config): SkillSourcesSpec {
  const home = resolveDshHome(config.dshHome)
  const defaultSources = config.defaultSources ?? []
  const ids = new Set<string>()
  for (const source of defaultSources) {
    assertSourceId(source.id)
    if (ids.has(source.id)) throw new Error(`skill-sources: duplicate default source id "${source.id}"`)
    ids.add(source.id)
    resolveSourceSpec(source)
  }
  const tokenRef = config.githubTokenRef ?? 'GITHUB_TOKEN'
  if (tokenRef !== '' && !isCredentialRefName(tokenRef)) throw new Error(`skill-sources: invalid githubTokenRef "${tokenRef}"`)
  return {
    // Schemastery fills an omitted array with `[]`; a default source that installs nothing has no use, so empty means every skill.
    defaultSources: defaultSources.map(({ skills, ...source }) => ({
      ...source,
      ...skills === undefined || skills.length === 0 ? {} : { skills },
      enabled: source.enabled ?? true,
    })),
    stateFile: join(home, 'skill-sources.json'),
    cacheDir: join(home, 'skill-sources'),
    rank: config.rank ?? 450,
    autoSyncOnStart: config.autoSyncOnStart ?? true,
    fetch: {
      maxBytes: config.maxDownloadBytes ?? 64 * 1024 * 1024,
      timeoutMs: config.fetchTimeoutMs ?? 120_000,
      allowHttpLoopback: config.allowHttpLoopback ?? false,
    },
    maxExtractedBytes: config.maxExtractedBytes ?? 256 * 1024 * 1024,
    maxFiles: config.maxFiles ?? 10_000,
    maxSkillBytes: config.maxSkillBytes ?? 1024 * 1024,
    maxDiscoveryDepth: config.maxDiscoveryDepth ?? 6,
    githubApiUrl: (config.githubApiUrl ?? 'https://api.github.com').replace(/\/+$/, ''),
    githubTokenRef: tokenRef === '' ? undefined : tokenRef,
  }
}

/** Sync progress of one source. */
export type SkillSourceSyncState = 'never' | 'syncing' | 'ok' | 'error'

/** One source as management surfaces display it. */
export interface SkillSourceView {
  readonly id: string
  readonly url: string
  readonly ref?: string
  readonly path?: string
  /** Installed skill selection; omitted means every discovered skill. */
  readonly skills?: readonly string[]
  readonly enabled: boolean
  /** `default` sources come from configuration; `user` sources were added by the user. */
  readonly origin: 'default' | 'user'
  /** Resolved source kind. */
  readonly kind: SourceSpec['kind']
  readonly sync: {
    readonly state: SkillSourceSyncState
    /** Commit SHA for GitHub sources, content SHA-256 otherwise, of the current generation. */
    readonly commit?: string
    /** ISO timestamp of the current generation. */
    readonly syncedAt?: string
    /** Failure message of the latest sync attempt. */
    readonly error?: string
    /** Number of installed skills in the current generation. */
    readonly skillCount: number
    /** Number of skills the current generation offers, installed or not. */
    readonly availableCount: number
    /** Upstream commit seen by the latest update check. */
    readonly latest?: string
    /** Whether the latest update check found a commit newer than the current generation. */
    readonly updateAvailable: boolean
    /** ISO timestamp of the latest update check. */
    readonly checkedAt?: string
  }
}

/** One skill a synced generation offers. */
export interface SkillSourceOffer {
  readonly name: string
  readonly description: string
  /** Skill directory relative to the source root. */
  readonly dir: string
  /** Whether the source's selection installs it. */
  readonly installed: boolean
}

/** Input for adding a source. */
export interface AddSkillSourceRequest {
  /** Source URL or `github:owner/repo`. */
  readonly url: string
  /** Git ref for GitHub sources. */
  readonly ref?: string | undefined
  /** Subdirectory that bounds discovery. */
  readonly path?: string | undefined
  /** Skill names or directory names to install; omitted installs every discovered skill. */
  readonly skills?: readonly string[] | undefined
  /** Explicit id; omitted derives one from the URL. */
  readonly id?: string | undefined
}

interface UserSource {
  id: string
  url: string
  ref?: string
  path?: string
  skills?: string[]
  enabled: boolean
}

interface DefaultOverride {
  enabled?: boolean
  removed?: boolean
  skills?: string[]
}

interface SourcesState {
  sources: UserSource[]
  defaults: Record<string, DefaultOverride>
}

interface UpdateCheck {
  latest: string
  checkedAt: string
}

interface Manifest {
  version: number
  commit: string
  syncedAt: string
  skills: DiscoveredSkill[]
}

interface Generation {
  dir: string
  manifest: Manifest
}

interface EffectiveSource extends UserSource {
  origin: 'default' | 'user'
}

interface Locator {
  file: string
  directory: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillSources: SkillSources
  }

  interface Events {
    /**
     * The source list, a source's enablement, or a sync state changed.
     * @mode emit
     */
    'skill-sources/change'(): void
  }
}

/**
 * Remote skill sources synced to disk and exposed as a `ctx.skills` provider.
 * Source-list mutations serialize through a cross-process file lock and commit
 * atomically; a sync replaces a source's generation only after extraction and
 * discovery succeed, so a failed sync keeps the previous skills.
 */
export class SkillSources extends Service {
  static readonly inject = ['skills']
  static Config: Schema<Config> = ConfigSchema

  private readonly spec: SkillSourcesSpec
  private state: SourcesState = { sources: [], defaults: {} }
  private readonly generations = new Map<string, Generation>()
  private readonly errors = new Map<string, string>()
  private readonly checks = new Map<string, UpdateCheck>()
  private readonly syncing = new Map<string, Promise<void>>()
  private readonly lifecycle = new AbortController()
  private control: SkillProviderControl | undefined
  private writes: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillSources')
    this.spec = resolveSkillSourcesSpec(config)
  }

  /** Load the source list and current generations, register the provider, and start first syncs. */
  protected async [Service.init](): Promise<void> {
    this.state = await readState(this.spec.stateFile)
    for (const source of this.effectiveSources()) {
      const generation = await readCurrentGeneration(this.sourceDir(source.id))
      if (generation !== undefined) this.generations.set(source.id, generation)
    }
    this.ctx.skills.registerProvider((control) => {
      this.control = control
      return this.provider()
    })
    this.ctx.effect(() => () => { this.lifecycle.abort(new Error('skill-sources disposed')) }, 'skillSources.lifecycle')
    if (this.spec.autoSyncOnStart) {
      for (const source of this.effectiveSources()) {
        if (source.enabled && !this.generations.has(source.id)) this.startSync(source.id)
      }
    }
  }

  /**
   * List every source with its sync status.
   * @returns sources in configuration order, then user sources in insertion order.
   */
  list(): SkillSourceView[] {
    return this.effectiveSources().map(source => this.view(source))
  }

  /**
   * Add a user source and start its first sync.
   * @param request - URL, optional ref, subdirectory, and id.
   * @returns the added source, in the `syncing` state.
   * @throws Error when the URL is unsupported or the id is taken.
   */
  async add(request: AddSkillSourceRequest): Promise<SkillSourceView> {
    const path = normalizeSubpath(request.path)
    const location = { url: request.url.trim(), ref: emptyToUndefined(request.ref), path }
    const spec = resolveSourceSpec(location)
    const id = request.id ?? suggestSourceId(spec)
    assertSourceId(id)
    await this.mutate((state) => {
      const taken = [...this.spec.defaultSources, ...state.sources].some(source => source.id === id)
      if (taken) throw new Error(`a skill source with id "${id}" already exists`)
      const source: UserSource = { id, url: location.url, enabled: true }
      if (location.ref !== undefined) source.ref = location.ref
      if (path !== undefined) source.path = path
      const skills = normalizeSelection(request.skills)
      if (skills !== undefined) source.skills = skills
      return { ...state, sources: [...state.sources, source] }
    })
    this.startSync(id)
    return this.view(this.requireSource(id))
  }

  /**
   * Remove a source and its synced files. A default source is hidden rather
   * than deleted, so configuration does not bring it back.
   * @param id - source id.
   */
  async remove(id: string): Promise<void> {
    const source = this.requireSource(id)
    await this.mutate(state => source.origin === 'default'
      ? { ...state, defaults: { ...state.defaults, [id]: { removed: true } } }
      : { ...state, sources: state.sources.filter(entry => entry.id !== id) })
    this.generations.delete(id)
    this.errors.delete(id)
    this.checks.delete(id)
    await rm(this.sourceDir(id), { recursive: true, force: true })
    this.changed()
  }

  /**
   * Enable or disable a source's skills without deleting synced files.
   * @param id - source id.
   * @param enabled - target enablement.
   * @returns the updated source.
   */
  async setEnabled(id: string, enabled: boolean): Promise<SkillSourceView> {
    const source = this.requireSource(id)
    await this.mutate(state => source.origin === 'default'
      ? { ...state, defaults: { ...state.defaults, [id]: { ...state.defaults[id], enabled } } }
      : { ...state, sources: state.sources.map(entry => entry.id === id ? { ...entry, enabled } : entry) })
    this.changed()
    if (enabled && !this.generations.has(id)) this.startSync(id)
    return this.view(this.requireSource(id))
  }

  /**
   * Replace which of a source's skills are installed. Selection applies to the
   * synced generation without downloading it again.
   * @param id - source id.
   * @param skills - skill or directory names; `undefined` installs every discovered skill of a user
   *   source and restores a default source's configured selection.
   * @returns the updated source.
   */
  async setSkills(id: string, skills: readonly string[] | undefined): Promise<SkillSourceView> {
    const source = this.requireSource(id)
    const selection = normalizeSelection(skills)
    await this.mutate((state) => {
      if (source.origin === 'default') {
        const { skills: _previous, ...rest } = state.defaults[id] ?? {}
        return { ...state, defaults: { ...state.defaults, [id]: selection === undefined ? rest : { ...rest, skills: selection } } }
      }
      return {
        ...state,
        sources: state.sources.map((entry) => {
          if (entry.id !== id) return entry
          const { skills: _previous, ...rest } = entry
          return selection === undefined ? rest : { ...rest, skills: selection }
        }),
      }
    })
    this.changed()
    return this.view(this.requireSource(id))
  }

  /**
   * List the skills a source's current generation offers and whether each is installed.
   * @param id - source id.
   * @returns offers in discovery order; empty before the first sync.
   */
  offers(id: string): SkillSourceOffer[] {
    const source = this.requireSource(id)
    const generation = this.generations.get(id)
    if (generation === undefined) return []
    return generation.manifest.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      dir: skill.dir,
      installed: selects(source.skills, skill),
    }))
  }

  /**
   * Ask upstream for the newest commit without downloading it. GitHub sources
   * compare commit SHAs; archive and file sources report no update until a sync
   * downloads different bytes.
   * @param id - source id.
   * @returns the source with `sync.updateAvailable` and `sync.latest` refreshed.
   */
  async checkUpdate(id: string): Promise<SkillSourceView> {
    const source = this.requireSource(id)
    const spec = resolveSourceSpec(source)
    try {
      if (spec.kind === 'github') {
        this.checks.set(id, { latest: await this.githubCommit(spec, this.lifecycle.signal), checkedAt: new Date().toISOString() })
      }
      this.errors.delete(id)
    } catch (error) {
      if (this.lifecycle.signal.aborted) throw error
      this.errors.set(id, (error as Error).message)
    }
    this.changed()
    return this.view(this.requireSource(id))
  }

  /**
   * Download the source again and switch to the new generation when its commit changed.
   * Concurrent calls for one source share one sync.
   * @param id - source id.
   * @returns the source after the sync settles; a failure is reported in `sync.error`.
   */
  async sync(id: string): Promise<SkillSourceView> {
    this.requireSource(id)
    let run = this.syncing.get(id)
    if (run === undefined) {
      run = this.runSync(id).finally(() => {
        this.syncing.delete(id)
        this.changed()
      })
      this.syncing.set(id, run)
      this.changed()
    }
    await run
    return this.view(this.requireSource(id))
  }

  private startSync(id: string): void {
    this.sync(id).catch((error: unknown) => {
      this.ctx.logger.warn(`skill source "${id}" sync failed: ${(error as Error).message}`)
    })
  }

  private async runSync(id: string): Promise<void> {
    const signal = this.lifecycle.signal
    const source = this.requireSource(id)
    try {
      const spec = resolveSourceSpec(source)
      const base = this.sourceDir(id)
      await mkdir(base, { recursive: true, mode: 0o700 })
      const staging = join(base, `.staging-${randomBytes(6).toString('hex')}`)
      await mkdir(staging)
      try {
        const commit = await this.download(spec, staging, this.generations.get(id)?.manifest.commit, signal)
        if (commit !== undefined) {
          const skills = await discoverSkills(staging, {
            maxDepth: this.spec.maxDiscoveryDepth,
            maxSkillBytes: this.spec.maxSkillBytes,
            warn: (message) => { this.ctx.logger.warn(`skill source "${id}": ${message}`) },
          })
          const manifest: Manifest = { version: MANIFEST_VERSION, commit, syncedAt: new Date().toISOString(), skills }
          await writeFileAtomic(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
          signal.throwIfAborted()
          await this.commitGeneration(id, staging, manifest)
        }
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
      this.errors.delete(id)
    } catch (error) {
      if (signal.aborted) throw error
      this.errors.set(id, (error as Error).message)
    }
  }

  /**
   * Fetch one source into `staging`.
   * @returns the new commit, or `undefined` when `current` is already up to date.
   */
  private async download(spec: SourceSpec, staging: string, current: string | undefined, signal: AbortSignal): Promise<string | undefined> {
    const limits = { maxExtractedBytes: this.spec.maxExtractedBytes, maxFiles: this.spec.maxFiles }
    switch (spec.kind) {
      case 'github': {
        const commit = await this.githubCommit(spec, signal)
        if (commit === current) return undefined
        const zip = await fetchBytes(`${this.spec.githubApiUrl}/repos/${spec.owner}/${spec.repo}/zipball/${commit}`, await this.githubHeaders(), this.spec.fetch, signal)
        await extractZip(zip, staging, spec.path, limits)
        return commit
      }
      case 'archive': {
        const zip = await fetchBytes(spec.url, userAgent(), this.spec.fetch, signal)
        const commit = sha256(zip)
        if (commit === current) return undefined
        await extractZip(zip, staging, spec.path, limits)
        return commit
      }
      case 'skill-file': {
        const bytes = await fetchBytes(spec.url, userAgent(), this.spec.fetch, signal)
        if (bytes.byteLength > this.spec.maxSkillBytes) throw new Error(`${spec.url} is larger than ${this.spec.maxSkillBytes} bytes`)
        const commit = sha256(bytes)
        if (commit === current) return undefined
        const { name } = parseSkillDocument(new TextDecoder().decode(bytes))
        await mkdir(join(staging, name), { recursive: true })
        await writeFileAtomic(join(staging, name, 'SKILL.md'), new TextDecoder().decode(bytes), { mode: 0o644 })
        return commit
      }
    }
  }

  private async githubCommit(spec: GitHubSourceSpec, signal: AbortSignal): Promise<string> {
    const headers = { ...await this.githubHeaders(), Accept: 'application/vnd.github.sha' }
    const bytes = await fetchBytes(`${this.spec.githubApiUrl}/repos/${spec.owner}/${spec.repo}/commits/${encodeURIComponent(spec.ref ?? 'HEAD')}`, headers, this.spec.fetch, signal)
    const commit = new TextDecoder().decode(bytes).trim()
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`GitHub returned an invalid commit for ${spec.owner}/${spec.repo}`)
    return commit
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

  /** Move a finished staging tree into place, then atomically repoint `current.json`. */
  private async commitGeneration(id: string, staging: string, manifest: Manifest): Promise<void> {
    // A removal during the download already deleted the source directory; keep it deleted.
    if (!this.effectiveSources().some(source => source.id === id)) return
    const base = this.sourceDir(id)
    const dir = join(base, manifest.commit)
    await rm(dir, { recursive: true, force: true })
    await rename(staging, dir)
    await writeFileAtomic(join(base, 'current.json'), `${JSON.stringify({ generation: manifest.commit })}\n`, { mode: 0o644 })
    const previous = this.generations.get(id)
    this.generations.set(id, { dir, manifest })
    if (previous !== undefined && previous.dir !== dir) await rm(previous.dir, { recursive: true, force: true })
    this.control?.invalidate()
  }

  private provider(): SkillProvider {
    return {
      name: PROVIDER_NAME,
      list: () => {
        const candidates: SkillCandidate[] = []
        for (const source of this.effectiveSources()) {
          const generation = this.generations.get(source.id)
          if (!source.enabled || generation === undefined) continue
          for (const skill of generation.manifest.skills) {
            if (selects(source.skills, skill)) candidates.push(this.candidate(source.id, generation, skill))
          }
        }
        return Promise.resolve(candidates)
      },
      get: async (candidate) => {
        const locator = candidate.locator as Locator
        let raw: string
        try {
          raw = await readFile(locator.file, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
        const document = parseSkillDocument(raw)
        const definition: SkillDefinition = { ...candidateSummary(candidate), ...document, content: document.content }
        return definition
      },
    }
  }

  private candidate(id: string, generation: Generation, skill: DiscoveredSkill): SkillCandidate {
    const directory = join(generation.dir, ...skill.dir.split('/').filter(segment => segment.length > 0))
    const file = join(directory, 'SKILL.md')
    return {
      name: skill.name,
      description: skill.description,
      ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
      invocation: skill.invocation,
      source: `remote:${id}`,
      provider: PROVIDER_NAME,
      rank: this.spec.rank,
      locator: { file, directory } satisfies Locator,
      path: file,
      resourceBase: { kind: 'directory', path: directory },
      ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
    }
  }

  private view(source: EffectiveSource): SkillSourceView {
    const generation = this.generations.get(source.id)
    const error = this.errors.get(source.id)
    const check = this.checks.get(source.id)
    const offered = generation?.manifest.skills ?? []
    const state: SkillSourceSyncState = this.syncing.has(source.id)
      ? 'syncing'
      : error !== undefined ? 'error' : generation !== undefined ? 'ok' : 'never'
    return {
      id: source.id,
      url: source.url,
      ...source.ref === undefined ? {} : { ref: source.ref },
      ...source.path === undefined ? {} : { path: source.path },
      ...source.skills === undefined ? {} : { skills: source.skills },
      enabled: source.enabled,
      origin: source.origin,
      kind: resolveSourceSpec(source).kind,
      sync: {
        state,
        ...generation === undefined ? {} : { commit: generation.manifest.commit, syncedAt: generation.manifest.syncedAt },
        ...error === undefined ? {} : { error },
        skillCount: offered.filter(skill => selects(source.skills, skill)).length,
        availableCount: offered.length,
        ...check === undefined ? {} : { latest: check.latest, checkedAt: check.checkedAt },
        updateAvailable: check !== undefined && generation !== undefined && check.latest !== generation.manifest.commit,
      },
    }
  }

  private effectiveSources(state: SourcesState = this.state): EffectiveSource[] {
    const defaults: EffectiveSource[] = []
    for (const source of this.spec.defaultSources) {
      const override = state.defaults[source.id]
      if (override?.removed === true) continue
      defaults.push({
        id: source.id,
        url: source.url,
        ...source.ref === undefined ? {} : { ref: source.ref },
        ...source.path === undefined ? {} : { path: source.path },
        ...override?.skills !== undefined ? { skills: override.skills } : source.skills === undefined ? {} : { skills: [...source.skills] },
        enabled: override?.enabled ?? source.enabled,
        origin: 'default',
      })
    }
    return [...defaults, ...state.sources.map(source => ({ ...source, origin: 'user' as const }))]
  }

  private requireSource(id: string): EffectiveSource {
    const source = this.effectiveSources().find(entry => entry.id === id)
    if (source === undefined) throw new Error(`unknown skill source "${id}"`)
    return source
  }

  private sourceDir(id: string): string {
    return join(this.spec.cacheDir, id)
  }

  private async mutate(change: (state: SourcesState) => SourcesState): Promise<void> {
    const run = this.writes.then(async () => {
      await mkdir(resolve(this.spec.stateFile, '..'), { recursive: true, mode: 0o700 })
      await withFileLock(this.spec.stateFile, async () => {
        const next = change(await readState(this.spec.stateFile))
        await writeFileAtomic(this.spec.stateFile, `${JSON.stringify({ version: STATE_VERSION, ...next }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
        this.state = next
      })
    })
    this.writes = run.catch(() => {})
    await run
    this.control?.invalidate()
  }

  private changed(): void {
    this.ctx.emit('skill-sources/change')
  }
}

function candidateSummary(candidate: SkillCandidate): Omit<SkillDefinition, 'content'> {
  const { rank: _rank, locator: _locator, ...summary } = candidate
  return summary
}

/**
 * Whether a selection installs one discovered skill; entries match its name or its directory's last segment.
 * @param selection - installed names, or `undefined` for every skill.
 * @param skill - the discovered skill.
 * @returns whether it is installed.
 */
function selects(selection: readonly string[] | undefined, skill: DiscoveredSkill): boolean {
  if (selection === undefined) return true
  const directory = skill.dir.split('/').at(-1)
  return selection.some(entry => entry === skill.name || entry === directory)
}

function normalizeSelection(skills: readonly string[] | undefined): string[] | undefined {
  if (skills === undefined) return undefined
  return [...new Set(skills.map(entry => entry.trim()).filter(entry => entry.length > 0))]
}

function userAgent(): Record<string, string> {
  return { 'User-Agent': 'deepseek-harness-skill-sources' }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function assertSourceId(id: string): void {
  if (!SOURCE_ID.test(id) || id.length > 64) throw new Error(`invalid skill source id "${id}"; use lowercase letters, digits, and hyphens`)
}

async function readState(file: string): Promise<SourcesState> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sources: [], defaults: {} }
    throw error
  }
  return parseSourcesState(raw, file)
}

/**
 * Validate the persisted source list.
 * @param raw - file text.
 * @param file - path named in errors.
 * @returns the validated state.
 */
export function parseSourcesState(raw: string, file: string): { sources: UserSource[]; defaults: SourcesState['defaults'] } {
  const fail = (detail: string): Error => new Error(`invalid skill sources file ${file}: ${detail}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw fail((error as SyntaxError).message)
  }
  if (!isRecord(parsed) || parsed.version !== STATE_VERSION) throw fail(`expected an object with version ${STATE_VERSION}`)
  if (!Array.isArray(parsed.sources) || !isRecord(parsed.defaults)) throw fail('"sources" must be an array and "defaults" an object')
  const sources: UserSource[] = parsed.sources.map((entry: unknown, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.url !== 'string' || typeof entry.enabled !== 'boolean') {
      throw fail(`sources[${index}] needs string "id" and "url" and boolean "enabled"`)
    }
    if (!SOURCE_ID.test(entry.id)) throw fail(`sources[${index}] has invalid id "${entry.id}"`)
    const source: UserSource = { id: entry.id, url: entry.url, enabled: entry.enabled }
    if (typeof entry.ref === 'string') source.ref = entry.ref
    if (typeof entry.path === 'string') source.path = entry.path
    if (entry.skills !== undefined) source.skills = parseSelection(entry.skills, `sources[${index}].skills`, fail)
    try {
      resolveSourceSpec(source)
    } catch (error) {
      throw fail(`sources[${index}]: ${(error as Error).message}`)
    }
    return source
  })
  const defaults: SourcesState['defaults'] = {}
  for (const [id, value] of Object.entries(parsed.defaults)) {
    if (!isRecord(value)) throw fail(`defaults["${id}"] must be an object`)
    defaults[id] = {
      ...typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {},
      ...value.removed === true ? { removed: true } : {},
      ...value.skills === undefined ? {} : { skills: parseSelection(value.skills, `defaults["${id}"].skills`, fail) },
    }
  }
  return { sources, defaults }
}

function parseSelection(value: unknown, field: string, fail: (detail: string) => Error): string[] {
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string')) throw fail(`${field} must be an array of strings`)
  return value
}

async function readCurrentGeneration(base: string): Promise<Generation | undefined> {
  let pointer: unknown
  try {
    pointer = JSON.parse(await readFile(join(base, 'current.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`invalid skill source pointer ${join(base, 'current.json')}: ${(error as Error).message}`, { cause: error })
  }
  if (!isRecord(pointer) || typeof pointer.generation !== 'string' || !/^[0-9a-f]{40,64}$/.test(pointer.generation)) {
    throw new Error(`invalid skill source pointer ${join(base, 'current.json')}`)
  }
  const dir = join(base, pointer.generation)
  const manifest = parseManifest(await readFile(join(dir, 'manifest.json'), 'utf8'), join(dir, 'manifest.json'))
  return { dir, manifest }
}

/**
 * Validate a generation manifest written by a sync.
 * @param raw - file text.
 * @param file - path named in errors.
 * @returns the validated manifest.
 */
export function parseManifest(raw: string, file: string): Manifest {
  const fail = (detail: string): Error => new Error(`invalid skill source manifest ${file}: ${detail}`)
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || parsed.version !== MANIFEST_VERSION || typeof parsed.commit !== 'string' || typeof parsed.syncedAt !== 'string' || !Array.isArray(parsed.skills)) {
    throw fail('missing version, commit, syncedAt, or skills')
  }
  const skills = parsed.skills.map((entry: unknown, index): DiscoveredSkill => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !isSkillName(entry.name) || typeof entry.description !== 'string'
      || typeof entry.dir !== 'string' || entry.dir.split('/').includes('..') || !isInvocation(entry.invocation)) {
      throw fail(`skills[${index}] is malformed`)
    }
    return {
      name: entry.name,
      description: entry.description,
      dir: entry.dir,
      invocation: entry.invocation,
      ...typeof entry.whenToUse === 'string' ? { whenToUse: entry.whenToUse } : {},
      ...isRecord(entry.metadata) ? { metadata: entry.metadata } : {},
    }
  })
  return { version: MANIFEST_VERSION, commit: parsed.commit, syncedAt: parsed.syncedAt, skills }
}

function isInvocation(value: unknown): value is SkillInvocationPolicy {
  return isRecord(value) && typeof value.modelInvocable === 'boolean' && typeof value.userInvocable === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default SkillSources
