import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOptionalPatches, USER_PATCH_LAYER_KEY, type UserPatchLayerService } from '@deepseek-ai/dsh-app-boot'
import { remoteMethods, TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginEntryId } from '../src/types.ts'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}
/** Rejects on init, so enabling it exercises activation failure without missing services. */
const brokenPlugin: Plugin.Function = () => {
  throw new Error('broken fixture entry')
}

/** Composition rows the test include mounts, in file order. */
const COMPOSITION = [
  '# composition rows',
  '- id: web',
  '  name: cordis:active',
  '- id: worker',
  '  name: cordis:pending',
  '- id: broken',
  '  name: cordis:broken',
  '  disabled: true',
  '- id: cluster',
  '  name: cordis:group',
  '  group: true',
  '  config:',
  '    - id: inner',
  '      name: cordis:active',
  '',
].join('\n')

/**
 * Seed one patch layer with an existing override row and a `!!js` expression
 * row, both under a comment, so edits must preserve them.
 */
const SEEDED_LAYER = [
  '# user overrides',
  '- id: web',
  '  disabled: true',
  '- id: keep',
  '  config:',
  '    endpoint: !!js "process.env.DSH_X" # preserved',
  '',
].join('\n')

/** Seed disabling the activatable web row, so a toggle can enable it live. */
const SEED_WEB_DISABLED = ['# seed', '- id: web', '  disabled: true', ''].join('\n')

/** Seed disabling the never-activating worker row. */
const SEED_WORKER_DISABLED = ['# seed', '- id: worker', '  disabled: true', ''].join('\n')

interface HarnessOptions {
  /** `false` mounts no `userPatchLayer`; a string seeds the layer file with it. */
  layer?: string | false
  /** Patch-layer live-watch state reported by the mounted service (default true). */
  layerLive?: boolean
  /** Mounts an additional include row inside the composition. */
  nested?: boolean
  /** Overrides the patch layer filename (tests that make the path unusable). */
  filename?: string
}

async function harness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
  layer: UserPatchLayerService
  dir: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-'))
  tempDirs.push(dir)
  const entryFile = join(dir, 'cordis.yml')
  const patchFile = options.filename ?? join(dir, 'cordis.patch.yml')
  const composition = options.nested === true
    ? `${COMPOSITION}- id: nested\n  name: cordis:include\n  config:\n    path: ${pathToFileURL(join(dir, 'nested.yml')).href}\n`
    : COMPOSITION
  await writeFile(entryFile, composition)
  if (options.nested === true) {
    await writeFile(join(dir, 'nested.yml'), '- id: deep\n  name: cordis:active\n')
  }
  if (typeof options.layer === 'string') await writeFile(patchFile, options.layer)
  const layer: UserPatchLayerService = { filename: patchFile, live: options.layerLive !== false }

  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  ctx.loader.builtins.broken = brokenPlugin
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  if (options.layer !== false) ctx.provide(USER_PATCH_LAYER_KEY, layer)
  const includeEntry: EntryOptions = {
    id: 'include',
    name: 'cordis:include',
    config: { path: pathToFileURL(entryFile).href },
  }
  await ctx.loader.create(includeEntry)
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory, layer, dir }
}

/** @returns the stable failure `promise` rejects with, failing the test when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<TypertRemoteFailure> {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof TypertRemoteFailure) return error
    throw error
  }
  throw new Error('expected the Remote call to reject')
}

/** Assert one rejection carries the expected stable code and message fragment. */
async function expectFailure(promise: Promise<unknown>, code: string, messagePart: string): Promise<void> {
  const failure = await rejectionOf(promise)
  expect(failure.failure.code).toBe(code)
  expect(failure.failure.message).toContain(messagePart)
}

/**
 * Compose the patch layer over the test composition with the launcher's own
 * parser and patch semantics, so every row assertion is about the state a
 * reload would actually apply.
 * @param layerFile - the patch layer path.
 * @returns the composed entry rows.
 */
function composedRows(layerFile: string): EntryOptions[] {
  const base: EntryOptions[] = [
    { id: 'web', name: 'cordis:active' },
    { id: 'worker', name: 'cordis:pending' },
    { id: 'keep', name: 'cordis:active' },
  ]
  const patches = loadOptionalPatches('plugin-inventory test', layerFile)
  const warn: string[] = []
  const composed = applyEntryPatches(structuredClone(base), patches, message => warn.push(message))
  expect(warn).toEqual([])
  return composed
}

/** Poll until the predicate holds, failing with message after a bounded wait. */
async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
}

/**
 * Stand in for the launcher's patch watch: apply the layer file onto the
 * test include through the real parser and patch semantics. The chokidar
 * trigger itself belongs to app-boot's watchUserPatches coverage.
 */
async function applyLayerFile(ctx: Context, layerFile: string): Promise<void> {
  const rows = loadOptionalPatches('plugin-inventory test', layerFile) ?? []
  const include = ctx.loader.resolve('include')
  await include.update({ config: { path: include.options.config.path, patches: rows } })
}

describe('PluginInventoryGateway', () => {
  it('publishes list and setEntryEnabled under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory).map(method => method.method)).toEqual(
      expect.arrayContaining(['list', 'setEntryEnabled']),
    )
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.writable).toBe(true)
    expect(snapshot.live).toBe(true)
    // The boot include's composition rows, the include entry itself, and the
    // created rows all project; the created group row and the composition's
    // own group row do not.
    expect(snapshot.entries.map(entry => entry.entryId)).toEqual(expect.arrayContaining([
      activeId, pendingId, disabledId, 'include', 'include:web', 'include:worker', 'include:inner',
    ]))
    expect(snapshot.entries.some(entry => entry.moduleName === 'cordis:group')).toBe(false)
    expect(snapshot.entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: true,
      fiberPhase: 'active',
    })
    expect(snapshot.entries.find(entry => entry.entryId === pendingId)).toEqual({
      entryId: pendingId,
      moduleName: 'cordis:pending',
      enabled: true,
      fiberPhase: 'pending',
    })
    expect(snapshot.entries.find(entry => entry.entryId === disabledId)).toEqual({
      entryId: disabledId,
      moduleName: 'cordis:not-installed',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('reports the snapshot unwritable without the user patch layer', async () => {
    const { inventory } = await harness({ layer: false })
    expect(inventory.list().writable).toBe(false)
    expect(inventory.list().live).toBe(false)
    const compositionIds = inventory.list().entries.map(entry => entry.entryId)
    expect(compositionIds).toEqual(expect.arrayContaining(['include:web', 'include:inner']))
  })

  it('reports the patch watch as non-live when the launch service says so', async () => {
    const { inventory } = await harness({ layerLive: false })
    const snapshot = inventory.list()
    expect(snapshot.writable).toBe(true)
    expect(snapshot.live).toBe(false)
  })

  it('appends the override row and leaves comments and !!js scalars untouched', async () => {
    const { ctx, inventory, layer } = await harness({ layer: SEEDED_LAYER })
    const commits: unknown[] = []
    ctx.on('plugin-inventory/patch-committed', (commit) => { commits.push(commit) })

    await inventory.setEntryEnabled('include:worker' as PluginEntryId, false)

    const layerText = await readFile(layer.filename, 'utf8')
    expect(layerText).toContain('# user overrides')
    expect(layerText).toContain('endpoint: !!js "process.env.DSH_X" # preserved')
    expect(layerText).toContain('- id: worker')
    expect(layerText).toContain('disabled: true')
    // The composed result must actually disable the row the patch targets.
    expect(composedRows(layer.filename).find(row => row.id === 'worker')?.disabled).toBe(true)
    expect(commits).toEqual([
      { entryId: 'include:worker', patchId: 'worker', enabled: false, filename: layer.filename },
    ])
  })

  it('updates an existing override row in place', async () => {
    const { inventory, layer } = await harness({ layer: SEEDED_LAYER })
    await inventory.setEntryEnabled('include:web' as PluginEntryId, true)
    const layerText = await readFile(layer.filename, 'utf8')
    expect(layerText).toContain('# user overrides')
    expect(layerText).toContain('endpoint: !!js "process.env.DSH_X" # preserved')
    expect(composedRows(layer.filename).find(row => row.id === 'web')?.disabled).toBe(false)
  })

  it('rewriting the same state leaves the file byte-identical', async () => {
    const { inventory, layer } = await harness({ layer: SEEDED_LAYER })
    await inventory.setEntryEnabled('include:web' as PluginEntryId, true)
    const before = await readFile(layer.filename, 'utf8')
    await inventory.setEntryEnabled('include:web' as PluginEntryId, true)
    expect(await readFile(layer.filename, 'utf8')).toBe(before)
  })

  it('serializes concurrent overrides so both rows survive', async () => {
    const { inventory, layer } = await harness()
    await Promise.all([
      inventory.setEntryEnabled('include:web' as PluginEntryId, false),
      inventory.setEntryEnabled('include:worker' as PluginEntryId, false),
    ])
    const composed = composedRows(layer.filename)
    expect(composed.find(row => row.id === 'web')?.disabled).toBe(true)
    expect(composed.find(row => row.id === 'worker')?.disabled).toBe(true)
  })

  it('rejects unknown, group, and non-composition entries', async () => {
    const { inventory, layer } = await harness()
    await expectFailure(inventory.setEntryEnabled('include:ghost' as PluginEntryId, false),
      'plugin-entry-not-found', '"include:ghost"')
    await expectFailure(inventory.setEntryEnabled('include:cluster' as PluginEntryId, false),
      'plugin-entry-not-patchable', 'group')
    // The boot include itself and loader-created entries live in the root
    // tree, where a patch row can never reach them.
    await expectFailure(inventory.setEntryEnabled('include' as PluginEntryId, false),
      'plugin-entry-not-patchable', 'composition row')
    expect(await readFileOrEmpty(layer.filename)).toBe('')
  })

  it('rejects entries mounted by a nested include inside the composition', async () => {
    const { inventory, layer } = await harness({ nested: true })
    const ids = inventory.list().entries.map(entry => entry.entryId)
    expect(ids).toContain('include:nested:deep')
    await expectFailure(inventory.setEntryEnabled('include:nested:deep' as PluginEntryId, false),
      'plugin-entry-not-patchable', 'composition row')
    expect(await readFileOrEmpty(layer.filename)).toBe('')
  })

  it('fails loud when the user patch layer service is absent', async () => {
    const { inventory } = await harness({ layer: false })
    await expectFailure(inventory.setEntryEnabled('include:web' as PluginEntryId, false),
      'internal', 'userPatchLayer service is absent')
  })

  it('fails loud when the patch layer is misshapen, unparseable, or unreadable', async () => {
    const { inventory } = await harness({ layer: 'id: web\n' })
    await expectFailure(inventory.setEntryEnabled('include:web' as PluginEntryId, false),
      'patch-layer-rejected', 'top-level YAML array')
    const { inventory: scalarRows } = await harness({ layer: '- a bare scalar row\n- id: web\n' })
    await expectFailure(scalarRows.setEntryEnabled('include:web' as PluginEntryId, false),
      'patch-layer-rejected', 'must be a mapping')
    const { inventory: unparseable } = await harness({ layer: '- id: web\n  disabled: [unclosed\n' })
    await expectFailure(unparseable.setEntryEnabled('include:web' as PluginEntryId, false),
      'patch-layer-rejected', 'rejected the override')
    const { inventory: unreadable, layer: unreadableLayer } = await harness({ filename: join(tmpdir(), 'dsh-plugin-inventory-unreadable') })
    await mkdir(unreadableLayer.filename, { recursive: true })
    await expectFailure(unreadable.setEntryEnabled('include:web' as PluginEntryId, false),
      'patch-layer-rejected', `failed to read patch layer ${unreadableLayer.filename}`)
  })

  it('fails loud when the patch layer file cannot be created', async () => {
    const { dir } = await harness()
    await writeFile(join(dir, 'blocker'), 'x')
    const { inventory: blocked } = await harness({ filename: join(dir, 'blocker', 'cordis.patch.yml') })
    await expectFailure(blocked.setEntryEnabled('include:web' as PluginEntryId, false),
      'patch-layer-rejected', 'failed to prepare the directory')
  })

  it('rejects the whole call when the host tree exits before the write', async () => {
    const { ctx, inventory, layer } = await harness()
    await ctx.fiber.dispose()
    await expectFailure(inventory.setEntryEnabled('include:web' as PluginEntryId, false),
      'internal', 'host plugin tree exited mid-call')
    expect(await readFileOrEmpty(layer.filename)).toBe('')
  })

  it('aborts the write when the host tree exits while waiting for the writer lock', async () => {
    const { ctx, inventory, layer } = await harness()
    await writeFile(`${layer.filename}.lock`, 'held\n', { flag: 'wx' })
    const pending = inventory.setEntryEnabled('include:web' as PluginEntryId, false)
    await new Promise(resolve => setTimeout(resolve, 100))
    await ctx.fiber.dispose()
    await rm(`${layer.filename}.lock`, { force: true })
    await expectFailure(pending, 'internal', 'host plugin tree exited mid-call')
    expect(await readFileOrEmpty(layer.filename)).toBe('')
  })

  it('verifies a live enable against the applying tree', { timeout: 20_000 }, async () => {
    const webId = 'include:web' as PluginEntryId
    const { ctx, inventory, layer } = await harness({ layer: SEED_WEB_DISABLED })
    await applyLayerFile(ctx, layer.filename)
    await eventually(() => {
      const entry = inventory.list().entries.find(candidate => candidate.entryId === webId)
      return entry?.enabled === false
    }, 'seeded disable was not applied to the tree')
    const call = inventory.setEntryEnabled(webId, true)
    // Let the verify loop observe the still-disabled tree before driving the apply.
    await new Promise((resolve) => { setTimeout(resolve, 600) })
    await applyLayerFile(ctx, layer.filename)
    await call
    expect(inventory.list().entries.find(candidate => candidate.entryId === webId))
      .toMatchObject({ enabled: true, fiberPhase: 'active' })
    expect(composedRows(layer.filename)).toContainEqual({ id: 'web', name: 'cordis:active', disabled: false })
  })

  it('reverts the appended row when a live enable never activates', { timeout: 20_000 }, async () => {
    const workerId = 'include:worker' as PluginEntryId
    const { inventory, layer } = await harness()
    const failure = await rejectionOf(inventory.setEntryEnabled(workerId, true))
    expect(failure.failure.code).toBe('plugin-entry-not-applied')
    expect(failure.failure.details).toMatchObject({ entryId: workerId, missingServices: ['neverReady'] })
    expect(existsSync(layer.filename)).toBe(false)
  })

  it('restores the previous row when a live enable never activates', { timeout: 20_000 }, async () => {
    const workerId = 'include:worker' as PluginEntryId
    const { inventory, layer } = await harness({ layer: SEED_WORKER_DISABLED })
    const failure = await rejectionOf(inventory.setEntryEnabled(workerId, true))
    expect(failure.failure.code).toBe('plugin-entry-not-applied')
    expect(composedRows(layer.filename)).toContainEqual({ id: 'worker', name: 'cordis:pending', disabled: true })
  })

  it('reports the failure without missing services when activation itself rejects', { timeout: 20_000 }, async () => {
    const brokenId = 'include:broken' as PluginEntryId
    const { ctx, inventory, layer } = await harness()
    const call = inventory.setEntryEnabled(brokenId, true)
    await eventually(() => existsSync(layer.filename), 'override row was not written')
    // The tree rejects the broken enable loudly; the toggle still waits out
    // the verify window and then reverts the row.
    await expect(applyLayerFile(ctx, layer.filename)).rejects.toThrow()
    const failure = await rejectionOf(call)
    expect(failure.failure.code).toBe('plugin-entry-not-applied')
    expect(failure.failure.details).toMatchObject({ entryId: brokenId, missingServices: [] })
    expect(existsSync(layer.filename)).toBe(false)
  })

  it('reports internal when the layer directory vanishes before the revert', { timeout: 20_000 }, async () => {
    const workerId = 'include:worker' as PluginEntryId
    const { inventory, layer, dir } = await harness({ layer: SEED_WORKER_DISABLED })
    const call = inventory.setEntryEnabled(workerId, true)
    await eventually(
      () => existsSync(layer.filename) && readFileSync(layer.filename, 'utf8').includes('disabled: false'),
      'override row was not written',
    )
    await rm(dir, { recursive: true, force: true })
    await expectFailure(call, 'internal', 'revert')
  })

  it('reports internal when the host tree exits mid-verify', async () => {
    const { ctx, inventory } = await harness()
    setTimeout(() => {
      try {
        void Promise.resolve(ctx.fiber.dispose()).catch(() => {})
      } catch {
        // Disposal races the call; either order ends the tree.
      }
    }, 0)
    await expectFailure(inventory.setEntryEnabled('include:worker' as PluginEntryId, true),
      'internal', 'exited')
  })

  it('skips verification for frozen profiles', async () => {
    const webId = 'include:web' as PluginEntryId
    const { ctx, inventory, layer } = await harness({ layer: SEED_WEB_DISABLED, layerLive: false })
    await applyLayerFile(ctx, layer.filename)
    await eventually(() => {
      const entry = inventory.list().entries.find(candidate => candidate.entryId === webId)
      return entry?.enabled === false
    }, 'seeded disable was not applied to the tree')
    // No apply is driven after the toggle: resolving with the row written
    // while the tree still reports disabled proves no verification ran.
    await inventory.setEntryEnabled(webId, true)
    expect(composedRows(layer.filename)).toContainEqual({ id: 'web', name: 'cordis:active', disabled: false })
    expect(inventory.list().entries.find(candidate => candidate.entryId === webId)?.enabled).toBe(false)
  })
})

/** @returns the file's text, or the empty string when it does not exist yet. */
async function readFileOrEmpty(filename: string): Promise<string> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return ''
    throw error
  }
}
