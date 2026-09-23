/**
 * MCP page state: one snapshot store fed by the `mcpManager` Remote.
 * Switches update the store optimistically and roll back when the Host refuses.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  AddMcpServerRequest,
  McpChangeValue,
  McpRegistryServer,
  McpServersValue,
  SearchMcpRegistryValue,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Result envelope every generated Remote method resolves to. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The Remote methods this page calls, injected so tests can supply fakes. */
export interface McpManagerRemote {
  readonly servers: () => Promise<RemoteResult<McpServersValue>>
  readonly addServer: (request: AddMcpServerRequest) => Promise<RemoteResult<McpChangeValue>>
  readonly setServerEnabled: (request: { entryId: string; enabled: boolean }) => Promise<RemoteResult<McpChangeValue>>
  readonly removeServer: (request: { entryId: string }) => Promise<RemoteResult<McpChangeValue>>
  readonly searchRegistry: (request: { query: string; cursor?: string }) => Promise<RemoteResult<SearchMcpRegistryValue>>
}

/** One editable name-value row of the server form. */
export interface FormVariable {
  readonly name: string
  readonly value: string
  readonly description?: string | undefined
  /** A registry template such as `Bearer {token}`, shown while the value is empty. */
  readonly placeholder?: string | undefined
  readonly required: boolean
  readonly secret: boolean
}

/** The add-server form, filled by hand or from a registry server. */
export interface ServerForm {
  readonly open: boolean
  /** Registry server the form was opened from, with the selected run option. */
  readonly registry?: { readonly server: McpRegistryServer; readonly option: number } | undefined
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly command: string
  /** One argument per line. */
  readonly args: string
  readonly url: string
  /** Environment variables for stdio, headers for Streamable HTTP. */
  readonly variables: readonly FormVariable[]
  readonly busy: boolean
  readonly error?: string | undefined
}

/** Registry browsing state. */
export interface DiscoverState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly error?: string | undefined
  readonly query: string
  readonly results: readonly McpRegistryServer[]
  readonly nextCursor?: string | undefined
  readonly loadingMore: boolean
}

/** Complete page state. */
export interface McpState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly error?: string | undefined
  readonly view?: McpServersValue | undefined
  /** Entry ids whose change is in flight. */
  readonly pending: readonly string[]
  /** Latest failed change or restart hint, shown until dismissed or replaced. */
  readonly notice?: { readonly kind: 'error' | 'restart'; readonly message: string } | undefined
  readonly discover: DiscoverState
  readonly form: ServerForm
}

const CLOSED_FORM: ServerForm = { open: false, serverName: '', transport: 'stdio', command: '', args: '', url: '', variables: [], busy: false }

/** Initial state before the page first renders. */
export const INITIAL_STATE: McpState = {
  status: 'idle',
  pending: [],
  discover: { status: 'idle', query: '', results: [], loadingMore: false },
  form: CLOSED_FORM,
}

/** Actions and hooks the page receives. */
export interface McpFace {
  hooks: { mcp: SnapshotStore<McpState> }
  /** Load the server list once the page first renders. */
  ensure: () => void
  refresh: () => void
  toggleServer: (entryId: string, enabled: boolean) => void
  removeServer: (entryId: string) => void
  dismissNotice: () => void
  /** Load the first registry page once Discover first renders. */
  ensureDiscover: () => void
  search: (query: string) => void
  loadMore: () => void
  /** Open the form empty, for a server added by hand. */
  openCustom: () => void
  /** Open the form filled from a registry server's first supported option. */
  openRegistry: (server: McpRegistryServer) => void
  /** Switch the registry option the form is filled from. */
  selectOption: (index: number) => void
  editForm: (patch: Partial<Pick<ServerForm, 'serverName' | 'transport' | 'command' | 'args' | 'url'>>) => void
  editVariable: (index: number, patch: Partial<Pick<FormVariable, 'name' | 'value'>>) => void
  addVariable: () => void
  removeVariable: (index: number) => void
  closeForm: () => void
  submitForm: () => void
}

/** Owner of the MCP page snapshot and its Host round trips. */
export class McpController {
  /** Page snapshot the page renders through `useMcp`. */
  readonly store: SnapshotStore<McpState> = createSnapshotStore<McpState>(INITIAL_STATE)
  private request = 0
  private searchRequest = 0
  private disposed = false

  /** @param remote - the `mcpManager` Remote face. */
  constructor(private readonly remote: McpManagerRemote) {}

  /** Stop applying late Host responses. */
  dispose(): void {
    this.disposed = true
  }

  /**
   * Bind the page's actions to this controller.
   * @returns the page face.
   */
  inject(): McpFace {
    return {
      hooks: { mcp: this.store },
      ensure: () => { if (this.state().status === 'idle') void this.load() },
      refresh: () => { void this.load() },
      toggleServer: (entryId, enabled) => { void this.toggle(entryId, enabled) },
      removeServer: (entryId) => { void this.change(entryId, () => this.remote.removeServer({ entryId })) },
      dismissNotice: () => { this.patch({ notice: undefined }) },
      ensureDiscover: () => { if (this.state().discover.status === 'idle') void this.search(false) },
      search: (query) => {
        this.patchDiscover({ query })
        void this.search(false)
      },
      loadMore: () => {
        const discover = this.state().discover
        if (discover.nextCursor !== undefined && !discover.loadingMore) void this.search(true)
      },
      openCustom: () => { this.patch({ form: { ...CLOSED_FORM, open: true } }) },
      openRegistry: (server) => { this.patch({ form: formFor(server, 0) }) },
      selectOption: (index) => {
        const registry = this.state().form.registry
        if (registry !== undefined) this.patch({ form: { ...formFor(registry.server, index), serverName: this.state().form.serverName } })
      },
      editForm: (patch) => { this.patchForm(patch) },
      editVariable: (index, patch) => {
        const variables = this.state().form.variables.map((variable, at) => at === index ? { ...variable, ...patch } : variable)
        this.patchForm({ variables })
      },
      addVariable: () => { this.patchForm({ variables: [...this.state().form.variables, { name: '', value: '', required: false, secret: false }] }) },
      removeVariable: (index) => { this.patchForm({ variables: this.state().form.variables.filter((_variable, at) => at !== index) }) },
      closeForm: () => { if (!this.state().form.busy) this.patch({ form: CLOSED_FORM }) },
      submitForm: () => { void this.submit() },
    }
  }

  /** Reload the server list; called by the page and by Host change events once the page has rendered. */
  async load(): Promise<void> {
    const request = ++this.request
    if (this.state().view === undefined) this.patch({ status: 'loading' })
    const result = await this.remote.servers()
    if (this.disposed || request !== this.request) return
    if (result.ok) this.patch({ status: 'ready', view: result.value, error: undefined })
    else if (this.state().view === undefined) this.patch({ status: 'error', error: result.error.message })
    else this.patch({ notice: { kind: 'error', message: result.error.message } })
  }

  /**
   * Read the page snapshot.
   * @returns the current snapshot.
   */
  state(): McpState {
    return this.store.getSnapshot()
  }

  private async toggle(entryId: string, enabled: boolean): Promise<void> {
    const view = this.state().view
    if (view !== undefined) {
      this.patch({ view: { ...view, servers: view.servers.map(server => server.entryId === entryId ? { ...server, enabled, state: enabled ? 'connecting' : 'disabled' } : server) } })
    }
    await this.change(entryId, () => this.remote.setServerEnabled({ entryId, enabled }))
  }

  private async change(entryId: string, operation: () => Promise<RemoteResult<McpChangeValue>>): Promise<void> {
    this.patch({ pending: [...this.state().pending, entryId] })
    const result = await operation()
    if (this.disposed) return
    this.patch({ pending: this.state().pending.filter(entry => entry !== entryId) })
    this.settle(result)
    await this.load()
  }

  private settle(result: RemoteResult<McpChangeValue>): void {
    if (!result.ok) this.patch({ notice: { kind: 'error', message: result.error.message } })
    else if (result.value.application === 'restart-required') this.patch({ notice: { kind: 'restart', message: '' } })
  }

  private async submit(): Promise<void> {
    const form = this.state().form
    if (form.busy) return
    this.patchForm({ busy: true, error: undefined })
    const variables = Object.fromEntries(form.variables.map(variable => [variable.name.trim(), variable.value] as const).filter(([name]) => name !== ''))
    const request: AddMcpServerRequest = form.transport === 'stdio'
      ? {
        serverName: form.serverName.trim(),
        transport: 'stdio',
        command: form.command.trim(),
        args: form.args.split('\n').map(line => line.trim()).filter(line => line !== ''),
        env: variables,
      }
      : { serverName: form.serverName.trim(), transport: 'streamable-http', url: form.url.trim(), headers: variables }
    const result = await this.remote.addServer(request)
    if (this.disposed) return
    if (!result.ok) {
      this.patchForm({ busy: false, error: result.error.message })
      return
    }
    this.patch({ form: CLOSED_FORM })
    this.settle(result)
    const discover = this.state().discover
    const results = discover.results.map(server => server.suggestedName === request.serverName ? { ...server, installed: true } : server)
    this.patchDiscover({ results })
    await this.load()
  }

  private async search(more: boolean): Promise<void> {
    const request = ++this.searchRequest
    const { query, nextCursor, results } = this.state().discover
    this.patchDiscover(more ? { loadingMore: true } : { status: 'loading' })
    const after = more && nextCursor !== undefined ? { cursor: nextCursor } : {}
    const result = await this.remote.searchRegistry({ query: query.trim(), ...after })
    if (this.disposed || request !== this.searchRequest) return
    if (!result.ok) {
      this.patchDiscover({ status: 'error', error: result.error.message, loadingMore: false })
      return
    }
    const known = new Set(more ? results.map(server => server.name) : [])
    const page = result.value.servers.filter(server => !known.has(server.name))
    this.patchDiscover({
      status: 'ready',
      error: undefined,
      loadingMore: false,
      results: more ? [...results, ...page] : page,
      nextCursor: result.value.nextCursor,
    })
  }

  private patchForm(patch: Partial<ServerForm>): void {
    this.patch({ form: { ...this.state().form, ...patch, ...'error' in patch ? {} : { error: undefined } } })
  }

  private patchDiscover(patch: Partial<DiscoverState>): void {
    this.patch({ discover: { ...this.state().discover, ...patch } })
  }

  private patch(patch: Partial<McpState>): void {
    this.store.set({ ...this.state(), ...patch })
  }
}

/**
 * Fill the form from one registry server option.
 * @param server - registry server.
 * @param index - option index; an index past the end selects no option.
 * @returns the open form.
 */
export function formFor(server: McpRegistryServer, index: number): ServerForm {
  const option = server.options[index]
  const variables = (option?.inputs ?? []).map((input): FormVariable => {
    // A value with `{placeholders}` is a template to fill in, not a usable value.
    const template = input.value !== undefined && /\{[^}]+\}/.test(input.value)
    return {
      name: input.name,
      value: template ? '' : input.value ?? '',
      placeholder: template ? input.value : undefined,
      description: input.description,
      required: input.required,
      secret: input.secret,
    }
  })
  return {
    ...CLOSED_FORM,
    open: true,
    registry: { server, option: index },
    serverName: server.suggestedName,
    transport: option?.transport ?? 'stdio',
    command: option?.command ?? '',
    args: (option?.args ?? []).join('\n'),
    url: option?.url ?? '',
    variables,
  }
}
