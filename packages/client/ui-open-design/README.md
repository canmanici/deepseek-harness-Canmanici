---
description: "Adds a localized DSH sidebar panel that reports the optional OpenDesign runtime state and embeds its loopback Studio when the browser is local."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-open-design

English | [中文](README.zh.md)

## Summary

Use this optional browser plugin with [`dsh-host-open-design`](../../host/open-design/README.md) and the [`dsh-open-design` bundle](../../bundle/open-design/README.md). Its global sidebar panel shows runtime download and startup progress, offers retry after a failure, and embeds the Studio URL returned by the Host only when the browser runs on the same computer as DSH. The Web iframe is sandboxed and accepts only an HTTP URL on `127.0.0.1`.

The panel is available only while the optional bundle is active. It does not install OpenDesign by itself; the paired Host plugin downloads the separately published, pinned runtime artifact.

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

Install and enable [`@deepseek-ai/dsh-open-design`](../../bundle/open-design/README.md) from DSH Web Plugins, then select **OpenDesign** in the global sidebar. The panel reads its status from DSH's authenticated same-origin routes and refreshes while the runtime is starting.

The embedded frame is shown only for local DSH browser addresses or the Desktop `file:` shell. Remote browsers receive a clear same-computer notice because `127.0.0.1` would refer to the remote user's own computer, not the DSH Host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/client/index.ts` registers one localized global main panel and one sidebar navigation entry. `OpenDesignPanel.tsx` validates status JSON before rendering it, rejects a Studio URL outside `http://127.0.0.1/`, and renders the iframe only for local browser sessions. The warning explains that OpenDesign's project-file access is outside DSH workspace permissions and sandboxing.

No runtime invariant companion is published: this package projects the Host's status and does not own a second copy of runtime state.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Locale and global panel registration |
| [`src/client/OpenDesignPanel.tsx`](src/client/OpenDesignPanel.tsx) | Status, retry, accessibility, local-frame policy, and Studio embedding |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Simplified Chinese copy |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [OpenDesign Host runtime](../../host/open-design/README.md) — downloader, routes, and process lifetime.
- [OpenDesign bundle](../../bundle/open-design/README.md) — agent MCP tools and complete enablement flow.
- [Client package map](../README.md) — the browser plugin family.

<a id="model-experience"></a>
## Model Experience

None; this package presents the human-facing Studio and runtime status. The separate MCP client row provides OpenDesign tools to the agent.

#### KV Cache effect

None; the browser panel does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The first runtime artifact supports Linux x64 only; the paired Host reports unsupported systems.
- The iframe works only when the DSH browser is on the Host computer. Remote Web access does not proxy the Studio.
- OpenDesign's daemon can access files permitted to the DSH process user; DSH workspace permissions and sandboxing do not constrain those tool operations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The browser panel owns no independent lifecycle or runtime invariant; process state remains Host-owned.

</details>
