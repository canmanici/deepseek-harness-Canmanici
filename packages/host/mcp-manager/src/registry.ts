/**
 * MCP Registry response parsing: turns registry server entries into the
 * stdio or Streamable HTTP configurations `dsh-mcp-client` accepts.
 * @module
 */

import type { McpRegistryInput, McpRegistryOption, McpRegistryServer } from './types.ts'

/** Server name grammar of `dsh-mcp-client`. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Parse one page of `GET /v0/servers`.
 * @param body - decoded JSON.
 * @param installed - server names already configured.
 * @returns servers with their supported run options, and the next cursor.
 */
export function parseRegistryPage(body: unknown, installed: ReadonlySet<string>): { servers: McpRegistryServer[]; nextCursor?: string } {
  const servers: McpRegistryServer[] = []
  for (const item of records(field(body, 'servers'))) {
    const server = field(item, 'server')
    const name = text(field(server, 'name'))
    if (name === undefined) continue
    const suggestedName = suggestServerName(name)
    const options = [
      ...records(field(server, 'packages')).map(packageOption),
      ...records(field(server, 'remotes')).map(remoteOption),
    ].filter((option): option is McpRegistryOption => option !== undefined)
    const title = text(field(server, 'title'))
    const repository = text(field(field(server, 'repository'), 'url'))
    const websiteUrl = text(field(server, 'websiteUrl'))
    servers.push({
      name,
      ...title === undefined ? {} : { title },
      description: text(field(server, 'description')) ?? '',
      version: text(field(server, 'version')) ?? '',
      ...repository === undefined ? {} : { repository },
      ...websiteUrl === undefined ? {} : { websiteUrl },
      suggestedName,
      options,
      installed: installed.has(suggestedName),
    })
  }
  const nextCursor = text(field(field(body, 'metadata'), 'nextCursor'))
  return { servers, ...nextCursor === undefined ? {} : { nextCursor } }
}

/**
 * Derive a server name from a registry name: its last path segment, cleaned to the client grammar.
 * @param registryName - name such as `io.github.owner/server-name`.
 * @returns a valid server name.
 */
export function suggestServerName(registryName: string): string {
  const leaf = registryName.split('/').at(-1) as string
  const cleaned = leaf.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^mcp-server-|-mcp-server$|^mcp-|-mcp$/gi, '')
  return (cleaned.length === 0 ? 'server' : cleaned).slice(0, 32).replace(/-+$/, '')
}

function packageOption(pkg: Record<string, unknown>): McpRegistryOption | undefined {
  const kind = text(pkg.registryType)
  const identifier = text(pkg.identifier)
  if (identifier === undefined || text(field(pkg.transport, 'type')) !== 'stdio') return undefined
  const version = text(pkg.version)
  const inputs = records(pkg.environmentVariables).map(env => input(env, 'env')).filter((entry): entry is McpRegistryInput => entry !== undefined)
  const extra = records(pkg.packageArguments).flatMap((argument) => {
    const value = text(argument.value) ?? text(argument.default)
    const flag = text(argument.name)
    if (value === undefined) return []
    return text(argument.type) === 'named' && flag !== undefined ? [flag, value] : [value]
  })
  switch (kind) {
    case 'npm':
      return { kind, transport: 'stdio', command: 'npx', args: ['-y', version === undefined ? identifier : `${identifier}@${version}`, ...extra], inputs }
    case 'pypi':
      return { kind, transport: 'stdio', command: 'uvx', args: [version === undefined ? identifier : `${identifier}==${version}`, ...extra], inputs }
    case 'oci':
      return {
        kind,
        transport: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', ...inputs.flatMap(entry => ['-e', entry.name]), version === undefined || identifier.includes(':') ? identifier : `${identifier}:${version}`, ...extra],
        inputs,
      }
    default:
      return undefined
  }
}

function remoteOption(remote: Record<string, unknown>): McpRegistryOption | undefined {
  const url = text(remote.url)
  if (text(remote.type) !== 'streamable-http' || url === undefined) return undefined
  const inputs = records(remote.headers).map(header => input(header, 'header')).filter((entry): entry is McpRegistryInput => entry !== undefined)
  return { kind: 'remote', transport: 'streamable-http', url, inputs }
}

function input(entry: Record<string, unknown>, target: McpRegistryInput['target']): McpRegistryInput | undefined {
  const name = text(entry.name)
  if (name === undefined) return undefined
  const description = text(entry.description)
  const value = text(entry.value) ?? text(entry.default)
  return {
    name,
    target,
    ...description === undefined ? {} : { description },
    required: entry.isRequired === true,
    secret: entry.isSecret === true,
    ...value === undefined ? {} : { value },
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
