import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
const binScript = fileURLToPath(new URL('./fixtures/skill-preferences/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/skill-preferences/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

async function writeSkill(cwd: string, name: string, description: string): Promise<void> {
  const dir = join(cwd, '.dsh', 'skills', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${description} body.\n`)
}

describe('skill preferences assembled snapshot', () => {
  it('omits disabled skills from the catalog and loader and applies toggles through the shipped app', async () => {
    const run = await runLoaderSmoke({
      label: 'skill preferences snapshot',
      tempDirPrefix: 'headless-snapshot-skill-preferences-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      prepare: async (cwd) => {
        await mkdir(join(cwd, '.git'))
        await writeSkill(cwd, 'alpha-notes', 'Write alpha notes.')
        await writeSkill(cwd, 'beta-notes', 'Write beta notes.')
        await writeFile(join(cwd, '.dsh', 'skill-preferences.json'), JSON.stringify({
          version: 1,
          global: { disabled: ['beta-notes'] },
          projects: {},
        }))
      },
    })

    expect(run.stderr).toBe('')
    type Observation = { catalog: Array<{ text: string }> }
    const snapshot = JSON.parse(run.stdout) as { initial: Observation; toggled: Observation }
    expect(snapshot).toMatchObject({
      initial: { loads: { 'alpha-notes': true, 'beta-notes': false } },
      toggled: { loads: { 'alpha-notes': false, 'beta-notes': true } },
    })
    expect(snapshot.initial.catalog[0]?.text).toContain('- `alpha-notes`: Write alpha notes.')
    expect(snapshot.initial.catalog[0]?.text).not.toContain('beta-notes')
    expect(snapshot.toggled.catalog[0]?.text).toContain('- `beta-notes`: Write beta notes.')
    expect(snapshot.toggled.catalog[0]?.text).not.toContain('alpha-notes')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
