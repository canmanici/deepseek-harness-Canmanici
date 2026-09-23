---
description: "skill（技能）组地图：由提供方发现并经会话目录与 skill 工具加载的可复用 agent（智能体）指令，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# skill/ — skill 能力家族

[English](README.md) | 中文

## 概述

skill 家族让 agent 和用户仅在需要时发现并加载可复用的任务指令。使用 `skill/` 合并目录并为每个名称提供一组指令；本地目录选择 `skill-filesystem`，GitHub、归档或 URL 来源选择 `skill-sources`，搜索公开 skill 市场选择 `skill-marketplace`，逐 skill 开关选择 `skill-preferences`，官方徽章选择 `skill-badge`，Office 工作流选择 `skill-office`。需要让模型获得排序且持久的会话目录、通过 `skill` 工具加载完整指令，或接受 `/name` 直接调用时，请添加 `tool-skill`。不同来源生成相同的模型可见格式，启用模型访问前必须配置至少一个来源。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`skill/`](skill/README.zh.md) | 合并任意提供方的 skill 目录、并按名称解析出胜出 skill 的注册表 | `ctx.skills` |
| [`skill-filesystem/`](skill-filesystem/README.zh.md) | 从项目、自定义与用户目录发现 skill，并监视其变更 | 注册到 `ctx.skills` |
| [`skill-preferences/`](skill-preferences/README.zh.md) | 保存全局与按项目的 skill 启用偏好，并作为注册表过滤器强制执行 | `ctx.skillPreferences`；注册到 `ctx.skills` |
| [`skill-marketplace/`](skill-marketplace/README.zh.md) | 搜索公开 skill 市场：GitHub 仓库、claude-plugins.dev、SkillsMP 和 skills.sh | `ctx.skillMarketplace` |
| [`skill-sources/`](skill-sources/README.zh.md) | 从 GitHub 仓库、ZIP 归档和 skill 文件 URL 同步 skill，默认包含 Anthropic 公共仓库 | `ctx.skillSources`；注册到 `ctx.skills` |
| [`skill-badge/`](skill-badge/README.zh.md) | 随包附带官方「powered by dsh」徽章 skill，默认禁用 | 注册到 `ctx.skills` |
| [`skill-office/`](skill-office/README.zh.md) | 随包提供 Word、PowerPoint 和 Excel 工作流及文件结构检查 | 注册到 `ctx.skills` |
| [`tool-skill/`](tool-skill/README.zh.md) | 发布会话 skill 目录与面向模型的 `skill` 加载工具 | 注册到 `ctx.tools` |
| [`tool-skill-manage/`](tool-skill-manage/README.zh.md) | 让智能体和子智能体通过 `manage_skills` 列出 skill 并开关它们 | 注册到 `ctx.tools` |
| [`tool-workspace-dependencies/`](tool-workspace-dependencies/README.zh.md) | 为 Desktop 与 SDK 载体报告内置 Office 解释器路径和版本 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解共享词汇，再阅读 Agent Note 了解设计依据。

- [skill 子系统参考](../../docs/subsystems/skills.zh.md)——注册表、提供方约定、本地发现优先级，以及目录与工具。
- [skill 调用策略 Agent Note](../../.agents/notes/implemented/feature/2026-07-28-skill-invocation-policy.zh.md)——模型与用户调用控制。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
