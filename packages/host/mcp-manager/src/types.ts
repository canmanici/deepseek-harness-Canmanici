/**
 * Wire vocabulary of the `mcpManager` Remote namespace. Types only.
 * @module @deepseek-ai/dsh-host-mcp-manager/src/types
 */

import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Host composition does not mount the service this operation needs. */
    'mcp-manager/unavailable': { readonly service: string }
    /** The request names an unknown server or carries an invalid value. */
    'mcp-manager/invalid-request': { readonly reason: string }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The MCP server list or a server's connection status changed; management
     * clients refetch their view.
     * @mode emit
     */
    'mcp-manager/changed'(): void
  }
}

/** Transport of one MCP server. */
export type McpTransport = 'stdio' | 'streamable-http'

/** Connection state of one MCP server. */
export type ManagedMcpState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'stopped' | 'disabled'

/** One configured MCP server as the MCP page displays it. */
export interface ManagedMcpServer {
  /** Loader entry identity used by enablement and removal. */
  readonly entryId: string
  /** Server namespace; tools appear as `mcp__<serverName>__<tool>`. */
  readonly serverName: string
  readonly transport: McpTransport
  /** Executable of a stdio server. */
  readonly command?: string
  /** Arguments of a stdio server. */
  readonly args?: readonly string[]
  /** Endpoint of a Streamable HTTP server. */
  readonly url?: string
  /** Names of configured environment variables; values stay on the Host. */
  readonly envNames: readonly string[]
  /** Names of configured request headers; values stay on the Host. */
  readonly headerNames: readonly string[]
  readonly enabled: boolean
  /** Whether the profile can change the entry; entries from bundles or overlays are read-only. */
  readonly manageable: boolean
  readonly state: ManagedMcpState
  /** Public tool names the server currently exposes. */
  readonly tools: readonly string[]
  /** Message of the latest failed connection attempt. */
  readonly error?: string
  /** Consecutive failed attempts in the current outage. */
  readonly attempt?: number
}

/** MCP server list. */
export interface McpServersValue {
  readonly servers: readonly ManagedMcpServer[]
  /** Whether the Host mounts the plugin manager, so servers can be added, switched, and removed. */
  readonly manageable: boolean
}

/** New server request. */
export interface AddMcpServerRequest {
  /** Server namespace: letters, digits, `_`, and `-`, at most 32 characters. */
  readonly serverName: string
  readonly transport: McpTransport
  /** stdio: executable. */
  readonly command?: string
  /** stdio: arguments. */
  readonly args?: readonly string[]
  /** stdio: environment variables. */
  readonly env?: Readonly<Record<string, string>>
  /** Streamable HTTP: endpoint URL. */
  readonly url?: string
  /** Streamable HTTP: request headers. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Request addressing one server. */
export interface McpServerRequest {
  /** Loader entry identity. */
  readonly entryId: string
}

/** Enablement change for one server. */
export interface SetMcpServerEnabledRequest {
  readonly entryId: string
  readonly enabled: boolean
}

/** Result of a change that the Host applies to the running profile. */
export interface McpChangeValue {
  /** `applied` when the running Host picked the change up; `restart-required` when a restart applies it. */
  readonly application: 'applied' | 'restart-required' | 'overridden'
  /** Diagnostics the Host reported while applying the change. */
  readonly warnings: readonly string[]
}

/** One value a registry install option needs from the user. */
export interface McpRegistryInput {
  /** Environment variable or header name. */
  readonly name: string
  /** Where the value goes. */
  readonly target: 'env' | 'header'
  readonly description?: string
  readonly required: boolean
  readonly secret: boolean
  /** Value the registry suggests, such as a default or a header template like `Bearer {token}`. */
  readonly value?: string
}

/** One way to run a registry server. */
export interface McpRegistryOption {
  /** `npm`, `pypi`, and `oci` run a package locally over stdio; `remote` connects to a hosted endpoint. */
  readonly kind: 'npm' | 'pypi' | 'oci' | 'remote'
  readonly transport: McpTransport
  /** stdio: executable that runs the package. */
  readonly command?: string
  /** stdio: arguments that run the package. */
  readonly args?: readonly string[]
  /** Streamable HTTP: endpoint URL. */
  readonly url?: string
  /** Values the user supplies. */
  readonly inputs: readonly McpRegistryInput[]
}

/** One server listed by the MCP Registry. */
export interface McpRegistryServer {
  /** Registry name such as `io.github.owner/server`. */
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly version: string
  /** Source repository URL. */
  readonly repository?: string
  readonly websiteUrl?: string
  /** Server name suggested for the configuration entry. */
  readonly suggestedName: string
  /** Supported ways to run the server; empty when every option needs an unsupported transport. */
  readonly options: readonly McpRegistryOption[]
  /** Whether a configured server already uses the suggested name. */
  readonly installed: boolean
}

/** Registry search input. */
export interface SearchMcpRegistryRequest {
  /** Free text; empty lists servers. */
  readonly query: string
  /** Cursor from a previous result. */
  readonly cursor?: string
}

/** Registry search output. */
export interface SearchMcpRegistryValue {
  readonly servers: readonly McpRegistryServer[]
  /** Cursor for the next page. */
  readonly nextCursor?: string
}
