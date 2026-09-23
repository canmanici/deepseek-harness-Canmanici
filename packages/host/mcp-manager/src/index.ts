/**
 * Host owner of the `mcpManager` Remote namespace: the MCP page's view of
 * configured MCP servers with their live status, server add, switch, and
 * remove operations, and MCP Registry search.
 * @module @deepseek-ai/dsh-host-mcp-manager
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
import { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type { McpServerStatus } from '@deepseek-ai/dsh-mcp-status'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { parseRegistryPage, SERVER_NAME } from './registry.ts'
import type {
  AddMcpServerRequest,
  ManagedMcpServer,
  McpChangeValue,
  McpServerRequest,
  McpServersValue,
  SearchMcpRegistryRequest,
  SearchMcpRegistryValue,
  SetMcpServerEnabledRequest,
} from './types.ts'

export type * from './types.ts'
export { parseRegistryPage, SERVER_NAME, suggestServerName } from './registry.ts'

/** Module name of MCP server entries. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** MCP manager configuration. */
export interface Config {
  /** MCP Registry base URL. */
  readonly registryUrl?: string
  /** Servers per registry page. */
  readonly pageSize?: number
  /** Registry request timeout in milliseconds. */
  readonly fetchTimeoutMs?: number
  /** Largest accepted registry response in bytes. */
  readonly maxResponseBytes?: number
  /**
   * Working directory of local servers added from the page; empty uses the
   * user's home directory. A workspace directory can break `npx` launches,
   * because npx resolves binaries against the enclosing package.
   */
  readonly serverCwd?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `mcpManager` Remote namespace. */
    mcpManager: McpManager
  }
}

/**
 * Remote service behind the MCP page. Server rows come from the Loader's
 * `dsh-mcp-client` entries, status from `ctx.mcpStatus`, and writes go
 * through `ctx.pluginManager`, which owns the profile patch.
 */
export class McpManager extends TypertRemoteService {
  static inject = ['loader', 'typert']
  static Config: Schema<Config> = z.object({
    registryUrl: z.string().default('https://registry.modelcontextprotocol.io'),
    pageSize: z.natural().min(1).max(100).default(30),
    fetchTimeoutMs: z.natural().default(20_000),
    maxResponseBytes: z.natural().default(8 * 1024 * 1024),
    serverCwd: z.string().default(''),
  })

  private readonly registryUrl: string
  private readonly pageSize: number
  private readonly fetchTimeoutMs: number
  private readonly maxResponseBytes: number
  private readonly serverCwd: string

  /**
   * @param ctx - Host context carrying the Loader and the optional plugin manager and MCP status services.
   * @param config - registry location and bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mcpManager')
    this.registryUrl = (config.registryUrl ?? 'https://registry.modelcontextprotocol.io').replace(/\/+$/, '')
    this.pageSize = config.pageSize ?? 30
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 20_000
    this.maxResponseBytes = config.maxResponseBytes ?? 8 * 1024 * 1024
    this.serverCwd = config.serverCwd === undefined || config.serverCwd === '' ? homedir() : config.serverCwd
    const changed = (): void => { ctx.emit('mcp-manager/changed') }
    ctx.on('mcp-status/change', changed)
    ctx.on('plugin-manager/changed', changed)
  }

  /**
   * List configured MCP servers with their live status.
   * @returns servers sorted by name, and whether they can be changed.
   */
  @Remote
  async servers(): Promise<McpServersValue> {
    const manager = this.ctx.get('pluginManager')
    const plugins = manager === undefined ? undefined : await manager.listPlugins()
    const statuses = this.ctx.get('mcpStatus')?.list() ?? []
    const servers: ManagedMcpServer[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE) continue
      const config = entry.options.config as Record<string, unknown> | undefined
      const serverName = typeof config?.serverName === 'string' ? config.serverName : entry.options.id
      const plugin = plugins?.find(row => row.entryId === entry.id)
      const enabled = plugin?.enabled ?? !entry.options.disabled
      const status = statuses.find(candidate => candidate.server === serverName)
      servers.push(managedServer(entry.id, serverName, config ?? {}, enabled, plugin, status))
    }
    servers.sort((left, right) => left.serverName.localeCompare(right.serverName))
    return { servers, manageable: manager !== undefined }
  }

  /**
   * Add a server to the profile and connect it.
   * @param request - server name and transport settings.
   * @returns how the Host applied the change.
   * @throws RemoteError when the plugin manager is not mounted, the name is taken, or the settings are invalid.
   */
  @Remote
  async addServer(request: AddMcpServerRequest): Promise<McpChangeValue> {
    const manager = this.requireManager()
    const serverName = request.serverName.trim()
    if (!SERVER_NAME.test(serverName)) invalid(`server name "${serverName}" must be 1-32 letters, digits, "_", or "-"`)
    if ((await this.servers()).servers.some(server => server.serverName === serverName)) invalid(`a server named "${serverName}" already exists`)
    const command = request.command?.trim() ?? ''
    if (request.transport === 'stdio' && command === '') invalid('a local server needs a command')
    const url = request.url?.trim() ?? ''
    if (request.transport === 'streamable-http' && !URL.canParse(url)) invalid(`a remote server needs a valid URL, not "${url}"`)
    const config = request.transport === 'stdio'
      ? {
        serverName,
        transport: 'stdio' as const,
        command,
        cwd: this.serverCwd,
        ...request.args === undefined || request.args.length === 0 ? {} : { args: [...request.args] },
        ...emptyToAbsent(request.env, 'env'),
      }
      : { serverName, transport: 'streamable-http' as const, url, ...emptyToAbsent(request.headers, 'headers') }
    try {
      McpClientConfig(config)
    } catch (error) {
      invalid((error as Error).message)
    }
    const ids = new Set([...this.ctx.loader.entries()].map(entry => entry.options.id))
    const base = `mcp-${serverName.toLowerCase().replace(/_/g, '-')}`
    let id = base
    for (let suffix = 2; ids.has(id); suffix += 1) id = `${base}-${suffix}`
    return changeValue(await manager.addEntry({ id, name: MCP_CLIENT_MODULE, config }))
  }

  /**
   * Switch one server on or off.
   * @param request - entry id and target enablement.
   * @returns how the Host applied the change.
   * @throws RemoteError when the plugin manager is not mounted or the entry cannot change.
   */
  @Remote
  async setServerEnabled(request: SetMcpServerEnabledRequest): Promise<McpChangeValue> {
    const manager = this.requireManager()
    this.requireServer(request.entryId)
    return changeValue(await manager.setPluginEnabled(request.entryId as never, request.enabled))
  }

  /**
   * Remove a server the profile defines.
   * @param request - entry id.
   * @returns how the Host applied the change.
   * @throws RemoteError when the plugin manager is not mounted or the profile does not define the server.
   */
  @Remote
  async removeServer(request: McpServerRequest): Promise<McpChangeValue> {
    const manager = this.requireManager()
    const entry = this.requireServer(request.entryId)
    return changeValue(await manager.removeEntry(entry.options.id, MCP_CLIENT_MODULE))
  }

  /**
   * Search the MCP Registry for the latest version of each server.
   * @param request - query and optional cursor.
   * @returns servers with their supported run options and the next cursor.
   * @throws RemoteError when the registry cannot be reached or answers with invalid data.
   */
  @Remote
  async searchRegistry(request: SearchMcpRegistryRequest): Promise<SearchMcpRegistryValue> {
    const url = new URL(`${this.registryUrl}/v0/servers`)
    url.searchParams.set('version', 'latest')
    url.searchParams.set('limit', String(this.pageSize))
    const query = request.query.trim()
    if (query !== '') url.searchParams.set('search', query)
    if (request.cursor !== undefined) url.searchParams.set('cursor', request.cursor)
    const installed = new Set((await this.servers()).servers.map(server => server.serverName))
    let body: unknown
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'deepseek-harness-mcp-manager' }, signal: AbortSignal.timeout(this.fetchTimeoutMs) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      if (Buffer.byteLength(text) > this.maxResponseBytes) throw new Error(`response exceeds ${this.maxResponseBytes} bytes`)
      body = JSON.parse(text)
    } catch (error) {
      invalid(`the MCP Registry could not be read: ${(error as Error).message}`)
    }
    return parseRegistryPage(body, installed)
  }

  private requireManager(): NonNullable<Context['pluginManager']> {
    const manager = this.ctx.get('pluginManager')
    if (manager === undefined) throw new RemoteError('mcp-manager/unavailable', 'the Host composition does not mount pluginManager', { service: 'pluginManager' })
    return manager
  }

  private requireServer(entryId: string): { options: { id: string } } {
    const entry = [...this.ctx.loader.entries()].find(candidate => candidate.id === entryId && candidate.options.name === MCP_CLIENT_MODULE)
    if (entry === undefined) invalid(`unknown MCP server entry "${entryId}"`)
    return entry
  }
}

function managedServer(
  entryId: string,
  serverName: string,
  config: Record<string, unknown>,
  enabled: boolean,
  plugin: PluginInfo | undefined,
  status: McpServerStatus | undefined,
): ManagedMcpServer {
  const transport = config.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const args = Array.isArray(config.args) ? config.args.filter((value): value is string => typeof value === 'string') : undefined
  return {
    entryId,
    serverName,
    transport,
    ...typeof config.command === 'string' ? { command: config.command } : {},
    ...args === undefined ? {} : { args },
    ...typeof config.url === 'string' ? { url: config.url } : {},
    envNames: keys(config.env),
    headerNames: keys(config.headers),
    enabled,
    manageable: plugin !== undefined && plugin.readOnlyReason === undefined,
    state: !enabled ? 'disabled' : status?.state ?? 'connecting',
    tools: status?.tools ?? [],
    ...status?.error === undefined ? {} : { error: status.error },
    ...status?.attempt === undefined ? {} : { attempt: status.attempt },
  }
}

function keys(value: unknown): string[] {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : []
}

function emptyToAbsent<K extends string>(
  values: Readonly<Record<string, string>> | undefined,
  key: K,
): Partial<Record<K, Record<string, string>>> {
  const entries = Object.entries(values ?? {}).map(([name, value]) => [name.trim(), value] as const).filter(([name]) => name !== '')
  return entries.length === 0 ? {} : { [key]: Object.fromEntries(entries) } as Partial<Record<K, Record<string, string>>>
}

function changeValue(result: { application: string; error?: { code: string; diagnostic?: string }; warnings?: string[] }): McpChangeValue {
  if (result.application === 'failed' || result.application === 'cancelled') {
    invalid(result.error?.diagnostic ?? result.error?.code ?? 'the profile change failed')
  }
  return { application: result.application as McpChangeValue['application'], warnings: result.warnings ?? [] }
}

function invalid(reason: string): never {
  throw new RemoteError('mcp-manager/invalid-request', reason, { reason })
}

export default McpManager
