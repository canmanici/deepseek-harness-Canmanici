---
description: "位于 Skills 下方的 Web MCP 页面，供从 MCP Registry 或手动连接 MCP 服务器、查看其状态和工具，并开关或移除它们的用户阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp-library

[English](README.md) | 中文

## 概述

此包在 Web 和桌面端侧边栏中 **Skills** 的正下方添加 **MCP** 入口。**服务器**显示每个已配置的 MCP 服务器及其实时状态、命令或 URL 和工具，并提供开关和移除。**发现**搜索官方 MCP Registry，并通过由 Registry 填好的表单连接服务器。**添加服务器**手动连接本地命令或远程 URL。

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

点击侧边栏中的 **MCP**。随附的 Web 组合挂载 `ui-mcp-library` 行；它需要 Host 的 `mcp-manager` 行。

### 服务器

- 每张卡片显示服务器名称、状态（**已连接**、**正在连接**、带尝试次数的**正在重连**、**连接失败**、**已停止**或**已关闭**）、本地还是远程、命令或 URL，以及已配置变量的名称。
- **显示工具**列出服务器暴露的工具名称；模型看到的形式是 `mcp__<名称>__<工具>`。
- 开关用于开启或关闭服务器，**移除**在确认后删除 profile 添加的服务器。来自 bundle 或覆盖层的服务器标记为**由配置提供**，保持只读。

### 发现

- 搜索框在输入停顿后查询 MCP Registry；每张卡片显示服务器的运行方式（npm、Python、Docker 或远程）、版本和仓库链接。
- **连接**打开由 Registry 填好的表单：命令和参数或 URL，以及服务器需要的每个环境变量或请求头。必填值必须填写；`Bearer {token}` 这样的模板会作为提示显示。

### 添加服务器

表单接受名称、带命令和每行一个参数的**本地**方式或带 URL 的**远程**方式，以及环境变量或请求头。这些值保存在 profile 中。

当 Host 报告 `mcp-manager/changed` 时页面会刷新，其中包括每一次连接状态变化。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`McpController` 持有一个快照存储。它在页面首次渲染时读取服务器列表，在**发现**首次渲染时读取 Registry，乐观地应用开关，并在 Host 保存了无法实时应用的更改时显示重启提示。所有文案都在 `locales.ts` 中；颜色来自共享的 `--dsw-alias-*` 令牌。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 侧边栏入口、主面板注册和 Host 事件刷新 |
| [`src/client/controller.ts`](src/client/controller.ts) | 页面状态和 Remote 往返 |
| [`src/client/McpPage.tsx`](src/client/McpPage.tsx) | 页头、视图标签和通知 |
| [`src/client/ServersView.tsx`](src/client/ServersView.tsx) | 服务器卡片 |
| [`src/client/DiscoverView.tsx`](src/client/DiscoverView.tsx) | Registry 搜索和结果卡片 |
| [`src/client/ServerFormDialog.tsx`](src/client/ServerFormDialog.tsx) | 添加服务器和连接表单 |
| [`src/client/McpLibrary.module.css`](src/client/McpLibrary.module.css) | 样式 |
| [`src/client/locales.ts`](src/client/locales.ts) | 英文和中文文案 |
| — | 不发布运行时不变量伴随包；页面渲染由一个 Remote 驱动的一个存储。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [host-mcp-manager](../../host/mcp-manager/README.zh.md)——此页面调用的 Remote。
- [mcp-client 包](../../mcp/mcp-client/README.zh.md)——已配置服务器如何连接并暴露工具。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包是浏览器端页面，不注册任何面向模型的内容；已连接的服务器通过 `dsh-mcp-client` 到达模型。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **不能编辑**——通过移除后重新添加来更改服务器。
- **值保存在 profile 中**——表单中输入的密钥保存在 profile patch 中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
