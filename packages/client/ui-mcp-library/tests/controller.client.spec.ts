import { describe, expect, it, vi } from 'vitest'
import type { McpServersValue, SearchMcpRegistryValue } from '@deepseek-ai/dsh-api-remotes/client'
import { formFor, McpController, type McpManagerRemote, type RemoteResult } from '../src/client/controller.ts'
import { registryServer, server } from './fixtures.client.ts'

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const fail = (message: string): RemoteResult<never> => ({ ok: false, error: { code: 'mcp-manager/invalid-request', message } })
type MockRemote = { [K in keyof McpManagerRemote]: ReturnType<typeof vi.fn> & McpManagerRemote[K] }

function remote(overrides: Partial<Record<keyof McpManagerRemote, unknown>> = {}): MockRemote {
  return {
    servers: vi.fn(async () => ok<McpServersValue>({ servers: [server()], manageable: true })),
    addServer: vi.fn(async () => ok({ application: 'applied', warnings: [] })),
    setServerEnabled: vi.fn(async () => ok({ application: 'applied', warnings: [] })),
    removeServer: vi.fn(async () => ok({ application: 'restart-required', warnings: [] })),
    searchRegistry: vi.fn(async () => ok<SearchMcpRegistryValue>({ servers: [registryServer()], nextCursor: 'c2' })),
    ...overrides,
  } as MockRemote
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

describe('McpController', () => {
  it('loads once, reports first-load errors on the page and later ones as notices, and ignores stale or late responses', async () => {
    const api = remote({ servers: vi.fn(async () => fail('host down')) })
    const controller = new McpController(api)
    const face = controller.inject()
    expect(face.hooks.mcp).toBe(controller.store)
    face.ensure()
    expect(controller.state().status).toBe('loading')
    await settle()
    expect(controller.state()).toMatchObject({ status: 'error', error: 'host down' })
    api.servers.mockResolvedValueOnce(ok({ servers: [], manageable: true }))
    face.refresh()
    await settle()
    face.ensure()
    expect(controller.state()).toMatchObject({ status: 'ready', view: { servers: [] } })
    api.servers.mockResolvedValueOnce(fail('flaky'))
    await controller.load()
    expect(controller.state().notice).toEqual({ kind: 'error', message: 'flaky' })
    face.dismissNotice()
    let release: (value: RemoteResult<McpServersValue>) => void = () => {}
    api.servers.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const stale = controller.load()
    api.servers.mockResolvedValueOnce(ok({ servers: [server()], manageable: true }))
    await controller.load()
    release(ok({ servers: [server({ serverName: 'stale' })], manageable: true }))
    await stale
    expect(controller.state().view?.servers[0]?.serverName).toBe('docs')
    controller.dispose()
    await controller.load()
    expect(api.servers).toHaveBeenCalledTimes(6)
  })

  it('switches optimistically, removes, and reports failures and restart hints', async () => {
    const api = remote()
    const controller = new McpController(api)
    const face = controller.inject()
    face.toggleServer('e-docs', false)
    await settle()
    await controller.load()
    face.toggleServer('e-docs', false)
    expect(controller.state().view?.servers[0]).toMatchObject({ enabled: false, state: 'disabled' })
    expect(controller.state().pending).toEqual(['e-docs'])
    await settle()
    expect(api.setServerEnabled).toHaveBeenLastCalledWith({ entryId: 'e-docs', enabled: false })
    face.toggleServer('e-other', true)
    await settle()
    face.toggleServer('e-docs', true)
    expect(controller.state().view?.servers[0]).toMatchObject({ enabled: true, state: 'connecting' })
    await settle()
    face.removeServer('e-docs')
    await settle()
    expect(controller.state().notice).toEqual({ kind: 'restart', message: '' })
    api.removeServer.mockResolvedValueOnce(fail('read-only'))
    face.removeServer('e-docs')
    await settle()
    expect(controller.state().notice).toEqual({ kind: 'error', message: 'read-only' })
    controller.dispose()
    face.removeServer('e-docs')
    await settle()
    expect(controller.state().pending).toEqual(['e-docs'])
  })

  it('searches the registry, pages with the cursor, and drops superseded or failed searches', async () => {
    const api = remote()
    const controller = new McpController(api)
    const face = controller.inject()
    face.ensureDiscover()
    expect(controller.state().discover.status).toBe('loading')
    await settle()
    face.ensureDiscover()
    expect(api.searchRegistry).toHaveBeenCalledTimes(1)
    expect(api.searchRegistry).toHaveBeenLastCalledWith({ query: '' })
    api.searchRegistry.mockResolvedValueOnce(ok({ servers: [registryServer(), registryServer({ name: 'io.x/next' })] }))
    face.loadMore()
    face.loadMore()
    await settle()
    expect(api.searchRegistry).toHaveBeenLastCalledWith({ query: '', cursor: 'c2' })
    expect(controller.state().discover.results.map(entry => entry.name)).toEqual(['io.github.acme/files', 'io.x/next'])
    face.loadMore()
    expect(api.searchRegistry).toHaveBeenCalledTimes(2)
    let release: (value: RemoteResult<SearchMcpRegistryValue>) => void = () => {}
    api.searchRegistry.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    face.search('slow')
    face.search(' git ')
    await settle()
    release(ok({ servers: [] }))
    await settle()
    expect(api.searchRegistry).toHaveBeenLastCalledWith({ query: 'git' })
    expect(controller.state().discover.results).toHaveLength(1)
    api.searchRegistry.mockResolvedValueOnce(fail('offline'))
    face.search('x')
    await settle()
    expect(controller.state().discover).toMatchObject({ status: 'error', error: 'offline' })
    controller.dispose()
    face.search('y')
    await settle()
    expect(controller.state().discover.status).toBe('loading')
  })

  it('fills the form from a registry option, edits variables, and submits stdio and remote servers', async () => {
    const api = remote()
    const controller = new McpController(api)
    const face = controller.inject()
    face.ensureDiscover()
    await settle()
    face.openRegistry(registryServer())
    expect(controller.state().form).toMatchObject({ open: true, serverName: 'files', transport: 'stdio', command: 'npx', args: '-y\n@acme/files@1.0.0', variables: [{ name: 'ROOT', value: '', required: true }] })
    face.editForm({ serverName: 'my-files' })
    face.selectOption(1)
    expect(controller.state().form).toMatchObject({ serverName: 'my-files', transport: 'streamable-http', url: 'https://acme.dev/mcp', variables: [{ name: 'Authorization', value: '', placeholder: 'Bearer {key}', secret: true }] })
    face.editVariable(0, { value: 'Bearer abc' })
    face.addVariable()
    face.editVariable(1, { name: ' X-Team ', value: 'one' })
    face.addVariable()
    face.removeVariable(3)
    face.submitForm()
    face.submitForm()
    face.closeForm()
    expect(controller.state().form.open).toBe(true)
    await settle()
    expect(api.addServer).toHaveBeenCalledTimes(1)
    expect(api.addServer).toHaveBeenCalledWith({ serverName: 'my-files', transport: 'streamable-http', url: 'https://acme.dev/mcp', headers: { Authorization: 'Bearer abc', 'X-Team': 'one' } })
    expect(controller.state().form.open).toBe(false)
    expect(controller.state().discover.results[0]?.installed).toBe(false)

    face.openCustom()
    face.editForm({ serverName: 'files', command: ' uvx ', args: ' pkg \n\n --flag ' })
    api.addServer.mockResolvedValueOnce(fail('name taken'))
    face.submitForm()
    await settle()
    expect(controller.state().form).toMatchObject({ busy: false, error: 'name taken' })
    face.editForm({ serverName: 'files' })
    expect(controller.state().form.error).toBeUndefined()
    api.addServer.mockResolvedValueOnce(ok({ application: 'restart-required', warnings: [] }))
    face.submitForm()
    await settle()
    expect(api.addServer).toHaveBeenLastCalledWith({ serverName: 'files', transport: 'stdio', command: 'uvx', args: ['pkg', '--flag'], env: {} })
    expect(controller.state().notice).toEqual({ kind: 'restart', message: '' })
    expect(controller.state().discover.results[0]?.installed).toBe(true)
    face.selectOption(0)
    face.openCustom()
    face.closeForm()
    expect(controller.state().form.open).toBe(false)
    controller.dispose()
    face.openCustom()
    face.submitForm()
    await settle()
    expect(controller.state().form.busy).toBe(true)
  })

  it('opens an empty form for a registry server without options', () => {
    expect(formFor(registryServer({ options: [] }), 0)).toMatchObject({ transport: 'stdio', command: '', args: '', url: '', variables: [] })
  })
})
