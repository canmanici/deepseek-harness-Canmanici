---
description: "skillManager Remote，供 Skills 页面的维护者阅读：已安装 skill（技能）、逐 skill 启用状态、编写、市场安装、更新和远程 skill 来源。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-skill-manager

[English](README.md) | 中文

## 概述

本包提供 Web **Skills** 页面调用的 `skillManager` Remote 命名空间。它列出每个已安装的 skill 及其启用状态，在全局或按项目开关 skill，并创建、编辑、自定义和删除 skill。它搜索公开市场，安装和卸载单个 skill，检查来源更新并管理远程来源。启用状态通过 `ctx.skillPreferences` 持久化，安装通过 `ctx.skillSources` 持久化，用户 skill 是 `<dshHome>/skills` 下的 `SKILL.md` 文件。

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

随附的 Web 组合在 `plugin-inventory` 旁挂载 `skill-manager` 行。插件需要 `ctx.skills`；skill 偏好、skill 来源、工作区注册表和 agent 预设名册都是可选的。

### Remote 方法

| 方法 | 结果 |
|---|---|
| `inventory({ projectRoot? })` | 排序后的 skill 及其 `enabled` 和 `preference`（`default`、`global` 或 `project`）、工作区项目，以及偏好和来源是否已挂载 |
| `setEnabled({ name, enabled, projectRoot? })` | 全局偏好；带 `projectRoot` 时为项目覆盖 |
| `clearOverride({ name, projectRoot })` | 移除一个项目覆盖 |
| `sources()` | 远程来源及其同步状态、提交、时间、错误、已安装和可用数量以及更新状态 |
| `addSource({ url, ref?, path? })` | 添加来源并开始首次同步 |
| `syncSource({ id })`、`setSourceEnabled({ id, enabled })`、`removeSource({ id })` | 来源操作 |
| `readSkill({ name })` | 任一已安装 skill 的字段、文件路径以及能否就地编辑 |
| `createSkill(draft)` | 写入 `<dshHome>/skills/<name>/SKILL.md`；名称已被任一已安装 skill 使用时拒绝 |
| `updateSkill(draft)` | 就地重写本地 skill 的字段并保留其他 frontmatter 键；名称不能更改 |
| `deleteSkill({ name })` | 删除用户 skill 的包目录或扁平 Markdown 文件；删除自定义副本会恢复原 skill |
| `customizeSkill({ name })` | 把远程或内置 skill 的目录复制到 `<dshHome>/skills`，副本的排名高于原 skill |
| `marketplaces({ refresh? })` | 带 skill 数量的市场；`refresh` 会先询问它们 |
| `searchMarketplace({ query, marketplace?, offset?, limit? })` | 标记为 `available`、`installing` 或 `installed` 的市场条目，同名已安装 skill 会带 `conflict` 来源标签 |
| `installSkill({ repository, dir?, name })` | 把 skill 加入跟踪该仓库的来源的选择，或添加一个只安装此 skill 的来源，并同步它 |
| `uninstallSkill({ name })` | 从来源的选择中移除一个远程 skill；被清空的用户来源会被移除 |
| `sourceSkills({ id })`、`setSourceSkills({ id, skills? })` | 来源提供的 skill，以及替换其选择 |
| `checkUpdates()` | 向每个已启用的 GitHub 来源查询其最新提交 |

清单读取默认 agent 预设的作用域，因此列出的正是新会话能看到的 skill。工作区项目以按项目偏好使用的同一项目根目录为键。当胜出文件来自用户、`~/.agents`、项目或自定义 skill 目录时，skill 可就地 `editable`；当该文件是 `<dshHome>/skills/<name>/SKILL.md` 或 `<dshHome>/skills/<name>.md` 时为 `deletable`；其他带文件的 skill 为 `customizable`；来自远程来源的 skill 为 `uninstallable`。草稿包含 `name`、`description`、可选的 `whenToUse`、`body`、`modelInvocable` 和 `userInvocable`；服务按本地发现所用的同一规则渲染它，因此保存的 skill 总能加载。部署覆盖 `dshHome` 时，请将其设为与 `dsh-skill-filesystem` 相同的值。

### 事件与错误

每当 `skills/change`、`skill-preferences/change` 或 `skill-sources/change` 触发时，宿主会转发 `skill-manager/changed`；客户端随后重新获取视图。每次写入 skill 文件后它会发出 `skill-filesystem/changed`，使目录无需等待文件监视器即可更新。写入组合未挂载的服务会以 `skill-manager/unavailable` 失败；校验失败会以携带其消息的 `skill-manager/invalid-request` 失败；编辑非本地 skill、自定义本地 skill 或卸载非远程 skill 会以 `skill-manager/read-only` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `SkillManager` Remote 服务、投影和事件转发 |
| [`src/authoring.ts`](src/authoring.ts) | `SKILL.md` 渲染与解析，以及用户 skill 目录 |
| [`src/types.ts`](src/types.ts) | 线上类型、错误详情和 `skill-manager/changed` 事件声明 |
| — | 不发布运行时不变量配套模块；该服务不持有任何可能与其读取的服务出现分歧的状态。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Skill 子系统参考](../../../docs/subsystems/skills.zh.md)——过滤器、偏好和远程来源。
- [ui-skill-library](../../client/ui-skill-library/README.zh.md)——调用此 Remote 的 Skills 页面。
- [skill-marketplace](../../skill/skill-marketplace/README.zh.md)——市场搜索所用的服务。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是 Remote 管理视图；写入经由 `dsh-skill-preferences` 和 `dsh-skill-sources` 到达模型，它们会改变 `dsh-tool-skill` 渲染的目录。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **默认预设视图**——清单列出默认 agent 预设的 skill；其他预设通过自己的目录添加的 skill 不会显示。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
