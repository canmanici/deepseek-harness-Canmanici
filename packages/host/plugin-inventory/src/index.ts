/**
 * Host-side Remote surface over the current Cordis Loader plugin entries:
 * a point-in-time inventory projection plus the one mutation it can own —
 * persisting a per-entry enable/disable override into the installation user
 * patch layer the launcher watches and live-applies.
 */

import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import { TypertRemoteFailure, TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { USER_PATCH_LAYER_KEY } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { parsePatchLayerDocument, upsertEntryPatchRow } from './patch-file.ts'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Stable caller-facing failure codes of this Remote. */
export type PluginInventoryErrorCode =
  | 'internal'
  | 'plugin-entry-not-found'
  | 'plugin-entry-not-patchable'
  | 'patch-layer-rejected'
  | 'plugin-entry-not-applied'

/** Milliseconds between live-apply verification polls. */
const VERIFY_POLL_MS = 200
/**
 * How long setEntryEnabled waits for a live tree to apply an enable before
 * reverting the row: long enough for a cold module load plus entry init, short
 * enough that a stuck activation fails back while the operator still watches.
 */
const VERIFY_TIMEOUT_MS = 10_000

/** @param code - closed failure code carried to the caller unchanged. */
function failure(code: PluginInventoryErrorCode, message: string, details: object = {}): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

/** @returns the error's message without assuming an `Error` instance. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- every wrapped rejection (fs, lock, YAML, lock timeout) is an Error instance */
  return error instanceof Error ? error.message : String(error)
}

/** Remote service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order, plus whether
   * per-entry overrides can be persisted in this deployment and whether they
   * re-apply live.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    const patchLayer = this.ctx.get(USER_PATCH_LAYER_KEY)
    return { entries, writable: patchLayer !== undefined, live: patchLayer?.live === true }
  }

  /**
   * Persist one per-entry enable/disable override into the installation user
   * patch layer. The override is the patch row `{ id: <entry's own config
   * id>, disabled: !enabled }`; the launcher already watches that file and
   * re-applies it onto the running tree (`live` profiles) or on the next
   * boot, so this method never touches the tree itself.
   *
   * The row composes above every layer that configured the entry, so writing
   * `disabled: false` reverts an earlier `disabled: true`.
   *
   * A live enable is transactional: after the write this method waits for the
   * running tree to apply the row, and reverts the file when the entry does
   * not reach `active` in time — a committed-but-unapplied row would
   * otherwise brick the next boot (a pending entry fails boot) or lie about
   * the deployment state. Disables and frozen profiles stay write-only: a
   * dispose is restart-enforced, and a frozen tree has nothing to observe.
   * @param entryId - current non-group Loader entry id (as `list` reports it).
   * @param enabled - effective enablement to persist for the entry.
   * @returns nothing; the commit announcement resolves only after the write.
   * @throws TypertRemoteFailure `internal` when the `userPatchLayer` service is
   * absent (the deployment did not boot through a `dsh` profile launcher) or the host
   * plugin tree exits mid-call; `plugin-entry-not-found` when `entryId` names
   * no current Loader entry; `plugin-entry-not-patchable` when the entry is a
   * group (always enabled) or not a composition row a patch row can target;
   * `patch-layer-rejected` when the patch layer cannot be read, is not a
   * top-level patch-row array, or cannot be written; `plugin-entry-not-applied`
   * when a live enable does not reach `active` in time (the row is reverted;
   * `details.missingServices` names the injected services no running entry
   * provides). The package invariant re-reads the committed file inside the
   * commit announcement and fails loud on any divergence.
   */
  @Remote
  async setEntryEnabled(entryId: PluginEntryId, enabled: boolean): Promise<void> {
    const loader = this.liveLoader()
    const layer = this.ctx.get(USER_PATCH_LAYER_KEY)
    if (layer === undefined) {
      throw failure('internal',
        'userPatchLayer service is absent: this deployment did not boot through a dsh profile launcher, '
        + 'so per-entry overrides have no installation patch layer to persist into',
        { entryId })
    }
    const entry = [...loader.entries()].find(candidate => candidate.id === entryId)
    if (entry === undefined) {
      throw failure('plugin-entry-not-found',
        `"${entryId}" names no current Loader entry; call pluginInventory/list for the current roster`,
        { entryId })
    }
    if (entry.options.group) {
      throw failure('plugin-entry-not-patchable',
        `"${entryId}" is a group entry and groups are always enabled`,
        { entryId })
    }
    // Patch rows match the entry's own config id inside the installation
    // entry list. Only rows mounted by the boot include live there: the
    // entry's tree must be owned by a root-tree entry (the boot include is
    // the only root-tree subtree), so builtin and launcher-created entries
    // are rejected — a patch row for them would warn "entry not found" and
    // silently do nothing. Tree identity reads entry chains, not service
    // identity: context service reads return Cordis traceable proxies.
    const owner = entry.parent.tree.ctx.fiber.entry
    if (owner === undefined || owner.parent.tree.ctx.fiber.entry !== undefined) {
      throw failure('plugin-entry-not-patchable',
        `"${entryId}" is not a composition row of the installation entry list, so a patch row cannot target it`,
        { entryId })
    }
    const row = { id: entry.options.id, disabled: !enabled }
    try {
      await mkdir(dirname(layer.filename), { recursive: true, mode: 0o700 })
    } catch (error: unknown) {
      throw failure('patch-layer-rejected',
        `failed to prepare the directory of patch layer ${layer.filename}: ${messageOf(error)}`,
        { filename: layer.filename, entryId })
    }
    const previousText = await withFileLock<string | undefined>(layer.filename, async () => {
      // The tree can exit while this call waits for the writer lock; persisting
      // on behalf of an exited tree would be a write its caller no longer owns.
      this.liveLoader()
      let text: string | undefined
      try {
        text = await readFile(layer.filename, 'utf8')
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          // An absent layer means "no overrides yet" — the upsert starts one.
        } else {
          throw failure('patch-layer-rejected',
            `failed to read patch layer ${layer.filename}: ${messageOf(error)}`,
            { filename: layer.filename })
        }
      }
      const previous = text
      try {
        const doc = parsePatchLayerDocument(text ?? '')
        const changed = upsertEntryPatchRow(doc, row)
        if (changed) await writeFileAtomic(layer.filename, doc.toString(), { mode: 0o600, dirMode: 0o700 })
      } catch (error: unknown) {
        throw failure('patch-layer-rejected',
          `patch layer ${layer.filename} rejected the override for "${entryId}": ${messageOf(error)}`,
          { filename: layer.filename, entryId })
      }
      // The commit announcement is the durable check when the package
      // invariant is mounted: its listener re-reads the file synchronously
      // and fails loud when the committed file does not carry the row. No
      // announcement follows a verification rollback below: the file then
      // deliberately no longer carries the row.
      this.ctx.emit('plugin-inventory/patch-committed', {
        entryId,
        patchId: row.id,
        enabled,
        filename: layer.filename,
      })
      return previous
    })
    if (enabled && layer.live) {
      await this.verifyLiveEnable(entryId, layer.filename, previousText)
    }
  }

  /**
   * Wait for a live tree to apply an enable, reverting the row when it does
   * not reach `active` in time. The revert restores the exact previous bytes
   * (or removes a row this call appended), so a failed enable can neither
   * brick the next boot nor leave the file disagreeing with the tree.
   * @param entryId - the toggled entry id, re-resolved on every poll: the
   * applying update may replace the entry object itself.
   * @param filename - the patch layer file that received the row.
   * @param previousText - the layer bytes before this call's write, or
   * `undefined` when the call created the file.
   */
  private async verifyLiveEnable(
    entryId: PluginEntryId,
    filename: string,
    previousText: string | undefined,
  ): Promise<void> {
    const started = Date.now()
    let phase: PluginFiberPhase = null
    let missing: string[] = []
    for (;;) {
      const loader = this.liveLoader()
      const current = [...loader.entries()].find(candidate => candidate.id === entryId)
      /* v8 ignore next -- only reachable when a validated entry leaves
      loader.entries() mid-verify; nested loader.remove does not detach walked
      entries (an awaited remove still yields the entry), and root-level rows
      are rejected before verification */
      if (current === undefined) break
      phase = current.fiber === undefined ? null : FIBER_PHASE[current.fiber.state]
      if (!current.disabled && current.fiber?.state === FIBER_STATE.ACTIVE) return
      missing = this.missingServices(current)
      if (Date.now() - started >= VERIFY_TIMEOUT_MS) break
      await new Promise<void>((resolve) => { setTimeout(resolve, VERIFY_POLL_MS) })
    }
    try {
      await withFileLock(filename, async () => {
        this.liveLoader()
        if (previousText === undefined) {
          await rm(filename, { force: true })
        } else {
          await writeFileAtomic(filename, previousText, { mode: 0o600, dirMode: 0o700 })
        }
      })
    } catch (error: unknown) {
      throw failure('internal',
        `enabled "${entryId}" live but failed to revert the unapplied override in ${filename}: ${messageOf(error)}`,
        { filename, entryId })
    }
    const reason = missing.length > 0
      ? `"${entryId}" did not activate live: it waits for services no running entry provides (${missing.join(', ')}) — enable their provider entries first; the override was reverted`
      : `"${entryId}" did not reach active within ${VERIFY_TIMEOUT_MS}ms; the override was reverted`
    throw failure('plugin-entry-not-applied', reason, { entryId, fiberPhase: phase, missingServices: missing })
  }

  /**
   * @returns the injected service names the entry's fiber still waits on:
   * every `inject` key no live service satisfies. Empty for running entries.
   */
  private missingServices(entry: Entry): string[] {
    const fiber = entry.fiber
    /* v8 ignore next -- an enabled-options entry without a fiber exists only
    between Entry.update's option commit and init settlement; no deterministic
    fixture lands the verify poll inside that window */
    if (fiber === undefined) return []
    return Object.keys(fiber.inject).filter(name => this.ctx.get(name) === undefined)
  }

  /**
   * @returns the live Loader, failing when the host tree has exited: every
   * method resolves the Loader at call time, never at mount time.
   */
  private liveLoader(): Loader {
    const loader = this.ctx.get('loader')
    if (loader === undefined) {
      throw failure('internal',
        'host plugin tree exited mid-call; the inventory no longer reflects a live composition')
    }
    return loader
  }
}

export default PluginInventoryGateway
