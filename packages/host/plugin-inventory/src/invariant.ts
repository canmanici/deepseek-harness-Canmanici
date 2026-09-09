/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-plugin-inventory`:
 * every `plugin-inventory/patch-committed` announcement must agree with the
 * durable patch layer it names — the file re-parses (in the dialect the
 * launcher boots) to exactly the override row the commit claims. A mismatch
 * means a write path resolved or serialized the row differently than the
 * commit reports.
 * @module @deepseek-ai/dsh-host-plugin-inventory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { PluginPatchCommitted } from './types.ts'
import { patchLayerRowMismatch } from './patch-file.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-inventory'

/** Cordis companion plugin name. */
export const name = 'host-plugin-inventory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install the patch-committed announcement ↔ durable patch-row agreement check. */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure): void => {
  ctx.on('plugin-inventory/patch-committed', (commit: PluginPatchCommitted) => {
    const mismatch = patchLayerRowMismatch(commit.filename, { id: commit.patchId, disabled: !commit.enabled })
    if (mismatch !== undefined) fail(mismatch)
  }, { global: true })
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
