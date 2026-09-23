// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { McpServersValue, SearchMcpRegistryValue } from '@deepseek-ai/dsh-api-remotes/client'
import { McpController, type McpManagerRemote, type McpState, type RemoteResult } from '../src/client/controller.ts'
// Type-only: the mcpLibrary locale namespace merge the page props read.
import type {} from '../src/client/index.ts'
import { McpPage, type McpPageProps } from '../src/client/McpPage.tsx'
import { en, type McpLibraryLocaleKey } from '../src/client/locales.ts'
import { registryServer, server } from './fixtures.client.ts'

afterEach(cleanup)

const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value })
const fail = (message: string): RemoteResult<never> => ({ ok: false, error: { code: 'mcp-manager/invalid-request', message } })
const t = ((key: McpLibraryLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as McpPageProps['t']
type MockRemote = { [K in keyof McpManagerRemote]: ReturnType<typeof vi.fn> & McpManagerRemote[K] }

function remote(overrides: Partial<Record<keyof McpManagerRemote, unknown>> = {}): MockRemote {
  return {
    servers: vi.fn(async () => ok<McpServersValue>({
      servers: [
        server(),
        server({ entryId: 'e-web', serverName: 'web', transport: 'streamable-http', command: undefined, args: undefined, url: 'https://web/mcp', envNames: [], headerNames: ['Authorization'], state: 'reconnecting', attempt: 3, error: 'refused', tools: [], manageable: false }),
        server({ entryId: 'e-off', serverName: 'off', enabled: false, state: 'disabled', envNames: [], tools: [], args: undefined }),
        server({ entryId: 'e-bad', serverName: 'bad', state: 'failed', error: 'spawn ENOENT', tools: [], envNames: [] }),
        server({ entryId: 'e-new', serverName: 'new', state: 'connecting', tools: [], envNames: [] }),
        server({ entryId: 'e-stop', serverName: 'stop', state: 'stopped', tools: [], envNames: [] }),
      ],
      manageable: true,
    })),
    addServer: vi.fn(async () => ok({ application: 'applied', warnings: [] })),
    setServerEnabled: vi.fn(async () => ok({ application: 'applied', warnings: [] })),
    removeServer: vi.fn(async () => ok({ application: 'applied', warnings: [] })),
    searchRegistry: vi.fn(async () => ok<SearchMcpRegistryValue>({
      servers: [
        registryServer(),
        registryServer({ name: 'io.x/pkgs', title: undefined, suggestedName: 'pkgs', repository: undefined, websiteUrl: 'https://x.dev', version: '', installed: true, options: [
          { kind: 'pypi', transport: 'stdio', command: 'uvx', args: ['x'], inputs: [] },
          { kind: 'oci', transport: 'stdio', command: 'docker', args: ['run'], inputs: [] },
        ] }),
        registryServer({ name: 'io.x/none', suggestedName: 'none', repository: undefined, options: [] }),
      ],
      nextCursor: 'c2',
    })),
    ...overrides,
  } as MockRemote
}

function mount(api: MockRemote = remote()): { controller: McpController; api: MockRemote } {
  const controller = new McpController(api)
  const { hooks, ...face } = controller.inject()
  const unused = (): never => { throw new Error('The MCP page reads no global state') }
  const props = {
    usePanelInfo: unused, useWorkspaces: unused, useSessions: unused,
    useSessionStatus: unused, useSessionRetainInfo: unused, useResource: unused,
    t,
    ...face,
    useMcp: bindSnapshotSelector(hooks.mcp),
  } as McpPageProps
  render(<McpPage {...props} />)
  return { controller, api }
}

function set(controller: McpController, patch: Partial<McpState>): void {
  act(() => { controller.store.set({ ...controller.state(), ...patch }) })
}

const tab = (name: RegExp): HTMLElement => screen.getByRole('tab', { name })

describe('McpPage', () => {
  it('lists servers with their state, target, variables, tools, and switches', async () => {
    const { api } = mount()
    expect(screen.getByRole('status').textContent).toBe(en.loading)
    await screen.findByText('docs')
    expect(screen.getByText('6 servers')).toBeDefined()
    expect(screen.getByText('1 connected')).toBeDefined()
    expect(screen.getByText('3 tools')).toBeDefined()
    expect(tab(/^Servers/).textContent).toBe('Servers6')
    for (const label of [en.stateConnected, 'Reconnecting (attempt 3)', en.stateDisabled, en.stateFailed, en.stateConnecting, en.stateStopped]) {
      expect(screen.getByText(label)).toBeDefined()
    }
    expect(screen.getAllByText('npx -y @acme/docs').length).toBeGreaterThan(0)
    expect(screen.getByText('https://web/mcp')).toBeDefined()
    expect(screen.getByText('Set: TOKEN')).toBeDefined()
    expect(screen.getByText('Set: Authorization')).toBeDefined()
    expect(screen.getByText('spawn ENOENT')).toBeDefined()
    expect(screen.getByText(en.readOnly)).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Turn on web' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 tools' }))
    expect(screen.getByText('read')).toBeDefined()
    expect(screen.getByText('other')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.toolsHide }))
    expect(screen.queryByText('read')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Turn on docs' }))
    expect(api.setServerEnabled).toHaveBeenCalledWith({ entryId: 'e-docs', enabled: false })
  })

  it('removes a server after confirming and shows restart and error notices', async () => {
    const api = remote({ removeServer: vi.fn(async () => ok({ application: 'restart-required', warnings: [] })) })
    const { controller } = mount(api)
    await screen.findByText('docs')
    const card = screen.getByText('docs').closest('li') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: en.remove }))
    fireEvent.click(within(card).getByRole('button', { name: en.removeNo }))
    fireEvent.click(within(card).getByRole('button', { name: en.remove }))
    expect(within(card).getByRole('alertdialog').textContent).toContain('Remove docs?')
    fireEvent.click(within(card).getByRole('button', { name: en.removeYes }))
    expect(api.removeServer).toHaveBeenCalledWith({ entryId: 'e-docs' })
    expect(await screen.findByText(en.restartRequired)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.dismiss }))
    expect(screen.queryByText(en.restartRequired)).toBeNull()
    set(controller, { notice: { kind: 'error', message: 'disk full' } })
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t save: disk full')
  })

  it('shows empty, read-only, and error states', async () => {
    const api = remote({ servers: vi.fn(async () => ok({ servers: [], manageable: false })) })
    const { controller } = mount(api)
    await screen.findByText(en.emptyTitle)
    expect(screen.getAllByRole('button', { name: en.addServer }).every(button => button.hasAttribute('disabled'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.emptyBrowse }))
    expect(tab(/^Discover/).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab(/^Discover/), { key: 'ArrowRight' })
    expect(tab(/^Servers/).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab(/^Servers/), { key: 'ArrowLeft' })
    fireEvent.keyDown(tab(/^Discover/), { key: 'Enter' })
    expect(tab(/^Discover/).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab(/^Servers/))
    set(controller, { view: { servers: [server({ manageable: false })], manageable: false } })
    expect(screen.getByText(en.unmanageable)).toBeDefined()
    expect(screen.queryByRole('button', { name: en.remove })).toBeNull()
    set(controller, { status: 'error', view: undefined, error: 'host down' })
    expect(screen.getByRole('alert').textContent).toContain('host down')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(api.servers).toHaveBeenCalledTimes(2) })
    set(controller, { status: 'error', view: undefined, error: undefined })
    expect(screen.getByRole('alert').textContent).toContain(en.loadError.replace('{error}', ''))
  })

  it('searches the registry, pages, and connects a server through the form', async () => {
    const { api } = mount()
    await screen.findByText('docs')
    fireEvent.click(tab(/^Discover/))
    await screen.findByText('io.github.acme/files')
    expect(screen.getByText('pkgs')).toBeDefined()
    expect(screen.getByText(en.unsupported)).toBeDefined()
    expect(screen.getByText(en.connected)).toBeDefined()
    expect(screen.getAllByText('v1.0.0')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: en.openRepository }).map(link => link.getAttribute('href'))).toEqual(['https://github.com/acme/files', 'https://x.dev'])
    const noneCard = screen.getByText('io.x/none').closest('li') as HTMLElement
    expect(within(noneCard).getByRole('button', { name: en.connect }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'git' } })
    await waitFor(() => { expect(api.searchRegistry).toHaveBeenLastCalledWith({ query: 'git' }) })
    await screen.findByText('io.github.acme/files')
    api.searchRegistry.mockResolvedValueOnce(ok({ servers: [registryServer({ name: 'io.x/more', title: 'More' })] }))
    fireEvent.click(screen.getByRole('button', { name: en.loadMore }))
    await screen.findByText('More')
    expect(screen.queryByRole('button', { name: en.loadMore })).toBeNull()

    fireEvent.click(within(screen.getByText('io.github.acme/files').closest('li') as HTMLElement).getByRole('button', { name: en.connect }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Connect Files')).toBeDefined()
    const submit = within(dialog).getAllByRole('button', { name: en.formSubmit }).at(-1) as HTMLElement
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('ROOT Value'), { target: { value: '/data' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.kindRemote }))
    const header = within(dialog).getByLabelText('Authorization Value')
    expect(header.getAttribute('placeholder')).toBe('Bearer {key}')
    expect(header.getAttribute('type')).toBe('password')
    fireEvent.change(header, { target: { value: 'Bearer abc' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.variableAdd }))
    fireEvent.change(within(dialog).getAllByLabelText(en.variableName).at(-1) as HTMLElement, { target: { value: 'X-Team' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove X-Team' }))
    fireEvent.click(within(dialog).getAllByRole('button', { name: en.formSubmit }).at(-1) as HTMLElement)
    await waitFor(() => { expect(api.addServer).toHaveBeenCalledWith({ serverName: 'files', transport: 'streamable-http', url: 'https://acme.dev/mcp', headers: { Authorization: 'Bearer abc' } }) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('adds a custom local or remote server and reports a failed add in the form', async () => {
    const api = remote({ addServer: vi.fn(async () => fail('name taken')) })
    const { controller } = mount(api)
    await screen.findByText('docs')
    fireEvent.click(screen.getAllByRole('button', { name: en.addServer })[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(en.formAddTitle)).toBeDefined()
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: 'bad name' } })
    expect(within(dialog).getByRole('textbox', { name: /^Name/ }).getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Name/ }), { target: { value: 'tools' } })
    fireEvent.change(within(dialog).getByLabelText(en.fieldCommand), { target: { value: 'uvx' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Arguments/ }), { target: { value: 'pkg' } })
    fireEvent.submit(within(dialog).getByRole('textbox', { name: /^Name/ }).closest('form') as HTMLFormElement)
    expect(await within(dialog).findByRole('alert')).toBeDefined()
    expect(within(dialog).getByRole('alert').textContent).toBe('name taken')
    fireEvent.click(within(dialog).getByRole('button', { name: en.transportRemote }))
    expect(within(dialog).getByText(en.fieldHeaders)).toBeDefined()
    fireEvent.change(within(dialog).getByLabelText(en.fieldUrl), { target: { value: 'https://r/mcp' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.transportLocal }))
    expect(within(dialog).getByText(en.fieldEnv)).toBeDefined()
    set(controller, { form: { ...controller.state().form, busy: true } })
    expect(within(dialog).getByRole('button', { name: en.formBusy })).toBeDefined()
    fireEvent.submit(within(dialog).getByRole('textbox', { name: /^Name/ }).closest('form') as HTMLFormElement)
    expect(api.addServer).toHaveBeenCalledTimes(1)
    set(controller, { form: { ...controller.state().form, busy: false } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.formCancel }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('shows registry loading, error, and empty states', async () => {
    const api = remote({ searchRegistry: vi.fn(async () => fail('offline')) })
    const { controller } = mount(api)
    await screen.findByText('docs')
    fireEvent.click(tab(/^Discover/))
    expect(await screen.findByText('Couldn’t read the MCP Registry: offline')).toBeDefined()
    api.searchRegistry.mockResolvedValueOnce(ok({ servers: [] }))
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText('No servers match “”.')).toBeDefined()
    set(controller, { discover: { ...controller.state().discover, status: 'loading' } })
    expect(screen.getByText(en.discoverLoading)).toBeDefined()
    set(controller, { discover: { ...controller.state().discover, status: 'error', error: undefined } })
    expect(screen.getByRole('alert').textContent).toContain(en.discoverError.replace('{error}', ''))
    set(controller, { discover: { ...controller.state().discover, status: 'ready', results: [registryServer()], nextCursor: 'c', loadingMore: true } })
    expect(screen.getByRole('button', { name: en.loadingMore }).hasAttribute('disabled')).toBe(true)
  })

  it('falls back for a missing attempt count, command, URL, and registry title', async () => {
    const { controller } = mount()
    await screen.findByText('docs')
    set(controller, { view: { manageable: true, servers: [
      server({ entryId: 'a', serverName: 'a', state: 'reconnecting', command: undefined, args: undefined, envNames: [] }),
      server({ entryId: 'b', serverName: 'b', transport: 'streamable-http', command: undefined, args: undefined, envNames: [] }),
    ] } })
    expect(screen.getByText('Reconnecting (attempt 1)')).toBeDefined()
    act(() => { controller.inject().openRegistry(registryServer({ title: undefined })) })
    expect(await screen.findByText('Connect files')).toBeDefined()
  })
})
