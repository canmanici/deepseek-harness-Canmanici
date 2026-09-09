/**
 * Integrations settings section: hero header, one tab rail, and the
 * marketplace/tab panels the section renders.
 *
 * The section owns no child slot: everything below it is React state from the
 * section's own store, so its tabs' internals stay under the section's
 * ownership.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { IntegrationsStudioState } from './studio-store.ts'

/** The section's injected face. */
export interface IntegrationsSectionInjected {
  hooks: {
    /** Section snapshot bound by the renderer as useIntegrationsStudio. */
    studio: SnapshotStore<IntegrationsStudioState>
  }
}

/** Props the renderer binds for the section. */
export type IntegrationsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.integrations-studio'>
  & InjectFace<IntegrationsSectionInjected>
