/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-integrations-studio`.
 * @module @deepseek-ai/dsh-client-integrations-studio/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-integrations-studio'

/** Cordis companion plugin name. */
export const name = 'client-integrations-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side settings surface whose node half
 * owns no event stream or mutable runtime data; the persisted document and the
 * deployed-skill relation are Host contracts owned by
 * `@deepseek-ai/dsh-integrations-studio` and proven by its REAL-composition
 * boot test.
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
