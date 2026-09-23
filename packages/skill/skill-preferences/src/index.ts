/**
 * User skill enablement preferences.
 *
 * This package is the Service Provider for per-skill enablement on the
 * `ctx.skills` filter seam. It owns one JSON file, by default
 * `<dshHome>/skill-preferences.json`, holding global disables and per-project
 * overrides, and registers a registry filter so every catalog, loader, and
 * command surface omits a disabled skill.
 *
 * @module @deepseek-ai/dsh-skill-preferences
 */

import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import chokidar from 'chokidar'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isSkillName, type SkillFilterControl } from '@deepseek-ai/dsh-skill'
import { resolveSkillProjectRoot } from '@deepseek-ai/dsh-skill-filesystem'

const FORMAT_VERSION = 1
const FILE_NAME = 'skill-preferences.json'
const FILTER_NAME = 'skill-preferences'

/** Per-project enablement overrides; a name appears in at most one list. */
export interface ProjectSkillOverrides {
  /** Skills enabled in this project even when disabled globally. */
  readonly enabled: readonly string[]
  /** Skills disabled in this project even when enabled globally. */
  readonly disabled: readonly string[]
}

/** Complete committed preferences. */
export interface SkillPreferencesState {
  /** Global enablement: every listed skill is disabled unless a project override enables it. */
  readonly global: { readonly disabled: readonly string[] }
  /** Overrides keyed by absolute project root. */
  readonly projects: Readonly<Record<string, ProjectSkillOverrides>>
}

/** Which preference decided a skill's enablement. */
export type SkillEnablementOrigin = 'default' | 'global' | 'project'

/** Resolved enablement for one skill in one project. */
export interface SkillEnablementDecision {
  /** Whether the skill is enabled. */
  readonly enabled: boolean
  /** The preference level that decided `enabled`. */
  readonly origin: SkillEnablementOrigin
}

/** One enablement change. */
export interface SetSkillEnabledRequest {
  /** Kebab-case skill name. */
  readonly name: string
  /** Target enablement. */
  readonly enabled: boolean
  /** Absolute project root for a project override; omitted changes the global preference. */
  readonly projectRoot?: string | undefined
}

/** Removal of one project override. */
export interface ClearSkillOverrideRequest {
  /** Kebab-case skill name. */
  readonly name: string
  /** Absolute project root that holds the override. */
  readonly projectRoot: string
}

/** Skill preferences configuration. */
export interface Config {
  /** Preferences file; omitted resolves to `<dshHome>/skill-preferences.json`. */
  readonly file?: string
  /** DSH home used when `file` is omitted; omitted resolves `$DSH_HOME`, then `~/.dsh`. */
  readonly dshHome?: string
  /** Reload the file when another process or editor changes it. */
  readonly watch?: boolean
}

/** Resolved configuration with every default applied. */
export interface SkillPreferencesSpec {
  /** Absolute preferences file path. */
  readonly file: string
  /** Whether external file changes are watched. */
  readonly watch: boolean
}

/**
 * Apply configuration defaults.
 * @param config - validated plugin configuration.
 * @returns the resolved specification.
 */
export function resolveSkillPreferencesSpec(config: Config): SkillPreferencesSpec {
  const file = config.file === undefined ? join(resolveDshHome(config.dshHome), FILE_NAME) : resolve(config.file)
  return { file, watch: config.watch ?? true }
}

const EMPTY_STATE: SkillPreferencesState = { global: { disabled: [] }, projects: {} }

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillPreferences: SkillPreferences
  }

  interface Events {
    /**
     * Committed skill preferences changed, through this service or an external edit.
     * @mode emit
     */
    'skill-preferences/change'(): void
  }
}

/**
 * Persistent global and per-project skill enablement, enforced as a
 * `ctx.skills` filter. Mutations serialize through a cross-process file lock,
 * commit with an atomic rename, and only then update the in-memory state and
 * invalidate the skill catalog.
 */
export class SkillPreferences extends Service {
  static readonly inject = ['skills']
  static Config: Schema<Config> = z.object({
    file: z.string(),
    dshHome: z.string(),
    watch: z.boolean().default(true),
  })

  private readonly spec: SkillPreferencesSpec
  private current: SkillPreferencesState = EMPTY_STATE
  private loadError: Error | undefined
  private control: SkillFilterControl | undefined
  private writes: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillPreferences')
    this.spec = resolveSkillPreferencesSpec(config)
  }

  /** Load the committed file, fail loudly when it is malformed, then start enforcing and watching it. */
  protected async [Service.init](): Promise<void> {
    this.current = await readState(this.spec.file)
    this.ctx.skills.registerFilter((control) => {
      this.control = control
      return {
        name: FILTER_NAME,
        resolve: async (options) => {
          if (this.loadError !== undefined) throw this.loadError
          const state = this.current
          const projectRoot = options.cwd === undefined ? undefined : await resolveSkillProjectRoot(this.ctx, options.cwd)
          return skill => decide(state, skill.name, projectRoot).enabled
        },
      }
    })
    if (this.spec.watch) {
      await ensureParent(this.spec.file)
      await this.watch()
    }
  }

  /**
   * Read the committed preferences.
   * @returns the current state; callers must not mutate it.
   */
  state(): SkillPreferencesState {
    return this.current
  }

  /**
   * Resolve the project root a cwd keys on, matching project skill discovery.
   * @param cwd - workspace directory.
   * @returns the absolute project root.
   */
  async projectRootOf(cwd: string): Promise<string> {
    return await resolveSkillProjectRoot(this.ctx, cwd)
  }

  /**
   * Explain one skill's enablement.
   * @param name - kebab-case skill name.
   * @param projectRoot - absolute project root; omitted reads the global level only.
   * @returns the enablement and the level that decided it.
   */
  decide(name: string, projectRoot?: string): SkillEnablementDecision {
    return decide(this.current, name, projectRoot)
  }

  /**
   * Enable or disable one skill globally or for one project. A project change
   * records an override only when it differs from the global preference and
   * removes a redundant one.
   * @param request - skill name, target enablement, and optional project root.
   * @returns the committed state.
   */
  async setEnabled(request: SetSkillEnabledRequest): Promise<SkillPreferencesState> {
    assertName(request.name)
    if (request.projectRoot !== undefined) assertProjectRoot(request.projectRoot)
    return await this.mutate(state => setEnabled(state, request))
  }

  /**
   * Remove one project override so the global preference applies.
   * @param request - skill name and project root.
   * @returns the committed state.
   */
  async clearOverride(request: ClearSkillOverrideRequest): Promise<SkillPreferencesState> {
    assertName(request.name)
    assertProjectRoot(request.projectRoot)
    return await this.mutate(state => withProject(state, request.projectRoot, overrides => ({
      enabled: overrides.enabled.filter(entry => entry !== request.name),
      disabled: overrides.disabled.filter(entry => entry !== request.name),
    })))
  }

  private async mutate(change: (state: SkillPreferencesState) => SkillPreferencesState): Promise<SkillPreferencesState> {
    const run = this.writes.then(async () => {
      await ensureParent(this.spec.file)
      return await withFileLock(this.spec.file, async () => {
        const next = normalizeState(change(await readState(this.spec.file)))
        await writeFileAtomic(this.spec.file, `${JSON.stringify({ version: FORMAT_VERSION, ...next }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
        this.commit(next)
        return next
      })
    })
    this.writes = run.catch(() => {})
    return await run
  }

  private commit(state: SkillPreferencesState): void {
    this.current = state
    this.loadError = undefined
    this.control?.invalidate()
    this.ctx.emit('skill-preferences/change')
  }

  /** Start watching and settle once the watcher has scanned the directory. */
  private async watch(): Promise<void> {
    const target = basename(this.spec.file)
    const watcher = chokidar.watch(dirname(this.spec.file), { depth: 0, ignoreInitial: true })
    const reload = (path: string): void => {
      if (basename(path) !== target) return
      readState(this.spec.file).then(
        (state) => {
          // The watcher also reports this service's own commits; only a real difference or a recovery republishes.
          if (this.loadError === undefined && JSON.stringify(state) === JSON.stringify(this.current)) return
          this.commit(state)
        },
        (error: unknown) => {
          // readState rejects only with filesystem errors or parseState's Error.
          this.loadError = error as Error
          this.ctx.logger.warn(`skill preferences rejected until fixed: ${this.loadError.message}`)
          this.control?.invalidate()
        },
      )
    }
    watcher.on('add', reload).on('change', reload).on('unlink', reload)
    /* v8 ignore next -- Chokidar reports only host watcher failures, which no portable fixture can force. */
    watcher.on('error', (error) => { this.ctx.logger.warn(`skill preferences watcher failed: ${String(error)}`) })
    this.ctx.effect(() => async () => { await watcher.close() }, 'skillPreferences.watch')
    await new Promise<void>((resolve) => { watcher.once('ready', () => { resolve() }) })
  }
}

function decide(state: SkillPreferencesState, name: string, projectRoot: string | undefined): SkillEnablementDecision {
  const overrides = projectRoot === undefined ? undefined : state.projects[projectRoot]
  if (overrides?.enabled.includes(name) === true) return { enabled: true, origin: 'project' }
  if (overrides?.disabled.includes(name) === true) return { enabled: false, origin: 'project' }
  if (state.global.disabled.includes(name)) return { enabled: false, origin: 'global' }
  return { enabled: true, origin: 'default' }
}

function setEnabled(state: SkillPreferencesState, request: SetSkillEnabledRequest): SkillPreferencesState {
  const { name, enabled, projectRoot } = request
  if (projectRoot === undefined) {
    const disabled = state.global.disabled.filter(entry => entry !== name)
    return { ...state, global: { disabled: enabled ? disabled : [...disabled, name] } }
  }
  const globallyEnabled = !state.global.disabled.includes(name)
  return withProject(state, projectRoot, (overrides) => {
    const enabledList = overrides.enabled.filter(entry => entry !== name)
    const disabledList = overrides.disabled.filter(entry => entry !== name)
    if (enabled === globallyEnabled) return { enabled: enabledList, disabled: disabledList }
    return enabled
      ? { enabled: [...enabledList, name], disabled: disabledList }
      : { enabled: enabledList, disabled: [...disabledList, name] }
  })
}

function withProject(
  state: SkillPreferencesState,
  projectRoot: string,
  change: (overrides: ProjectSkillOverrides) => ProjectSkillOverrides,
): SkillPreferencesState {
  const next = change(state.projects[projectRoot] ?? { enabled: [], disabled: [] })
  const others = Object.entries(state.projects).filter(([root]) => root !== projectRoot)
  const empty = next.enabled.length === 0 && next.disabled.length === 0
  return { ...state, projects: Object.fromEntries(empty ? others : [...others, [projectRoot, next]]) }
}

/** Sort and deduplicate every list so the file content is deterministic. */
function normalizeState(state: SkillPreferencesState): SkillPreferencesState {
  const projects: Record<string, ProjectSkillOverrides> = {}
  for (const [root, overrides] of Object.entries(state.projects).sort(([left], [right]) => (left < right ? -1 : 1))) {
    projects[root] = { enabled: sortedUnique(overrides.enabled), disabled: sortedUnique(overrides.disabled) }
  }
  return { global: { disabled: sortedUnique(state.global.disabled) }, projects }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

async function readState(file: string): Promise<SkillPreferencesState> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STATE
    throw error
  }
  return parseState(raw, file)
}

/**
 * Validate preferences file content.
 * @param raw - file text.
 * @param file - path named in errors.
 * @returns the validated state.
 */
export function parseState(raw: string, file: string): SkillPreferencesState {
  const fail = (detail: string): Error => new Error(`invalid skill preferences file ${file}: ${detail}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw fail((error as SyntaxError).message)
  }
  if (!isRecord(parsed)) throw fail('expected an object')
  if (parsed.version !== FORMAT_VERSION) throw fail(`unsupported version ${JSON.stringify(parsed.version)}`)
  if (!isRecord(parsed.global)) throw fail('"global" must be an object')
  const global = { disabled: nameList(parsed.global.disabled, 'global.disabled', fail) }
  if (!isRecord(parsed.projects)) throw fail('"projects" must be an object')
  const projects: Record<string, ProjectSkillOverrides> = {}
  for (const [root, value] of Object.entries(parsed.projects)) {
    if (!isAbsolute(root)) throw fail(`project root "${root}" must be absolute`)
    if (!isRecord(value)) throw fail(`projects["${root}"] must be an object`)
    projects[root] = {
      enabled: nameList(value.enabled, `projects["${root}"].enabled`, fail),
      disabled: nameList(value.disabled, `projects["${root}"].disabled`, fail),
    }
  }
  return normalizeState({ global, projects })
}

function nameList(value: unknown, field: string, fail: (detail: string) => Error): string[] {
  if (!Array.isArray(value)) throw fail(`"${field}" must be an array`)
  for (const entry of value) {
    if (typeof entry !== 'string' || !isSkillName(entry)) throw fail(`"${field}" contains invalid skill name ${JSON.stringify(entry)}`)
  }
  return value as string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertName(name: string): void {
  if (!isSkillName(name)) throw new Error(`invalid skill name "${name}"`)
}

function assertProjectRoot(projectRoot: string): void {
  if (!isAbsolute(projectRoot)) throw new Error(`project root "${projectRoot}" must be absolute`)
}

/** Create the preferences directory owner-only; the file lock and watcher require it. */
async function ensureParent(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
}

export default SkillPreferences
