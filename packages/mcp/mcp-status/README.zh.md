---
description: "面向 MCP 页面等管理界面维护者的已配置 MCP 服务器实时连接状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-status

[English](README.md) | 中文

## 概述

此包在 `ctx.mcpStatus` 中保存每个已配置 MCP 服务器的实时连接状态。每个 `dsh-mcp-client` 实例都会在这里注册自己的连接：状态、暴露的工具名称以及最近一次失败。MCP 页面等管理界面读取该列表并跟随 `mcp-status/change`。随附的 base 组合会加载它；缺少它时 MCP 服务器照常工作，只是不报告状态。

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

`ctx.mcpStatus` 提供：

- `register(server, source)` 在调用上下文的生命周期内添加一个状态来源，并返回其清理函数。来源具有 `snapshot()` 和 `subscribe(listener)`。
- `list()` 按服务器名称排序，返回每个已注册服务器的 `state`（`connecting`、`connected`、`reconnecting`、`failed` 或 `stopped`）、`tools`，以及可选的 `error`、`attempt` 和 `connectedAt`。

每次注册、移除和状态变化都会发出 `mcp-status/change`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

状态按需读取：注册表在 `list()` 运行时读取每个来源，只转发变化通知，因此从不保存可能过期的副本。`dsh-mcp-client` 通过 `ctx.inject` 注册，因此在服务器之后加载的状态服务仍能收到它。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、状态类型和变化事件 |
| — | 不发布运行时不变量伴随包；注册表除所读取的来源外不保存状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [mcp-client 包](../mcp-client/README.zh.md)——向此注册表报告的连接管理器。
- [host-mcp-manager](../../host/mcp-manager/README.zh.md)——读取它的 MCP 页面 Remote。

-----

<a id="model-experience"></a>
## 模型体验

无，因为连接状态只服务于管理界面，从不进入模型请求。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限当前进程**——注册表反映其所在的 Host 进程，不保存历史。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
