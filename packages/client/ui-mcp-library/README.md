---
description: "The Web MCP page below Skills for users who connect MCP servers from the MCP Registry or by hand, watch their status and tools, and switch or remove them."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp-library

English | [中文](README.zh.md)

## Summary

This package adds an **MCP** entry to the Web and Desktop sidebar, directly below **Skills**. **Servers** shows every configured MCP server with its live state, command or URL, and tools, with a switch and removal. **Discover** searches the official MCP Registry and connects a server through a form that the registry fills in. **Add server** connects a local command or a remote URL by hand.

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

Click **MCP** in the sidebar. The shipped Web composition mounts the row `ui-mcp-library`; it requires the Host `mcp-manager` row.

### Servers

- Each card shows the server name, its state (**Connected**, **Connecting**, **Reconnecting** with the attempt, **Couldn’t connect**, **Stopped**, or **Off**), whether it is local or remote, the command or URL, and the names of configured variables.
- **Show tools** lists the tool names the server exposes; the model sees them as `mcp__<name>__<tool>`.
- The switch turns a server on or off, and **Remove** deletes a server the profile added after confirmation. Servers from bundles or overlays are marked **From configuration** and stay read-only.

### Discover

- The search field queries the MCP Registry after typing pauses; each card shows how the server runs (npm, Python, Docker, or Remote), its version, and a repository link.
- **Connect** opens the form filled from the registry: the command and arguments or URL, and every environment variable or header the server needs. Required values must be filled in; templates such as `Bearer {token}` appear as hints.

### Add server

The form takes a name, **Local** with a command and one argument per line, or **Remote** with a URL, and environment variables or headers. Values are saved in the profile.

The page refreshes when the Host reports `mcp-manager/changed`, which includes every connection state change.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`McpController` owns one snapshot store. It loads the server list when the page first renders, loads the registry when Discover first renders, applies a switch optimistically, and shows a restart notice when the Host saved a change it could not apply live. All copy lives in `locales.ts`; colors come from the shared `--dsw-alias-*` tokens.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Sidebar entry, main panel registration, and Host event refresh |
| [`src/client/controller.ts`](src/client/controller.ts) | Page state and Remote round trips |
| [`src/client/McpPage.tsx`](src/client/McpPage.tsx) | Header, view tabs, and notices |
| [`src/client/ServersView.tsx`](src/client/ServersView.tsx) | Server cards |
| [`src/client/DiscoverView.tsx`](src/client/DiscoverView.tsx) | Registry search and result cards |
| [`src/client/ServerFormDialog.tsx`](src/client/ServerFormDialog.tsx) | Add-server and connect form |
| [`src/client/McpLibrary.module.css`](src/client/McpLibrary.module.css) | Styles |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese copy |
| — | No runtime invariant companion is published; the page renders one store fed by one Remote. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [host-mcp-manager](../../host/mcp-manager/README.md) — the Remote this page calls.
- [mcp-client package](../../mcp/mcp-client/README.md) — how a configured server connects and exposes tools.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side page that registers nothing model-facing; connected servers reach the model through `dsh-mcp-client`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No editing** — change a server by removing it and adding it again.
- **Values stored in the profile** — keys entered in the form are saved in the profile patch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
