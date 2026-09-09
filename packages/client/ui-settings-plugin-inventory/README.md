---
description: "Cordis Loader inventory tab in Web Plugins settings for the dsh web client: searchable plugin catalog with per-entry enable/disable toggling, a writability gate, and configuration."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-plugin-inventory` contributes the **Plugin list** tab to the Web Settings Plugins section. The tab lazily calls `ctx.remote.pluginInventory.list()` the first time it is selected and renders a searchable two-column catalog of compact disclosure cards: each collapsed card shows the short module name, an effective-enablement tag, and (for enabled entries) a colored root-fiber status dot; expanding a card reveals the Loader-tree entry id, effective configuration, Cordis status, and the entry's enable/disable action. Disabling requires an explicit confirmation, saving and failure states stay local to the card, a committed toggle refetches the snapshot, and a read-only deployment renders a short hint instead of action buttons. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read can be retried without exposing transport details.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the Plugins section in Settings and select the **Plugin list** tab to inspect the Host's plugin inventory. The tab reads no Remote during plugin activation — selecting it for the first time mounts the component and lazily calls `ctx.remote.pluginInventory.list()` through `api-remotes`.

### Reading a card

Each collapsed card uses the short module name as its title and a small effective-enablement tag; enabled entries also show a colored root-fiber status dot. Expanding one card reveals its Loader-tree entry id, followed by the effective configuration and, for enabled entries, Cordis status; disabled entries omit the redundant unmounted runtime state. Search filters the catalog by name and entry id.

### Retrying a failed read

A failed read renders a generic failure state inside the tab; retrying re-runs the lazy `list()` call without exposing transport details.

### Toggling a plugin entry

Expanding a card in a writable deployment shows an **Enable** or **Disable** action. Disabling is confirm-gated: the button turns into a **Confirm disable**/**Cancel** pair so an accidental click cannot break the deployment. While the write is in flight the card announces progress and disables its controls; a committed toggle refetches the snapshot, keeps the card expanded, and shows a one-line effect hint — a live-reload deployment applies the change immediately, otherwise the change takes effect after the app restarts. A failed write surfaces a card-local alert with a retry control; when the Host reports the entry did not apply live, the alert names the missing services the entry waits on instead. A failed refetch falls back to the tab-level failure state. When `snapshot.writable` is `false`, the tab renders no action buttons and shows a hint explaining that enablement is configured by the deployment (patch file or CLI); the toggle face additionally rejects any call made from a non-writable last-known snapshot.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tab projects a Host-owned snapshot and owns the per-entry toggle; it performs no Remote read during plugin activation and takes the snapshot on first selection.

### Registration

The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. Registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

### Toggle state machine

The tab splits card rendering into a cohesive card component holding the per-card toggle states idle → confirming → saving → refreshed/failed. The apply closure tracks the last-known snapshot writability from its `list()` results and rejects any `setEnabled` call made before a writable snapshot was observed; `tests/invariant.client.spec.ts` exercises both gate arms, since the browser-only relation has no node-side observable stream for an invariant companion to watch.

### Rendering

The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings section, the remote call, and the Host-side projection.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the Plugins section this tab registers into.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.plugins.tab`.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface behind `pluginInventory.list()`.
- [plugin-inventory](../../host/plugin-inventory/README.md) — the Host-side Loader projection this tab renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side inventory projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the inventory view; they are current package constraints.

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
