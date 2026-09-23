---
description: "全局与按项目的 skill（技能）启用偏好，供无需编辑或删除 skill 即可单独开关它们的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-preferences

[English](README.md) | 中文

## 概述

本包让用户按名称开启或关闭任意 skill，可作用于所有项目或单个项目。被禁用的 skill 会从模型的 skill 目录、`skill` 工具、`/name` 命令和 `/` 建议中消失，而其文件保持不变。偏好保存在 DSH 主目录中的一个 JSON 文件里，因此项目仓库永远不会被修改。Skills 页面、`manage_skills` 智能体工具和其他管理界面通过 `ctx.skillPreferences` 服务写入；DSH 运行期间对该文件的手工编辑也会被读取。

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

随附组合以默认配置启用该插件。在偏好禁用某个 skill 之前，每个 skill 都处于启用状态。

### 解析顺序

当查找的工作目录位于某个项目内时，第一条匹配的规则决定结果：

1. 项目在 `enabled` 下列出该 skill：启用。
2. 项目在 `disabled` 下列出该 skill：禁用。
3. `global.disabled` 列出该 skill：禁用。
4. 其他情况：启用。

项目根目录是最近的包含 `.git` 的祖先目录，否则是工作目录本身，与项目 skill 发现使用的根目录相同。没有工作目录的查找只应用全局级别。

### 偏好文件

默认路径是 `<dshHome>/skill-preferences.json`，其中 `dshHome` 依次从配置、`$DSH_HOME`、`~/.dsh` 解析。

```json
{
  "version": 1,
  "global": { "disabled": ["pdf"] },
  "projects": {
    "/home/me/work/report": { "enabled": ["pdf"], "disabled": ["frontend-design"] }
  }
}
```

项目键是绝对路径。每个名称都必须是 kebab-case 的 skill 名称。服务写入文件时列表经过排序和去重，并使用仅所有者可访问的权限。

### 配置

| 字段 | 默认值 | 作用 |
|---|---|---|
| `file` | `<dshHome>/skill-preferences.json` | 偏好文件路径。 |
| `dshHome` | `$DSH_HOME`，然后 `~/.dsh` | 省略 `file` 时使用的主目录。 |
| `watch` | `true` | 外部编辑后重新加载文件。 |

### 服务

`ctx.skillPreferences` 提供：

- `setEnabled({ name, enabled, projectRoot? })` 修改全局偏好；带 `projectRoot` 时记录项目覆盖。与全局偏好一致的项目修改会移除该覆盖。
- `clearOverride({ name, projectRoot })` 移除一个项目覆盖。
- `decide(name, projectRoot?)` 返回 `{ enabled, origin }`，其中 `origin` 为 `default`、`global` 或 `project`。
- `projectRootOf(cwd)` 解析工作目录对应的项目根目录。
- `state()` 返回已提交的偏好。

每次修改在文件写入提交后发出 `skill-preferences/change` 和 `skills/change`。

### 可观察的成功与失败

- 被禁用的 skill 不会出现在 `ctx.skills.list()`、`snapshot()` 和 `get()` 中；`ctx.skills.inventory()` 仍会列出它，并带有 `disabledBy: ["skill-preferences"]`。
- 启动时文件格式错误会阻止插件加载，错误信息会指出文件和字段。
- DSH 运行期间文件变为格式错误时，所有 skill 读取都会失败，直到文件被修复，因此损坏的文件永远不会重新启用被禁用的 skill。修改操作也会拒绝覆盖格式错误的文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

该服务注册一个名为 `skill-preferences` 的 `ctx.skills` 过滤器。注册表在 `list`、`snapshot` 和 `get` 中对合并后的胜出项应用过滤器，因此任何消费方都无法绕过禁用。被禁用的胜出项不会被同名的低优先级 skill 替代。

同一进程内的修改逐个执行，并在读取-修改-写入周期内持有跨进程的 `withFileLock` 锁。文件通过 `writeFileAtomic` 提交；内存状态和目录失效在提交之后发生。当重新加载的状态与已提交状态相同时，Chokidar 监视器会忽略自身的提交。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务、过滤器注册、解析、文件校验、加锁写入和监视器 |
| — | 不发布运行时不变量配套模块；已提交状态与过滤器读取同一个内存值，因此不存在可能出现分歧的独立观测。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Skill 子系统参考](../../../docs/subsystems/skills.zh.md)——注册表过滤器接缝以及启用状态如何与提供方结合。
- [skill 包](../skill/README.zh.md)——`registerFilter()` 与 `inventory()`。
- [tool-skill 包](../tool-skill/README.zh.md)——目录变化如何在下一步到达模型。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-skill` 间接作用：被禁用的 skill 会从其渲染的目录中省略，`skill` 工具会将该名称报告为未知。

#### KV Cache 影响

一次开关会改变目录。在下一步，`dsh-tool-skill` 会在现有前缀之后追加一条已记录的替换目录，因此之前的前缀仍可缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **名称级控制**——偏好作用于 skill 名称，而不是某个提供方的副本；禁用一个名称会隐藏所有同名候选项。
- **主机本地文件**——偏好不会随用户同步到另一台机器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
