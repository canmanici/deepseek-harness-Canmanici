/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-integrations-studio`.
 * @module @deepseek-ai/dsh-integrations-studio/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-integrations-studio'

/** Cordis companion plugin name. */
export const name = 'integrations-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the persisted document is a settings-namespace value
 * owned by the settings capability (its schema validation and write queue are
 * that seam's contracts), and the deployed-skill registry relation is proven
 * by the package's REAL-composition boot test rather than an installed
 * observer.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
