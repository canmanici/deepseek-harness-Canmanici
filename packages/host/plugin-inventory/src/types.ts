import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/**
 * Point-in-time inventory returned by the plugin inventory Remote.
 */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /**
   * Whether `pluginInventory/setEntryEnabled` can persist overrides in this
   * deployment: true only when the launcher provided the installation user
   * patch layer (`userPatchLayer` service).
   */
  readonly writable: boolean
  /**
   * Whether the watched patch layer re-applies live. True means a committed
   * toggle takes effect immediately; false means it requires an application
   * restart. Only meaningful when `writable` is true.
   */
  readonly live: boolean
}

/** One committed per-entry enable/disable override, announced after the patch layer write resolves. */
export interface PluginPatchCommitted {
  /** Loader entry id the override targets (the caller-facing branded identity). */
  readonly entryId: string
  /** Patch-row id written into the patch layer (the entry's own config id). */
  readonly patchId: string
  /** Requested effective enablement; the row carries `disabled: !enabled`. */
  readonly enabled: boolean
  /** Absolute path of the patch layer file that received the row. */
  readonly filename: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A per-entry enable/disable override was committed to the installation
     * user patch layer, emitted strictly after the write. The package
     * invariant re-parses the committed file inside this announcement and
     * fails loud when it does not carry the requested row.
     * @param commit - target entry, patch-row id, requested state, and the file that received the row.
     * @mode emit
     */
    'plugin-inventory/patch-committed'(commit: PluginPatchCommitted): void
  }
}
