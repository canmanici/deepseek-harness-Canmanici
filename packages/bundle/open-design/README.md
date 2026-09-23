---
description: "Add an optional DSH-managed OpenDesign runtime, embedded Studio panel, and agent tools to a DSH profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-open-design

English | [中文](README.zh.md)

## Summary

This optional profile bundle downloads and starts a pinned OpenDesign headless runtime when enabled, adds its Studio to the DSH sidebar, and exposes its local MCP tools to the agent under `mcp__open-design__...`. Users do not install or launch OpenDesign separately; shipped profiles leave the bundle off. The first runtime artifact targets Linux x64. OpenDesign can operate on projects available to its daemon, not only DSH's workspace.

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

Open **Plugins** in DSH Web and enable **OpenDesign**, then select **OpenDesign** in the sidebar. The bundle is included in DSH and ships disabled; users do not install or launch OpenDesign separately. DSH downloads the versioned runtime into DSH-owned storage, starts its loopback-only daemon and Studio, and connects the agent tools. The Studio shows download progress and can retry a failed install. The runtime artifact is separate from ordinary DSH installers and must be published from the repository's **OpenDesign runtime** workflow.

OpenDesign owns its project files and daemon access. DSH's filesystem sandbox does not constrain file changes made through OpenDesign MCP tools, so review write or delete tool calls before approving them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This bundle inserts the Host runtime owner, browser Studio panel, and `dsh-mcp-client` row. The Host downloads and verifies the pinned OpenDesign payload, extracts it atomically under DSH home, launches the headless bootstrap through `ctx.subprocess`, waits for daemon and Studio readiness, and stops only the `dsh-open-design` sidecar generations through OpenDesign's shutdown API when the profile unloads. DSH waits for that API to report no remaining process IDs before shutdown completes. The MCP client uses the packaged Node runtime to connect over stdio to the daemon. The large Studio payload stays out of regular DSH packages and downloads only when the bundle is enabled.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Runtime, browser panel, and MCP client rows |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| — | No runtime invariant companion is published; the bundle is a static patch carrier, and its Host and MCP packages own the process lifecycles. |

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

- The first published runtime artifact supports Linux x64 only. Other operating systems receive an explicit unsupported-platform error.
- Only one active profile per DSH home can use this bundle; profiles share its data directory and default loopback ports. If you change `daemonPort`, change the MCP entry's `--daemon-url` in the same profile patch.
- The embedded Studio currently works only when the DSH browser is on the same computer as the DSH Host; remote-browser proxying is not included.
- OpenDesign's daemon accesses project files with the DSH process user's permissions. DSH workspace file permissions and sandboxing do not constrain OpenDesign tool operations.
- This integration embeds the Studio and tools but does not copy OpenDesign design systems or its skill catalog into DSH.
- OpenDesign owns MCP tool compatibility and project-selection behavior; the integration pins one OpenDesign source revision and builds its runtime from that source.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
