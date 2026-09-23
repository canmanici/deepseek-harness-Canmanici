---
description: "通过 MCP 在 DSH profile 中启用 OpenDesign 本地项目与设计工具，适用于已在本机运行 OpenDesign 的用户。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-open-design

[English](README.md) | 中文

## 概述

这个可选 profile 组合包会通过 `mcp__open-design__...` 将 OpenDesign 本地 MCP 工具提供给 DSH 智能体。安装 OpenDesign 后，可在 DSH Web 的插件管理中启用；随附 profile 默认关闭它。OpenDesign 的守护进程、项目和 Studio UI 仍在 DSH 之外。它的工具可以操作该守护进程可访问的项目，而不只限于 DSH 工作区。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待处理工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

按照 [OpenDesign 官方设置指南](https://github.com/nexu-io/open-design#readme)安装并启动 OpenDesign。在 OpenDesign 设置 → MCP server 中复制本地 MCP server 的命令路径。如果 `od` 不是正确的可执行文件，请在启动 DSH 前将 `OPEN_DESIGN_MCP_COMMAND` 设为该路径；macOS 可能会把 `od` 解析为系统内置的 `/usr/bin/od`。如果 OpenDesign 守护进程没有使用 `http://127.0.0.1:7456`，请设置 `OPEN_DESIGN_DAEMON_URL`。

在 DSH Web 中打开**插件**并启用 **OpenDesign**。启用后请新建会话。DSH 会通过 stdio 启动 OpenDesign MCP 命令，并以 `mcp__open-design__` 开头的名称发现其工具。如果找不到 CLI 或守护进程不可用，该可选 MCP 条目会保持未激活；DSH 会报告启动错误，并继续使用 profile 的其余部分。

OpenDesign 负责自己的项目文件和守护进程访问权限。DSH 文件系统沙箱无法约束通过 OpenDesign MCP 工具所做的文件更改，因此在批准写入或删除工具调用前请先检查。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

此组合包会插入一个 `dsh-mcp-client` 条目。MCP 客户端通过 stdio 启动已配置的 OpenDesign CLI、注册发现到的工具，并随 profile 一起释放该进程。此组合包不包含 OpenDesign 源码、守护进程或 Studio UI。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | OpenDesign MCP 客户端条目和本地命令设置 |
| [`src/index.ts`](src/index.ts) | 包入口；不提供运行时 API |
| — | 不发布运行时不变式伴随包；该组合包只是静态 patch 载体，连接生命周期由 MCP 客户端包负责。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [组合包索引](../README.zh.md)——随 DSH 提供的 profile 层。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md)——stdio 配置、工具命名和重连行为。
- [OpenDesign](https://github.com/nexu-io/open-design)——安装、守护进程和项目文档。

-----

<a id="model-experience"></a>
## 模型体验

间接地，模型会收到已连接 OpenDesign MCP server 声明的工具和说明。DSH 会以 `mcp__open-design__...` 命名每个工具；可用操作由 OpenDesign 决定。

#### KV Cache 效果

组合包启用期间，MCP 客户端发现的工具定义和 OpenDesign 说明会加入模型请求。

## 已知限制与待处理工作

<a id="known-limitations-and-deferred-work"></a>

- 必须单独安装 OpenDesign；其本地 CLI 和守护进程不属于 DSH profile 生命周期。
- 此组合包只提供 MCP 工具；它不会把 OpenDesign Studio UI 嵌入 DSH，也不会把其设计系统和技能目录复制到 DSH。
- OpenDesign MCP 操作遵循 OpenDesign 守护进程的项目范围和文件权限。DSH 无法将这些操作限制在当前 DSH 工作区内。
- OpenDesign 负责其 MCP 工具兼容性和项目选择行为。更改命令或守护进程 URL 后，请重启 DSH profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
