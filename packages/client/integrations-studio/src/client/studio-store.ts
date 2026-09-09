/**
 * The Integrations section's registry state.
 *
 * Business data lives in the object layer: the persisted-document snapshot
 * arrives through the settings scope, and the section's viewing state (active
 * tab, query, kind, category, staged draft) is the only shared state this
 * surface owns. One controller derives the view from the scope and routes the
 * staged writes persistently.
 *
 * @module studio-store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Which tab the section shows. */
export type StudioTabId = 'marketplace' | 'integrations' | 'studio'

/** Marketplace kind filter identity. */
export type CatalogKind = 'all' | 'mcp' | 'skill'

/** The staged studio draft's fields, as the page edits them. */
export interface StudioDraftFields {
  /** Kebab-case skill name. */
  name: string
  /** Routing description. */
  description: string
  /** Routing hint. */
  whenToUse: string
  /** Comma-separated tag draft. */
  tags: string
  /** Raw Markdown instruction body. */
  instructions: string
}

/** One persisted skill entry read from the settings snapshot. */
export interface DeployedSkillEntry {
  /** Kebab-case skill name. */
  name: string
  /** Routing description. */
  description: string
  /** Routing hint; empty when none. */
  whenToUse: string
  /** Raw Markdown instruction body. */
  instructions: string
  /** ISO deployment stamp. */
  deployedAt: string
}

/** The persisted `integrations-studio` document, as the scope narrows it. */
export interface StudioDocument {
  /** Deployed skills, in deployment order. */
  skills: DeployedSkillEntry[]
}

/** The section's staged view state. */
export interface IntegrationsStudioState {
  /** Active tab; the Marketplace is the resident default. */
  tab: StudioTabId
  /** Marketplace query — the search input's live draft. */
  query: string
  /** Marketplace kind filter. */
  kind: CatalogKind
  /** Marketplace category filter; 'all' shows every category. */
  category: string
  /** Staged studio draft. */
  draft: StudioDraftFields
  /** Deployed skill entries, from the persisted snapshot. */
  skills: readonly DeployedSkillEntry[]
}

/** The empty section view. */
export const EMPTY_STUDIO_STATE: IntegrationsStudioState = {
  tab: 'marketplace',
  query: '',
  kind: 'all',
  category: 'all',
  draft: { name: '', description: '', whenToUse: '', tags: '', instructions: '' },
  skills: [],
}

/** Narrow one unknown wire section to the persisted document shape. */
export function decodeStudioDocument(section: unknown): StudioDocument | undefined {
  if (section === null || typeof section !== 'object') return undefined
  const skills = (section as { skills?: unknown }).skills
  if (!Array.isArray(skills)) return undefined
  const entries: DeployedSkillEntry[] = []
  for (const entry of skills) {
    if (entry === null || typeof entry !== 'object') continue
    const skill = entry as Record<string, unknown>
    if (typeof skill.name !== 'string' || typeof skill.description !== 'string'
      || typeof skill.instructions !== 'string' || typeof skill.deployedAt !== 'string') continue
    entries.push({
      name: skill.name,
      description: skill.description,
      whenToUse: typeof skill.whenToUse === 'string' ? skill.whenToUse : '',
      instructions: skill.instructions,
      deployedAt: skill.deployedAt,
    })
  }
  return { skills: entries }
}

/** The section's staged-view mutation API. */
export interface StudioActions {
  /** Show one tab. */
  setTab(tab: StudioTabId): void
  /** Replace the marketplace query draft. */
  setQuery(query: string): void
  /** Replace the marketplace kind filter. */
  setKind(kind: CatalogKind): void
  /** Replace the marketplace category filter. */
  setCategory(category: string): void
  /** Replace one staged studio draft field. */
  patchDraft(field: keyof StudioDraftFields, value: string): void
  /** Stage one whole draft replacement. */
  setDraft(fields: StudioDraftFields): void
}

/**
 * The registration-side inject face, complete: snapshot + actions — the
 * complete mutation API the section binds, per the slots discipline.
 */
export interface IntegrationsStudioInjected {
  hooks: {
    /** Section snapshot bound by the renderer as useIntegrationsStudio. */
    studio: SnapshotStore<IntegrationsStudioState>
  }
  /** The section's staged-view mutation API. */
  actions: StudioActions
}

/** The settings-scope seam the controller binds (ui-settings contract's own face). */
type StudioScope = SettingsScope<StudioDocument>

/** Build the section's face over one bound settings scope. */
export class IntegrationsStudioController {
  private readonly store: SnapshotStore<IntegrationsStudioState>
  private readonly unsubscribe: () => void

  /** @param scope - the bound scope for the `integrations-studio` namespace. */
  constructor(readonly scope: StudioScope) {
    this.store = createSnapshotStore(EMPTY_STUDIO_STATE)
    this.unsubscribe = scope.subscribe(() => { this.refreshSkills() })
    this.refreshSkills()
  }

  /**
   * Derive the deployed-skill entries from the scope's current snapshot.
   */
  private refreshSkills(): void {
    const snapshot = this.scope.getSnapshot()
    const document = decodeStudioDocument(snapshot.value)
    this.store.set({ ...this.store.getSnapshot(), skills: document?.skills ?? [] })
  }

  /**
   * Replace one staged view field, one call-site per member.
   * @param field - the state member to replace.
   * @param value - next value, as the section edits it.
   */
  patchState<K extends keyof IntegrationsStudioState>(field: K, value: IntegrationsStudioState[K]): void {
    this.store.set({ ...this.store.getSnapshot(), [field]: value })
  }

  /**
   * Build the face the section's slot registration injects: the tab snapshot
   * plus the complete staged-view mutation API.
   * @returns the section's inject face.
   */
  inject(): IntegrationsStudioInjected {
    return {
      hooks: { studio: this.store },
      actions: {
        setTab: (tab) => { this.patchState('tab', tab) },
        setQuery: (query) => { this.patchState('query', query) },
        setKind: (kind) => { this.patchState('kind', kind) },
        setCategory: (category) => { this.patchState('category', category) },
        patchDraft: (field, value) => {
          this.patchState('draft', { ...this.store.getSnapshot().draft, [field]: value })
        },
        setDraft: (fields) => { this.patchState('draft', fields) },
      },
    }
  }

  /**
   * Stop following the scope; the registration effect captures the disposer.
   */
  dispose(): void {
    this.unsubscribe()
  }
}
