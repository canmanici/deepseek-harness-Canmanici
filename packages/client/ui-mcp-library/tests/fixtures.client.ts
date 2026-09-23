import type { ManagedMcpServer, McpRegistryServer } from '@deepseek-ai/dsh-api-remotes/client'

/** One configured server. */
export function server(overrides: Loose<ManagedMcpServer> = {}): ManagedMcpServer {
  return defined<ManagedMcpServer>({
    entryId: 'e-docs',
    serverName: 'docs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@acme/docs'],
    envNames: ['TOKEN'],
    headerNames: [],
    enabled: true,
    manageable: true,
    state: 'connected',
    tools: ['mcp__docs__read', 'mcp__docs__search', 'other'],
    ...overrides,
  })
}

/** One registry server with an npm and a remote option. */
export function registryServer(overrides: Loose<McpRegistryServer> = {}): McpRegistryServer {
  return defined<McpRegistryServer>({
    name: 'io.github.acme/files',
    title: 'Files',
    description: 'Read files',
    version: '1.0.0',
    repository: 'https://github.com/acme/files',
    suggestedName: 'files',
    installed: false,
    options: [
      { kind: 'npm', transport: 'stdio', command: 'npx', args: ['-y', '@acme/files@1.0.0'], inputs: [{ name: 'ROOT', target: 'env', required: true, secret: false, description: 'Folder' }] },
      { kind: 'remote', transport: 'streamable-http', url: 'https://acme.dev/mcp', inputs: [{ name: 'Authorization', target: 'header', required: true, secret: true, value: 'Bearer {key}' }] },
    ],
    ...overrides,
  })
}

/** Overrides that may set an optional field to `undefined` to drop it. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined }

function defined<T extends object>(value: Loose<T>): T {
  const copy = { ...value }
  for (const key of Object.keys(copy) as Array<keyof T>) {
    if (copy[key] === undefined) Reflect.deleteProperty(copy, key)
  }
  return copy as T
}
