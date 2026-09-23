---
description: "Owns the optional OpenDesign headless runtime: verified download, DSH-home installation, loopback startup, browser status routes, and profile-lifetime shutdown."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-open-design

English | [中文](README.zh.md)

## Summary

Use this optional Host plugin with [`dsh-client-ui-open-design`](../../client/ui-open-design/README.md) and [`dsh-open-design`](../../bundle/open-design/README.md) to install and run a pinned OpenDesign headless runtime from DSH. It downloads a versioned DSH release artifact on activation, verifies its SHA-256 checksum, installs it under DSH home, and owns the loopback-only daemon and Studio process for the profile lifetime. Browser routes use DSH connection authentication and Host/Origin checks.

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

Add the optional OpenDesign bundle to a Web composition that provides `webServer`, `connection`, and `subprocess`. The bundle mounts this plugin and its browser companion; enabling it starts the runtime automatically. The runtime archive is built from the pinned `third_party/open-design` submodule and published separately from regular DSH installers with the repository's **OpenDesign runtime** workflow.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-host-open-design'
  config:
    daemonPort: 17456
    webPort: 17457
    maxRuntimeBytes: 1500000000
    downloadTimeoutMs: 1800000
    startupTimeoutMs: 180000
    installLockWaitMs: 1800000
```

| Field | Default | Meaning |
|---|---:|---|
| `runtimeDownloadBaseUrl` | `https://github.com/deepseek-ai/deepseek-harness/releases/download` | HTTPS base for immutable DSH runtime release assets. |
| `daemonPort` | `17456` | Loopback daemon port; keep it aligned with the bundle's MCP client row. |
| `webPort` | `17457` | Loopback Studio port. |
| `maxRuntimeBytes` | `1500000000` | Maximum compressed runtime archive size. |
| `downloadTimeoutMs` | `1800000` | Maximum time for each runtime asset download. |
| `startupTimeoutMs` | `180000` | Maximum time to wait for both daemon and Studio readiness. |
| `installLockWaitMs` | `1800000` | Maximum wait for another DSH profile to finish the shared runtime install. |

The two ports must differ. If changing `daemonPort`, update `mcp-open-design`'s `--daemon-url` in the bundle patch to match. The UI reads its Studio URL from the authenticated status route. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-host-open-design) lists the accepted fields.

### Runtime files and permissions

The verified runtime is installed below `dshHomePath('open-design', 'runtime', '<commit>')`; persistent OpenDesign data is kept below `dshHomePath('open-design', 'data')`. The Host sets daemon and Studio bind addresses to `127.0.0.1` and uses OpenDesign's sidecar API to stop only the DSH namespace when the profile unloads, waiting until the API reports no remaining process IDs. OpenDesign accesses project files with the DSH process user's permissions; DSH workspace permissions and sandbox rules do not limit those operations.

The runtime serves `GET /open-design/status` and `POST /open-design/start` through `ctx.webServer`. Both routes call `connection.requestRejection()` before returning status or starting work.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin streams the archive into a private staging directory while hashing it, compares that digest with the separately fetched release checksum, validates the manifest and required files, and atomically renames the completed runtime into DSH home. `ctx.subprocess` starts OpenDesign's packaged headless bootstrap; readiness requires both its daemon health route and Studio root to respond, even after the bootstrap exits cleanly. Plugin disposal aborts downloads, asks OpenDesign to stop the DSH sidecar namespace, checks for remaining process IDs, and waits for the managed launcher range to become empty.

No runtime invariant companion is published: installation validation, port selection, readiness, and process ownership all live in this one provider rather than in separately evolving registrations.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Runtime installer, process lifecycle, authenticated routes, and validated configuration |
| [`src/shared.ts`](src/shared.ts) | Browser-safe status type and route constants |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Embedded Studio panel](../../client/ui-open-design/README.md) — browser status and iframe surface.
- [OpenDesign optional bundle](../../bundle/open-design/README.md) — complete profile integration and setup steps.
- [Subprocess](../../subprocess/subprocess/README.md) — the managed Host process capability.
- [Host web server](../webserver/README.md) — route registration and HTTP lifecycle.

<a id="model-experience"></a>
## Model Experience

None; this package owns the runtime and browser routes. The optional bundle's MCP row provides the OpenDesign tools to the agent.

#### KV Cache effect

None; the Host runtime provider does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The first packaged runtime supports Linux x64 only. The plugin fails with an explicit platform error on other systems.
- The Studio embeds only when the browser is on the same computer as the DSH Host. A remote-browser proxy is not included.
- OpenDesign can access any project permitted to the DSH process user; this package does not confine it to the active DSH workspace.
- The matching versioned GitHub release asset must be published before users can enable the bundle successfully.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The build applies the port passthrough patch and every `scripts/open-design-patches/*.patch` diff, in name order, to a temporary copy of the pinned OpenDesign submodule; it does not modify the checked-out submodule. `dsh-runtime-assistant-stream.patch` makes the `@open-design/dsh-runtime` profile bridge forward text from `agent/assistant-stream`, because DSH 0.1.3-alpha.1 removed the `assistant/chunk` Session event that the pinned bridge reads.

</details>
