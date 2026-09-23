/**
 * Host owner of the `skillManager` Remote namespace: the management view of
 * every installed skill, per-skill enablement, and remote skill sources for
 * the Settings GUI.
 * @module @deepseek-ai/dsh-host-skill-manager
 */

import { cp, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SkillInventoryEntry } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill-preferences'
import type {} from '@deepseek-ai/dsh-skill-marketplace'
import { resolveSourceSpec, suggestSourceId, type SkillSourceView } from '@deepseek-ai/dsh-skill-sources'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-workspace'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { readSkillFile, UserSkillRoot } from './authoring.ts'
import type {
  AddSkillSourceRequest,
  ClearSkillOverrideRequest,
  InstallSkillRequest,
  ManagedProject,
  ManagedSkill,
  ManagedSource,
  SetSkillEnabledRequest,
  MarketplaceEntry,
  SearchMarketplaceRequest,
  SearchMarketplaceValue,
  SetSkillSourceEnabledRequest,
  SetSkillSourceSkillsRequest,
  SkillMarketplacesRequest,
  SkillMarketplacesValue,
  SkillSourceSkillsValue,
  SkillDocumentValue,
  SkillDraft,
  SkillInventoryRequest,
  SkillNameRequest,
  SkillInventoryValue,
  SkillSourceRequest,
  SkillSourcesValue,
  SkillSourceValue,
} from './types.ts'

export type * from './types.ts'

/** Filesystem sources whose files belong to the user, so the page edits them in place. */
const LOCAL_SOURCES: ReadonlySet<string> = new Set(['user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'custom'])
export { readSkillFile, renderSkillFile, UserSkillRoot } from './authoring.ts'

/** Skill manager configuration. */
export interface Config {
  /**
   * DSH home whose `skills` directory holds user skills; omitted resolves
   * `$DSH_HOME`, then `~/.dsh`. Match `dsh-skill-filesystem`'s `dshHome`.
   */
  readonly dshHome?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `skillManager` Remote namespace. */
    skillManager: SkillManager
  }
}

/**
 * Remote service behind the Skills settings page. Reads go through
 * `ctx.skills.inventory()` in the default agent preset's scope, so the page
 * lists the skills a new session sees; writes delegate to
 * `ctx.skillPreferences` and `ctx.skillSources`, which own validation and
 * persistence. Any catalog, preference, or source change is forwarded as
 * `skill-manager/changed`.
 */
export class SkillManager extends TypertRemoteService {
  static inject = ['skills', 'typert']
  static Config: Schema<Config> = z.object({ dshHome: z.string() })

  private readonly userRoot: UserSkillRoot

  /**
   * @param ctx - Host context carrying the skill registry and optional preference, source, workspace, and preset services.
   * @param config - DSH home that locates the user skills directory.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillManager')
    this.userRoot = new UserSkillRoot(join(resolveDshHome(config.dshHome), 'skills'))
    const changed = (): void => { ctx.emit('skill-manager/changed') }
    ctx.on('skills/change', changed)
    ctx.on('skill-preferences/change', changed)
    ctx.on('skill-sources/change', changed)
  }

  /**
   * Read every installed skill with its enablement for one view.
   * @param request - optional project root selecting per-project overrides and project skills.
   * @returns sorted skills, workspace projects, and which management services are mounted.
   * @throws RemoteError when the project root is not absolute.
   */
  @Remote
  async inventory(request: SkillInventoryRequest): Promise<SkillInventoryValue> {
    const projectRoot = request.projectRoot
    if (projectRoot !== undefined) assertAbsolute(projectRoot)
    const preferences = this.ctx.get('skillPreferences')
    await using lease = await this.defaultScope()
    const snapshot = await this.ctx.skills.inventory({ cwd: projectRoot, scope: lease?.key })
    const skills: ManagedSkill[] = []
    for (const skill of snapshot.skills) {
      const origin = preferences?.decide(skill.name, projectRoot).origin ?? 'default'
      skills.push(managedSkill(skill, origin, await this.userRoot.owns(skill.name, skill.path)))
    }
    return {
      skills,
      complete: snapshot.complete,
      projects: await this.projects(),
      preferencesAvailable: preferences !== undefined,
      sourcesAvailable: this.ctx.get('skillSources') !== undefined,
    }
  }

  /**
   * Enable or disable one skill globally or for one project.
   * @param request - skill name, target enablement, and optional project root.
   * @throws RemoteError when skill preferences are not mounted or the request is invalid.
   */
  @Remote
  async setEnabled(request: SetSkillEnabledRequest): Promise<void> {
    const preferences = this.requirePreferences()
    await invalidOnError(() => preferences.setEnabled(request))
  }

  /**
   * Remove one project override so the global preference applies.
   * @param request - skill name and project root.
   * @throws RemoteError when skill preferences are not mounted or the request is invalid.
   */
  @Remote
  async clearOverride(request: ClearSkillOverrideRequest): Promise<void> {
    const preferences = this.requirePreferences()
    await invalidOnError(() => preferences.clearOverride(request))
  }

  /**
   * List remote skill sources with their sync status.
   * @returns every source; empty when remote sources are not mounted.
   */
  @Remote
  sources(): Promise<SkillSourcesValue> {
    return Promise.resolve({ sources: this.ctx.get('skillSources')?.list().map(managedSource) ?? [] })
  }

  /**
   * Add a remote source and start its first sync.
   * @param request - URL with optional ref and subdirectory.
   * @returns the added source.
   * @throws RemoteError when sources are not mounted or the URL is unsupported.
   */
  @Remote
  async addSource(request: AddSkillSourceRequest): Promise<SkillSourceValue> {
    const sources = this.requireSources()
    return { source: managedSource(await invalidOnError(() => sources.add(request))) }
  }

  /**
   * Download one source again.
   * @param request - source id.
   * @returns the source after the sync settles; failures appear in `error`.
   * @throws RemoteError when sources are not mounted or the id is unknown.
   */
  @Remote
  async syncSource(request: SkillSourceRequest): Promise<SkillSourceValue> {
    const sources = this.requireSources()
    return { source: managedSource(await invalidOnError(() => sources.sync(request.id))) }
  }

  /**
   * Enable or disable one source's skills.
   * @param request - source id and target enablement.
   * @returns the updated source.
   * @throws RemoteError when sources are not mounted or the id is unknown.
   */
  @Remote
  async setSourceEnabled(request: SetSkillSourceEnabledRequest): Promise<SkillSourceValue> {
    const sources = this.requireSources()
    return { source: managedSource(await invalidOnError(() => sources.setEnabled(request.id, request.enabled))) }
  }

  /**
   * Remove one source; a default source stays hidden afterwards.
   * @param request - source id.
   * @throws RemoteError when sources are not mounted or the id is unknown.
   */
  @Remote
  async removeSource(request: SkillSourceRequest): Promise<void> {
    const sources = this.requireSources()
    await invalidOnError(() => sources.remove(request.id))
  }

  /**
   * Read any installed skill's stored fields, for preview or, when editable, for editing.
   * @param request - skill name.
   * @returns the stored fields, file path, and whether the page may change the skill.
   * @throws RemoteError when the skill has no readable file.
   */
  @Remote
  async readSkill(request: SkillNameRequest): Promise<SkillDocumentValue> {
    await using lease = await this.defaultScope()
    const skill = (await this.ctx.skills.inventory({ scope: lease?.key })).skills.find(entry => entry.name === request.name)
    if (skill?.path === undefined) {
      throw new RemoteError('skill-manager/read-only', `"${request.name}" has no readable skill file`, { name: request.name })
    }
    const path = skill.path
    const draft = await invalidOnError(async () => readSkillFile(await readFile(path, 'utf8')).draft)
    return { skill: draft, path, editable: isLocal(skill) }
  }

  /**
   * Create a skill in the user skills directory.
   * @param request - the new skill's fields.
   * @returns the stored fields and file path.
   * @throws RemoteError when the name is taken by any installed skill or the fields are invalid.
   */
  @Remote
  async createSkill(request: SkillDraft): Promise<SkillDocumentValue> {
    await using lease = await this.defaultScope()
    const taken = (await this.ctx.skills.inventory({ scope: lease?.key })).skills.find(skill => skill.name === request.name)
    if (taken !== undefined) {
      const reason = `a skill named "${request.name}" already exists (${taken.source})`
      throw new RemoteError('skill-manager/invalid-request', reason, { reason })
    }
    const path = await invalidOnError(() => this.userRoot.create(request))
    this.ctx.emit('skill-filesystem/changed', path)
    return { skill: request, path, editable: true }
  }

  /**
   * Replace a local skill's fields in place, keeping other frontmatter keys.
   * @param request - the skill's new fields; the name selects the skill.
   * @returns the stored fields and file path.
   * @throws RemoteError when the winning skill is not a local file or the fields are invalid.
   */
  @Remote
  async updateSkill(request: SkillDraft): Promise<SkillDocumentValue> {
    const skill = await this.winner(request.name)
    if (skill?.path === undefined || !isLocal(skill)) {
      throw new RemoteError('skill-manager/read-only', `"${request.name}" is not a local skill file; customize it first`, { name: request.name })
    }
    const path = skill.path
    await invalidOnError(() => this.userRoot.update(path, request))
    this.ctx.emit('skill-filesystem/changed', path)
    return { skill: request, path, editable: true }
  }

  /**
   * Delete a user skill's files. Deleting a customized copy restores the original.
   * @param request - skill name.
   * @throws RemoteError when the skill is not a user skill.
   */
  @Remote
  async deleteSkill(request: SkillNameRequest): Promise<void> {
    const path = await this.ownedPath(request.name)
    await this.userRoot.remove(request.name, path)
    this.ctx.emit('skill-filesystem/changed', path)
  }

  /**
   * Copy a remote or bundled skill's directory into the user skills directory,
   * where the copy outranks the original, so it can be edited. Deleting the
   * copy restores the original.
   * @param request - skill name.
   * @returns the copy's stored fields and path.
   * @throws RemoteError when the skill is local already, has no file, or a user skill of that name exists.
   */
  @Remote
  async customizeSkill(request: SkillNameRequest): Promise<SkillDocumentValue> {
    const skill = await this.winner(request.name)
    if (skill?.path === undefined || isLocal(skill)) {
      throw new RemoteError('skill-manager/read-only', `"${request.name}" cannot be customized; only remote and bundled skills with files can`, { name: request.name })
    }
    const source = skill.path
    const target = this.userRoot.bundlePath(request.name)
    await invalidOnError(async () => {
      if (await exists(dirname(target))) throw new Error(`a skill named "${request.name}" already exists in ${this.userRoot.root}`)
      if (basename(source) === 'SKILL.md') {
        await cp(dirname(source), dirname(target), { recursive: true, errorOnExist: true, force: false, filter: from => !basename(from).startsWith('.') || from === dirname(source) })
      } else {
        await cp(source, target, { errorOnExist: true, force: false })
      }
    })
    this.ctx.emit('skill-filesystem/changed', target)
    const draft = await invalidOnError(async () => readSkillFile(await readFile(target, 'utf8')).draft)
    return { skill: draft, path: target, editable: true }
  }

  /**
   * List the marketplaces the Host searches.
   * @param request - `refresh` asks browsable marketplaces for their skill counts first.
   * @returns marketplaces in configuration order.
   */
  @Remote
  async marketplaces(request: SkillMarketplacesRequest): Promise<SkillMarketplacesValue> {
    const marketplace = this.ctx.get('skillMarketplace')
    if (marketplace === undefined) return { marketplaces: [], available: false }
    const views = request.refresh === true ? await marketplace.refreshCounts() : marketplace.list()
    return { marketplaces: views, available: true }
  }

  /**
   * Search public marketplaces and mark entries that are installed already.
   * @param request - query, optional marketplace, offset, and page size.
   * @returns entries with install state, totals, and per-marketplace failures.
   * @throws RemoteError when the marketplace service is not mounted or the marketplace id is unknown.
   */
  @Remote
  async searchMarketplace(request: SearchMarketplaceRequest): Promise<SearchMarketplaceValue> {
    const marketplace = this.ctx.get('skillMarketplace')
    if (marketplace === undefined) throw unavailable('skillMarketplace')
    const result = await invalidOnError(() => marketplace.search(request))
    const sources = this.ctx.get('skillSources')?.list() ?? []
    await using lease = await this.defaultScope()
    const installed = (await this.ctx.skills.inventory({ scope: lease?.key })).skills
    const skills = result.skills.map((entry): MarketplaceEntry => {
      const selector = selectorOf(entry)
      const source = sources.find(candidate => sameRepository(candidate, entry.repository)
        && (candidate.skills === undefined || candidate.skills.includes(selector) || candidate.skills.includes(entry.name)))
      const state = source === undefined ? 'available' : source.sync.state === 'syncing' || source.sync.state === 'never' ? 'installing' : 'installed'
      const other = installed.find(skill => skill.name === entry.name && (source === undefined || skill.source !== `remote:${source.id}`))
      return { ...entry, state, ...other === undefined ? {} : { conflict: other.source } }
    })
    return { skills, totals: result.totals, hasMore: result.hasMore, nextOffset: result.nextOffset, errors: result.errors }
  }

  /**
   * Install one marketplace skill: add it to the selection of the source that
   * already tracks its repository, or add a source for the repository that
   * installs only this skill, then wait for the sync. A disabled source that
   * installed every skill is narrowed to this skill before it is re-enabled.
   * @param request - repository, optional directory, and name.
   * @returns the source that installs the skill.
   * @throws RemoteError when sources are not mounted, the repository is invalid,
   *   or the synced repository contains no skill matching the request.
   */
  @Remote
  async installSkill(request: InstallSkillRequest): Promise<SkillSourceValue> {
    const sources = this.requireSources()
    const selector = selectorOf(request)
    const existing = sources.list().find(candidate => sameRepository(candidate, request.repository))
    const view = await invalidOnError(async () => {
      if (existing === undefined) {
        const url = `https://github.com/${request.repository}`
        const base = suggestSourceId(resolveSourceSpec({ url }))
        const ids = new Set(sources.list().map(candidate => candidate.id))
        let id = base
        for (let suffix = 2; ids.has(id); suffix += 1) id = `${base}-${suffix}`
        const added = await sources.add({ url, skills: [selector], id })
        return sources.sync(added.id)
      }
      let current = existing
      if (current.skills === undefined && !current.enabled) current = await sources.setSkills(current.id, [selector])
      else if (current.skills !== undefined && !current.skills.includes(selector)) {
        current = await sources.setSkills(current.id, [...current.skills, selector])
      }
      if (!current.enabled) current = await sources.setEnabled(current.id, true)
      if (current.sync.state !== 'ok') current = await sources.sync(current.id)
      return current
    })
    const found = sources.offers(view.id).some(offer => offer.installed && (offer.name === request.name || offer.dir.split('/').at(-1) === selector))
    if (view.sync.state === 'ok' && !found) {
      // Undo the selection change so a missing skill leaves the source as it was.
      if (existing === undefined) await sources.remove(view.id)
      else {
        await sources.setSkills(existing.id, existing.skills)
        if (!existing.enabled) await sources.setEnabled(existing.id, false)
      }
      const reason = `${request.repository} has no skill "${request.name}" within the discovery depth of its source`
      throw new RemoteError('skill-manager/invalid-request', reason, { reason })
    }
    return { source: managedSource(view) }
  }

  /**
   * Uninstall one remote skill by removing it from its source's selection; a
   * user source left with no skills is removed.
   * @param request - skill name.
   * @throws RemoteError when the winning skill is not a remote skill.
   */
  @Remote
  async uninstallSkill(request: SkillNameRequest): Promise<void> {
    const sources = this.requireSources()
    const skill = await this.winner(request.name)
    if (skill === undefined || !skill.source.startsWith('remote:')) {
      throw new RemoteError('skill-manager/read-only', `"${request.name}" is not a remote skill`, { name: request.name })
    }
    const id = skill.source.slice('remote:'.length)
    await invalidOnError(async () => {
      const offers = sources.offers(id)
      const leaf = (dir: string): string => dir.split('/').at(-1) as string
      const removed = offers.filter(offer => offer.name === request.name)
      const remaining = offers.filter(offer => offer.installed && !removed.includes(offer)).map(offer => leaf(offer.dir) || offer.name)
      const source = sources.list().find(candidate => candidate.id === id)
      if (remaining.length === 0 && source?.origin === 'user') await sources.remove(id)
      else await sources.setSkills(id, remaining)
    })
  }

  /**
   * List the skills one source offers and which are installed.
   * @param request - source id.
   * @returns offers in discovery order.
   * @throws RemoteError when sources are not mounted or the id is unknown.
   */
  @Remote
  async sourceSkills(request: SkillSourceRequest): Promise<SkillSourceSkillsValue> {
    const sources = this.requireSources()
    return { skills: await invalidOnError(() => Promise.resolve(sources.offers(request.id))) }
  }

  /**
   * Replace which of a source's skills are installed.
   * @param request - source id and selection; omitted installs every skill.
   * @returns the updated source.
   * @throws RemoteError when sources are not mounted or the id is unknown.
   */
  @Remote
  async setSourceSkills(request: SetSkillSourceSkillsRequest): Promise<SkillSourceValue> {
    const sources = this.requireSources()
    return { source: managedSource(await invalidOnError(() => sources.setSkills(request.id, request.skills))) }
  }

  /**
   * Ask upstream whether each GitHub source has a newer commit.
   * @returns every source with refreshed update flags.
   */
  @Remote
  async checkUpdates(): Promise<SkillSourcesValue> {
    const sources = this.ctx.get('skillSources')
    if (sources === undefined) return { sources: [] }
    await Promise.all(sources.list().filter(source => source.enabled && source.kind === 'github').map(source => sources.checkUpdate(source.id)))
    return { sources: sources.list().map(managedSource) }
  }

  /** The catalog entry that wins a name in the default scope. */
  private async winner(name: string): Promise<SkillInventoryEntry | undefined> {
    await using lease = await this.defaultScope()
    return (await this.ctx.skills.inventory({ scope: lease?.key })).skills.find(entry => entry.name === name)
  }

  /** Locate a user skill the page may change, by its winning catalog entry. */
  private async ownedPath(name: string): Promise<string> {
    await using lease = await this.defaultScope()
    const skill = (await this.ctx.skills.inventory({ scope: lease?.key })).skills.find(entry => entry.name === name)
    if (skill?.path === undefined || !await this.userRoot.owns(name, skill.path)) {
      throw new RemoteError('skill-manager/read-only', `"${name}" is not a skill in ${this.userRoot.root}`, { name })
    }
    return skill.path
  }

  private requirePreferences(): NonNullable<Context['skillPreferences']> {
    const preferences = this.ctx.get('skillPreferences')
    if (preferences === undefined) throw unavailable('skillPreferences')
    return preferences
  }

  private requireSources(): NonNullable<Context['skillSources']> {
    const sources = this.ctx.get('skillSources')
    if (sources === undefined) throw unavailable('skillSources')
    return sources
  }

  /** Lease the default agent preset's standing scope, when a preset roster is composed. */
  private async defaultScope(): Promise<({ key: ScopeKey } & AsyncDisposable) | undefined> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.acquireScope(undefined)
    } catch (error) {
      // A roster without a usable default preset still has a global catalog to show.
      this.ctx.logger.warn(`skill manager falls back to the global skill layer: ${String(error)}`)
      return undefined
    }
  }

  /** Workspace projects keyed by the root per-project preferences use, deduplicated. */
  private async projects(): Promise<ManagedProject[]> {
    const workspaces = this.ctx.get('workspaceRegistry')?.list() ?? []
    const preferences = this.ctx.get('skillPreferences')
    const projects = new Map<string, ManagedProject>()
    for (const workspace of workspaces) {
      const root = preferences === undefined ? workspace.path : await preferences.projectRootOf(workspace.path)
      if (!projects.has(root)) projects.set(root, { root, title: workspace.title })
    }
    return [...projects.values()]
  }
}

function managedSkill(skill: SkillInventoryEntry, preference: ManagedSkill['preference'], owned: boolean): ManagedSkill {
  const local = isLocal(skill)
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    source: skill.source,
    provider: skill.provider,
    ...skill.path === undefined ? {} : { path: skill.path },
    modelInvocable: skill.invocation.modelInvocable,
    userInvocable: skill.invocation.userInvocable,
    enabled: skill.enabled,
    preference,
    editable: local,
    deletable: owned,
    customizable: !local && skill.path !== undefined,
    uninstallable: skill.source.startsWith('remote:'),
  }
}

function managedSource(source: SkillSourceView): ManagedSource {
  return {
    id: source.id,
    url: source.url,
    ...source.ref === undefined ? {} : { ref: source.ref },
    ...source.path === undefined ? {} : { path: source.path },
    ...source.skills === undefined ? {} : { skills: source.skills },
    enabled: source.enabled,
    origin: source.origin,
    kind: source.kind,
    syncState: source.sync.state,
    ...source.sync.commit === undefined ? {} : { commit: source.sync.commit },
    ...source.sync.syncedAt === undefined ? {} : { syncedAt: source.sync.syncedAt },
    ...source.sync.error === undefined ? {} : { error: source.sync.error },
    skillCount: source.sync.skillCount,
    availableCount: source.sync.availableCount,
    updateAvailable: source.sync.updateAvailable,
    ...source.sync.latest === undefined ? {} : { latest: source.sync.latest },
    ...source.sync.checkedAt === undefined ? {} : { checkedAt: source.sync.checkedAt },
  }
}

function isLocal(skill: Pick<SkillInventoryEntry, 'source' | 'path'>): boolean {
  return skill.path !== undefined && LOCAL_SOURCES.has(skill.source)
}

/** The selection entry that installs a marketplace skill: its directory's last segment, else its name. */
function selectorOf(entry: { readonly dir?: string | undefined; readonly name: string }): string {
  const leaf = entry.dir?.split('/').filter(segment => segment.length > 0).at(-1)
  return leaf ?? entry.name
}

/** Whether a source installs from the whole default branch of one GitHub repository. */
function sameRepository(source: SkillSourceView, repository: string): boolean {
  if (source.kind !== 'github' || source.path !== undefined || source.ref !== undefined) return false
  const spec = resolveSourceSpec(source)
  return spec.kind === 'github' && `${spec.owner}/${spec.repo}`.toLowerCase() === repository.toLowerCase()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function unavailable(service: string): RemoteError {
  return new RemoteError('skill-manager/unavailable', `the Host composition does not mount ${service}`, { service })
}

function assertAbsolute(projectRoot: string): void {
  if (!projectRoot.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(projectRoot)) {
    throw new RemoteError('skill-manager/invalid-request', `project root "${projectRoot}" must be absolute`, { reason: 'project root must be absolute' })
  }
}

/** Report service validation failures as client errors instead of internal failures. */
async function invalidOnError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = (error as Error).message
    throw new RemoteError('skill-manager/invalid-request', message, { reason: message })
  }
}

export default SkillManager
