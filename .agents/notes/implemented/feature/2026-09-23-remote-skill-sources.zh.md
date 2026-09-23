# Agent Note：同步到磁盘的远程 skill 来源

状态：已实现

[English](2026-09-23-remote-skill-sources.md) | 中文

## 问题

用户希望无需手工复制文件，就能从 Anthropic 公共仓库、其他 GitHub 仓库和任意网页 URL 获取 skill（技能），并在 GUI（图形界面）中管理。注册表已经接受远程提供方，但没有任何提供方真正获取内容；而且 [skill 系统](../../archived/feature/2026-07-05-skill-system.md) 为本地根目录否决了嵌套递归的 `SKILL.md` 发现，而像 `anthropics/skills` 这样的公共仓库把 skill 放在 `skills/<name>/` 之下。

## 决定

`dsh-skill-sources` 持有 `ctx.skillSources` 并注册一个 `ctx.skills` 提供方。来源可以是 GitHub 仓库（可选 ref 和子目录）、ZIP 归档 URL 或单个 skill 文件 URL。同步通过 REST API 解析 GitHub 提交，跳过未变化的提交，下载 zipball，在路径和大小检查下提取，并在同步时按配置的深度发现 skill 目录。结果是 `<dshHome>/skill-sources/<id>/` 下以提交命名的一代中的清单；只有在这一代完整后 `current.json` 才会切换，同步失败则保留上一代。提供方从内存清单中列出候选项，因此查找永远不会访问网络，查找时的发现仍保持扁平。

默认来源是 Loader 配置。随附的 base 组合将 `https://github.com/anthropics/skills` 列为已启用的 `anthropic-skills`，并且只在 `web` 和 `desktop` profile 中于启动时同步从未同步过的来源，因此 CLI、SDK 和测试组合在启动时不会下载。用户添加的来源和默认来源的覆盖保存在 `<dshHome>/skill-sources.json` 中；移除默认来源会记录一个删除标记，使配置不会将其恢复。远程候选项使用来源 `remote:<id>` 和 rank 350，在同一层内位于自定义目录与用户 DSH 目录之间。[注册表过滤器](2026-09-23-skill-enablement-filters.zh.md) 提供的启用控制原样作用于远程 skill。

## 考虑过的替代方案

**每次查找时获取。** 被否决，因为每一步都会读取目录，网络失败会使目录不完整，而且 skill 正文可能在发现与加载之间发生变化。

**用 git 克隆。** 被否决，因为它引入宿主二进制依赖和凭据处理；GitHub zipball 加提交查询用普通 HTTPS 就能提供同样的固定版本。

**在 `dsh-skill-filesystem` 根目录中递归发现。** 以与之前相同的理由被否决：查找时扫描大型目录树。同步时发现把成本限制为每个提交一次扫描。

**通过插件管理器将来源作为 npm 包添加。** 被否决，因为 skill 包是 Markdown 目录树而不是插件，而且需要发布。

## 影响

GUI 调用 `ctx.skillSources` 来列出、添加、同步、启用和移除来源，并读取 `sync.state` 和 `sync.error` 显示状态。远程 skill 是模型会遵循的指令，因此 README 要求用户像对待依赖一样信任来源；同步永远不会执行来源文件。单元测试针对回环服务器覆盖 URL 解析、获取策略、提取防护、发现、同步、回滚、持久化和释放；组装加载器快照通过随附组合完成同步；一个需显式开启的网络测试会同步真实的 Anthropic 仓库。
