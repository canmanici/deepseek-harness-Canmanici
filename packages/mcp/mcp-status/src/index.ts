/**
 * Live connection status of configured MCP servers. Each `dsh-mcp-client`
 * instance registers a status source here; management surfaces read
 * {@link McpStatusRegistry.list} and follow `mcp-status/change`.
 * @module @deepseek-ai/dsh-mcp-status
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Lifecycle state of one server connection. */
export type McpConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'stopped'

/** One server connection as its client reports it. */
export interface McpConnectionStatus {
  readonly state: McpConnectionState
  /** Raw tool names the server currently exposes. */
  readonly tools: readonly string[]
  /** Message of the latest failed attempt; cleared by a successful connection. */
  readonly error?: string
  /** Consecutive failed attempts in the current outage. */
  readonly attempt?: number
  /** ISO timestamp of the current connection. */
  readonly connectedAt?: string
}

/** One registered server's status. */
export interface McpServerStatus extends McpConnectionStatus {
  /** Configured server name. */
  readonly server: string
}

/** A connection's status, readable at any time and observable for changes. */
export interface McpStatusSource {
  /** @returns the current status. */
  snapshot(): McpConnectionStatus
  /**
   * @param listener - called after each status change.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpStatus: McpStatusRegistry
  }

  interface Events {
    /**
     * An MCP server registered, unregistered, or changed its connection status.
     * @mode emit
     */
    'mcp-status/change'(): void
  }
}

/** Registry of live MCP server status sources. */
export class McpStatusRegistry extends Service {
  private readonly sources = new Map<symbol, { server: string; source: McpStatusSource }>()

  constructor(ctx: Context) {
    super(ctx, 'mcpStatus')
  }

  /**
   * Register one server's status source for the lifetime of the calling context.
   * @param server - configured server name.
   * @param source - the connection's status source.
   * @returns the effect disposer that removes the registration.
   */
  register(server: string, source: McpStatusSource): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- removal is synchronous; Cordis retains pending fiber disposal
    return this.ctx.effect(() => {
      const key = Symbol(server)
      this.sources.set(key, { server, source })
      const unsubscribe = source.subscribe(() => { this.changed() })
      this.changed()
      return () => {
        unsubscribe()
        this.sources.delete(key)
        this.changed()
      }
    }, `mcpStatus.register(${server})`)
  }

  /**
   * List every registered server with its current status.
   * @returns statuses sorted by server name.
   */
  list(): McpServerStatus[] {
    return [...this.sources.values()]
      .map(({ server, source }) => ({ server, ...source.snapshot() }))
      .sort((left, right) => left.server.localeCompare(right.server))
  }

  private changed(): void {
    this.ctx.emit('mcp-status/change')
  }
}

export default McpStatusRegistry
