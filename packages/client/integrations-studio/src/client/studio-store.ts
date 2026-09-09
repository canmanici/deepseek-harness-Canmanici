/**
 * The Integrations section's registry state.
 *
 * Business data lives in the object layer: the persisted document arrives
 * through the settings scope's snapshot, and the section's viewing state is
 * the only shared state this surface owns. One controller derives the view
 * from the scope and routes staged writes persistently.
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
}

/** The empty section view. */
export const EMPTY_STUDIO_STATE: IntegrationsStudioState = {
  tab: 'marketplace',
  query: '',
  kind: 'all',
  category: 'all',
  draft: { name: '', description: '', whenToUse: '', tags: '', instructions: '' },
}

/** The registration-side face the section's slot entry injects. */
export interface IntegrationsStudioFace {
  hooks: {
    /** Section snapshot bound by the renderer as useIntegrationsStudio. */
    studio: SnapshotStore<IntegrationsStudioState>
  }
}

/** Build the section's face over one bound settings scope. */
export class IntegrationsStudioController {
  private readonly store: SnapshotStore<IntegrationsStudioState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - the bound settings scope for the `integrations-studio`
   *   namespace; its snapshot is the one persisted-document reader.
   */
  constructor(readonly scope: SettingsScope<StudioDraftFields>) {
    this.store = createSnapshotStore(EMPTY_STUDIO_STATE)
    this.unsubscribe = scope.subscribe(() => { this.refresh() })
    this.refresh()
  }

  /**
   * Derive the view state and keep only tab viewing state in the store.
   */
  private refresh(): void { this.store.set({ ...this.store.getSnapshot() }) }

  /**
   * Replace one staged draft field.
   * @param field - the draft field to replace.
   * @param value - next draft value as the page edits it.
   */
  patchDraft<K extends keyof StudioDraftFields>(field: K, value: string): void {
    this.store.set({
      ...this.store.getSnapshot(),
      draft: { ...this.store.getSnapshot().draft, [field]: value },
    })
  }

  /**
   * Stage one whole draft replacement.
   * @param fields - the next draft, whole-object.
   */
  setDraft(fields: StudioDraftFields): void {
    this.patchState({ draft: fields })
  }

  private patchState(partial: Partial<IntegrationsStudioState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...partial })
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
        setTab: (tab) => { this.patchState({ tab }) },
        setQuery: (query) => { this.patchState({ query }) },
        setKind: (kind) => { this.patchState({ kind }) },
        setCategory: (category) => { this.patchState({ category }) },
        patchDraft: (field, value) => {
          this.patchState({ draft: { ...this.store.getSnapshot().draft, [field]: value } })
        },
        setDraft: (fields) => { this.patchState({ draft: fields }) },
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

/** The state patch the section routes through the controller. */
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
