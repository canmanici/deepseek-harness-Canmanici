---
description: "mcpManager Remote，供 MCP 页面的维护者阅读：已配置 MCP 服务器及其实时状态、添加、开关和移除服务器，以及 MCP Registry 搜索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-mcp-manager

[English](README.md) | 中文

## 概述

此包提供 Web **MCP** 页面调用的 `mcpManager` Remote 命名空间。它列出每个 `dsh-mcp-client` 条目及其配置、启用状态和实时状态，把服务器添加到 profile，开关服务器，移除 profile 定义的服务器，并搜索官方 MCP Registry。写入经过 `ctx.pluginManager`，状态来自 `ctx.mcpStatus`。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

随附的 Web 组合挂载 `mcp-manager` 行。它需要 Loader；插件管理器和 MCP 状态是可选的。

### Remote 方法

| 方法 | 结果 |
|---|---|
| `servers()` | 服务器及其传输方式、命令和参数或 URL、已配置环境变量或请求头的名称、`enabled`、`manageable`、`state`、`tools`，以及最近的 `error` 和 `attempt` |
| `addServer({ serverName, transport, command?, args?, env?, url?, headers? })` | 校验名称、唯一性和客户端配置后，把 `mcp-<serverName>` 插入 profile patch |
| `setServerEnabled({ entryId, enabled })` | 通过插件管理器开关一个服务器 |
| `removeServer({ entryId })` | 移除 profile patch 插入的服务器 |
| `searchRegistry({ query, cursor? })` | 匹配的 Registry 服务器的最新版本，每个都带有运行方式：通过 `npx` 运行的 `npm`、通过 `uvx` 运行的 `pypi`、通过 `docker run` 运行的 `oci`，以及 Streamable HTTP 远程服务，并列出每种方式需要的值 |

环境变量和请求头的值保留在 Host；页面只收到它们的名称。在这里添加的本地服务器从 `serverCwd` 运行，默认为用户主目录，因为在包目录中运行 `npx` 会按该包解析可执行文件。

### 配置

| 字段 | 默认值 | 作用 |
|---|---|---|
| `registryUrl` | `https://registry.modelcontextprotocol.io` | MCP Registry 基础 URL |
| `pageSize` | `30` | 每页 Registry 服务器数 |
| `fetchTimeoutMs`、`maxResponseBytes` | 20 秒、8 MiB | Registry 请求上限 |
| `serverCwd` | 空，即主目录 | 从页面添加的本地服务器的工作目录 |

### 事件与错误

每当 `mcp-status/change` 或 `plugin-manager/changed` 触发时，宿主会转发 `mcp-manager/changed`。没有插件管理器时写入会以 `mcp-manager/unavailable` 失败；无效请求或失败的 profile 更改会以携带原因的 `mcp-manager/invalid-request` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

服务器行来自 Loader 而不是 profile 文件，因此包含来自 bundle 和覆盖层的服务器，这些服务器被标记为不可 `manageable`。配置在插件管理器写入之前用 `dsh-mcp-client` 的模式校验，插件管理器通过 HMR 应用更改。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpManager` Remote 服务 |
| [`src/registry.ts`](src/registry.ts) | 把 MCP Registry 解析为运行方式 |
| [`src/types.ts`](src/types.ts) | 传输类型、错误详情和 `mcp-manager/changed` 事件 |
| — | 不发布运行时不变量伴随包；此服务不保存可能与其读取的服务不一致的状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [mcp-client 包](../../mcp/mcp-client/README.zh.md)——此页面写入的服务器配置。
- [ui-mcp-library](../../client/ui-mcp-library/README.zh.md)——调用此 Remote 的 MCP 页面。
- [plugin-manager](../../boot/plugin-manager/README.zh.md)——profile 的写入者。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包是 Remote 管理视图；它添加的服务器通过 `dsh-mcp-client` 到达模型。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **值保存在 profile 中**——页面中输入的环境变量和请求头保存在 profile patch 中，该文件只有用户可读。
- **不能编辑**——通过移除后重新添加来更改服务器。
- **Registry 信任**——Registry 条目是社区提交；页面会在运行前显示命令。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
