---
description: "Enable OpenDesign's local project and design tools in a DSH profile through MCP, for users who already run OpenDesign locally."
kind: "package-bundle"
---

# @deepseek-ai/dsh-open-design

English | [中文](README.zh.md)

## Summary

This optional profile bundle adds OpenDesign's local MCP tools to the DSH agent under `mcp__open-design__...`. Enable it from DSH Web Plugins after installing OpenDesign; shipped profiles leave it off. OpenDesign keeps its daemon, projects, and Studio UI outside DSH. Its tools can operate on projects available to that daemon, not only DSH's workspace.

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

Install and start OpenDesign using its [official setup guide](https://github.com/nexu-io/open-design#readme). In OpenDesign Settings → MCP server, copy the command path for the local MCP server. Set `OPEN_DESIGN_MCP_COMMAND` to that path before launching DSH when `od` is not the correct executable; macOS may resolve `od` to the built-in `/usr/bin/od` instead. Set `OPEN_DESIGN_DAEMON_URL` if the OpenDesign daemon does not use `http://127.0.0.1:7456`.

In DSH Web, open **Plugins** and enable **OpenDesign**. Start a new session after enabling it. DSH starts OpenDesign's stdio MCP command and discovers its tools under names beginning with `mcp__open-design__`. A missing CLI or unavailable daemon leaves this optional MCP entry inactive; DSH reports the startup error and keeps the rest of the profile available.

OpenDesign owns its project files and daemon access. DSH's filesystem sandbox does not constrain file changes made through OpenDesign MCP tools, so review write or delete tool calls before approving them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This bundle inserts one `dsh-mcp-client` row. The MCP client starts the configured OpenDesign CLI over stdio, registers the tools it discovers, and disposes the process with the profile. The bundle does not include OpenDesign source, its daemon, or its Studio UI.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | OpenDesign MCP client row and local command settings |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| — | No runtime invariant companion is published; the bundle is a static patch carrier, and the MCP client package owns the connection lifecycle. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Bundle package map](../README.md) — the profile layers shipped with DSH.
- [MCP client](../../mcp/mcp-client/README.md) — stdio configuration, tool naming, and reconnect behavior.
- [OpenDesign](https://github.com/nexu-io/open-design) — installation, daemon, and project documentation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, the model receives the tools and instructions advertised by the connected OpenDesign MCP server. DSH names each tool under `mcp__open-design__...`; OpenDesign determines the available operations.

#### KV Cache effect

The MCP client's discovered tool definitions and OpenDesign instructions contribute to model requests while the bundle is active.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- OpenDesign must be installed separately, and its local CLI and daemon remain outside the DSH profile lifecycle.
- The bundle exposes MCP tools only; it does not embed OpenDesign's Studio UI or copy its design systems and skill catalog into DSH.
- OpenDesign MCP operations use the projects and file permissions of the OpenDesign daemon. DSH cannot restrict those operations to the current DSH workspace.
- OpenDesign owns its MCP tool compatibility and project-selection behavior. Restart the DSH profile after changing the command or daemon URL.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
