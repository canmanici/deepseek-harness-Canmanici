# Skills

English | [中文](skills.zh.md)

The [skill capability family](../../packages/skill) includes the Service Definition ([dsh-skill](../../packages/skill/skill), `ctx.skills`), the local Service Provider ([dsh-skill-filesystem](../../packages/skill/skill-filesystem)), optional packaged providers ([dsh-skill-badge](../../packages/skill/skill-badge) and [dsh-skill-office](../../packages/skill/skill-office)), and the Consumer ([dsh-tool-skill](../../packages/skill/tool-skill)). The registry merges provider catalogs across its host and per-scope layers; providers contribute local or packaged skills; the Consumer owns the initial and replacement catalogs plus the model-facing `skill` tool. Skills are optional instructions, not session events, so their vocabulary lives here rather than in [core.md](core.md).

Source: [`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts), [`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts), [`packages/skill/skill-badge/src/index.ts`](../../packages/skill/skill-badge/src/index.ts), [`packages/skill/skill-office/src/index.ts`](../../packages/skill/skill-office/src/index.ts), and [`packages/skill/tool-skill/src/index.ts`](../../packages/skill/tool-skill/src/index.ts).

## Provider registry

`ctx.skills` combines local, embedded, remote, or other providers. Registration is synchronous; remote initialization and discovery belong in awaited `list()`. Provider objects, options, and candidates are borrowed readonly, while semantic fields are validated.

The registry is host+per-scope layered, the shape the [tools registry](tools.md) established over [dsh-scope](../../packages/core/scope): a registration files into the layer of its calling context's scope, so host rows and repository plugins land in the global layer while a plugin mounted by an agent preset's standing composition lands in that preset's layer, and provider names are unique per layer rather than process-wide. A read merges the global layer with the viewing scope's chain — the nearest layer's entry wins a duplicate skill name outright, and the rank order below decides duplicates only within one layer. Discovery caches are keyed by the resolved scope chain, so re-parenting a scope (a blank-session recompose) is visible to the next read without a registry mutation.

Within one layer, duplicate names resolve by rank, provider order, then local order; summaries sort by name. A rejected `list()` is logged and omitted from an incomplete observation, while an explicit incomplete observation contributes usable candidates without making the result cacheable; malformed candidates fail fast. Each provider factory receives a registration-scoped control whose `invalidate()` clears completed catalogs only while that exact registration remains active and whose signal aborts on failed registration or disposal. An in-flight discovery retries once when its provider generation changes; a second change returns the latest candidates incomplete and uncached. Provider and runtime mutations emit the unfiltered `skills/change` invalidation event; it carries no diff, so consumers refetch `snapshot()` with their own lookup options.

An array returned by `SkillProvider.list()` is complete-discovery shorthand. `SkillProviderObservation` lets a provider expose candidates that remain directly loadable while reporting that the observation is not authoritative.

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

## Enablement filters

A filter decides which merged winners every read exposes. `ctx.skills.registerFilter()` registers one host-wide filter per unique name; registration, disposal, and the control's `invalidate()` emit `skills/change`. `list`, `snapshot`, and `get` resolve every filter for the lookup and omit each winner any filter disables, so the model catalog, the `skill` tool, `/name` invocation, and the Browser Session catalog all observe the same decision. A lower-ranked candidate with the same name does not replace a disabled winner. A rejected `resolve()` rejects the read instead of exposing skills the filter would disable. A filter receives a `SkillFilterControl` with the same `signal` and `invalidate()` members as `SkillProviderControl`. `inventory()` returns a `SkillInventorySnapshot`: every winner with `enabled` and the disabling filter names for management surfaces; it never loads bodies.

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

The shipped filter is [dsh-skill-preferences](../../packages/skill/skill-preferences): global disables in `<dshHome>/skill-preferences.json`, overridden per project root by `enabled` and `disabled` lists. `ctx.skillPreferences.state()` returns that file as a `SkillPreferencesState`; `setEnabled()` takes a `SetSkillEnabledRequest`, `clearOverride()` takes a `ClearSkillOverrideRequest`, and `decide()` returns a `SkillEnablementDecision` naming the level (`default`, `global`, or `project`) that decided.

## Local discovery priority

The shipped local provider scans roots in rank order:

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 450 | `remote:<id>` | [dsh-skill-sources](../../packages/skill/skill-sources) synced generation, not a local root |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` when configured |

The project root is the nearest ancestor containing `.git`; without one, the current cwd is used. When `ctx.fs` is available, the git-root walk probes `.git` through the filesystem service so remote or sandboxed workspaces do not fall back to the host filesystem boundary. The user DSH root skips its `.system` child. The local provider does not synthesize built-in system skills; deployments supply packaged skills through configured bundled roots or dedicated providers.

`dsh-skill-badge` registers one immutable `bundled` candidate at `BUNDLED_SKILL_RANK` and exposes its packaged asset directory through `resourceBase`. The shipped CLI declares the plugin disabled, so enabling its composition row is an explicit opt-in.

Chokidar watches existing roots for direct bundle/flat-entry additions and removals plus direct skill-entry changes. A missing root is followed one absent path segment at a time from its nearest existing ancestor until Chokidar can attach. Resource files below a bundle are not catalog changes. Model-facing `write` and `edit` observations synchronously invalidate the provider when their target is catalog-relevant, while the host watcher covers IDE, Git, shell, and external-process mutations. Watcher failures make the current observation incomplete without hiding readable candidates from direct loads; project-scoped watchers use a configured bounded LRU.

## Remote sources

[dsh-skill-sources](../../packages/skill/skill-sources) contributes skills from GitHub repositories, ZIP archives, and single skill-file URLs through `ctx.skillSources`. Each sync downloads a source into a commit-named generation under `<dshHome>/skill-sources/<id>/`, discovers directories holding a valid `SKILL.md` at that time, and records them in a manifest; `list()` reads only the in-memory manifests of enabled sources, so catalog lookups never reach the network. Remote candidates carry source `remote:<id>` and rank 450, so a copy in `<dshHome>/skills` replaces a remote skill of the same name. A source may install only a selection of its skills, and `checkUpdate()` compares a GitHub source's newest commit with the synced one without downloading. `ctx.skillSources.list()` returns `SkillSourceView` values, and `add()` takes an `AddSkillSourceRequest`. The shipped base composition lists the Anthropic public repository as a default source and syncs never-synced sources at startup only in the `web` and `desktop` profiles.

## Skills page and agent management

The Web **Skills** page, below **Plugins** in the sidebar, calls the `skillManager` Remote of [dsh-host-skill-manager](../../packages/host/skill-manager). It reads `ctx.skills.inventory()` in the default agent preset's scope, writes enablement through `ctx.skillPreferences`, searches public marketplaces through [dsh-skill-marketplace](../../packages/skill/skill-marketplace), installs single skills and checks for updates through `ctx.skillSources`, edits local skills in place, customizes remote and bundled skills by copying them to `<dshHome>/skills`, and creates and deletes user skills there. Agents and subagents change enablement through the `manage_skills` tool of [dsh-tool-skill-manage](../../packages/skill/tool-skill-manage), which writes the same preferences. After each file write it emits `skill-filesystem/changed`, which local providers treat like a first-party `write`: the catalog invalidates at once, even for a root that did not exist when its watcher started.

## Skill identity

Skill names are kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). The local provider accepts directory bundles (`<name>/SKILL.md`) and flat Markdown files (`<name>.md`). Nested recursive `**/SKILL.md` discovery is not supported.

```ts type-equiv
/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})
```

## Summaries, candidates, and complete definitions

`SkillSummary` is the registry's invocation-neutral summary shape. Consumers choose which entries and fields to render; the model session catalog uses only model-invocable `name` and `description`, never the body or absolute file path. `SkillInvocationPolicy` normalizes the two independent invocation controls into positive booleans, and every resolved summary, candidate, and definition carries it without turning arbitrary frontmatter into the domain model.

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

`ctx.skills.list()` preserves all four policy combinations. `isModelInvocable(skill)` and `isUserInvocable(skill)` read the corresponding required field. A model-only skill sets `{ modelInvocable: true, userInvocable: false }`, a user-only skill sets `{ modelInvocable: false, userInvocable: true }`, and setting both fields to `false` keeps the skill available only through trusted `ctx.skills.get()` callers. The local provider reads the exact kebab-case frontmatter keys `disable-model-invocation` and `user-invocable`, defaults omitted fields to `true`, and projects every parsed skill into this normalized policy.

`SkillCatalogSnapshot` distinguishes authoritative absence from transient provider failure or a catalog that kept changing during discovery. `skills` contains the sorted invocation-neutral summaries collected in that observation; `complete` is true only when every registered provider completed without a concurrent catalog revision. Incomplete snapshots are not cached, allowing each consumer to retain its last-good filtered catalog and retry.

```ts type-equiv
/** One catalog observation plus whether discovery completed within a stable catalog revision. */
interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
```

`SkillCandidate` is the provider-to-registry shape. `locator` is opaque provider state; the registry only stores it and gives it back to the winning provider's `get()`.

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

`SkillDefinition` is the complete parsed result returned by `ctx.skills.get()` and used by the `skill` tool. `resourceBase` tells the tool how to render relative-resource guidance for local, URL, or provider-managed skills.

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

Runtime skill inputs may omit invocation controls and the provider label. The registry resolves both defaults once, then uses the same complete definition shape and first-wins collection order as providers. The returned disposer removes the contribution and invalidates discovery caches.

```ts type-equiv
/** Runtime skill contribution accepted by `ctx.skills.register()`. */
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}
```

## Lookup and configuration

Skill lookup is cwd-sensitive because providers may expose workspace-local skills, and its optional signal cancels provider work for the caller. Registry reads additionally take the viewing scope — consumers pass the calling agent, which is its own scope key — through `SkillViewOptions`; the registry consumes `scope` for layer selection, and providers read only their `SkillLookupOptions` contract from the same borrowed options object. Cancellation is checked before and after catalog selection, including cache hits, and races both discovery and full-definition loading. If no git root is found, the local provider treats the supplied cwd itself as the project root.

Full definitions are not cached by the registry. Each `get()` calls the winning provider with the selected candidate, so the local provider rereads the current body. A definition whose name no longer matches that candidate is rejected and invalidates the exact provider for rediscovery.

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

The registry owns only its discovery-cache bound. The local provider owns filesystem roots (`dshHome`, `agentsHome`, `customSkillDirs`, and optional `bundledSkillDir`/`DSH_BUNDLED_SKILL_DIR`) plus watcher enablement, polling, stability, symlink, and project-capacity controls. The consumer owns its catalog description bound. Exact defaults and validation are in the generated [config catalog](../config-catalog.md).

```ts type-equiv
/** Skill registry configuration. */
interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

## Session catalog and tool contract

`dsh-tool-skill` injects the initial durable user-role `<system-reminder>` at the first `agent/pre-step` of a live session that observes a non-empty complete view. The catalog contains sorted skill `name` and normalized, XML-escaped `description` only; it omits bodies, paths, sources, providers, and routing hints. Discovery forwards the step's abort signal through `SkillLookupOptions`. `catalogDescriptionMaxLength` is the consumer config for the description bound, with default `500` and integer minimum `3`.

Before each later model step, the consumer applies exact tool visibility and digests the exact rendered entries between the `<available_skills>` tags from a complete snapshot. It derives the comparison baseline from the same entries in the newest recognizable visible catalog message sourced by the plugin. A changed digest appends a durable full replacement through `agent.inject()`; deleting every skill appends an explicit empty replacement. Incomplete snapshots preserve the last-good model view. If compaction hides every historical catalog message, the next complete snapshot re-establishes the current catalog; an empty view with no prior catalog emits nothing. These catalog messages are session history, not World State.

The model-facing `skill({ name })` tool validates the kebab-case name, finds the summary in the invocation-neutral catalog, rejects it before loading unless `isModelInvocable` permits access, then rereads the complete definition for the calling agent cwd and rechecks the policy before returning content. It reports an unresolved skill as unknown or no longer available and returns a tool result containing `<skill_content name="...">`, `<skill_resources>`, and `<skill_instructions>`. `resourceBase` resolves explicitly referenced scripts, references, and assets only as needed; the loaded result does not enumerate a skill directory. Body-only edits therefore change later tool calls without producing catalog messages or rewriting earlier tool results.

## Browser Session catalog

`SkillListRequest` addresses one Session by `sessionId`; `SkillListValue` returns the user-invocable entries with name, description, optional usage guidance, and model-invocation availability. `SessionSkillCatalog` reads the Session cwd and recorded preset without activating an Agent. A live Agent may supply its scoped registry, while a cold Session uses the preset's standing scope.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
