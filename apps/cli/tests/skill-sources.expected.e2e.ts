import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
const binScript = fileURLToPath(new URL('./fixtures/skill-sources/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/skill-sources/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const COMMIT = 'c'.repeat(40)

describe('skill sources assembled snapshot', () => {
  it('syncs a GitHub source through the shipped app and exposes its skills to the model', async () => {
    const zip = zipSync({
      [`fixture-skills-${COMMIT.slice(0, 7)}/skills/remote-notes/SKILL.md`]: strToU8('---\nname: remote-notes\ndescription: Write notes from a remote source.\n---\n\nRemote notes body.\n'),
      [`fixture-skills-${COMMIT.slice(0, 7)}/README.md`]: strToU8('# fixture'),
    })
    const server = createServer((request, response) => {
      if (request.url === '/repos/fixture/skills/commits/HEAD') response.end(COMMIT)
      else if (request.url === `/repos/fixture/skills/zipball/${COMMIT}`) response.end(zip)
      else response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    try {
      const { port } = server.address() as AddressInfo
      const run = await runLoaderSmoke({
        label: 'skill sources snapshot',
        tempDirPrefix: 'headless-snapshot-skill-sources-',
        binScript,
        libBinScript: binScript,
        configPath,
        tsconfigPath,
        env: { DSH_TEST_GITHUB_API: `http://127.0.0.1:${port}` },
      })
      expect(run.stderr).toBe('')
      type Output = {
        before: Array<{ sync: { state: string } }>
        synced: { sync: { state: string; commit: string; skillCount: number } }
        catalog: Array<{ text: string }>
        result: { isError?: boolean; content: Array<{ text: string }> }
        afterDisable: string[]
      }
      const output = JSON.parse(run.stdout) as Output
      expect(output.before).toMatchObject([{ id: 'fixture-skills', origin: 'default', sync: { state: 'never' } }])
      expect(output.synced.sync).toMatchObject({ state: 'ok', commit: COMMIT, skillCount: 1 })
      expect(output.catalog[0]?.text).toContain('- `remote-notes`: Write notes from a remote source.')
      expect(output.result.isError).not.toBe(true)
      expect(output.result.content[0]?.text).toContain('Remote notes body.')
      expect(output.afterDisable).not.toContain('remote-notes')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
