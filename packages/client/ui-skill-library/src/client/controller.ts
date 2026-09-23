/**
 * Skill library state: one snapshot store fed by the `skillManager` Remote.
 * Toggles update the store optimistically and roll back when the Host refuses.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ManagedMarketplace,
  ManagedSource,
  MarketplaceEntry,
  SearchMarketplaceValue,
  SkillDraft,
  SkillManagerInventory,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Result envelope every generated Remote method resolves to. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Marketplaces the Host searches. */
export interface MarketplaceList {
  readonly marketplaces: readonly ManagedMarketplace[]
  /** Whether the Host mounts the marketplace service. */
  readonly available: boolean
}

/** One marketplace search request. */
export interface MarketplaceQuery {
  readonly query: string
  readonly marketplace?: string
  readonly offset?: number
  readonly limit?: number
}

/** Result carrying one source. */
export interface SourceResult {
  readonly source: ManagedSource
}

/** The Remote methods this page calls, injected so tests can supply fakes. */
export interface SkillManagerRemote {
  readonly inventory: (request: { projectRoot?: string }) => Promise<RemoteResult<SkillManagerInventory>>
  readonly setEnabled: (request: { name: string; enabled: boolean; projectRoot?: string }) => Promise<RemoteResult<void>>
  readonly clearOverride: (request: { name: string; projectRoot: string }) => Promise<RemoteResult<void>>
  readonly sources: () => Promise<RemoteResult<{ readonly sources: readonly ManagedSource[] }>>
  readonly addSource: (request: { url: string; ref?: string; path?: string }) => Promise<RemoteResult<{ readonly source: ManagedSource }>>
  readonly syncSource: (request: { id: string }) => Promise<RemoteResult<{ readonly source: ManagedSource }>>
  readonly setSourceEnabled: (request: { id: string; enabled: boolean }) => Promise<RemoteResult<{ readonly source: ManagedSource }>>
  readonly removeSource: (request: { id: string }) => Promise<RemoteResult<void>>
  readonly readSkill: (request: { name: string }) => Promise<RemoteResult<SkillDocument>>
  readonly createSkill: (request: SkillDraft) => Promise<RemoteResult<SkillDocument>>
  readonly updateSkill: (request: SkillDraft) => Promise<RemoteResult<SkillDocument>>
  readonly deleteSkill: (request: { name: string }) => Promise<RemoteResult<void>>
  readonly customizeSkill: (request: { name: string }) => Promise<RemoteResult<SkillDocument>>
  readonly uninstallSkill: (request: { name: string }) => Promise<RemoteResult<void>>
  readonly marketplaces: (request: { refresh?: boolean }) => Promise<RemoteResult<MarketplaceList>>
  readonly searchMarketplace: (request: MarketplaceQuery) => Promise<RemoteResult<SearchMarketplaceValue>>
  readonly installSkill: (request: { repository: string; dir?: string; name: string }) => Promise<RemoteResult<SourceResult>>
  readonly checkUpdates: () => Promise<RemoteResult<{ readonly sources: readonly ManagedSource[] }>>
}

/** Marketplace browsing state. */
export interface DiscoverState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly error?: string | undefined
  /** Whether the Host mounts the marketplace service. */
  readonly available: boolean
  readonly marketplaces: readonly ManagedMarketplace[]
  /** Query of the shown results. */
  readonly query: string
  /** Marketplace filter; undefined searches every enabled marketplace. */
  readonly marketplace?: string | undefined
  readonly searching: boolean
  readonly loadingMore: boolean
  readonly results: readonly MarketplaceEntry[]
  readonly totals: Readonly<Record<string, number>>
  readonly hasMore: boolean
  /** Next offset per marketplace. */
  readonly offset: number
  readonly errors: SearchMarketplaceValue['errors']
  /** Keys of entries whose install is in flight. */
  readonly installing: readonly string[]
}

/** One stored skill as `readSkill` returns it. */
export interface SkillDocument {
  readonly skill: SkillDraft
  readonly path: string
  /** Whether the page may edit or delete the skill. */
  readonly editable: boolean
}

/** The skill open in the inspector. */
export interface SkillInspection {
  readonly name: string
  readonly loading: boolean
  readonly document?: SkillDocument | undefined
  readonly error?: string | undefined
}

/** Skill editor state. */
export interface SkillEditor {
  readonly open: boolean
  /** `create` writes a new user skill; `edit` replaces an existing one whose name is fixed. */
  readonly mode: 'create' | 'edit'
  readonly draft: SkillDraft
  /** Reading the stored skill before editing. */
  readonly loading: boolean
  readonly busy: boolean
  readonly error?: string | undefined
}

const EMPTY_DRAFT: SkillDraft = { name: '', description: '', body: '', modelInvocable: true, userInvocable: true }
const CLOSED_EDITOR: SkillEditor = { open: false, mode: 'create', draft: EMPTY_DRAFT, loading: false, busy: false }

/** Draft of the add-source dialog. */
export interface AddSourceDraft {
  readonly open: boolean
  readonly url: string
  readonly ref: string
  readonly path: string
  readonly busy: boolean
  readonly error?: string | undefined
}

const INITIAL_DISCOVER: DiscoverState = {
  status: 'idle',
  available: true,
  marketplaces: [],
  query: '',
  searching: false,
  loadingMore: false,
  results: [],
  totals: {},
  hasMore: false,
  offset: 0,
  errors: [],
  installing: [],
}

/** Complete page state. */
export interface SkillsState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly error?: string | undefined
  /** Selected override scope; undefined is the all-projects level. */
  readonly projectRoot?: string | undefined
  readonly inventory?: SkillManagerInventory | undefined
  readonly sourcesStatus: 'idle' | 'loading' | 'ready' | 'error'
  readonly sourcesError?: string | undefined
  readonly sources: readonly ManagedSource[]
  /** Skill names whose write is in flight. */
  readonly pendingSkills: readonly string[]
  /** Source ids whose operation is in flight. */
  readonly pendingSources: readonly string[]
  /** Latest failed write, shown until dismissed or replaced. */
  readonly notice?: string | undefined
  readonly add: AddSourceDraft
  readonly editor: SkillEditor
  /** The selected skill; undefined shows the library without a selection. */
  readonly inspected?: SkillInspection | undefined
  readonly discover: DiscoverState
  /** An update check is in flight. */
  readonly checking: boolean
}

const CLOSED_DRAFT: AddSourceDraft = { open: false, url: '', ref: '', path: '', busy: false }

/** Initial state before the page first renders. */
export const INITIAL_STATE: SkillsState = {
  status: 'idle',
  sourcesStatus: 'idle',
  sources: [],
  pendingSkills: [],
  pendingSources: [],
  add: CLOSED_DRAFT,
  editor: CLOSED_EDITOR,
  discover: INITIAL_DISCOVER,
  checking: false,
}

/** Actions and hooks the section receives. */
export interface SkillsFace {
  hooks: { skills: SnapshotStore<SkillsState> }
  /** Load both views once the page first renders. */
  ensure: () => void
  /** Reload both views. */
  refresh: () => void
  /** Switch the override scope and reload the inventory. */
  selectProject: (projectRoot: string | undefined) => void
  /** Enable or disable one skill in the current scope. */
  toggleSkill: (name: string, enabled: boolean) => void
  /** Remove the current project's override for one skill. */
  resetSkill: (name: string) => void
  dismissNotice: () => void
  openAdd: () => void
  closeAdd: () => void
  editAdd: (patch: Partial<Pick<AddSourceDraft, 'url' | 'ref' | 'path'>>) => void
  submitAdd: () => void
  syncSource: (id: string) => void
  toggleSource: (id: string, enabled: boolean) => void
  removeSource: (id: string) => void
  /** Open the editor for a new skill. */
  openCreate: () => void
  /** Load a user skill into the editor. */
  openEdit: (name: string) => void
  closeEditor: () => void
  editDraft: (patch: Partial<SkillDraft>) => void
  /** Create or save the editor's skill. */
  saveEditor: () => void
  /** Delete a user skill's files. */
  deleteSkill: (name: string) => void
  /** Select a skill and load its stored instructions; undefined clears the selection. */
  inspect: (name: string | undefined) => void
  /** Copy a remote or bundled skill into the user skills directory and open the copy in the editor. */
  customizeSkill: (name: string) => void
  /** Remove a remote skill from its source. */
  uninstallSkill: (name: string) => void
  /** Load marketplaces and the first browse page once Discover first renders. */
  ensureDiscover: () => void
  /** Search with a new query. */
  search: (query: string) => void
  /** Restrict results to one marketplace; undefined searches every one. */
  selectMarketplace: (id: string | undefined) => void
  /** Append the next page of results. */
  loadMore: () => void
  /** Install one marketplace entry. */
  install: (entry: MarketplaceEntry) => void
  /** Ask upstream for newer commits of every GitHub source. */
  checkUpdates: () => void
  /** Sync every source with an update available. */
  updateAll: () => void
}

/** Owner of the Skills page snapshot and its Host round trips. */
export class SkillsController {
  /** Page snapshot the section renders through `useSkills`. */
  readonly store: SnapshotStore<SkillsState> = createSnapshotStore<SkillsState>(INITIAL_STATE)
  private inventoryRequest = 0
  private disposed = false

  /** @param remote - the `skillManager` Remote face. */
  constructor(private readonly remote: SkillManagerRemote) {}

  /** Stop applying late Host responses. */
  dispose(): void {
    this.disposed = true
  }

  /**
   * Bind the section's actions to this controller.
   * @returns the section face.
   */
  inject(): SkillsFace {
    return {
      hooks: { skills: this.store },
      ensure: () => {
        if (this.state().status !== 'idle') return
        void this.load().then(() => this.checkUpdates())
      },
      refresh: () => { void this.load() },
      selectProject: (projectRoot) => {
        this.patch({ projectRoot })
        void this.loadInventory()
      },
      toggleSkill: (name, enabled) => { void this.toggleSkill(name, enabled) },
      resetSkill: (name) => { void this.resetSkill(name) },
      dismissNotice: () => { this.patch({ notice: undefined }) },
      openAdd: () => { this.patch({ add: { ...CLOSED_DRAFT, open: true } }) },
      closeAdd: () => { if (!this.state().add.busy) this.patch({ add: CLOSED_DRAFT }) },
      editAdd: (patch) => { this.patch({ add: { ...this.state().add, ...patch, error: undefined } }) },
      submitAdd: () => { void this.submitAdd() },
      syncSource: (id) => { void this.sourceOperation(id, () => this.remote.syncSource({ id })) },
      toggleSource: (id, enabled) => {
        this.patchSource(id, { enabled })
        void this.sourceOperation(id, () => this.remote.setSourceEnabled({ id, enabled }))
      },
      removeSource: (id) => { void this.sourceOperation(id, () => this.remote.removeSource({ id })) },
      openCreate: () => { this.patch({ editor: { ...CLOSED_EDITOR, open: true } }) },
      openEdit: (name) => { void this.openEdit(name) },
      closeEditor: () => { if (!this.state().editor.busy) this.patch({ editor: CLOSED_EDITOR }) },
      editDraft: (patch) => {
        const editor = this.state().editor
        this.patch({ editor: { ...editor, draft: { ...editor.draft, ...patch }, error: undefined } })
      },
      saveEditor: () => { void this.saveEditor() },
      deleteSkill: (name) => { void this.deleteSkill(name) },
      inspect: (name) => { void this.inspect(name) },
      customizeSkill: (name) => { void this.customizeSkill(name) },
      uninstallSkill: (name) => { void this.uninstallSkill(name) },
      ensureDiscover: () => { if (this.state().discover.status === 'idle') void this.loadDiscover() },
      search: (query) => {
        this.patchDiscover({ query })
        void this.runSearch(false)
      },
      selectMarketplace: (marketplace) => {
        this.patchDiscover({ marketplace })
        void this.runSearch(false)
      },
      loadMore: () => { if (this.state().discover.hasMore && !this.state().discover.loadingMore) void this.runSearch(true) },
      install: (entry) => { void this.install(entry) },
      checkUpdates: () => { void this.checkUpdates() },
      updateAll: () => {
        for (const source of this.state().sources) {
          if (source.updateAvailable) void this.sourceOperation(source.id, () => this.remote.syncSource({ id: source.id }))
        }
      },
    }
  }

  /** Reload both views; called by the page and by Host change events once the page has rendered. */
  async load(): Promise<void> {
    await Promise.all([this.loadInventory(), this.loadSources()])
  }

  /**
   * Read the page snapshot.
   * @returns the current snapshot.
   */
  state(): SkillsState {
    return this.store.getSnapshot()
  }

  private async loadInventory(): Promise<void> {
    const request = ++this.inventoryRequest
    const { projectRoot, inventory } = this.state()
    if (inventory === undefined) this.patch({ status: 'loading' })
    const result = await this.remote.inventory(projectRoot === undefined ? {} : { projectRoot })
    if (this.disposed || request !== this.inventoryRequest) return
    if (result.ok) {
      const known = projectRoot === undefined || result.value.projects.some(project => project.root === projectRoot)
      this.patch({ status: 'ready', inventory: result.value, error: undefined, ...known ? {} : { projectRoot: undefined } })
    } else if (inventory === undefined) {
      this.patch({ status: 'error', error: result.error.message })
    } else {
      this.patch({ notice: result.error.message })
    }
  }

  private async loadSources(): Promise<void> {
    if (this.state().sourcesStatus === 'idle') this.patch({ sourcesStatus: 'loading' })
    const result = await this.remote.sources()
    if (this.disposed) return
    if (result.ok) this.patch({ sourcesStatus: 'ready', sources: result.value.sources, sourcesError: undefined })
    else this.patch({ sourcesStatus: 'error', sourcesError: result.error.message })
  }

  private async toggleSkill(name: string, enabled: boolean): Promise<void> {
    const { projectRoot } = this.state()
    const previous = this.skill(name)
    this.patchSkill(name, { enabled, preference: projectRoot === undefined ? 'global' : 'project' })
    this.patch({ pendingSkills: [...this.state().pendingSkills, name] })
    const result = await this.remote.setEnabled(projectRoot === undefined ? { name, enabled } : { name, enabled, projectRoot })
    await this.settleSkill(name, result, previous)
  }

  private async resetSkill(name: string): Promise<void> {
    const { projectRoot } = this.state()
    if (projectRoot === undefined) return
    this.patch({ pendingSkills: [...this.state().pendingSkills, name] })
    const result = await this.remote.clearOverride({ name, projectRoot })
    await this.settleSkill(name, result, undefined)
  }

  private async settleSkill(name: string, result: RemoteResult<void>, previous: ReturnType<SkillsController['skill']>): Promise<void> {
    if (this.disposed) return
    this.patch({ pendingSkills: this.state().pendingSkills.filter(entry => entry !== name) })
    if (!result.ok) {
      if (previous !== undefined) this.patchSkill(name, { enabled: previous.enabled, preference: previous.preference })
      this.patch({ notice: result.error.message })
      return
    }
    await this.loadInventory()
  }

  private async submitAdd(): Promise<void> {
    const draft = this.state().add
    const url = draft.url.trim()
    if (url.length === 0 || draft.busy) return
    this.patch({ add: { ...draft, busy: true, error: undefined } })
    const ref = draft.ref.trim()
    const path = draft.path.trim()
    const result = await this.remote.addSource({ url, ...ref === '' ? {} : { ref }, ...path === '' ? {} : { path } })
    if (this.disposed) return
    if (!result.ok) {
      this.patch({ add: { ...this.state().add, busy: false, error: result.error.message } })
      return
    }
    this.patch({ add: CLOSED_DRAFT, sources: [...this.state().sources, result.value.source] })
    await this.loadSources()
  }

  private async openEdit(name: string): Promise<void> {
    this.patch({ editor: { ...CLOSED_EDITOR, open: true, mode: 'edit', loading: true, draft: { ...EMPTY_DRAFT, name } } })
    const result = await this.remote.readSkill({ name })
    if (this.disposed || this.state().editor.draft.name !== name) return
    if (result.ok) this.patch({ editor: { ...this.state().editor, loading: false, draft: result.value.skill } })
    else this.patch({ editor: { ...this.state().editor, loading: false, error: result.error.message } })
  }

  private async saveEditor(): Promise<void> {
    const editor = this.state().editor
    if (editor.busy || editor.loading) return
    const whenToUse = editor.draft.whenToUse?.trim()
    const { whenToUse: _whenToUse, ...rest } = editor.draft
    const draft: SkillDraft = {
      ...rest,
      name: editor.draft.name.trim(),
      description: editor.draft.description.trim(),
      ...whenToUse === undefined || whenToUse === '' ? {} : { whenToUse },
    }
    this.patch({ editor: { ...editor, busy: true, error: undefined } })
    const result = editor.mode === 'create' ? await this.remote.createSkill(draft) : await this.remote.updateSkill(draft)
    if (this.disposed) return
    if (!result.ok) {
      this.patch({ editor: { ...this.state().editor, busy: false, error: result.error.message } })
      return
    }
    this.patch({ editor: CLOSED_EDITOR })
    await this.loadInventory()
    await this.inspect(draft.name)
  }

  private async deleteSkill(name: string): Promise<void> {
    this.patch({ pendingSkills: [...this.state().pendingSkills, name] })
    const result = await this.remote.deleteSkill({ name })
    if (this.disposed) return
    this.patch({ pendingSkills: this.state().pendingSkills.filter(entry => entry !== name) })
    if (!result.ok) this.patch({ notice: result.error.message })
    else if (this.state().inspected?.name === name) this.patch({ inspected: undefined })
    await this.loadInventory()
  }

  private async inspect(name: string | undefined): Promise<void> {
    if (name === undefined) {
      this.patch({ inspected: undefined })
      return
    }
    this.patch({ inspected: { name, loading: true } })
    const result = await this.remote.readSkill({ name })
    if (this.disposed || this.state().inspected?.name !== name) return
    this.patch({ inspected: result.ok ? { name, loading: false, document: result.value }
      : { name, loading: false, error: result.error.message } })
  }

  private async customizeSkill(name: string): Promise<void> {
    this.patch({ pendingSkills: [...this.state().pendingSkills, name] })
    const result = await this.remote.customizeSkill({ name })
    if (this.disposed) return
    this.patch({ pendingSkills: this.state().pendingSkills.filter(entry => entry !== name) })
    if (!result.ok) {
      this.patch({ notice: result.error.message })
      return
    }
    await this.loadInventory()
    this.patch({ editor: { ...CLOSED_EDITOR, open: true, mode: 'edit', draft: result.value.skill } })
  }

  private async uninstallSkill(name: string): Promise<void> {
    this.patch({ pendingSkills: [...this.state().pendingSkills, name] })
    const result = await this.remote.uninstallSkill({ name })
    if (this.disposed) return
    this.patch({ pendingSkills: this.state().pendingSkills.filter(entry => entry !== name) })
    if (!result.ok) this.patch({ notice: result.error.message })
    else if (this.state().inspected?.name === name) this.patch({ inspected: undefined })
    await this.load()
  }

  private async loadDiscover(): Promise<void> {
    this.patchDiscover({ status: 'loading' })
    const result = await this.remote.marketplaces({ refresh: true })
    if (this.disposed) return
    if (!result.ok) {
      this.patchDiscover({ status: 'error', error: result.error.message })
      return
    }
    this.patchDiscover({ status: 'ready', error: undefined, marketplaces: result.value.marketplaces, available: result.value.available })
    if (result.value.available) await this.runSearch(false)
  }

  private searchRequest = 0

  private async runSearch(more: boolean): Promise<void> {
    const request = ++this.searchRequest
    const { query, marketplace, offset, results } = this.state().discover
    const from = more ? offset : 0
    this.patchDiscover(more ? { loadingMore: true } : { searching: true })
    const scope = marketplace === undefined ? {} : { marketplace }
    const result = await this.remote.searchMarketplace({ query: query.trim(), ...scope, offset: from })
    if (this.disposed || request !== this.searchRequest) return
    if (!result.ok) {
      this.patchDiscover({ searching: false, loadingMore: false, errors: [{ marketplace: marketplace ?? '', message: result.error.message }] })
      return
    }
    const known = new Set(more ? results.map(entry => entry.key) : [])
    const page = result.value.skills.filter(entry => !known.has(entry.key))
    this.patchDiscover({
      searching: false,
      loadingMore: false,
      results: more ? [...results, ...page] : page,
      totals: result.value.totals,
      hasMore: result.value.hasMore,
      offset: result.value.nextOffset,
      errors: result.value.errors,
    })
  }

  private async install(entry: MarketplaceEntry): Promise<void> {
    if (this.state().discover.installing.includes(entry.key)) return
    this.patchDiscover({ installing: [...this.state().discover.installing, entry.key] })
    this.patchEntry(entry.key, 'installing')
    const location = entry.dir === undefined ? {} : { dir: entry.dir }
    const result = await this.remote.installSkill({ repository: entry.repository, name: entry.name, ...location })
    if (this.disposed) return
    this.patchDiscover({ installing: this.state().discover.installing.filter(key => key !== entry.key) })
    if (!result.ok) {
      this.patchEntry(entry.key, 'available')
      this.patch({ notice: result.error.message })
      return
    }
    const synced = result.value.source.syncState === 'ok'
    this.patchEntry(entry.key, synced ? 'installed' : 'installing')
    await this.load()
  }

  private async checkUpdates(): Promise<void> {
    if (this.state().checking) return
    this.patch({ checking: true })
    const result = await this.remote.checkUpdates()
    if (this.disposed) return
    this.patch({ checking: false, ...result.ok ? { sources: result.value.sources } : { notice: result.error.message } })
  }

  private patchEntry(key: string, state: MarketplaceEntry['state']): void {
    this.patchDiscover({ results: this.state().discover.results.map(entry => entry.key === key ? { ...entry, state } : entry) })
  }

  private patchDiscover(patch: Partial<DiscoverState>): void {
    this.patch({ discover: { ...this.state().discover, ...patch } })
  }

  private async sourceOperation(id: string, operation: () => Promise<RemoteResult<unknown>>): Promise<void> {
    this.patch({ pendingSources: [...this.state().pendingSources, id] })
    const result = await operation()
    if (this.disposed) return
    this.patch({ pendingSources: this.state().pendingSources.filter(entry => entry !== id) })
    if (!result.ok) this.patch({ notice: result.error.message })
    await this.load()
  }

  private skill(name: string): SkillManagerInventory['skills'][number] | undefined {
    return this.state().inventory?.skills.find(skill => skill.name === name)
  }

  private patchSkill(name: string, patch: { enabled: boolean; preference: SkillManagerInventory['skills'][number]['preference'] }): void {
    const inventory = this.state().inventory
    if (inventory === undefined) return
    this.patch({ inventory: { ...inventory, skills: inventory.skills.map(skill => skill.name === name ? { ...skill, ...patch } : skill) } })
  }

  private patchSource(id: string, patch: { enabled: boolean }): void {
    this.patch({ sources: this.state().sources.map(source => source.id === id ? { ...source, ...patch } : source) })
  }

  private patch(patch: Partial<SkillsState>): void {
    this.store.set({ ...this.state(), ...patch })
  }
}
