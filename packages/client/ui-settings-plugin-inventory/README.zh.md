---
description: "dsh Web 客户端设置中的 Cordis Loader 清单标签页：可搜索的插件目录，含逐条目启停操作、可写性门控与配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-plugin-inventory` 向 Web 设置的「插件」分区贡献**插件列表**标签页。该标签页在首次被选择时懒调用 `ctx.remote.pluginInventory.list()`，并以可搜索的双列紧凑折叠卡片展示清单：每张收起的卡片显示模块短名称、有效启停标签，以及（对已启用条目）彩色根 fiber 状态圆点；展开卡片会显示 Loader 树条目 id、有效配置、Cordis 状态与该条目的启用/停用操作。停用需要显式确认，保存与失败状态只属于所在卡片，提交成功的切换会重新读取快照，只读部署则渲染简短提示而非操作按钮。加载、空结果、无匹配与通用失败状态只属于已挂载组件，读取失败后可以重试，且不会暴露传输细节。

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

打开设置中的「插件」分区并选择**插件列表**标签页，即可查看宿主的插件清单。插件激活期间不会读取 Remote——首次选择该标签页时才挂载组件，并通过 `api-remotes` 懒调用 `ctx.remote.pluginInventory.list()`。

### 阅读卡片

每张收起的卡片使用模块短名称作为标题，并以小标签表示有效启停状态；已启用的条目还会显示彩色根 fiber 状态圆点。展开卡片后会直接展示 Loader 树条目 id、有效配置，已启用条目还会显示 Cordis 状态；已停用条目省略重复的「未挂载」运行状态。搜索按名称与条目 id 过滤目录。

### 重试失败的读取

读取失败会在标签页内渲染通用失败状态；重试会重新执行懒 `list()` 调用，且不会暴露传输细节。

### 切换插件条目

在可写部署中展开卡片会显示**启用**或**停用**操作。停用经过确认门控：按钮变为**确认停用**/**取消**对，避免误点击破坏部署。写入进行中时卡片会播报进度并禁用其控件；提交成功的切换会重新读取快照、保持卡片展开，并显示一行效果提示——live 重载部署立即生效，否则更改在应用重启后生效。失败的写入在卡片内以告警与重试控件呈现；当宿主报告条目未实时生效时，告警会点名该条目等待的缺失服务。重新读取失败则回退到标签页级失败状态。当 `snapshot.writable` 为 `false` 时，标签页不渲染操作按钮，并显示一条说明启用状态由部署（补丁文件或 CLI）决定的提示；切换面还会拒绝任何在只读快照之后发出的调用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该标签页投影宿主拥有的快照，并拥有逐条目的切换；插件激活期间不执行任何 Remote 读取，首次选择时才取快照。

### 注册

浏览器插件注册一个 id 为 `all` 的本地化 `settings.plugins.tab` 贡献；「插件」分区拥有导航入口与标签栏。注册使用 `ctx.slots.inject()`，因此能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

### 切换状态机

标签页将卡片渲染拆分为一个内聚的卡片组件，持有每张卡片的 idle → confirming → saving → refreshed/failed 切换状态。apply 闭包从其 `list()` 结果跟踪最后已知快照的可写性，并拒绝任何在可写快照被观察到之前发出的 `setEnabled` 调用；该关系只存在于浏览器树中，不变量伴生程序没有可观察的 node 侧数据流，因此由 `tests/invariant.client.spec.ts` 演练门控的两条拒绝分支。

### 渲染

条目 id 仍作为 React key、展开标识、详情值与额外的搜索目标；代码不按字符串形状对它分类。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖设置分区、Remote 调用与宿主侧投影。

- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——本标签页注册进的「插件」分区。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.plugins.tab` 的领域底座。
- [api-remotes](../../api/remotes/README.zh.md)——`pluginInventory.list()` 背后的 Remote BFF 表面。
- [plugin-inventory](../../host/plugin-inventory/README.zh.md)——本标签页所渲染的宿主侧 Loader 投影。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端清单投影，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义清单视图的新鲜度与触达范围；它们是当前包约束。

- **每次 Settings 挂载或重试只读取一份快照**：标签页不订阅 Loader 变化，也不会在重连后自动重新读取；切换标签页会保留当前快照，重新打开 Settings 则会取得新快照。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
