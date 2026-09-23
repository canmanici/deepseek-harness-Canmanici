import { describe, expect, it } from 'vitest'
import { parseRegistryPage, suggestServerName } from '../src/registry.ts'

describe('MCP Registry parsing', () => {
  it('maps npm, PyPI, OCI, and Streamable HTTP entries to run options and drops the rest', () => {
    const page = parseRegistryPage({
      servers: [
        {
          server: {
            name: 'io.github.acme/mcp-server-files',
            title: 'Files',
            description: 'Read files',
            version: '1.2.0',
            repository: { url: 'https://github.com/acme/files' },
            websiteUrl: 'https://acme.dev',
            packages: [
              {
                registryType: 'npm', identifier: '@acme/files', version: '1.2.0', transport: { type: 'stdio' },
                environmentVariables: [{ name: 'ROOT', description: 'Folder', isRequired: true }, { name: 'TOKEN', isSecret: true, default: 'x' }, { description: 'nameless' }],
                packageArguments: [{ type: 'positional', value: '/data' }, { type: 'named', name: '--mode', default: 'ro' }, { type: 'named', name: '--flag' }, { type: 'named', value: 'bare' }],
              },
              { registryType: 'pypi', identifier: 'acme-files', transport: { type: 'stdio' } },
              { registryType: 'pypi', identifier: 'acme-files', version: '2.0', transport: { type: 'stdio' } },
              { registryType: 'oci', identifier: 'ghcr.io/acme/files', version: '1.2.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'ROOT' }] },
              { registryType: 'oci', identifier: 'ghcr.io/acme/files:latest', transport: { type: 'stdio' } },
              { registryType: 'npm', identifier: '@acme/unversioned', transport: { type: 'stdio' } },
              { registryType: 'nuget', identifier: 'Acme.Files', transport: { type: 'stdio' } },
              { registryType: 'npm', identifier: '@acme/http', transport: { type: 'streamable-http' } },
              { registryType: 'npm', transport: { type: 'stdio' } },
            ],
            remotes: [
              { type: 'streamable-http', url: 'https://acme.dev/mcp', headers: [{ name: 'Authorization', value: 'Bearer {key}', isRequired: true, isSecret: true }] },
              { type: 'sse', url: 'https://acme.dev/sse' },
              { type: 'streamable-http' },
            ],
          },
        },
        { server: { name: 'com.example/remote-only', remotes: [{ type: 'sse', url: 'https://x' }] } },
        { server: {} },
        'junk',
      ],
      metadata: { nextCursor: 'next' },
    }, new Set(['remote-only']))
    expect(page.nextCursor).toBe('next')
    expect(page.servers).toHaveLength(2)
    const [files, remote] = page.servers
    expect(files).toMatchObject({ name: 'io.github.acme/mcp-server-files', title: 'Files', description: 'Read files', version: '1.2.0', repository: 'https://github.com/acme/files', websiteUrl: 'https://acme.dev', suggestedName: 'files', installed: false })
    expect(files?.options).toEqual([
      {
        kind: 'npm', transport: 'stdio', command: 'npx', args: ['-y', '@acme/files@1.2.0', '/data', '--mode', 'ro', 'bare'],
        inputs: [
          { name: 'ROOT', target: 'env', description: 'Folder', required: true, secret: false },
          { name: 'TOKEN', target: 'env', required: false, secret: true, value: 'x' },
        ],
      },
      { kind: 'pypi', transport: 'stdio', command: 'uvx', args: ['acme-files'], inputs: [] },
      { kind: 'pypi', transport: 'stdio', command: 'uvx', args: ['acme-files==2.0'], inputs: [] },
      { kind: 'oci', transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', '-e', 'ROOT', 'ghcr.io/acme/files:1.2.0'], inputs: [{ name: 'ROOT', target: 'env', required: false, secret: false }] },
      { kind: 'oci', transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', 'ghcr.io/acme/files:latest'], inputs: [] },
      { kind: 'npm', transport: 'stdio', command: 'npx', args: ['-y', '@acme/unversioned'], inputs: [] },
      { kind: 'remote', transport: 'streamable-http', url: 'https://acme.dev/mcp', inputs: [{ name: 'Authorization', target: 'header', required: true, secret: true, value: 'Bearer {key}' }] },
    ])
    expect(remote).toEqual({ name: 'com.example/remote-only', description: '', version: '', suggestedName: 'remote-only', options: [], installed: true })
    expect(parseRegistryPage(null, new Set())).toEqual({ servers: [] })
  })

  it('suggests valid server names', () => {
    expect(suggestServerName('io.github.acme/mcp-server-git')).toBe('git')
    expect(suggestServerName('io.github.acme/git-mcp')).toBe('git')
    expect(suggestServerName('com.example/Weather Tools!')).toBe('Weather-Tools')
    expect(suggestServerName('x/@@@')).toBe('server')
    expect(suggestServerName('x/' + 'a'.repeat(31) + '-b')).toBe('a'.repeat(31))
  })
})
