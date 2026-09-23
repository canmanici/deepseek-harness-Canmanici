import { homedir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { McpManager } from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals() })

interface FakeEntry { id: string; options: { id: string; name: string; config?: unknown; disabled?: boolean } }

function entry(id: string, config: Record<string, unknown>, extra: Partial<FakeEntry['options']> = {}): FakeEntry {
  return { id, options: { id, name: '@deepseek-ai/dsh-mcp-client', config, ...extra } }
}

interface SetupOptions { entries?: FakeEntry[]; manager?: boolean; status?: boolean; config?: ConstructorParameters<typeof McpManager>[1] }

function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  const entries: FakeEntry[] = options.entries ?? [
    entry('e-docs', { serverName: 'docs', transport: 'stdio', command: 'npx', args: ['-y', 'docs', 1], env: { TOKEN: 'secret' } }),
    entry('e-web', { serverName: 'web', transport: 'streamable-http', url: 'https://web/mcp', headers: { Authorization: 'x' } }),
    entry('e-off', { serverName: 'off', transport: 'stdio', command: 'uvx' }, { disabled: true }),
    entry('e-bare', undefined as never),
    { id: 'other', options: { id: 'other', name: '@deepseek-ai/dsh-tools' } },
  ]
  ctx.provide('loader', { entries: () => entries } as never)
  const plugins = [
    { entryId: 'e-docs', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, patchId: 'e-docs' },
    { entryId: 'e-web', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, readOnlyReason: 'unaddressable' },
  ]
  const pluginManager = {
    listPlugins: vi.fn(async () => plugins),
    addEntry: vi.fn(async () => ({ application: 'applied', warnings: ['note'] })),
    setPluginEnabled: vi.fn(async () => ({ application: 'restart-required' })),
    removeEntry: vi.fn(async () => ({ application: 'applied' })),
  }
  if (options.manager !== false) ctx.provide('pluginManager', pluginManager as never)
  if (options.status !== false) {
    ctx.provide('mcpStatus', {
      list: () => [
        { server: 'docs', state: 'connected', tools: ['mcp__docs__read'] },
        { server: 'web', state: 'reconnecting', tools: [], error: 'refused', attempt: 2 },
      ],
    } as never)
  }
  ctx.provide('typert', { register: () => () => {} } as never)
  const manager = new McpManager(ctx, options.config)
  return { ctx, manager, pluginManager, entries }
}

describe('McpManager', () => {
  it('lists servers with configuration, enablement, manageability, and live status', async () => {
    const { manager } = setup()
    const { servers, manageable } = await manager.servers()
    expect(manageable).toBe(true)
    expect(servers).toEqual([
      { entryId: 'e-docs', serverName: 'docs', transport: 'stdio', command: 'npx', args: ['-y', 'docs'], envNames: ['TOKEN'], headerNames: [], enabled: true, manageable: true, state: 'connected', tools: ['mcp__docs__read'] },
      { entryId: 'e-bare', serverName: 'e-bare', transport: 'stdio', envNames: [], headerNames: [], enabled: true, manageable: false, state: 'connecting', tools: [] },
      { entryId: 'e-off', serverName: 'off', transport: 'stdio', command: 'uvx', envNames: [], headerNames: [], enabled: false, manageable: false, state: 'disabled', tools: [] },
      { entryId: 'e-web', serverName: 'web', transport: 'streamable-http', url: 'https://web/mcp', envNames: [], headerNames: ['Authorization'], enabled: true, manageable: false, state: 'reconnecting', tools: [], error: 'refused', attempt: 2 },
    ])
    const bare = setup({ manager: false, status: false })
    expect((await bare.manager.servers()).manageable).toBe(false)
  })

  it('adds stdio and Streamable HTTP servers with a unique entry id and validates the request', async () => {
    const { manager, pluginManager, entries } = setup({ config: { serverCwd: '/work' } })
    entries.push({ id: 'x', options: { id: 'mcp-new-server', name: 'other' } })
    expect(await manager.addServer({ serverName: ' new_server ', transport: 'stdio', command: ' npx ', args: ['-y', 'pkg'], env: { ' KEY ': 'v', ' ': 'drop' } }))
      .toEqual({ application: 'applied', warnings: ['note'] })
    expect(pluginManager.addEntry).toHaveBeenLastCalledWith({
      id: 'mcp-new-server-2',
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'new_server', transport: 'stdio', command: 'npx', cwd: '/work', args: ['-y', 'pkg'], env: { KEY: 'v' } },
    })
    await manager.addServer({ serverName: 'remote', transport: 'streamable-http', url: 'https://r/mcp', headers: {} })
    expect(pluginManager.addEntry).toHaveBeenLastCalledWith({ id: 'mcp-remote', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'remote', transport: 'streamable-http', url: 'https://r/mcp' } })
    await manager.addServer({ serverName: 'plain', transport: 'stdio', command: 'uvx' })
    expect(pluginManager.addEntry).toHaveBeenLastCalledWith(expect.objectContaining({ config: { serverName: 'plain', transport: 'stdio', command: 'uvx', cwd: '/work' } }))

    await expect(manager.addServer({ serverName: 'bad name', transport: 'stdio', command: 'x' })).rejects.toMatchObject({ code: 'mcp-manager/invalid-request' })
    await expect(manager.addServer({ serverName: 'docs', transport: 'stdio', command: 'x' })).rejects.toThrow('already exists')
    await expect(manager.addServer({ serverName: 'nocmd', transport: 'stdio' })).rejects.toThrow('needs a command')
    await expect(manager.addServer({ serverName: 'nourl', transport: 'streamable-http' })).rejects.toThrow('needs a valid URL')
    await expect(manager.addServer({ serverName: 'badcfg', transport: 'streamable-http', url: 'https://ok', headers: { A: 1 as never } })).rejects.toMatchObject({ code: 'mcp-manager/invalid-request' })
    pluginManager.addEntry.mockResolvedValueOnce({ application: 'failed', error: { code: 'operation-error', diagnostic: 'disk full' } } as never)
    await expect(manager.addServer({ serverName: 'late', transport: 'stdio', command: 'x' })).rejects.toThrow('disk full')
    pluginManager.addEntry.mockResolvedValueOnce({ application: 'cancelled', error: { code: 'operation-error' } } as never)
    await expect(manager.addServer({ serverName: 'late', transport: 'stdio', command: 'x' })).rejects.toThrow('operation-error')
    pluginManager.addEntry.mockResolvedValueOnce({ application: 'failed' } as never)
    await expect(manager.addServer({ serverName: 'late', transport: 'stdio', command: 'x' })).rejects.toThrow('the profile change failed')
  })

  it('runs local servers from the home directory by default', async () => {
    const { manager, pluginManager } = setup()
    await manager.addServer({ serverName: 'home', transport: 'stdio', command: 'npx' })
    expect(JSON.stringify(pluginManager.addEntry.mock.calls.at(-1))).toContain(JSON.stringify(homedir()))
  })

  it('switches and removes servers and rejects unknown entries or a missing plugin manager', async () => {
    const { manager, pluginManager } = setup()
    expect(await manager.setServerEnabled({ entryId: 'e-docs', enabled: false })).toEqual({ application: 'restart-required', warnings: [] })
    expect(pluginManager.setPluginEnabled).toHaveBeenCalledWith('e-docs', false)
    expect(await manager.removeServer({ entryId: 'e-docs' })).toEqual({ application: 'applied', warnings: [] })
    expect(pluginManager.removeEntry).toHaveBeenCalledWith('e-docs', '@deepseek-ai/dsh-mcp-client')
    await expect(manager.removeServer({ entryId: 'other' })).rejects.toThrow('unknown MCP server entry')
    const bare = setup({ manager: false })
    await expect(bare.manager.setServerEnabled({ entryId: 'e-docs', enabled: true })).rejects.toMatchObject({ code: 'mcp-manager/unavailable' })
  })

  it('forwards status and plugin changes as mcp-manager/changed', () => {
    const { ctx } = setup()
    let changes = 0
    ctx.on('mcp-manager/changed', () => { changes += 1 })
    ctx.emit('mcp-status/change')
    ctx.emit('plugin-manager/changed', { reason: 'plugin' } as never)
    expect(changes).toBe(2)
  })

  it('searches the registry with query and cursor and reports unreachable or invalid responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ servers: [{ server: { name: 'io.x/docs' } }], metadata: {} })))
    vi.stubGlobal('fetch', fetchMock)
    const { manager } = setup({ config: { registryUrl: 'https://reg.example/', pageSize: 5 } })
    const result = await manager.searchRegistry({ query: ' git ', cursor: 'c1' })
    expect(result.servers[0]).toMatchObject({ name: 'io.x/docs', suggestedName: 'docs', installed: true })
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))
    expect(url.origin + url.pathname).toBe('https://reg.example/v0/servers')
    expect(Object.fromEntries(url.searchParams)).toEqual({ version: 'latest', limit: '5', search: 'git', cursor: 'c1' })
    await manager.searchRegistry({ query: '' })
    expect(new URL(String((fetchMock.mock.calls[1] as unknown[])[0])).searchParams.has('search')).toBe(false)

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }))
    await expect(manager.searchRegistry({ query: '' })).rejects.toThrow('HTTP 503')
    fetchMock.mockResolvedValueOnce(new Response('{bad'))
    await expect(manager.searchRegistry({ query: '' })).rejects.toThrow('could not be read')
    const small = setup({ config: { maxResponseBytes: 2 } })
    await expect(small.manager.searchRegistry({ query: '' })).rejects.toThrow('exceeds 2 bytes')
  })
})
