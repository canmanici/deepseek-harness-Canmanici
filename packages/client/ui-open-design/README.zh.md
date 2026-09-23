---
description: "添加本地化 DSH 侧栏面板，用于显示可选 OpenDesign runtime 状态，并在本机浏览器中嵌入 loopback Studio。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-open-design

[English](README.md) | 中文

## 概述

将此可选浏览器插件与 [`dsh-host-open-design`](../../host/open-design/README.zh.md) 及 [`dsh-open-design` 组合包](../../bundle/open-design/README.zh.md) 配合使用。全局侧栏面板会显示运行时下载与启动进度，失败时允许重试；仅当浏览器与 DSH 位于同一台电脑时，才嵌入 Host 返回的 Studio URL。Web iframe 带 sandbox，且仅接受 `127.0.0.1` 上的 HTTP URL。

只有启用可选组合包后才会出现此面板。它不会自行安装 OpenDesign；配套 Host 插件会下载单独发布的固定版本 runtime 产物。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待处理工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

从 DSH Web 插件中安装并启用 [`@deepseek-ai/dsh-open-design`](../../bundle/open-design/README.zh.md)，然后在全局侧栏中选择 **OpenDesign**。面板通过 DSH 经认证的同源路由读取状态，并在运行时启动期间持续刷新。

仅当 DSH 浏览器地址为本地地址或 Desktop `file:` 外壳时，才显示嵌入式 frame。远程浏览器会显示同机提示，因为其中的 `127.0.0.1` 指向远程用户自己的电脑，而非 DSH Host。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内幕——点击展开</summary>

`src/client/index.ts` 注册一个本地化的全局主面板与一个侧栏导航项。`OpenDesignPanel.tsx` 会先校验状态 JSON 再呈现，拒绝 `http://127.0.0.1/` 之外的 Studio URL，并且仅在本地浏览器会话中呈现 iframe。提示会说明 OpenDesign 项目文件访问不受 DSH 工作区权限和沙箱限制。

不发布运行时不变式伴随包：本包只呈现 Host 状态，不拥有第二份运行时状态。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 本地化与全局面板注册 |
| [`src/client/OpenDesignPanel.tsx`](src/client/OpenDesignPanel.tsx) | 状态、重试、无障碍、本地 frame 策略与 Studio 嵌入 |
| [`src/client/locales.ts`](src/client/locales.ts) | 英文与简体中文文案 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [OpenDesign Host runtime](../../host/open-design/README.zh.md)——下载器、路由与进程生命周期。
- [OpenDesign 组合包](../../bundle/open-design/README.zh.md)——智能体 MCP 工具与完整启用流程。
- [Client 包索引](../README.zh.md)——浏览器插件系列。

<a id="model-experience"></a>
## 模型体验

无；本包呈现面向用户的 Studio 与运行时状态。独立的 MCP 客户端条目会向智能体提供 OpenDesign 工具。

#### KV Cache 效果

无；浏览器面板不会更改模型请求。

## 已知限制与待处理工作

<a id="known-limitations-and-deferred-work"></a>

- 首个运行时产物仅支持 Linux x64；配套 Host 会报告不支持的系统。
- 只有 DSH 浏览器位于 Host 同一台电脑上时 iframe 才可用；远程 Web 访问不会代理 Studio。
- OpenDesign 守护进程能访问 DSH 进程用户获准访问的文件；DSH 工作区权限与沙箱无法限制这些工具操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

浏览器面板不拥有独立生命周期或运行时不变式；进程状态始终由 Host 管理。

</details>
