---
description: "位于 Plugins 下方的 Web Skills 页面，供在公开市场查找 skill（技能）、一键安装、开关、编辑任意 skill 并保持来源最新的用户阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-library

[English](README.md) | 中文

## 概述

此包在 Web 和桌面端侧边栏中 **Plugins** 的正下方添加 **Skills** 入口。**发现**搜索公开的 skill 市场，一键安装 skill。**已安装**按来源列出每个 skill，带有开关、查看指令的检查器，以及编辑、自定义、卸载或删除操作。**来源**显示每个已同步的仓库，检查更新并更新它。**新建技能**把你自己的 skill 写入 `~/.dsh/skills`。

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

点击侧边栏中的 **Skills**。随附的 Web 组合挂载 `ui-skill-library` 行；它需要 Host 的 `skill-manager` 行，**发现**还需要 Host 的 `skill-marketplace` 行。

### 发现

- 搜索框在输入停顿后查询每个已启用的市场；每个市场标签显示它提供或匹配的 skill 数量，对没有查询就不列出内容的市场显示**仅搜索**，统计失败后显示**无法访问**。
- 每张卡片显示市场、已报告的安装数和星数、skill 的 `/name`、描述及其仓库。**安装**添加该 skill；**已安装**标记已存在的 skill，并且会提示已安装的同名 skill。
- **加载更多**追加下一页。

### 已安装

- **全部**、**开启**和**关闭**按状态筛选；作用范围选择器把开关应用到所有项目，或作为可恢复的覆盖应用到某个工作区项目。
- 选择一个 skill 会打开检查器：来源、`/name`、描述、电源开关、调用标签、何时使用的说明、渲染后的指令和文件路径。
- 本地 skill 显示**编辑**。远程和内置 skill 显示**自定义**，它把 skill 复制到 `~/.dsh/skills`，副本会取代原 skill；删除副本即可恢复。远程 skill 显示**卸载**，`~/.dsh/skills` 中的 skill 显示**删除**；两者都会请求确认。
- 横幅报告有更新的来源，并提供**全部更新**。

### 来源

- 每张卡片显示来源类型、带 ref 和子目录的 URL、已安装与可用的 skill 数、短提交、同步时间，以及更新检查后的**有更新**。
- **检查更新**向每个 GitHub 来源查询其最新提交；**更新**或**同步**下载它。**添加来源**接受 GitHub、`.zip` 或 `SKILL.md` 链接。

### 新建与编辑 skill

编辑器接受按调用方式输入的名称、智能体据以路由的描述、可选的何时使用说明、带**预览**标签的 Markdown 指令，以及控制模型调用和 `/` 命令调用的开关。编辑时名称固定，并保留其他 frontmatter 键。

当 Host 报告 `skill-manager/changed` 时页面会刷新，包括来自其他窗口、CLI、智能体的 `manage_skills` 调用或文件编辑的更改。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`SkillsController` 持有一个快照存储。它在页面首次渲染时读取清单和来源并随后检查更新，在**发现**首次渲染时读取市场，乐观地应用开关并在 Host 拒绝时回滚，并忽略已被更新请求取代的响应。安装会一直显示**正在安装**，直到清单中出现同名的远程 skill。所有文案都在 `locales.ts` 中；颜色来自共享的 `--dsw-alias-*` 令牌，布局断点是页面自身的容器查询。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 侧边栏入口、主面板注册和 Host 事件刷新 |
| [`src/client/controller.ts`](src/client/controller.ts) | 页面状态和 Remote 往返 |
| [`src/client/SkillLibraryPage.tsx`](src/client/SkillLibraryPage.tsx) | 页头、视图标签和通知 |
| [`src/client/DiscoverView.tsx`](src/client/DiscoverView.tsx) | 市场搜索、标签和结果卡片 |
| [`src/client/LibraryView.tsx`](src/client/LibraryView.tsx) | 已安装列表、筛选、作用范围选择器和更新横幅 |
| [`src/client/SkillInspector.tsx`](src/client/SkillInspector.tsx) | skill 检查器及其操作 |
| [`src/client/SkillEditor.tsx`](src/client/SkillEditor.tsx) | 带 Markdown 预览的新建与编辑表单 |
| [`src/client/SourcesView.tsx`](src/client/SourcesView.tsx) | 来源卡片、更新检查以及添加和移除对话框 |
| [`src/client/helpers.ts`](src/client/helpers.ts) | 分组、标签、链接类型和安装状态 |
| [`src/client/SkillLibrary.module.css`](src/client/SkillLibrary.module.css) | 样式 |
| [`src/client/locales.ts`](src/client/locales.ts) | 英文和中文文案 |
| — | 不发布运行时不变量伴随包；页面渲染由一个 Remote 驱动的一个存储。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [host-skill-manager](../../host/skill-manager/README.zh.md)——此页面调用的 Remote。
- [skill-marketplace](../../skill/skill-marketplace/README.zh.md)——**发现**搜索的市场。
- [skill-preferences](../../skill/skill-preferences/README.zh.md) 和 [skill-sources](../../skill/skill-sources/README.zh.md)——开关和安装持久化的位置。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包是浏览器端页面，不注册任何面向模型的内容；启用状态和安装通过 skill 目录到达模型。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **不能重命名**——通过用新名称创建 skill 并删除旧 skill 来重命名。
- **同名安装**——安装一个与已安装 skill 同名的 skill 会显示警告；排名较高者保持生效。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
