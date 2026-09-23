---
description: "管理可选 OpenDesign headless runtime：校验下载、安装到 DSH home、仅监听 loopback、提供浏览器状态路由，并在 profile 结束时关闭进程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-open-design

[English](README.md) | 中文

## 概述

将此可选 Host 插件与 [`dsh-client-ui-open-design`](../../client/ui-open-design/README.zh.md) 及 [`dsh-open-design`](../../bundle/open-design/README.zh.md) 配合使用，可从 DSH 安装并运行固定版本的 OpenDesign headless runtime。激活时会下载带版本号的 DSH release 产物、校验 SHA-256、安装到 DSH home，并在 profile 生命周期内管理仅监听 loopback 的守护进程与 Studio。浏览器路由使用 DSH connection 认证和 Host/Origin 检查。

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

将可选 OpenDesign 组合包添加到提供 `webServer`、`connection` 和 `subprocess` 的 Web 组合中。该组合包会挂载本插件与其浏览器配套包；启用后自动启动运行时。运行时压缩包由固定的 `third_party/open-design` 子模块构建，并通过仓库的 **OpenDesign runtime** workflow 单独发布，不进入常规 DSH 安装包。

### 配置

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

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `runtimeDownloadBaseUrl` | `https://github.com/deepseek-ai/deepseek-harness/releases/download` | 不可变 DSH runtime release 产物的 HTTPS 基地址。 |
| `daemonPort` | `17456` | Loopback 守护进程端口；须与组合包 MCP 客户端条目保持一致。 |
| `webPort` | `17457` | Loopback Studio 端口。 |
| `maxRuntimeBytes` | `1500000000` | 运行时压缩包的最大字节数。 |
| `downloadTimeoutMs` | `1800000` | 每个运行时产物下载的最长时间。 |
| `startupTimeoutMs` | `180000` | 等待守护进程与 Studio 就绪的最长时间。 |
| `installLockWaitMs` | `1800000` | 等待另一个 DSH profile 完成共享运行时安装的最长时间。 |

两个端口必须不同。若更改 `daemonPort`，请同时更新组合包 patch 中 `mcp-open-design` 的 `--daemon-url`。UI 会从经认证的状态路由读取 Studio URL。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-host-open-design)列出所有可接受字段。

### 运行时文件与权限

校验后的运行时安装在 `dshHomePath('open-design', 'runtime', '<commit>')` 下；OpenDesign 持久数据保存在 `dshHomePath('open-design', 'data')` 下。Host 会把守护进程和 Studio 的绑定地址设为 `127.0.0.1`，并在 profile 卸载时通过 OpenDesign sidecar API 仅停止 DSH namespace，等待 API 报告没有剩余进程 ID。OpenDesign 使用 DSH 进程用户的权限访问项目文件；DSH 工作区权限与沙箱规则无法限制这些操作。

运行时通过 `ctx.webServer` 提供 `GET /open-design/status` 与 `POST /open-design/start`。两个路由在返回状态或启动工作前都会调用 `connection.requestRejection()`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内幕——点击展开</summary>

插件将压缩包流式写入私有暂存目录并同时计算哈希，与单独下载的 release checksum 比对，校验清单和必需文件后，再把完整运行时原子重命名到 DSH home。`ctx.subprocess` 会启动 OpenDesign 自带的 headless bootstrap；即使 bootstrap 正常退出，仍需等待守护进程健康路由与 Studio 根页面都响应才算就绪。插件释放时会中止下载，通过 OpenDesign 停止 DSH sidecar namespace，检查剩余进程 ID，并等待受管理的启动器范围变空。

不发布运行时不变式伴随包：安装校验、端口选择、就绪检查和进程所有权都由这一个提供方管理，并未拆成可独立演进的注册项。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 运行时安装器、进程生命周期、认证路由与校验配置 |
| [`src/shared.ts`](src/shared.ts) | 浏览器安全的状态类型与路由常量 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [嵌入式 Studio 面板](../../client/ui-open-design/README.zh.md)——浏览器状态与 iframe 界面。
- [OpenDesign 可选组合包](../../bundle/open-design/README.zh.md)——完整 profile 集成与设置步骤。
- [Subprocess](../../subprocess/subprocess/README.zh.md)——受管理的 Host 进程能力。
- [Host Web 服务器](../webserver/README.zh.md)——路由注册与 HTTP 生命周期。

<a id="model-experience"></a>
## 模型体验

无；本包负责运行时与浏览器路由。可选组合包的 MCP 条目会向智能体提供 OpenDesign 工具。

#### KV Cache 效果

无；Host runtime 提供方不会更改模型请求。

## 已知限制与待处理工作

<a id="known-limitations-and-deferred-work"></a>

- 首个打包运行时仅支持 Linux x64。其他系统会收到明确的平台错误。
- 仅当浏览器与 DSH Host 位于同一台电脑时才会嵌入 Studio；尚未提供远程浏览器代理。
- OpenDesign 可以访问 DSH 进程用户获准访问的项目；本包不会将其限制在当前 DSH 工作区。
- 用户成功启用此组合包前，必须先发布对应版本的 GitHub release 产物。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建会把端口透传补丁以及按名称顺序排列的每个 `scripts/open-design-patches/*.patch` 差异应用于固定 OpenDesign 子模块的临时副本，不会修改当前检出的子模块。`dsh-runtime-assistant-stream.patch` 让 `@open-design/dsh-runtime` profile 桥接从 `agent/assistant-stream` 转发文本，因为 DSH 0.1.3-alpha.1 删除了固定桥接读取的 `assistant/chunk` Session 事件。

</details>
