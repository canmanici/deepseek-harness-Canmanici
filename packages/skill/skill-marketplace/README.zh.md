---
description: "面向从 GitHub 仓库、claude-plugins.dev、SkillsMP 和 skills.sh 搜索并安装 skill 的用户的公开 skill 市场。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-marketplace

[English](README.md) | 中文

## 概述

此包通过 `ctx.skillMarketplace` 搜索公开的 skill 市场。一个市场要么是一个被扫描 `SKILL.md` 文件的 GitHub 仓库，要么是一个公开搜索 API：claude-plugins.dev、SkillsMP 或 skills.sh。每个结果都指明保存该 skill 的 GitHub 仓库和目录，[dsh-skill-sources](../skill-sources/README.zh.md) 从那里安装它。此包不包含任何 skill 列表；每个条目都在搜索运行时来自网络。随附的 Web 组合列出了十六个市场。

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

### 市场类型

| `kind` | `url` | 空查询 | 数量 |
|---|---|---|---|
| `github` | 仓库 URL，可带 `/tree/<ref>/<path>` | 列出每个 skill 目录 | `SKILL.md` 目录的数量 |
| `claude-plugins-dev` | `https://claude-plugins.dev` | 列出 skill | API 的 `total` |
| `skillsmp` | `https://skillsmp.com` | 不返回结果；API 需要查询词 | 查询时 API 的 `pagination.total` |
| `skills-sh` | `https://skills.sh` | 不返回结果；API 需要两个字符 | 无 |

一个 `github` 市场在每个缓存周期内消耗一次 GitHub API 请求：一次递归的树列表。描述来自 `raw.githubusercontent.com`，只为一页显示的条目读取。

### 服务

`ctx.skillMarketplace` 提供：

- `list()` 返回每个市场及其 `browsable`，以及最近一次 `refreshCounts()` 得到的数量或错误。
- `refreshCounts()` 询问每个已启用的可浏览市场提供多少个 skill。
- `search({ query, marketplace?, offset?, limit? })` 搜索一个市场或每个已启用的市场。结果按 `<owner>/<repo>/<directory>` 去重，并按配置顺序在各市场之间交错排列。结果带有每个市场的 `totals`、`hasMore`、`nextOffset` 和 `errors`；一个市场失败不会使搜索失败。

### 配置

| 字段 | 默认值 | 作用 |
|---|---|---|
| `marketplaces` | `[]`；随附的 Web 组合列出十六个 | 条目包含 `id`、`title`、`kind`、`url` 和 `enabled`。 |
| `pageSize` | `24` | 搜索指定一个市场时每页的条目数。 |
| `mixedPageSize` | `6` | 搜索覆盖所有市场时每个市场的条目数。 |
| `maxPageSize` | `100` | 搜索可请求的最大 `limit`。 |
| `cacheTtlMs` | 30 分钟 | 响应保持缓存的时长。 |
| `fetchTimeoutMs`、`maxResponseBytes` | 20 秒、8 MiB | 单次请求的上限。 |
| `maxRepositorySkills`、`maxDiscoveryDepth`、`scanConcurrency` | 2000、6、8 | 一个 `github` 市场的上限。 |
| `githubApiUrl`、`githubRawUrl` | `https://api.github.com`、`https://raw.githubusercontent.com` | GitHub 端点。 |
| `githubTokenRef` | `GITHUB_TOKEN` | 随 GitHub API 请求发送的凭据引用；空字符串表示不发送。 |
| `allowHttpLoopback` | `false` | 允许测试时对回环主机使用明文 HTTP。 |

### 可观察的成功与失败

- 搜索返回的条目包含 `marketplace`、`key`、`name`、`repository`、`url`，以及市场报告时的 `description`、`dir`、`installs` 和 `stars`。
- HTTP 失败、超时或无效 JSON 会出现在 `errors` 中，与其他市场的结果并列，失败的响应不会被缓存。
- 未知或已禁用的 `marketplace` id 会使搜索被拒绝；格式错误的市场条目会使插件在加载时失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

此服务从不安装任何东西。每个解析器把一个 API 的 JSON 映射为指向 GitHub 仓库的条目，因此安装总是经过带有提交固定和归档检查的 skill 来源。没有 GitHub 位置的条目会被丢弃。响应按 URL 缓存，并发调用者共享同一个进行中的请求。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、配置、分页、缓存和 GitHub 仓库扫描 |
| [`src/catalogs.ts`](src/catalogs.ts) | 每个市场 API 以及 GitHub 树的 JSON 解析器 |
| — | 不发布运行时不变量伴随包；此服务不保存任何可能被其他观察结果推翻的状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [skill-sources 包](../skill-sources/README.zh.md)——通过把条目的仓库加入某个来源的选择来安装市场条目。
- [Skill 子系统参考](../../../docs/subsystems/skills.zh.md)——远程 skill 与本地 skill 的排名关系。

-----

<a id="model-experience"></a>
## 模型体验

无，因为市场搜索只服务于 Skills 页面，它返回的任何内容都不会进入模型请求。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **匿名 GitHub 速率限制**——没有令牌时 GitHub 每小时允许 60 次 API 请求，每个 `github` 市场每个缓存周期使用一次。
- **仓库搜索匹配路径**——`github` 市场按目录路径而非描述进行筛选。
- **第三方 API**——claude-plugins.dev、SkillsMP 和 skills.sh 的响应字段没有版本；字段变化会丢弃条目而不是失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
