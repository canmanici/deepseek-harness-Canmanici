/**
 * Skill library, browser half: the **Skills** entry of the sidebar, below
 * Plugins, and the page it opens in the main column. The page lists every
 * installed skill with an inspector, switches skills on or off globally or
 * per project, creates and edits user skills, and manages remote sources
 * through the `skillManager` Remote.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the root `main` keyed slot and its panel id brand, declared by
// ui-layout, and the `sidebar.panellist` list declared by ui-sidebar.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-host-skill-manager/types'
import { SkillsController } from './controller.ts'
import { SkillLibraryPage } from './SkillLibraryPage.tsx'
import { SkillsPanelIcon } from './SkillsPanelIcon.tsx'
import { en, zh, type SkillLibraryLocaleKey } from './locales.ts'

export type { SkillsFace, SkillsState, SkillManagerRemote } from './controller.ts'
export type { SkillLibraryPageProps } from './SkillLibraryPage.tsx'
export type { SkillLibraryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skill library copy. */
    'skillLibrary': SkillLibraryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'skillLibrary'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'skills' as MainPanelId

/** Services required by the sidebar registration and the Remote methods. */
export const inject = ['slots', 'locale', 'remote', 'remote.skillManager']

/**
 * Contribute the Skills sidebar entry and its page, and keep the page current on Host changes.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-library: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new SkillsController(ctx.remote.skillManager)
  ctx.effect(() => () => { controller.dispose() }, 'ui-skill-library: controller')
  ctx.effect(() => {
    // A page never rendered holds no snapshot to refresh.
    const refresh = (): void => {
      if (controller.state().status !== 'idle') void controller.load()
    }
    const disposers = [
      ctx.remote.$on('skill-manager/changed', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-skill-library: host invalidations')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => controller.inject(),
  }, SkillLibraryPage))
  // Plugins sits at order 0; Skills follows it directly.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    label: () => t('panel'),
    locale: NS,
  }, SkillsPanelIcon))
}
