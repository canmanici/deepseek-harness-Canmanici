/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-settings-plugin-inventory/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-plugin-inventory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the entry-toggle writability relation is enforced by
 * the browser apply closure over its own `list()` results (src/client/
 * toggle-gate.ts), a client-tree mutable state this node-side companion
 * cannot observe; tests/invariant.client.spec.ts exercises both gate arms.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
