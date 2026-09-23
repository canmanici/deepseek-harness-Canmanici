---
description: "Live connection status of configured MCP servers for maintainers of management surfaces such as the MCP page."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-status

English | [中文](README.zh.md)

## Summary

This package keeps the live connection status of every configured MCP server in `ctx.mcpStatus`. Each `dsh-mcp-client` instance registers its connection there: state, the tool names it exposes, and the latest failure. Management surfaces such as the MCP page read the list and follow `mcp-status/change`. The shipped base composition loads it; without it, MCP servers work unchanged and report nothing.

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

`ctx.mcpStatus` exposes:

- `register(server, source)` adds one status source for the lifetime of the calling context and returns its disposer. A source has `snapshot()` and `subscribe(listener)`.
- `list()` returns every registered server with `state` (`connecting`, `connected`, `reconnecting`, `failed`, or `stopped`), `tools`, and optional `error`, `attempt`, and `connectedAt`, sorted by server name.

Every registration, removal, and status change emits `mcp-status/change`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Status is pulled: the registry reads each source when `list()` runs and only forwards change notifications, so it never holds a copy that could go stale. `dsh-mcp-client` registers through `ctx.inject`, so a status service loaded after a server still receives it.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, status types, and the change event |
| — | No runtime invariant companion is published; the registry keeps no state beyond the sources it reads. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [mcp-client package](../mcp-client/README.md) — the connection supervisor that reports into this registry.
- [host-mcp-manager](../../host/mcp-manager/README.md) — the MCP page Remote that reads it.

-----

<a id="model-experience"></a>
## Model Experience

None, as connection status serves management surfaces only and never reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Per-process** — the registry reflects the Host process it runs in; it keeps no history.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
