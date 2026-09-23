---
description: "The mcpManager Remote for maintainers of the MCP page: configured MCP servers with live status, server add, switch, and remove, and MCP Registry search."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-mcp-manager

English | [中文](README.zh.md)

## Summary

This package serves the `mcpManager` Remote namespace that the Web **MCP** page calls. It lists every `dsh-mcp-client` entry with its configuration, enablement, and live status. It adds a server to the profile, switches servers on or off, removes servers the profile defines, and searches the official MCP Registry. Writes go through `ctx.pluginManager`, and status comes from `ctx.mcpStatus`.

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

The shipped Web composition mounts the row `mcp-manager`. It needs the Loader; the plugin manager and MCP status are optional.

### Remote methods

| Method | Result |
|---|---|
| `servers()` | Servers with transport, command and arguments or URL, the names of configured environment variables or headers, `enabled`, `manageable`, `state`, `tools`, and the latest `error` and `attempt` |
| `addServer({ serverName, transport, command?, args?, env?, url?, headers? })` | Inserts `mcp-<serverName>` into the profile patch after validating the name, uniqueness, and the client configuration |
| `setServerEnabled({ entryId, enabled })` | Switches one server through the plugin manager |
| `removeServer({ entryId })` | Removes a server that the profile patch inserted |
| `searchRegistry({ query, cursor? })` | The latest version of matching registry servers, each with run options: `npm` through `npx`, `pypi` through `uvx`, `oci` through `docker run`, and Streamable HTTP remotes, plus the values each option needs |

Values of environment variables and headers stay on the Host; the page receives only their names. Local servers added here run from `serverCwd`, the user's home directory by default, because `npx` inside a package directory resolves binaries against that package.

### Configuration

| Field | Default | Effect |
|---|---|---|
| `registryUrl` | `https://registry.modelcontextprotocol.io` | MCP Registry base URL |
| `pageSize` | `30` | Servers per registry page |
| `fetchTimeoutMs`, `maxResponseBytes` | 20 s, 8 MiB | Registry request bounds |
| `serverCwd` | empty, the home directory | Working directory of local servers added from the page |

### Events and errors

The Host forwards `mcp-manager/changed` whenever `mcp-status/change` or `plugin-manager/changed` fires. A write without the plugin manager fails with `mcp-manager/unavailable`; an invalid request or a failed profile change fails with `mcp-manager/invalid-request` carrying its reason.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Server rows come from the Loader rather than the profile file, so they include servers from bundles and overlays, which are marked not `manageable`. Configuration is validated with the `dsh-mcp-client` schema before the plugin manager writes it, and the plugin manager applies the change through HMR.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpManager` Remote service |
| [`src/registry.ts`](src/registry.ts) | MCP Registry parsing into run options |
| [`src/types.ts`](src/types.ts) | Wire types, error details, and the `mcp-manager/changed` event |
| — | No runtime invariant companion is published; the service holds no state that could diverge from the services it reads. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [mcp-client package](../../mcp/mcp-client/README.md) — the server configuration this page writes.
- [ui-mcp-library](../../client/ui-mcp-library/README.md) — the MCP page that calls this Remote.
- [plugin-manager](../../boot/plugin-manager/README.md) — the profile writer.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a Remote management view; servers it adds reach the model through `dsh-mcp-client`.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Values stored in the profile** — environment variables and headers entered in the page are saved in the profile patch, which is readable only by the user.
- **No editing** — change a server by removing it and adding it again.
- **Registry trust** — registry entries are community submissions; the page shows the command before it runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
