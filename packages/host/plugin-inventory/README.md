---
description: "Loader plugin state Remote for web GUI host clients: read the current pluginInventory inventory and persist per-entry enable/disable overrides into the installation user patch layer."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

## Summary

Clients and settings pages can show what is currently composed in the host and toggle plugin entries: calling `pluginInventory/list` returns the current non-group Loader entries in Loader order — entry id, module specifier, effective enablement, and root Fiber phase (`pending`, `loading`, `active`, `failed`, or `unloading`, or `null` when an entry has no live root Fiber) — plus whether this deployment accepts per-entry overrides at all and whether the watched patch layer re-applies live. Calling `pluginInventory/setEntryEnabled` persists one override as a patch row in the installation user patch layer (`$DSH_HOME/cordis.patch.yml`), which the launcher already watches and live-applies. The inventory itself stays point-in-time: the Loader is the sole lifecycle authority, and this package owns no cache, history, or provenance model. Client packages consume the Remote through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

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

Call `pluginInventory/list` when a client or settings page needs to show what is currently composed in the host — which plugins are loaded, enabled, and alive — and `pluginInventory/setEntryEnabled` to persist an operator's enable/disable choice for one entry. The Remote is the only entry point: the service is Remote-only and deliberately declares no same-process Cordis `Context` merge.

### What a snapshot contains

Each row is one non-group Loader entry: its entry id, the exact module specifier, the effective enablement (including disabled ancestor groups), and the current root Fiber phase. `pending` means the entry waits to load, `loading` that it is being read, `active` that it is running, `failed` that its fiber rejected, and `unloading` that it is being torn down; `null` means no live root Fiber exists at all. Structural group rows are skipped. `writable` is `true` only when the launcher provided the `userPatchLayer` service — deployments not booted through a `dsh` profile report `false` and reject `setEntryEnabled`. `live` mirrors that service's patch-watch state: `true` means a committed toggle applies immediately, `false` that it needs an app restart.

### What you can and cannot do with it

The inventory is a snapshot for display and diagnostics: a client can render the roster, flag failed entries, and detect changes by comparing snapshots. `setEntryEnabled(entryId, enabled)` persists one per-entry override; it cannot add, remove, rename, or reconfigure plugins, and it never touches the running tree itself — the launcher's existing user patch-layer watch re-applies the file (`live` profiles) or the next boot picks it up, so a frozen profile changes state on restart only. A live enable is transactional: the call waits for the tree to apply the row and reverts the file when the entry does not reach `active` in time, reporting `plugin-entry-not-applied` with the injected services no running entry provides (`details.missingServices`); disables and frozen profiles stay write-only. The Remote carries no history — a fiber that already failed and was removed is absent. Because the service reads the Loader on every call, the answer always reflects the current composition rather than a cached view.

### How the override is persisted

`setEntryEnabled` resolves the entry in the current Loader, then upserts the patch row `{ id: <the entry's own config id>, disabled: !enabled }` into the file the `userPatchLayer` service names. Composition rows carry scoped Loader entry ids (`include:<row id>`), while patch rows match the row's own config id — the service maps between the two and rejects every entry a patch row cannot target (the boot include itself, launcher-created entries, nested-include rows, and group entries, which are always enabled). The row is written under a cross-process file lock with an atomic rename, comments and `!!js` expression scalars in the file survive untouched, rewriting the requested state twice is a no-op, and the row composes above every layer that configured the entry, so writing `disabled: false` reverts an earlier `disabled: true`. Every commit announces `plugin-inventory/patch-committed`, and the package invariant re-parses the committed file and fails loud when it does not carry the requested row.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The gateway is a direct projection with no second lifecycle truth: every `list()` call reads `ctx.loader.entries()` and maps each non-group entry to its public row. Cordis's internal plugin/status events already maintain `Entry.fiber` and `Fiber.state`, so a cache would only add another lifecycle truth to keep synchronized.

### The phase mapping

Fiber states map onto the public phase vocabulary, with `disposed` folding into `null` — an entry whose fiber is gone has no live root to report. The phase therefore never distinguishes why no live root exists: the entry may never have started, or its fiber may already have been disposed.

### The override write path

`setEntryEnabled` never mutates the tree: it is a durable-file operation the launcher's own patch mechanics already know how to apply. The patch layer is edited through the `yaml` package's document API with a pass-through `!!js` scalar tag, so a user file's comments and expression values round-trip unchanged; the edit runs inside `@deepseek-ai/dsh-atomic-write`'s file lock and atomic rename. The one mutation the Remote exposes is deliberately narrow: an enable/disable toggle of an existing composition row.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`: the `pluginInventory` Remote service, the Loader projection, and the override write path |
| [`src/patch-file.ts`](src/patch-file.ts) | Comment- and `!!js`-preserving patch-layer parsing, row upsert, and the committed-row check |
| [`src/types.ts`](src/types.ts) | Public payload types: `PluginInventoryEntry`, `PluginInventorySnapshot`, `PluginFiberPhase`, `PluginPatchCommitted` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: every `plugin-inventory/patch-committed` announcement must agree with the committed patch layer |

Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the inventory contract is not enough: how the Remote reaches clients, the patch mechanics the override rides on, then the Loader it projects and the surface that renders it.

- [Remote assembly](../../api/remotes/README.md) — how clients consume `pluginInventory/list` and `pluginInventory/setEntryEnabled` without importing the Host implementation.
- [App boot](../../boot/app-boot/README.md) — the user patch layers, their parse dialect, and the live `watchUserPatches` reconciliation the override file rides on.
- [Cordis plugin loader](../../../vendor/loader/README.md) — the Loader whose entries this package projects.
- [Plugin inventory settings surface](../../client/ui-settings-plugin-inventory/README.md) — the browser-side projection that renders the inventory.

-----

<a id="model-experience"></a>
## Model Experience

None, as the Loader projection and its patch-layer override write register nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a point-in-time inventory cannot tell a client. They are current package constraints, not a task backlog.

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No provenance** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot add, remove, rename, or reconfigure plugins; the one mutation is the per-entry enable/disable override.
- **Override state is eventual** — `setEntryEnabled` commits the file, not the tree: a non-live profile applies the override on the next boot, and even a live profile reports the old `fiberPhase` until the launcher's watch re-applies the patch layer.
- **Live-enabling an entry whose service the launcher already provides fails loudly and reverts** — on a live profile the launcher mounts a watch-only fallback for a service its composed row does not provide (today only `hmr`); enabling that row afterwards collides on the Cordis service registration (`service "hmr" has been registered`), the call reports `plugin-entry-not-applied` and removes the row it just wrote. Rebooting with the row enabled composes cleanly, because the fallback is then never mounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
