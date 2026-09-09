/** Writability gate shared by the entry-toggle face and its invariant coverage. */

/** Snapshot vocabulary the gate reads; `writable` arrives with the Host toggle face. */
export interface WritabilitySource {
  readonly writable?: boolean
}

/** Toggle-face gate over the last-known inventory snapshot writability. */
export interface ToggleGate {
  /** Record the writability of the most recently read snapshot. */
  observe: (snapshot: WritabilitySource) => void
  /**
   * Reject a toggle attempt unless the last observed snapshot was writable.
   * @throws when no snapshot has been observed yet or the last one was read-only.
   */
  assertToggleAllowed: () => void
}

/**
 * Own the "toggling requires a writable last-known snapshot" relation. The
 * browser apply closure drives this gate from its `list()` results; the
 * invariant spec exercises both rejection arms directly.
 * @returns a gate handle observing snapshot writability and rejecting stale or read-only toggles.
 */
export function createToggleGate(): ToggleGate {
  let writable: boolean | null = null
  return {
    observe(snapshot) {
      writable = snapshot.writable !== false
    },
    assertToggleAllowed() {
      if (writable === null) {
        throw new Error('pluginInventory entry toggle rejected: no inventory snapshot has been read')
      }
      if (!writable) {
        throw new Error('pluginInventory entry toggle rejected: the current deployment inventory is not writable')
      }
    },
  }
}
