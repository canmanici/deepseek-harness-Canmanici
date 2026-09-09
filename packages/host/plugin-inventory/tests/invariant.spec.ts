import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import * as PluginInventoryInvariant from '../src/invariant.ts'
import type { PluginPatchCommitted } from '../src/types.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const invariantViolation: unknown = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@deepseek-ai/dsh-host-plugin-inventory',
})

const LAYER = [
  '# user overrides',
  '- id: web',
  '  disabled: true',
  '- id: keep',
  '  config:',
  '    endpoint: !!js "process.env.DSH_X" # preserved',
  '',
].join('\n')

async function setup(layerText = LAYER): Promise<{ ctx: Context; filename: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-invariant-'))
  tempDirs.push(dir)
  const filename = join(dir, 'cordis.patch.yml')
  if (layerText !== '') await writeFile(filename, layerText)
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  const fiber = ctx.plugin(PluginInventoryInvariant)
  await expect(fiber.await()).resolves.toBeDefined()
  return { ctx, filename }
}

function commit(filename: string, overrides: Partial<PluginPatchCommitted> = {}): PluginPatchCommitted {
  return {
    entryId: 'include:web',
    patchId: 'web',
    enabled: false,
    filename,
    ...overrides,
  }
}

describe('plugin-inventory invariant companion', () => {
  it('registers and re-registers the package-owned installer', async () => {
    const { ctx } = await setup('')
    await ctx.fiber.dispose()
  })

  it('accepts a commit whose file re-parses to the requested override row', () => {
    return setup().then(({ ctx, filename }) => {
      expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(filename)) }).not.toThrow()
      expect(() => {
        ctx.emit('plugin-inventory/patch-committed', commit(filename, {
          entryId: 'include:keep',
          patchId: 'keep',
          enabled: true,
        }))
      }).toThrow(invariantViolation)
    })
  })

  it('rejects a commit whose row carries a different disabled value', async () => {
    const { ctx, filename } = await setup()
    expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(filename, { enabled: true })) })
      .toThrow(invariantViolation)
  })

  it('rejects a commit for a row the file does not carry', async () => {
    const { ctx, filename } = await setup()
    expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(filename, { entryId: 'include:ghost', patchId: 'ghost' })) })
      .toThrow(invariantViolation)
  })

  it('rejects a commit whose file is unreadable, unparseable, or not a patch-row list', async () => {
    const { ctx, filename } = await setup('id: web\n')
    expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(filename)) }).toThrow(invariantViolation)
    await writeFile(filename, '- id: web\n  disabled: [unclosed\n')
    expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(filename)) }).toThrow(invariantViolation)
    const missing = join(filename, '.absent')
    expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(missing)) }).toThrow(invariantViolation)
  })

  it('preserves comments and !!js scalars when checking the committed file', async () => {
    const { ctx, filename } = await setup()
    expect(() => { ctx.emit('plugin-inventory/patch-committed', commit(filename)) }).not.toThrow()
    expect(await readFile(filename, 'utf8')).toBe(LAYER)
  })
})
