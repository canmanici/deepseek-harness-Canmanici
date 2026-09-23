/**
 * Wire vocabulary of the `skillManager` Remote namespace. Types only.
 * @module @deepseek-ai/dsh-host-skill-manager/src/types
 */

import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Host composition does not mount the service this operation needs. */
    'skill-manager/unavailable': { readonly service: string }
    /** The request names an unknown skill source or carries an invalid value. */
    'skill-manager/invalid-request': { readonly reason: string }
    /** The skill is not a user skill this page may change. */
    'skill-manager/read-only': { readonly name: string }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The skill catalog, skill preferences, or skill sources changed; management
     * clients refetch their current view.
     * @mode emit
     */
    'skill-manager/changed'(): void
  }
}

/** Which preference level decided a skill's enablement. */
export type SkillPreferenceOrigin = 'default' | 'global' | 'project'

/** One skill as the management page displays it. */
export interface ManagedSkill {
  /** Kebab-case skill name. */
  readonly name: string
  /** Routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Discovery source label, such as `user-dsh`, `project-dsh`, `bundled`, or `remote:<id>`. */
  readonly source: string
  /** Provider that owns the skill body. */
  readonly provider: string
  /** Absolute `SKILL.md` path when the provider supplies one. */
  readonly path?: string
  /** Whether model-facing catalogs may include the skill. */
  readonly modelInvocable: boolean
  /** Whether `/name` invocation may include the skill. */
  readonly userInvocable: boolean
  /** Whether no registry filter disables the skill in the requested view. */
  readonly enabled: boolean
  /** The preference level that decided enablement; `default` when no preference names the skill. */
  readonly preference: SkillPreferenceOrigin
  /** Whether the skill is a local file the page may edit in place: the user, user-agents, project, or custom skill directories. */
  readonly editable: boolean
  /** Whether the skill lives in the user skills directory, so the page may delete it. */
  readonly deletable: boolean
  /** Whether the page may copy the skill into the user skills directory, where the copy takes its place, to edit it. */
  readonly customizable: boolean
  /** Whether the skill comes from a remote source, so the page may uninstall it. */
  readonly uninstallable: boolean
}

/** Author-controlled fields of one user skill. */
export interface SkillDraft {
  /** Kebab-case skill name; also the directory name. */
  readonly name: string
  /** Routing description the catalog shows. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Markdown instructions after the frontmatter. */
  readonly body: string
  /** Whether model-facing catalogs may include the skill. */
  readonly modelInvocable: boolean
  /** Whether `/name` invocation may include the skill. */
  readonly userInvocable: boolean
}

/** Request naming one user skill. */
export interface SkillNameRequest {
  /** Kebab-case skill name. */
  readonly name: string
}

/** One skill as stored on disk. */
export interface SkillDocumentValue {
  readonly skill: SkillDraft
  /** Absolute `SKILL.md` path. */
  readonly path: string
  /** Whether the page may edit the file in place. */
  readonly editable: boolean
}

/** A workspace project whose root can carry per-project overrides. */
export interface ManagedProject {
  /** Absolute project root used as the override key. */
  readonly root: string
  /** Workspace display title. */
  readonly title: string
}

/** Inventory request. */
export interface SkillInventoryRequest {
  /** Absolute project root to view; omitted views the global level. */
  readonly projectRoot?: string
}

/** Complete management view. */
export interface SkillInventoryValue {
  /** Sorted skills of the requested view, enabled or not. */
  readonly skills: readonly ManagedSkill[]
  /** Whether every provider completed discovery. */
  readonly complete: boolean
  /** Workspace projects available as override scopes. */
  readonly projects: readonly ManagedProject[]
  /** Whether the Host mounts skill preferences, so enablement can change. */
  readonly preferencesAvailable: boolean
  /** Whether the Host mounts remote skill sources. */
  readonly sourcesAvailable: boolean
}

/** Enablement change for one skill. */
export interface SetSkillEnabledRequest {
  /** Kebab-case skill name. */
  readonly name: string
  /** Target enablement. */
  readonly enabled: boolean
  /** Absolute project root for a project override; omitted changes the global preference. */
  readonly projectRoot?: string
}

/** Removal of one project override. */
export interface ClearSkillOverrideRequest {
  /** Kebab-case skill name. */
  readonly name: string
  /** Absolute project root holding the override. */
  readonly projectRoot: string
}

/** Sync progress of one source. */
export type ManagedSourceSyncState = 'never' | 'syncing' | 'ok' | 'error'

/** One remote skill source. */
export interface ManagedSource {
  readonly id: string
  readonly url: string
  readonly ref?: string
  readonly path?: string
  readonly enabled: boolean
  /** `default` sources come from configuration; `user` sources were added by the user. */
  readonly origin: 'default' | 'user'
  readonly kind: 'github' | 'archive' | 'skill-file'
  readonly syncState: ManagedSourceSyncState
  /** Commit or content hash of the current generation. */
  readonly commit?: string
  /** ISO timestamp of the current generation. */
  readonly syncedAt?: string
  /** Failure message of the latest sync attempt. */
  readonly error?: string
  /** Installed skill selection; omitted installs every discovered skill. */
  readonly skills?: readonly string[]
  /** Number of installed skills in the current generation. */
  readonly skillCount: number
  /** Number of skills the current generation offers. */
  readonly availableCount: number
  /** Whether the latest update check found a newer upstream commit. */
  readonly updateAvailable: boolean
  /** Upstream commit the latest update check saw. */
  readonly latest?: string
  /** ISO timestamp of the latest update check. */
  readonly checkedAt?: string
}

/** One skill a source's synced generation offers. */
export interface ManagedSourceSkill {
  readonly name: string
  readonly description: string
  /** Directory relative to the source root. */
  readonly dir: string
  /** Whether the source's selection installs it. */
  readonly installed: boolean
}

/** Skills one source offers. */
export interface SkillSourceSkillsValue {
  readonly skills: readonly ManagedSourceSkill[]
}

/** Selection change for one source. */
export interface SetSkillSourceSkillsRequest {
  /** Source id. */
  readonly id: string
  /** Skill or directory names to install; omitted installs every discovered skill. */
  readonly skills?: readonly string[]
}

/** How a marketplace is queried. */
export type ManagedMarketplaceKind = 'github' | 'claude-plugins-dev' | 'skillsmp' | 'skills-sh'

/** One public skill marketplace. */
export interface ManagedMarketplace {
  readonly id: string
  readonly title: string
  readonly kind: ManagedMarketplaceKind
  /** API base URL or repository URL. */
  readonly url: string
  readonly enabled: boolean
  /** Whether an empty query lists skills. */
  readonly browsable: boolean
  /** Skills the marketplace offers, when it reports a count. */
  readonly available?: number
  /** Failure message of the latest count. */
  readonly error?: string
}

/** Marketplace list request. */
export interface SkillMarketplacesRequest {
  /** Ask browsable marketplaces for their skill counts first. */
  readonly refresh?: boolean
}

/** Marketplace list. */
export interface SkillMarketplacesValue {
  readonly marketplaces: readonly ManagedMarketplace[]
  /** Whether the Host mounts the marketplace service. */
  readonly available: boolean
}

/** Marketplace search input. */
export interface SearchMarketplaceRequest {
  /** Free text; empty browses the marketplaces that list without a query. */
  readonly query: string
  /** Marketplace id; omitted searches every enabled marketplace. */
  readonly marketplace?: string
  /** Entries to skip per marketplace. */
  readonly offset?: number
  /** Entries per marketplace. */
  readonly limit?: number
}

/** Install state of one marketplace entry. */
export type MarketplaceEntryState = 'available' | 'installing' | 'installed'

/** One marketplace search result. */
export interface MarketplaceEntry {
  /** Marketplace id that returned the entry. */
  readonly marketplace: string
  /** Identity across marketplaces: `<owner>/<repo>/<directory or name>`. */
  readonly key: string
  readonly name: string
  readonly description?: string
  /** GitHub repository as `owner/repo`. */
  readonly repository: string
  /** Skill directory inside the repository. */
  readonly dir?: string
  /** Web page describing the skill. */
  readonly url: string
  readonly installs?: number
  readonly stars?: number
  readonly state: MarketplaceEntryState
  /** Source label of a different installed skill with the same name, which would shadow or be shadowed by this one. */
  readonly conflict?: string
}

/** Marketplace search output. */
export interface SearchMarketplaceValue {
  readonly skills: readonly MarketplaceEntry[]
  /** Reported matches per marketplace id. */
  readonly totals: Readonly<Record<string, number>>
  /** Whether a further page exists. */
  readonly hasMore: boolean
  /** Offset that requests the next page. */
  readonly nextOffset: number
  /** Marketplaces that failed, with their messages. */
  readonly errors: ReadonlyArray<{ readonly marketplace: string; readonly message: string }>
}

/** Install request for one marketplace entry. */
export interface InstallSkillRequest {
  /** GitHub repository as `owner/repo`. */
  readonly repository: string
  /** Skill directory inside the repository. */
  readonly dir?: string
  /** Skill name, used as the selector when no directory is known. */
  readonly name: string
}

/** Source list. */
export interface SkillSourcesValue {
  readonly sources: readonly ManagedSource[]
}

/** New source request. */
export interface AddSkillSourceRequest {
  /** Source URL or `github:owner/repo`. */
  readonly url: string
  /** Git ref for GitHub sources. */
  readonly ref?: string
  /** Subdirectory that bounds discovery. */
  readonly path?: string
}

/** Request addressing one source. */
export interface SkillSourceRequest {
  /** Source id. */
  readonly id: string
}

/** Source enablement change. */
export interface SetSkillSourceEnabledRequest {
  /** Source id. */
  readonly id: string
  /** Target enablement. */
  readonly enabled: boolean
}

/** Result carrying one source. */
export interface SkillSourceValue {
  readonly source: ManagedSource
}
