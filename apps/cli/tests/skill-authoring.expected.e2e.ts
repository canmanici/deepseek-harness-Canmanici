import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
const binScript = fileURLToPath(new URL('./fixtures/skill-authoring/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/skill-authoring/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('skill authoring assembled snapshot', () => {
  it('creates a user skill through skillManager that the model catalog and skill tool load, then deletes it', async () => {
    const run = await runLoaderSmoke({
      label: 'skill authoring snapshot',
      tempDirPrefix: 'headless-snapshot-skill-authoring-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
    })
    expect(run.stderr).toBe('')
    type Output = {
      created: { path: string }
      catalog: Array<{ text: string }>
      loaded: { isError?: boolean; content: Array<{ text: string }> }
      editable: boolean
      afterDelete: { isError?: boolean }
    }
    const output = JSON.parse(run.stdout) as Output
    expect(output.created.path).toMatch(/\.dsh\/skills\/gui-notes\/SKILL\.md$/)
    expect(output.catalog[0]?.text).toContain('- `gui-notes`: Write notes created from the Settings page.')
    expect(output.loaded.isError).not.toBe(true)
    expect(output.loaded.content[0]?.text).toContain('GUI-authored body.')
    expect(output.editable).toBe(true)
    expect(output.afterDelete.isError).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
