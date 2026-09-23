---
description: "在 DSH profile 中添加由 DSH 管理的可选 OpenDesign 运行时、嵌入式 Studio 面板与智能体工具。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-open-design

[English](README.md) | 中文

## 概述

此可选 profile 组合包启用后会下载并启动固定版本的 OpenDesign headless runtime，在 DSH 侧栏中加入 Studio，并通过 `mcp__open-design__...` 向智能体提供本地 MCP 工具。用户无需单独安装或启动 OpenDesign；随附 profile 默认关闭此组合包。首个运行时产物面向 Linux x64。OpenDesign 可操作其守护进程能访问的项目，不只限于 DSH 工作区。

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

在 DSH Web 中打开**插件**并启用 **OpenDesign**，然后从侧栏选择 **OpenDesign**。此组合包已包含在 DSH 中，默认关闭；用户无需另行安装或启动 OpenDesign。DSH 会把带版本号的运行时下载到 DSH 自己管理的存储中，启动仅监听 loopback 的守护进程与 Studio，并连接智能体工具。Studio 会显示下载进度，并可重试失败的安装。运行时产物与普通 DSH 安装包分开发布，须从仓库的 **OpenDesign runtime** workflow 发布。

OpenDesign 负责自己的项目文件和守护进程访问权限。DSH 文件系统沙箱无法约束通过 OpenDesign MCP 工具所做的文件更改，因此在批准写入或删除工具调用前请先检查。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

此组合包会插入 Host 运行时管理器、浏览器 Studio 面板与 `dsh-mcp-client` 条目。Host 会下载并校验固定版本的 OpenDesign 负载，在 DSH home 下原子安装，通过 `ctx.subprocess` 启动 headless bootstrap，并等待守护进程与 Studio 就绪。profile 卸载时，Host 仅通过 OpenDesign 关闭 API 停止 `dsh-open-design` sidecar generation，并等待 API 确认没有剩余进程后才完成卸载。MCP 客户端使用随包 Node runtime 通过 stdio 连接守护进程。大型 Studio 负载不会进入常规 DSH 包，仅在启用此组合包时下载。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 运行时、浏览器面板与 MCP 客户端条目 |
| [`src/index.ts`](src/index.ts) | 包入口；不提供运行时 API |
| — | 不发布运行时不变式伴随包；此组合包是静态 patch 载体，进程生命周期由 Host 与 MCP 包负责。 |

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

- 首个已发布运行时产物目前仅支持 Linux x64；其他操作系统会收到明确的不支持平台错误。
- 每个 DSH home 同时只能有一个 profile 使用此组合包；这些 profile 共用数据目录和默认环回端口。若修改 `daemonPort`，还须在同一 profile patch 中更新 MCP 条目的 `--daemon-url`。
- 嵌入式 Studio 当前仅在 DSH 浏览器与 DSH Host 位于同一台电脑时可用；尚未提供远程浏览器代理。
- OpenDesign 守护进程使用 DSH 进程用户的权限访问项目文件。DSH 工作区文件权限与沙箱不能限制 OpenDesign 工具操作。
- 此集成嵌入 Studio 和工具，但不会把 OpenDesign 设计系统或技能目录复制到 DSH。
- OpenDesign 负责 MCP 工具兼容性和项目选择行为；此集成固定一个 OpenDesign 源码修订版，并从该源码构建运行时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
