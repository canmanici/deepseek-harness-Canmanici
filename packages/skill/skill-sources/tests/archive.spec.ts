import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { discoverSkills, extractZip } from '../src/archive.ts'
import { assertFetchable, fetchBytes } from '../src/fetch.ts'
import { skillText, startServer, tempDir, zipOf, type FixtureServer } from './fixtures.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

async function dir(): Promise<string> {
  const temp = await tempDir()
  cleanups.push(temp.cleanup)
  return temp.path
}

const limits = { maxExtractedBytes: 1_000_000, maxFiles: 100 }

describe('extractZip', () => {
  it('strips a shared top directory and keeps only the subdirectory', async () => {
    const target = await dir()
    const zip = zipOf({ 'repo-abc/skills/a/SKILL.md': 'A', 'repo-abc/skills/a/ref.txt': 'R', 'repo-abc/README.md': 'top', 'repo-abc/empty/': '' })
    expect(await extractZip(zip, target, 'skills', limits)).toBe(2)
    expect(await readFile(join(target, 'a', 'ref.txt'), 'utf8')).toBe('R')
  })

  it('keeps archives without a shared top directory intact', async () => {
    const target = await dir()
    expect(await extractZip(zipOf({ 'a/SKILL.md': 'A', 'b.md': 'B' }), target, undefined, limits)).toBe(2)
    expect(await readFile(join(target, 'b.md'), 'utf8')).toBe('B')
  })

  it.each([
    ['parent segments', { 'top/../../escape': 'x' }, 'unsafe path'],
    ['absolute names', { '/etc/passwd': 'x' }, 'unsafe path'],
    ['backslashes', { 'a\\b': 'x' }, 'unsafe path'],
  ])('rejects %s', async (_label, files, message) => {
    await expect(extractZip(zipOf(files), await dir(), undefined, limits)).rejects.toThrow(message)
  })

  it('enforces file-count and size bounds and a missing subdirectory', async () => {
    await expect(extractZip(zipOf({ a: '1', b: '2' }), await dir(), undefined, { ...limits, maxFiles: 1 })).rejects.toThrow('more than 1 files')
    await expect(extractZip(zipOf({ a: '12345' }), await dir(), undefined, { ...limits, maxExtractedBytes: 4 })).rejects.toThrow('beyond 4 bytes')
    await expect(extractZip(zipOf({ 'top/a': '1' }), await dir(), 'missing', limits)).rejects.toThrow('no files below "missing"')
  })
})

describe('discoverSkills', () => {
  it('finds nested skills, stops at skill directories and depth, and reports skipped files', async () => {
    const root = await dir()
    const write = async (path: string, text: string): Promise<void> => {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), text)
    }
    await write('skills/alpha/SKILL.md', skillText('alpha'))
    await write('skills/alpha/nested/SKILL.md', skillText('hidden'))
    await write('skills/beta/SKILL.md', skillText('alpha', 'duplicate'))
    await write('skills/broken/SKILL.md', 'no frontmatter')
    await write('skills/big/SKILL.md', skillText('big', 'x'.repeat(500)))
    await write('a/b/c/d/e/SKILL.md', skillText('too-deep'))
    await write('.hidden/SKILL.md', skillText('dot'))
    const warnings: string[] = []
    const found = await discoverSkills(root, { maxDepth: 4, maxSkillBytes: 200, warn: message => warnings.push(message) })
    expect(found.map(skill => [skill.name, skill.dir])).toEqual([['alpha', 'skills/alpha']])
    expect(warnings).toEqual([
      'skill "alpha" in skills/beta ignored: an earlier directory already provides it',
      'skills/big/SKILL.md ignored: larger than 200 bytes',
      'skills/broken/SKILL.md ignored: missing YAML frontmatter',
    ])
  })

  it('accepts a root that is itself a skill and labels root diagnostics', async () => {
    const root = await dir()
    await writeFile(join(root, 'SKILL.md'), skillText('solo'))
    expect(await discoverSkills(root, { maxDepth: 0, maxSkillBytes: 1000, warn: () => {} })).toMatchObject([{ name: 'solo', dir: '' }])
    const warnings: string[] = []
    await discoverSkills(root, { maxDepth: 0, maxSkillBytes: 1, warn: message => warnings.push(message) })
    expect(warnings).toEqual(['./SKILL.md ignored: larger than 1 bytes'])
    await writeFile(join(root, 'SKILL.md'), 'plain text')
    await discoverSkills(root, { maxDepth: 0, maxSkillBytes: 1000, warn: message => warnings.push(message) })
    expect(warnings.at(-1)).toBe('./SKILL.md ignored: missing YAML frontmatter')
  })
})

describe('fetchBytes', () => {
  let server: FixtureServer
  afterEach(async () => { await server.close() })

  it('reads bodies, follows redirects, and enforces status, size, and protocol policy', async () => {
    server = await startServer()
    server.routes.set('/ok', { body: 'hello' })
    server.routes.set('/moved', { body: '', redirect: '/ok' })
    server.routes.set('/big', { body: 'x'.repeat(100) })
    server.routes.set('/fail', { status: 500, body: 'no' })
    server.routes.set('/empty', { status: 204, body: '' })
    const policy = { maxBytes: 10, timeoutMs: 5000, allowHttpLoopback: true }
    const signal = new AbortController().signal
    expect(new TextDecoder().decode(await fetchBytes(`${server.url}/moved`, {}, policy, signal))).toBe('hello')
    await expect(fetchBytes(`${server.url}/big`, {}, policy, signal)).rejects.toThrow('exceeded 10 bytes')
    await expect(fetchBytes(`${server.url}/fail`, {}, policy, signal)).rejects.toThrow('HTTP 500')
    expect(await fetchBytes(`${server.url}/empty`, {}, policy, signal)).toEqual(new Uint8Array())
    await expect(fetchBytes(`${server.url}/ok`, {}, { ...policy, allowHttpLoopback: false }, signal)).rejects.toThrow('require HTTPS')
  })

  it('checks streamed bodies without a declared length', async () => {
    server = await startServer()
    const policy = { maxBytes: 3, timeoutMs: 5000, allowHttpLoopback: true }
    const original = globalThis.fetch
    globalThis.fetch = async () => {
      const response = new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('ab'))
          controller.enqueue(new TextEncoder().encode('cd'))
          controller.close()
        },
      }))
      Object.defineProperty(response, 'url', { value: `${server.url}/stream` })
      return response
    }
    try {
      await expect(fetchBytes(`${server.url}/stream`, {}, policy, new AbortController().signal)).rejects.toThrow('exceeded 3 bytes')
    } finally {
      globalThis.fetch = original
    }
  })

  it('rejects credentials, non-loopback HTTP, and other schemes', () => {
    server = { close: async () => {} } as FixtureServer
    expect(() => { assertFetchable(new URL('https://u:p@x.io/'), { allowHttpLoopback: true }) }).toThrow('credentials')
    expect(() => { assertFetchable(new URL('http://example.com/'), { allowHttpLoopback: true }) }).toThrow('require HTTPS')
    expect(() => { assertFetchable(new URL('file:///etc/passwd'), { allowHttpLoopback: true }) }).toThrow('refusing file URL')
    expect(() => { assertFetchable(new URL('http://localhost/'), { allowHttpLoopback: true }) }).not.toThrow()
    expect(() => { assertFetchable(new URL('https://example.com/'), { allowHttpLoopback: false }) }).not.toThrow()
  })
})
