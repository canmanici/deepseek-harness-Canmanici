---
description: "供智能体和子智能体列出已安装 skill 并开关它们的 manage_skills 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-skill-manage

[English](README.md) | 中文

## 概述

此包注册 `manage_skills` 工具。智能体或子智能体调用它来列出已安装的 skill 及其启用状态，或者按名称为所有项目或仅当前项目启用或禁用 skill。写入通过 `ctx.skillPreferences` 进行，即 Skills 页面使用的同一个服务，因此智能体做出的更改与页面中做出的更改是同一个偏好。更改会在每个智能体的下一步到达其 skill 目录。

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

随附的 base 组合在 `tool-skill` 之后加载此工具。它的参数：

| 参数 | 取值 | 作用 |
|---|---|---|
| `action` | `list`、`enable`、`disable` | `list` 返回每个已安装的 skill；其他值更改启用状态。 |
| `names` | 精确的 skill 名称 | 要更改的 skill；`enable` 和 `disable` 必需。 |
| `scope` | `global`（默认）、`project` | `project` 只为会话的项目根目录写入覆盖。 |

清单中不存在的名称、空的 `names`、没有工作目录的 `project` 范围，或未加载 `skill-preferences` 的组合，都会向模型返回错误且不做任何更改。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

此工具在调用智能体的作用域中读取 `ctx.skills.inventory()`，因此也会列出已禁用的 skill，并通过 `ctx.skillPreferences.setEnabled()` 为每个名称写入一条偏好。随后 `dsh-skill-preferences` 的注册表过滤器隐藏或恢复该 skill，`dsh-tool-skill` 在下一步记录一个替换目录，使模型可见的目录能够从会话日志重建。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具定义、校验和列表渲染 |
| — | 不发布运行时不变量伴随包；此工具不保存状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [skill-preferences 包](../skill-preferences/README.zh.md)——全局和按项目偏好如何解析。
- [tool-skill 包](../tool-skill/README.zh.md)——反映每次更改的目录。

-----

<a id="model-experience"></a>
## 模型体验

### 工具模式

#### 模型看到的内容

模型看到生成的 [`manage_skills` 模式](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-skill-manage)。

#### Token 影响

在工具可见的每个请求中有固定的模式成本。

#### KV Cache 影响

模式属于稳定的工具前缀，步骤之间不会变化。

### 工具结果

#### 模型看到的内容

`list` 返回一行计数和每个 skill 一行，或 `No skills are installed.`；`enable` 和 `disable` 返回一行确认。

##### Result templates

```markdown
<on> of <total> skills enabled.
- `<name>` (<enabled|disabled>, <source>): <description>

<Enabled|Disabled> `<name>`, `<name>` for <every project|project <root>>. The skill catalog updates at the next step.
```

#### Token 影响

`list` 结果随已安装 skill 的数量及其描述增长。

#### KV Cache 影响

结果追加到对话中，之前的前缀仍可缓存。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **不能安装**——此工具只更改启用状态；从市场安装 skill 仍是 Skills 页面中的用户操作，因为远程 skill 会成为模型遵循的指令。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
