# Agent Note: Plugin list entry toggle in Web Settings

Status: implemented

English | [中文](2026-09-09-plugin-inventory-entry-toggle.zh.md)

## Problem

The Settings → Plugins "Plugin list" tab (`@deepseek-ai/dsh-client-ui-settings-plugin-inventory`) was a read-only projection: operators could see which Loader entries were enabled but had to edit the patch file or use the CLI to change enablement. The Host gained `pluginInventory/setEntryEnabled` plus a `writable` snapshot flag; the client half needed a per-entry toggle with a deployment-safe interaction model — disabling can break the deployment, and a read-only deployment must show no actions at all.

## Decision

The tab's expanded card carries an Enable/Disable action guarded by three layers:

- **Confirm before disabling.** The Disable button turns into a Confirm disable/Cancel pair rendered inside the card; enabling needs no confirmation. While a write is in flight the card announces progress (`role="status"`) and disables its controls; failure surfaces a card-local `role="alert"` with a Retry control — naming the missing services when the Host reports the entry did not apply live; a committed toggle refetches the snapshot, keeps the card expanded, and shows a one-line effect hint (live or restart, per the snapshot's `live` flag).
- **Writability gate, enforced in the operation that makes it.** The browser apply closure tracks the last-known snapshot writability from its `list()` results (`src/client/toggle-gate.ts`) and rejects any `setEnabled` call before a writable snapshot was observed; the component additionally renders no action buttons and a locale-owned read-only hint when `snapshot.writable === false`.
- **Transactional live enable, no dependency auto-magic.** A live enable waits for the tree to reach `active` and reverts the file on timeout (`plugin-entry-not-applied`, with `details.missingServices` naming the injected services no running entry provides); disables and frozen profiles stay write-only. Enabling a target can NOT pull in its provider entries: no reliable service→entry map exists for disabled rows, and auto-enabling would cascade unpredictably — so the operation fails loud with the exact missing piece instead of guessing. A service collision (enabling a row whose service the launcher's watch-only fallback already provides, e.g. `hmr`) therefore reports failure and reverts rather than lying about success.
- **Effect hint branches on the snapshot's `live` flag.** `PluginInventorySnapshot` carries `writable` plus `live` (the launcher's patch-watch state); after a successful toggle the card shows "applied live" when `live` is true and "takes effect after the app restarts" otherwise.

The invariant companion stays an explained empty: the writability relation lives in the browser tree, which the node-side companion cannot observe in production. Its reason was rewritten (the old "read-only contribution" reason became false), and `tests/invariant.client.spec.ts` now exercises both gate arms through the shared gate module.

## Alternatives considered

### Shared `RiskConfirmation` modal for the disable confirmation

The primitives dialog gates its primary action behind a checkbox acknowledgement — heavier than a two-step button pair for a single toggle, adds a modal focus round-trip per card, and pulls six label props through the card. The inline pair keeps focus in the card (focus returns to the action button), needs two strings, and is explicitly sanctioned by the feature brief for this case. If a future toggle needs acknowledgement-grade weight, the shared primitive is still there.

### A real node-side invariant companion over the toggle relation

The only production home of the gate state is the browser apply closure; the invariant registry mounts only in the node Loader tree, so any companion check would be a fixed pure example — exactly what package invariant rules forbid. Enforcement in the operation plus spec exercise of both arms is the honest split.

### Surfacing the Host failure code/message in the failed-save state

Superseded for one case: the tab still hides transport details for generic failures (generic `saveFailed` copy), but a `plugin-entry-not-applied` rejection with named missing services renders its own locale-owned hint (`notAppliedNeeds` with the service list), because "enable X first" is the actionable content of that failure — hiding it would send the operator to the server log for something the UI already knows. The thrown error still carries `code`/`details` for logs and tests.

## Consequences

- Disabling a plugin from the web UI now requires two deliberate clicks, and a read-only deployment can render the catalog without offering broken actions.
- `setEnabled` calls the generated `pluginInventory/setEntryEnabled` Remote face directly; the inject face threads the Host's branded `PluginEntryId` (re-exported through `api-remotes/client`) so no cast exists.
- The invariant-companion rule stays satisfied by an explained empty whose reason is now true; the gate module is covered at 100% from the invariant spec, so removing the gate trips coverage instead of leaving an unenforced promise.

## Testing

`tests/components.client.spec.tsx` covers the enable flow, confirm/cancel, saving, failure+retry, read-only rendering, post-toggle refetch failure, the missing-services hint, and malformed rejections; `tests/browser-plugin.client.spec.tsx` drives the inject face through a fake remote, including both gate rejections and failure code/details propagation; `tests/invariant.client.spec.ts` exercises the gate module arms. Host `tests/inventory.spec.ts` covers the transactional enable (live success, timeout revert of appended and restored rows, activation rejection, missing-directory revert failure, tree exit, frozen skip) plus a seed-application driver standing in for the launcher watch. Per-file coverage stays at 100%.
