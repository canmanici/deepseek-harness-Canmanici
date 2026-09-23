---
description: "远程 skill（技能）来源，供从 Anthropic 公共仓库、其他 GitHub 仓库、ZIP 归档或单个 skill 文件 URL 添加 skill 的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sources

[English](README.md) | 中文

## 概述

本包从远程来源添加 skill：GitHub 仓库、ZIP 归档，或位于 HTTPS URL 的单个 Markdown skill 文件。一次同步会把来源下载到 DSH 主目录，并记录其中包含的 skill；模型和用户随后可以像使用本地 skill 一样使用它们。随附组合默认启用 [Anthropic 公共 skill 仓库](https://github.com/anthropics/skills)，并在 Web 或 Desktop 应用启动时下载它。用户通过 Skills 页面调用的 `ctx.skillSources` 服务添加、禁用、重新同步或移除来源；该页面也会把公开市场中的单个 skill 安装到某个来源的选择中。

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

### 来源 URL

| URL 形式 | 来源 |
|---|---|
| `https://github.com/<owner>/<repo>` 或 `github:<owner>/<repo>` | 仓库的默认分支 |
| `https://github.com/<owner>/<repo>/tree/<ref>/<path>` | 一个 ref，限定在一个子目录 |
| `https://github.com/<owner>/<repo>/blob/<ref>/<file>.md` | 一个 skill 文件，从 `raw.githubusercontent.com` 读取 |
| `https://<host>/<name>.zip` | 一个 ZIP 归档 |
| `https://<host>/<name>.md` | 一个 skill 文件 |

显式的 `ref` 或 `path` 会覆盖 URL 中嵌入的值。只会获取 HTTPS，携带凭据的 URL 会被拒绝。

### 同步做什么

GitHub 来源的同步会向 GitHub API 查询所配置 ref 的提交，若该提交已是当前版本则跳过下载。否则它会下载仓库归档，提取所配置子目录下的文件，并查找最多六层深、包含有效 `SKILL.md` 的每个目录。发现过程不会进入 skill 目录内部，因此其中的脚本和参考资料仍是该 skill 的资源。按路径排序最先出现的目录赢得重名，无效或过大的 `SKILL.md` 会被跳过并给出警告。

归档和 skill 文件来源用下载字节的 SHA-256 代替提交。skill 文件来源会成为一个以其 frontmatter `name` 命名的 skill 目录。

同步把结果写入 `<dshHome>/skill-sources/<id>/<commit>/`，然后将 `current.json` 切换到该目录。同步失败时保留之前的 skill，并在来源上报告错误。

### 服务

`ctx.skillSources` 提供：

- `list()` 返回每个来源及其 `origin`（`default` 或 `user`）、`kind`、`enabled`、可选的 `skills` 选择，以及 `sync`（`state`、`commit`、`syncedAt`、`error`、`skillCount`、`availableCount`、`updateAvailable`、`latest`、`checkedAt`）。
- `add({ url, ref?, path?, skills?, id? })` 校验 URL，保存一个用户来源（未给出 id 时从 URL 派生），并开始首次同步。`skills` 只安装指定的 skill；每一项匹配 skill 的名称或其目录的最后一段。
- `sync(id)` 重新下载一个来源；并发调用共享一次同步。
- `setEnabled(id, enabled)` 隐藏或恢复来源的 skill，不删除文件。
- `setSkills(id, skills)` 替换已安装的选择而无需重新下载；`undefined` 会安装用户来源的全部 skill，并恢复默认来源配置的选择。
- `offers(id)` 列出当前代包含的每个 skill，以及选择是否安装了它。
- `checkUpdate(id)` 向 GitHub API 查询该 ref 的最新提交而不下载，当它与当前代不同时设置 `sync.updateAvailable`。归档和单文件来源在同步下载到不同字节之前不报告更新。
- `remove(id)` 删除用户来源及其文件。默认来源则会被隐藏，因此配置不会将其恢复。

每次变更都会发出 `skill-sources/change` 并使 skill 目录失效。用户来源和默认来源的覆盖保存在 `<dshHome>/skill-sources.json` 中。

### 配置

| 字段 | 默认值 | 作用 |
|---|---|---|
| `defaultSources` | `[]`；随附的 base 组合列出 `anthropic-skills` | 每个用户初始拥有的来源：`id`、`url`，以及可选的 `ref`、`path`、`skills` 和 `enabled`。空的 `skills` 列表会安装全部 skill。 |
| `autoSyncOnStart` | `true`；随附的 base 组合仅为 `web` 和 `desktop` profile 启用 | 插件启动时同步从未同步过的已启用来源。 |
| `rank` | `450` | 远程 skill 在同一注册表层内的优先级；项目、自定义和 `~/.dsh/skills` 中的 skill 赢得重名，因此自定义副本会取代远程 skill。`~/.agents/skills` 和内置 skill 输给它。 |
| `githubTokenRef` | `GITHUB_TOKEN` | 通过 `ctx.credentials` 为 GitHub 请求解析的凭据引用；空字符串表示不发送令牌。 |
| `githubApiUrl` | `https://api.github.com` | GitHub REST API 基础 URL。 |
| `maxDownloadBytes`、`maxExtractedBytes`、`maxFiles`、`maxSkillBytes`、`maxDiscoveryDepth`、`fetchTimeoutMs` | 64 MiB、256 MiB、10000、1 MiB、6、120 秒 | 下载、提取、发现和超时上限。 |
| `dshHome` | `$DSH_HOME`，然后 `~/.dsh` | 保存来源列表和已同步文件的主目录。 |
| `allowHttpLoopback` | `false` | 允许对回环主机使用明文 HTTP，用于本地镜像和测试。 |

### 信任

远程 skill 一旦加载，就是模型会遵循的指令。只添加你信任的来源，就像对待依赖一样。同步永远不会执行来源中的文件，带有绝对路径或父目录相对路径的归档条目会中止同步。

### 可观察的成功与失败

- 同步之后，每个 skill 以来源 `remote:<id>` 出现在 `ctx.skills.list()` 和模型目录中。
- 网络、HTTP、归档或上限失败会把 `sync.state` 设为 `error` 并附上消息，同时保留之前的 skill。
- 格式错误的 `skill-sources.json`、`current.json` 或清单会阻止插件加载，并指出该文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

发现在同步时运行并写入清单，因此目录查找只读取内存，从不访问网络或扫描远程目录树。每一代都位于以提交命名的目录中；暂存目录树先被重命名到位，然后 `current.json` 才会切换，之后再删除上一代。来源列表写入持有跨进程文件锁，并通过原子重命名提交。释放时会中止进行中的下载。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、提供方注册、来源列表、同步流程和文件校验 |
| [`src/source-spec.ts`](src/source-spec.ts) | 将 URL 解析为 GitHub、归档和 skill 文件获取计划 |
| [`src/fetch.ts`](src/fetch.ts) | HTTPS 策略、重定向、超时和字节上限 |
| [`src/archive.ts`](src/archive.ts) | 带路径与大小检查的 ZIP 提取，以及同步时发现 |
| — | 不发布运行时不变量配套模块；提供方读取的正是同步提交的同一份内存中各代数据，因此不存在可能出现分歧的独立观测。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Skill 子系统参考](../../../docs/subsystems/skills.zh.md)——提供方约定以及远程 skill 与本地 skill 的优先级关系。
- [skill-filesystem 包](../skill-filesystem/README.zh.md)——`parseSkillDocument()`，共享的 `SKILL.md` 规则。
- [skill-preferences 包](../skill-preferences/README.zh.md)——逐 skill 启用控制，同样作用于远程 skill。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-skill` 间接作用：它在目录中渲染远程 skill，并以已同步目录作为资源基础返回其正文。

#### KV Cache 影响

改变 skill 集合的同步会改变目录；`dsh-tool-skill` 在下一步追加一条已记录的替换目录，之前的前缀仍可缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有定时更新**——`checkUpdate()` 会报告更新的提交，但来源只在用户同步它，或从未同步过的来源在 `autoSyncOnStart` 下启动时才会改变。
- **整仓下载**——安装一个 skill 也会下载整个仓库归档；选择只决定暴露哪些已发现的 skill。
- **仅支持 ZIP**——不支持 tar 归档以及 GitHub API 之外的 git 协议。
- **匿名 GitHub 速率限制**——没有令牌时，GitHub 对每个 IP 地址每小时允许 60 次 API 请求。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
