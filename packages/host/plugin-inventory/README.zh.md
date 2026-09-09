---
description: "面向 web GUI 宿主客户端的 Loader 插件状态 Remote：读取当前 pluginInventory 清单，并把按条目的启用/停用覆盖写入安装级用户补丁层。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

## 概述

客户端与设置页可以展示宿主当前组合了什么，并切换插件条目：调用 `pluginInventory/list` 即按 Loader 顺序返回当前的非组条目——条目 id、模块标识、有效启用状态与根 Fiber 阶段（`pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活根 Fiber 时为 `null`）——外加本部署是否接受按条目覆盖，以及被监视的补丁层是否实时重新应用。调用 `pluginInventory/setEntryEnabled` 会把一条覆盖作为补丁行写入安装级用户补丁层（`$DSH_HOME/cordis.patch.yml`），启动器已经在监视并热应用该文件。清单本身仍只表示调用当下：Loader 是唯一的生命周期权威，本包不拥有缓存、历史或来源模型。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.zh.md) 组合消费这个 Remote，而不导入 Host 实现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当客户端或设置页需要展示宿主当前组合了什么——哪些插件已加载、已启用、是否存活——时调用 `pluginInventory/list`；需要持久化操作者对某个条目的启用/停用选择时调用 `pluginInventory/setEntryEnabled`。Remote 是唯一入口：该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。

### 快照包含什么

每一行是一个非组 Loader 条目：其条目 id、精确模块标识、有效启用状态（含被禁用的祖先组）与当前根 Fiber 阶段。`pending` 表示条目等待加载，`loading` 表示正在读取，`active` 表示正在运行，`failed` 表示其 fiber 被拒绝，`unloading` 表示正在拆除；`null` 表示完全不存在存活的根 Fiber。结构性的 group 行会被跳过。仅当启动器提供了 `userPatchLayer` 服务时 `writable` 才为 `true`——未经 `dsh` profile 启动的部署报告 `false`，并拒绝 `setEntryEnabled`。`live` 镜像该服务的补丁监视状态：为 `true` 时提交的切换立即生效，为 `false` 时需要应用重启。

### 你能用它做什么、不能做什么

该清单是供展示与诊断的快照：客户端可以渲染名单、标出失败条目，并通过比较快照检测变化。`setEntryEnabled(entryId, enabled)` 持久化一条按条目的覆盖；它不能添加、移除、重命名或重配置插件，也从不触碰正在运行的树——启动器既有的用户补丁层监视会重新应用该文件（`live` profile），或由下次启动读取，因此冻结 profile 只在重启后改变状态。live 启用是事务性的：调用会等待树应用该行，条目未按时进入 `active` 即还原文件，并以 `plugin-entry-not-applied` 报告（`details.missingServices` 列出没有运行中条目提供的注入服务）；停用与冻结 profile 保持只写。该 Remote 不携带历史——已经失败并被移除的 fiber 缺席。由于服务每次调用都读取 Loader，答案总是反映当前组合，而不是缓存视图。

### 覆盖如何持久化

`setEntryEnabled` 先在当前 Loader 中解析该条目，再把补丁行 `{ id: <条目自身的 config id>, disabled: !enabled }` 插入或更新到 `userPatchLayer` 服务指定的文件。组合行携带带作用域的 Loader 条目 id（`include:<row id>`），而补丁行匹配该行自身的 config id——服务在两者之间映射，并拒绝补丁行无法指向的每个条目（启动 include 自身、启动器创建的条目、嵌套 include 的行，以及始终启用的 group 条目）。该行在跨进程文件锁与原子重命名下写入，文件中的注释与 `!!js` 表达式标量原样保留，重复写入相同状态是无操作，且该行组合在配置过该条目的每一层之上，因此写 `disabled: false` 会还原更早的 `disabled: true`。每次提交都会宣布 `plugin-inventory/patch-committed`，包不变式会重新解析已提交的文件，在缺少请求行时大声失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

网关是一层没有第二个生命周期真源的直接投影：每次 `list()` 调用都读取 `ctx.loader.entries()`，并把每个非组条目映射为公共行。Cordis 内部的 plugin/status 事件已经维护了 `Entry.fiber` 与 `Fiber.state`，因此再加缓存只会多出一个需要同步的生命周期真源。

### 阶段映射

Fiber 状态映射到公共阶段词汇，其中 `disposed` 折叠为 `null`——fiber 已消失的条目没有可报告的存活根。因此阶段从不区分为什么没有存活根：条目可能从未启动，也可能其 fiber 已被释放。

### 覆盖写入路径

`setEntryEnabled` 从不修改树：它是一次持久文件操作，启动器自己的补丁机制已经知道如何应用。补丁层通过 `yaml` 包的文档 API 加直通 `!!js` 标量标签编辑，因此用户文件中的注释与表达式值原样往返；编辑在 `@deepseek-ai/dsh-atomic-write` 的文件锁与原子重命名内进行。该 Remote 暴露的唯一修改被刻意收窄：对既有组合行的启用/停用切换。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`：`pluginInventory` Remote 服务、Loader 投影与覆盖写入路径 |
| [`src/patch-file.ts`](src/patch-file.ts) | 保留注释与 `!!js` 的补丁层解析、行插入更新，以及已提交行检查 |
| [`src/types.ts`](src/types.ts) | 公共 payload 类型：`PluginInventoryEntry`、`PluginInventorySnapshot`、`PluginFiberPhase`、`PluginPatchCommitted` |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：每条 `plugin-inventory/patch-committed` 宣布都必须与已提交的补丁层一致 |

Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当清单约定不够用时阅读以下内容：Remote 如何到达客户端、覆盖所搭乘的补丁机制，再到它所投影的 Loader 与渲染它的界面。

- [Remote 组合](../../api/remotes/README.zh.md)——客户端如何在不导入 Host 实现的情况下消费 `pluginInventory/list` 与 `pluginInventory/setEntryEnabled`。
- [应用启动](../../boot/app-boot/README.zh.md)——用户补丁层、其解析方言，以及覆盖文件所搭乘的 `watchUserPatches` 实时对账。
- [Cordis 插件 loader](../../../vendor/loader/README.md)——本包所投影条目的那个 Loader。
- [插件清单设置界面](../../client/ui-settings-plugin-inventory/README.zh.md)——渲染该清单的浏览器侧投影。

-----

<a id="model-experience"></a>
## 模型体验

无。Loader 投影与其补丁层覆盖写入不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明一个点时刻清单无法告诉客户端什么。它们是当前包约束，不是任务积压。

- **仅表示调用当下**——结果不包含持久的失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分其原因。
- **无来源**——服务不识别条目由哪个 bundle、profile 或 override 引入，也不能添加、移除、重命名或重配置插件；唯一的修改是按条目的启用/停用覆盖。
- **覆盖状态是最终一致的**——`setEntryEnabled` 提交的是文件，不是树：非 live profile 在下次启动时应用覆盖，即使是 live profile，在启动器的监视重新应用补丁层之前，`fiberPhase` 仍报告旧值。
- **实时启用启动器已提供服务的条目会大声失败并还原**——live profile 上，启动器会为组合中没有的行挂载仅监视的回退实例（目前只有 `hmr`）；之后启用该行会在 Cordis 服务注册上冲突（`service "hmr" has been registered`），调用报告 `plugin-entry-not-applied` 并删除刚写入的行。在该行启用状态下重启则正常组合，因为此时不会挂载回退实例。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
