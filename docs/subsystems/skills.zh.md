# Skills

[English](skills.md) | 中文

[skill（技能）能力族](../../packages/skill) 包含 Service Definition（[dsh-skill](../../packages/skill/skill)，`ctx.skills`）、本地 Service Provider（[dsh-skill-filesystem](../../packages/skill/skill-filesystem)）、可选的随包提供方（[dsh-skill-badge](../../packages/skill/skill-badge) 与 [dsh-skill-office](../../packages/skill/skill-office)）和 Consumer（[dsh-tool-skill](../../packages/skill/tool-skill)）。注册表在其宿主层与各 scope 层之间合并各提供方的目录；提供方贡献本地或随包 skill；Consumer 拥有初始目录和替换目录，以及面向模型的 `skill` 工具。skill 是可选的指令而非会话事件，因此其词汇定义在此处而非 [core.md](core.zh.md)。

源码：[`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts)、[`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts)、[`packages/skill/skill-badge/src/index.ts`](../../packages/skill/skill-badge/src/index.ts)、[`packages/skill/skill-office/src/index.ts`](../../packages/skill/skill-office/src/index.ts) 与 [`packages/skill/tool-skill/src/index.ts`](../../packages/skill/tool-skill/src/index.ts)。

## 提供方注册表

`ctx.skills` 组合本地、内嵌、远程或其他提供方。注册是同步的；远程初始化与发现属于 `list()` 的 await 阶段。提供方对象、选项与候选项以只读方式借用，语义字段会被校验。

注册表采用宿主 + 按 scope 的分层结构，即[工具注册表](tools.zh.md)在 [dsh-scope](../../packages/core/scope) 之上确立的形态：注册会落入调用方上下文 scope 对应的层——宿主行与 repository 插件落入全局层，由 agent（智能体） preset 常驻组合挂载的插件落入该 preset 的层——提供方名称在每层内唯一，而非进程级唯一。读取时将全局层与观察 scope 的链合并：最近层的条目直接赢得重名 skill，下文的 rank 顺序只在单层内裁决重名。发现缓存以解析后的 scope 链为键，因此重设 scope 父级（空会话重组）无需注册表变更即可被下一次读取看到。

在单层内，重名项依次按 rank、提供方顺序和本地顺序确定优先级；摘要按名称排序。提供方的 `list()` 被拒绝时，系统会记录日志，并从不完整观测中省略该提供方的结果；显式的不完整观测会提供可用候选项，但不会使结果变得可缓存；格式错误的候选项快速失败。每个提供方工厂都会接收一项注册作用域内的控制能力；仅当该精确注册仍处于活动状态时，其 `invalidate()` 才会清除已完成目录；注册失败或 dispose（资源释放）时，其信号会中止。若提供方代次在发现进行期间发生变化，该发现会重试一次；若再次变化，则返回最新候选项，并将结果标为不完整且不予缓存。提供方和运行时变更会发出不带过滤条件的 `skills/change` 失效事件；该事件不携带 diff，因此消费方会使用自身的查找选项重新获取 `snapshot()`。

`SkillProvider.list()` 返回的数组是完整发现的简写形式。`SkillProviderObservation` 允许提供方公开仍可直接加载的候选项，同时报告该观测不具权威性。

```ts type-equiv
/** Provider candidates plus whether the current discovery is authoritative. */
interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}
```

```ts type-equiv
/** Provider interface for one source of skills, such as local directories or a remote registry. */
interface SkillProvider {
  /** Unique provider name in the `ctx.skills` registry. */
  readonly name: string
  /**
   * List available skill candidates for the current lookup context. Provider
   * plugins register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method. Implementations
   * should settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
```

```ts type-equiv
/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidate completed catalogs and notify consumers only while the exact registration remains active. */
  readonly invalidate: () => void
}
```

## 启用过滤器

过滤器决定每次读取暴露哪些合并胜出项。`ctx.skills.registerFilter()` 按唯一名称注册一个宿主范围的过滤器；注册、释放以及控制对象的 `invalidate()` 都会发出 `skills/change`。`list`、`snapshot` 和 `get` 为本次查找解析所有过滤器，并省略被任一过滤器禁用的胜出项，因此模型目录、`skill` 工具、`/name` 调用和浏览器 Session 目录观察到相同的决定。同名的低优先级候选项不会替代被禁用的胜出项。`resolve()` 被拒绝时读取也会被拒绝，而不会暴露过滤器本应禁用的 skill。过滤器收到的 `SkillFilterControl` 与 `SkillProviderControl` 具有相同的 `signal` 和 `invalidate()` 成员。`inventory()` 返回 `SkillInventorySnapshot`：为管理界面列出每个胜出项及其 `enabled` 和禁用它的过滤器名称；它从不加载正文。

```ts type-equiv
/**
 * Enablement policy the registry applies to merged winners before any read
 * lists or loads them. A disabled winner is absent from every surface; a
 * lower-ranked candidate with the same name does not take its place.
 */
interface SkillFilter {
  /** Unique filter name, reported as the reason in {@link SkillInventoryEntry.disabledBy}. */
  readonly name: string
  /**
   * Resolve the predicate for one lookup. A rejection rejects the calling
   * read, so a failing policy never exposes a skill it would disable.
   * @param options - lookup options; `cwd` selects workspace-sensitive policy and `signal` cancels work.
   * @returns the predicate applied to every merged winner of this lookup.
   */
  readonly resolve: (options: SkillLookupOptions) => Promise<SkillEnablement>
}
```

随附的过滤器是 [dsh-skill-preferences](../../packages/skill/skill-preferences)：全局禁用保存在 `<dshHome>/skill-preferences.json` 中，并可按项目根目录用 `enabled` 和 `disabled` 列表覆盖。`ctx.skillPreferences.state()` 以 `SkillPreferencesState` 返回该文件；`setEnabled()` 接收 `SetSkillEnabledRequest`，`clearOverride()` 接收 `ClearSkillOverrideRequest`，`decide()` 返回 `SkillEnablementDecision`，指明做出决定的级别（`default`、`global` 或 `project`）。

## 本地发现优先级

随附的本地提供方按 rank 顺序扫描各根目录：

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 450 | `remote:<id>` | [dsh-skill-sources](../../packages/skill/skill-sources) 已同步的代，而非本地根目录 |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | 配置了 `Config.bundledSkillDir` 时使用该目录 |

项目根目录为包含 `.git` 的最近祖先目录；找不到时使用当前 cwd。当 `ctx.fs` 可用时，git-root 向上查找通过文件系统服务探测 `.git`，使远程或沙箱工作区不会回退到宿主文件系统边界。用户 DSH 根目录会跳过其 `.system` 子目录。本地提供方不会合成内置系统 skill；部署方通过已配置的 bundled 根目录或专用提供方提供随包 skill。

`dsh-skill-badge` 在 `BUNDLED_SKILL_RANK` 注册一个不可变的 `bundled` 候选项，并通过 `resourceBase` 公开其随包资产目录。交付的 CLI（命令行界面）将该插件声明为禁用，因此启用其组合配置行即为显式选择加入。

Chokidar 会监视现有根目录中直属 bundle 和平铺条目的添加与移除，以及直属 skill 条目的变更。缺失的根目录会从最近的现有祖先开始，逐个跟踪缺失路径段，直至 Chokidar 可以附加。bundle 下的资源文件变更不属于目录变更。面向模型的 `write` 和 `edit` 观测会在目标路径与目录相关时同步使提供方目录失效，而宿主 watcher 覆盖 IDE、Git、shell 和外部进程产生的变更。watcher 失败会使当前观测不完整，但不会在直接加载时隐藏可读候选项；项目作用域 watcher 使用按配置设限的 LRU。

## 远程来源

[dsh-skill-sources](../../packages/skill/skill-sources) 通过 `ctx.skillSources` 从 GitHub 仓库、ZIP 归档和单个 skill 文件 URL 贡献 skill。每次同步把来源下载到 `<dshHome>/skill-sources/<id>/` 下以提交命名的代中，在此时发现包含有效 `SKILL.md` 的目录，并将其记录在清单中；`list()` 只读取已启用来源的内存清单，因此目录查找永远不会访问网络。远程候选项的来源为 `remote:<id>`，rank 为 450，因此 `<dshHome>/skills` 中的副本会取代同名的远程 skill。来源可以只安装其 skill 的一个选择，`checkUpdate()` 在不下载的情况下比较 GitHub 来源的最新提交与已同步的提交。`ctx.skillSources.list()` 返回 `SkillSourceView` 值，`add()` 接收 `AddSkillSourceRequest`。随附的 base 组合将 Anthropic 公共仓库列为默认来源，并且只在 `web` 和 `desktop` profile 中于启动时同步从未同步过的来源。

## Skills 页面与智能体管理

位于侧边栏 **Plugins** 下方的 Web **Skills** 页面调用 [dsh-host-skill-manager](../../packages/host/skill-manager) 的 `skillManager` Remote。它在默认 agent 预设的作用域中读取 `ctx.skills.inventory()`，通过 `ctx.skillPreferences` 写入启用状态，通过 [dsh-skill-marketplace](../../packages/skill/skill-marketplace) 搜索公开市场，通过 `ctx.skillSources` 安装单个 skill 并检查更新，就地编辑本地 skill，通过复制到 `<dshHome>/skills` 来自定义远程和内置 skill，并在那里创建和删除用户 skill。智能体和子智能体通过 [dsh-tool-skill-manage](../../packages/skill/tool-skill-manage) 的 `manage_skills` 工具更改启用状态，它写入相同的偏好。每次写入文件后它会发出 `skill-filesystem/changed`，本地提供方将其视同第一方 `write`：目录会立即失效，即使该根目录在其监视器启动时尚不存在。

## skill 身份

skill 名称为 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）。本地提供方接受目录包（`<name>/SKILL.md`）和扁平 Markdown 文件（`<name>.md`）。嵌套递归的 `**/SKILL.md` 发现不受支持。

```ts type-equiv
/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})
```

## 摘要、候选项与完整定义

`SkillSummary` 是注册表中与调用策略无关的摘要形状。消费方自行选择渲染哪些条目和字段；模型会话目录仅使用模型可调用 skill 的 `name` 和 `description`，从不使用正文或绝对文件路径。`SkillInvocationPolicy` 将两个独立调用控制规范化为正向布尔值，且每个已解析的摘要、候选项和定义都携带该策略，而不会把任意 frontmatter 纳入领域模型。

```ts type-equiv
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

```ts type-equiv
/** Invocation-neutral skill metadata returned by `ctx.skills.list()`. */
interface SkillSummary {
  /** Absolute instruction file path when supplied by the provider; absent for virtual skills. */
  readonly path?: string
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Provider-specific base for relative resources. */
  readonly resourceBase?: SkillResourceBase
}
```

`ctx.skills.list()` 保留全部四种策略组合。`isModelInvocable(skill)` 和 `isUserInvocable(skill)` 分别读取对应的必填字段。仅供模型调用的 skill 设置 `{ modelInvocable: true, userInvocable: false }`，仅供用户调用的 skill 设置 `{ modelInvocable: false, userInvocable: true }`，两个字段均设为 `false` 后，该 skill 只能由受信的 `ctx.skills.get()` 调用方获取。本地提供方读取名称完全匹配的 kebab-case frontmatter 键 `disable-model-invocation` 和 `user-invocable`，将省略的字段默认为 `true`，并为每个解析出的 skill 生成这个规范化策略。

`SkillCatalogSnapshot` 用于区分已确定的不存在与提供方的瞬时失败或发现期间持续变化的目录。`skills` 包含该次观测中收集、排序且与调用策略无关的摘要；只有每个已注册提供方都在没有并发目录修订时完成发现，`complete` 才为 true。不完整快照不会缓存，因此每个消费方可以保留上一份经过自身过滤的可用目录并重试。

```ts type-equiv
/** One catalog observation plus whether discovery completed within a stable catalog revision. */
interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
```

`SkillCandidate` 是提供方到注册表的形状。`locator` 是提供方的不透明状态；注册表只存储它并在调用获胜提供方的 `get()` 时传回。

```ts type-equiv
/** Provider catalog entry used by the registry to merge and later load skills. */
interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

`SkillDefinition` 是 `ctx.skills.get()` 返回的完整解析结果，供 `skill` 工具使用。`resourceBase` 告知工具如何为本地、URL 或提供方管理的 skill 渲染相对资源引导。

```ts type-equiv
/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }
```

```ts type-equiv
/** Complete parsed skill definition, including the body loaded by `ctx.skills.get()`. */
interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  readonly content: string
  /** Parsed optional metadata object from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

运行时 skill 输入可以省略调用控制和提供方标签。注册表会一次性补全这两项默认值，随后使用与提供方相同的完整定义形状和先到先得收集顺序。返回的 disposer 移除该贡献并使发现缓存失效。

```ts type-equiv
/** Runtime skill contribution accepted by `ctx.skills.register()`. */
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}
```

## 查找与配置

skill 查找对 cwd 敏感，因为提供方可能暴露工作区本地的 skill；可选的 signal 为调用方取消提供方的工作。注册表读取还通过 `SkillViewOptions` 携带观察 scope——消费方传入调用中的 agent，agent 本身就是自己的 scope key；注册表消费 `scope` 做层选择，提供方只从同一个借用的选项对象中读取其 `SkillLookupOptions` 约定。取消在目录选择前后（包括缓存命中时）都会检查，并与发现和完整定义加载竞争。如果找不到 git root，本地提供方将所提供的 cwd 本身视为项目根目录。

注册表不缓存完整定义。每次调用 `get()` 都会携所选候选项调用胜出提供方，因此本地提供方会重新读取当前正文。名称与该候选项不再匹配的定义会被拒绝，并使该提供方实例失效以便重新发现。

```ts type-equiv
/** Caller context used for cwd-sensitive and abortable provider work. */
interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}
```

```ts type-equiv
/**
 * Registry read options: provider lookup context plus the viewing scope.
 * The registry consumes `scope` to select layers; providers receive the same
 * borrowed options object and read only their {@link SkillLookupOptions}
 * contract from it.
 */
interface SkillViewOptions extends SkillLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}
```

注册表只拥有其发现缓存上限。本地提供方拥有文件系统根目录（`dshHome`、`agentsHome`、`customSkillDirs`，以及可选的 `bundledSkillDir`/`DSH_BUNDLED_SKILL_DIR`），以及 watcher 启用、轮询、稳定性、符号链接和项目容量控制。消费方拥有其目录描述上限。确切的默认值和校验规则见自动生成的[插件配置目录](../config-catalog.zh.md)。

```ts type-equiv
/** Skill registry configuration. */
interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

## 会话目录与工具约定

`dsh-tool-skill` 在存活会话中第一个观察到非空完整视图的 `agent/pre-step` 注入初始的持久 user-role `<system-reminder>`。目录只包含已排序的 skill `name` 和规范化、经 XML 转义的 `description`；不包含正文、路径、来源、提供方或路由提示。发现通过 `SkillLookupOptions` 转发该步骤的 abort signal。`catalogDescriptionMaxLength` 是消费方用于 description 上限的配置，默认值为 `500`，整数最小值为 `3`。

在后续每个模型步骤之前，消费方都会应用精确的工具可见性，并对完整快照中 `<available_skills>` 标签之间精确渲染的条目计算 digest。它以该插件所发布、最新一条可识别且仍可见的目录消息中的相同条目作为比较基线。digest 发生变化时，会通过 `agent.inject()` 追加一条持久的完整目录替换；删除所有 skill 时会追加一条显式的空替换。不完整快照会保留上一份可用模型视图。如果压缩（compaction）隐藏了所有历史目录消息，下一份完整快照会重新建立当前目录；如果视图为空且从未发布目录，则不发送任何内容。这些目录消息属于会话历史，而非 World State。

面向模型的 `skill({ name })` 工具校验 kebab-case 名称，在与调用策略无关的目录中查找摘要，并在加载前通过 `isModelInvocable` 拒绝无权访问的 skill；随后它根据调用方 agent 的 cwd 重新读取完整定义，并在返回内容前再次检查策略。该工具将无法解析的 skill 报告为未知或已不可用，并返回包含 `<skill_content name="...">`、`<skill_resources>` 和 `<skill_instructions>` 的工具结果。`resourceBase` 仅按需解析显式引用的脚本、参考资料和资产；加载结果不枚举 skill 目录。因此，仅修改正文会改变后续工具调用，而不会生成目录消息或改写先前工具结果。

## 浏览器 Session 目录

`SkillListRequest` 通过 `sessionId` 指定一个 Session；`SkillListValue` 返回允许用户调用的条目，其中包含名称、描述、可选使用提示与模型调用可用性。`SessionSkillCatalog` 在不激活 Agent 的前提下读取 Session cwd 与记录的 preset。live Agent 可以提供其作用域 registry，冷 Session 则使用 preset 的 standing scope。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionskillcatalog--sessionskillcatalog"></a>

### `ctx.sessionSkillCatalog` — `SessionSkillCatalog`

Host service backing `ctx.remote.skills` without activating a cold Agent.

```ts cordis-catalog
/**
 * List the user-invocable skills visible to one Session composition.
 * @param request - Session identity whose cwd and preset select the catalog view.
 * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
 * @returns user-invocable skill metadata without loading skill bodies.
 * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
 */
@Remote async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue>
```

Source: [`packages/api/session-controller/src/skill-catalog.ts`](../../packages/api/session-controller/src/skill-catalog.ts)

<a id="ctxskillmanager--skillmanager"></a>

### `ctx.skillManager` — `SkillManager`

Remote service behind the Skills settings page. Reads go through `ctx.skills.inventory()` in the default agent preset's scope, so the page lists the skills a new session sees; writes delegate to `ctx.skillPreferences` and `ctx.skillSources`, which own validation and persistence. Any catalog, preference, or source change is forwarded as `skill-manager/changed`.

```ts cordis-catalog
/**
 * Read every installed skill with its enablement for one view.
 * @param request - optional project root selecting per-project overrides and project skills.
 * @returns sorted skills, workspace projects, and which management services are mounted.
 * @throws RemoteError when the project root is not absolute.
 */
@Remote async inventory(request: SkillInventoryRequest): Promise<SkillInventoryValue>

/**
 * Enable or disable one skill globally or for one project.
 * @param request - skill name, target enablement, and optional project root.
 * @throws RemoteError when skill preferences are not mounted or the request is invalid.
 */
@Remote async setEnabled(request: SetSkillEnabledRequest): Promise<void>

/**
 * Remove one project override so the global preference applies.
 * @param request - skill name and project root.
 * @throws RemoteError when skill preferences are not mounted or the request is invalid.
 */
@Remote async clearOverride(request: ClearSkillOverrideRequest): Promise<void>

/**
 * List remote skill sources with their sync status.
 * @returns every source; empty when remote sources are not mounted.
 */
@Remote sources(): Promise<SkillSourcesValue>

/**
 * Add a remote source and start its first sync.
 * @param request - URL with optional ref and subdirectory.
 * @returns the added source.
 * @throws RemoteError when sources are not mounted or the URL is unsupported.
 */
@Remote async addSource(request: AddSkillSourceRequest): Promise<SkillSourceValue>

/**
 * Download one source again.
 * @param request - source id.
 * @returns the source after the sync settles; failures appear in `error`.
 * @throws RemoteError when sources are not mounted or the id is unknown.
 */
@Remote async syncSource(request: SkillSourceRequest): Promise<SkillSourceValue>

/**
 * Enable or disable one source's skills.
 * @param request - source id and target enablement.
 * @returns the updated source.
 * @throws RemoteError when sources are not mounted or the id is unknown.
 */
@Remote async setSourceEnabled(request: SetSkillSourceEnabledRequest): Promise<SkillSourceValue>

/**
 * Remove one source; a default source stays hidden afterwards.
 * @param request - source id.
 * @throws RemoteError when sources are not mounted or the id is unknown.
 */
@Remote async removeSource(request: SkillSourceRequest): Promise<void>

/**
 * Read any installed skill's stored fields, for preview or, when editable, for editing.
 * @param request - skill name.
 * @returns the stored fields, file path, and whether the page may change the skill.
 * @throws RemoteError when the skill has no readable file.
 */
@Remote async readSkill(request: SkillNameRequest): Promise<SkillDocumentValue>

/**
 * Create a skill in the user skills directory.
 * @param request - the new skill's fields.
 * @returns the stored fields and file path.
 * @throws RemoteError when the name is taken by any installed skill or the fields are invalid.
 */
@Remote async createSkill(request: SkillDraft): Promise<SkillDocumentValue>

/**
 * Replace a local skill's fields in place, keeping other frontmatter keys.
 * @param request - the skill's new fields; the name selects the skill.
 * @returns the stored fields and file path.
 * @throws RemoteError when the winning skill is not a local file or the fields are invalid.
 */
@Remote async updateSkill(request: SkillDraft): Promise<SkillDocumentValue>

/**
 * Delete a user skill's files. Deleting a customized copy restores the original.
 * @param request - skill name.
 * @throws RemoteError when the skill is not a user skill.
 */
@Remote async deleteSkill(request: SkillNameRequest): Promise<void>

/**
 * Copy a remote or bundled skill's directory into the user skills directory,
 * where the copy outranks the original, so it can be edited. Deleting the
 * copy restores the original.
 * @param request - skill name.
 * @returns the copy's stored fields and path.
 * @throws RemoteError when the skill is local already, has no file, or a user skill of that name exists.
 */
@Remote async customizeSkill(request: SkillNameRequest): Promise<SkillDocumentValue>

/**
 * List the marketplaces the Host searches.
 * @param request - `refresh` asks browsable marketplaces for their skill counts first.
 * @returns marketplaces in configuration order.
 */
@Remote async marketplaces(request: SkillMarketplacesRequest): Promise<SkillMarketplacesValue>

/**
 * Search public marketplaces and mark entries that are installed already.
 * @param request - query, optional marketplace, offset, and page size.
 * @returns entries with install state, totals, and per-marketplace failures.
 * @throws RemoteError when the marketplace service is not mounted or the marketplace id is unknown.
 */
@Remote async searchMarketplace(request: SearchMarketplaceRequest): Promise<SearchMarketplaceValue>

/**
 * Install one marketplace skill: add it to the selection of the source that
 * already tracks its repository, or add a source for the repository that
 * installs only this skill, then wait for the sync. A disabled source that
 * installed every skill is narrowed to this skill before it is re-enabled.
 * @param request - repository, optional directory, and name.
 * @returns the source that installs the skill.
 * @throws RemoteError when sources are not mounted, the repository is invalid,
 *   or the synced repository contains no skill matching the request.
 */
@Remote async installSkill(request: InstallSkillRequest): Promise<SkillSourceValue>

/**
 * Uninstall one remote skill by removing it from its source's selection; a
 * user source left with no skills is removed.
 * @param request - skill name.
 * @throws RemoteError when the winning skill is not a remote skill.
 */
@Remote async uninstallSkill(request: SkillNameRequest): Promise<void>

/**
 * List the skills one source offers and which are installed.
 * @param request - source id.
 * @returns offers in discovery order.
 * @throws RemoteError when sources are not mounted or the id is unknown.
 */
@Remote async sourceSkills(request: SkillSourceRequest): Promise<SkillSourceSkillsValue>

/**
 * Replace which of a source's skills are installed.
 * @param request - source id and selection; omitted installs every skill.
 * @returns the updated source.
 * @throws RemoteError when sources are not mounted or the id is unknown.
 */
@Remote async setSourceSkills(request: SetSkillSourceSkillsRequest): Promise<SkillSourceValue>

/**
 * Ask upstream whether each GitHub source has a newer commit.
 * @returns every source with refreshed update flags.
 */
@Remote async checkUpdates(): Promise<SkillSourcesValue>
```

Source: [`packages/host/skill-manager/src/index.ts`](../../packages/host/skill-manager/src/index.ts)

<a id="ctxskillmarketplace--skillmarketplace"></a>

### `ctx.skillMarketplace` — `SkillMarketplace`

Searches public skill marketplaces. Responses are cached per URL for `cacheTtlMs`; a failed marketplace is reported beside the others' results instead of failing the search.

```ts cordis-catalog
/**
 * List marketplaces with the counts the latest {@link refreshCounts} found.
 * @returns marketplaces in configuration order.
 */
list(): MarketplaceView[]

/**
 * Ask every enabled browsable marketplace how many skills it offers.
 * @returns the refreshed list.
 */
async refreshCounts(): Promise<MarketplaceView[]>

/**
 * Search one or every enabled marketplace.
 * @param request - query, optional marketplace, offset, and page size.
 * @returns merged entries, totals, and per-marketplace failures.
 * @throws Error when `marketplace` names an unknown or disabled marketplace.
 */
async search(request: MarketplaceSearchRequest): Promise<MarketplaceSearchResult>
```

Source: [`packages/skill/skill-marketplace/src/index.ts`](../../packages/skill/skill-marketplace/src/index.ts)

<a id="ctxskillpreferences--skillpreferences"></a>

### `ctx.skillPreferences` — `SkillPreferences`

Persistent global and per-project skill enablement, enforced as a `ctx.skills` filter. Mutations serialize through a cross-process file lock, commit with an atomic rename, and only then update the in-memory state and invalidate the skill catalog.

```ts cordis-catalog
/**
 * Read the committed preferences.
 * @returns the current state; callers must not mutate it.
 */
state(): SkillPreferencesState

/**
 * Resolve the project root a cwd keys on, matching project skill discovery.
 * @param cwd - workspace directory.
 * @returns the absolute project root.
 */
async projectRootOf(cwd: string): Promise<string>

/**
 * Explain one skill's enablement.
 * @param name - kebab-case skill name.
 * @param projectRoot - absolute project root; omitted reads the global level only.
 * @returns the enablement and the level that decided it.
 */
decide(name: string, projectRoot?: string): SkillEnablementDecision

/**
 * Enable or disable one skill globally or for one project. A project change
 * records an override only when it differs from the global preference and
 * removes a redundant one.
 * @param request - skill name, target enablement, and optional project root.
 * @returns the committed state.
 */
async setEnabled(request: SetSkillEnabledRequest): Promise<SkillPreferencesState>

/**
 * Remove one project override so the global preference applies.
 * @param request - skill name and project root.
 * @returns the committed state.
 */
async clearOverride(request: ClearSkillOverrideRequest): Promise<SkillPreferencesState>
```

Source: [`packages/skill/skill-preferences/src/index.ts`](../../packages/skill/skill-preferences/src/index.ts)

<a id="ctxskills--skillregistry"></a>

### `ctx.skills` — `SkillRegistry`

Layered registry of skill providers, the host+per-scope shape the tools registry established. A registration files into the layer of its calling context's scope (scopeOf): host rows and repository plugins land in the global layer, while a plugin mounted by an agent preset's standing composition lands in that preset's layer. A read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer. It exposes sorted invocation-neutral summaries and loads full skill bodies on demand.

```ts cordis-catalog
/**
 * Register a borrowed same-process provider synchronously during plugin
 * apply, into the calling context's layer: a scoped context (an agent
 * preset's standing mount) registers for that scope alone, an unscoped
 * context registers globally. Duplicate names within one layer and reserved
 * names throw; remote initialization belongs in `list()`. Fiber disposal
 * unregisters the provider and invalidates catalog caches.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this provider;
 *   composite effects may yield it directly to preserve teardown ordering.
 */
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void

/**
 * Register a borrowed readonly runtime skill into the calling context's
 * layer. Project entries outrank runtime entries, which outrank user
 * entries, within one layer. Same-name runtime entries in one layer are
 * first-wins; a duplicate logs a warning and receives a no-op disposer so
 * it cannot remove the winner.
 * @param skill - the skill definition input; omitted invocation and provider fields receive defaults.
 * @returns the exact Cordis effect disposer, preserving composite teardown order and invalidating caches.
 */
register(skill: SkillRegistration): () => void

/**
 * Register a borrowed same-process enablement filter synchronously during
 * plugin apply. Filters are host-wide: every scope's reads apply every
 * registered filter. Registration, disposal, and the control's
 * `invalidate()` emit `skills/change`.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this filter.
 */
registerFilter(create: (control: SkillFilterControl) => SkillFilter): () => Promise<void>

/**
 * List enabled invocation-neutral skill summaries for a workspace; merged
 * winners disabled by a registered filter are omitted. Consumers apply
 * model or user invocation policy at their operational boundary. Lookup
 * options and provider candidates are readonly same-process values borrowed
 * throughout discovery.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns all sorted winning summaries.
 */
async list(options: SkillViewOptions = {}): Promise<SkillSummary[]>

/**
 * Observe the current enabled invocation-neutral catalog and whether discovery completed within a stable revision.
 * Winners disabled by a registered filter are omitted. Incomplete observations are never cached, allowing
 * consumers to retain last-good state and retry on their next request boundary.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns sorted summaries plus discovery-completeness state.
 */
async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>

/**
 * Observe every merged winner, including those disabled by filters, for
 * management surfaces. Model and user catalogs read {@link snapshot} instead.
 * @param options - view options; `scope` selects the viewing agent's layers,
 *   `cwd` selects project roots and filter policy, and `signal` cancels discovery.
 * @returns sorted winners with their enablement plus discovery-completeness state.
 */
async inventory(options: SkillViewOptions = {}): Promise<SkillInventorySnapshot>

/**
 * Load and validate the winning candidate, passing its opaque discovery locator back to the
 * provider. A winner disabled by a registered filter is not loaded. Cancellation is rechecked
 * after selection, including cache hits, and raced against
 * loading so an uncooperative provider cannot hang the caller.
 * @param name - kebab-case skill name.
 * @param options - view options; `scope` selects the viewing agent's layers,
 *   `cwd` selects workspace-sensitive skills, and `signal` cancels work.
 * @returns the full skill, including body content, or `undefined`.
 */
async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>
```

Source: [`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts)

<a id="ctxskillsources--skillsources"></a>

### `ctx.skillSources` — `SkillSources`

Remote skill sources synced to disk and exposed as a `ctx.skills` provider. Source-list mutations serialize through a cross-process file lock and commit atomically; a sync replaces a source's generation only after extraction and discovery succeed, so a failed sync keeps the previous skills.

```ts cordis-catalog
/**
 * List every source with its sync status.
 * @returns sources in configuration order, then user sources in insertion order.
 */
list(): SkillSourceView[]

/**
 * Add a user source and start its first sync.
 * @param request - URL, optional ref, subdirectory, and id.
 * @returns the added source, in the `syncing` state.
 * @throws Error when the URL is unsupported or the id is taken.
 */
async add(request: AddSkillSourceRequest): Promise<SkillSourceView>

/**
 * Remove a source and its synced files. A default source is hidden rather
 * than deleted, so configuration does not bring it back.
 * @param id - source id.
 */
async remove(id: string): Promise<void>

/**
 * Enable or disable a source's skills without deleting synced files.
 * @param id - source id.
 * @param enabled - target enablement.
 * @returns the updated source.
 */
async setEnabled(id: string, enabled: boolean): Promise<SkillSourceView>

/**
 * Replace which of a source's skills are installed. Selection applies to the
 * synced generation without downloading it again.
 * @param id - source id.
 * @param skills - skill or directory names; `undefined` installs every discovered skill of a user
 *   source and restores a default source's configured selection.
 * @returns the updated source.
 */
async setSkills(id: string, skills: readonly string[] | undefined): Promise<SkillSourceView>

/**
 * List the skills a source's current generation offers and whether each is installed.
 * @param id - source id.
 * @returns offers in discovery order; empty before the first sync.
 */
offers(id: string): SkillSourceOffer[]

/**
 * Ask upstream for the newest commit without downloading it. GitHub sources
 * compare commit SHAs; archive and file sources report no update until a sync
 * downloads different bytes.
 * @param id - source id.
 * @returns the source with `sync.updateAvailable` and `sync.latest` refreshed.
 */
async checkUpdate(id: string): Promise<SkillSourceView>

/**
 * Download the source again and switch to the new generation when its commit changed.
 * Concurrent calls for one source share one sync.
 * @param id - source id.
 * @returns the source after the sync settles; a failure is reported in `sync.error`.
 */
async sync(id: string): Promise<SkillSourceView>
```

Source: [`packages/skill/skill-sources/src/index.ts`](../../packages/skill/skill-sources/src/index.ts)

<a id="skill-filesystem-events"></a>

### `skill-filesystem/*` events

<a id="skill-filesystemchanged--emit"></a>

#### `skill-filesystem/changed` — emit

A trusted Host writer, such as the Skills page editor, created, changed, or deleted a file that may be a skill. Providers whose roots contain the path invalidate the catalog without waiting for a watcher.

```ts cordis-catalog
/**
 * A trusted Host writer, such as the Skills page editor, created,
 * changed, or deleted a file that may be a skill. Providers whose roots
 * contain the path invalidate the catalog without waiting for a watcher.
 * @param path - absolute path of the changed file.
 * @mode emit
 */
'skill-filesystem/changed'(path: string): void
```

Source: [`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts)

<a id="skill-manager-events"></a>

### `skill-manager/*` events

<a id="skill-managerchanged--emit"></a>

#### `skill-manager/changed` — emit

The skill catalog, skill preferences, or skill sources changed; management clients refetch their current view.

```ts cordis-catalog
/**
 * The skill catalog, skill preferences, or skill sources changed; management
 * clients refetch their current view.
 * @mode emit
 */
'skill-manager/changed'(): void
```

Source: [`packages/host/skill-manager/src/types.ts`](../../packages/host/skill-manager/src/types.ts)

<a id="skill-preferences-events"></a>

### `skill-preferences/*` events

<a id="skill-preferenceschange--emit"></a>

#### `skill-preferences/change` — emit

Committed skill preferences changed, through this service or an external edit.

```ts cordis-catalog
/**
 * Committed skill preferences changed, through this service or an external edit.
 * @mode emit
 */
'skill-preferences/change'(): void
```

Source: [`packages/skill/skill-preferences/src/index.ts`](../../packages/skill/skill-preferences/src/index.ts)

<a id="skill-sources-events"></a>

### `skill-sources/*` events

<a id="skill-sourceschange--emit"></a>

#### `skill-sources/change` — emit

The source list, a source's enablement, or a sync state changed.

```ts cordis-catalog
/**
 * The source list, a source's enablement, or a sync state changed.
 * @mode emit
 */
'skill-sources/change'(): void
```

Source: [`packages/skill/skill-sources/src/index.ts`](../../packages/skill/skill-sources/src/index.ts)

<a id="skills-events"></a>

### `skills/*` events

<a id="skillschange--emit"></a>

#### `skills/change` — emit

A skill provider, runtime contribution, enablement filter, or provider-backed catalog may have changed. This is an unfiltered invalidation notification; consumers refetch the catalog for their own lookup options. Listener failures are contained and cannot veto the registry mutation.

```ts cordis-catalog
/**
 * A skill provider, runtime contribution, enablement filter, or
 * provider-backed catalog may have changed. This is an unfiltered invalidation notification; consumers
 * refetch the catalog for their own lookup options. Listener failures are
 * contained and cannot veto the registry mutation.
 * @mode emit
 */
'skills/change'(): void
```

Source: [`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts)
<!-- END GENERATED cordis-surface -->
