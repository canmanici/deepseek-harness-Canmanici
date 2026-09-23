/** Browser composition for the optional OpenDesign Studio panel. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OpenDesignPanel, OpenDesignPanelIcon } from './OpenDesignPanel.tsx'
import { en, zh, type OpenDesignLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** OpenDesign runtime and embedded Studio copy. */
    'open-design': OpenDesignLocaleKey
  }
}

/** Stable id shared by the sidebar navigation row and its main panel. */
const PANEL_ID = 'open-design' as MainPanelId
const NS = 'open-design'

/** Required services: slot registration and localized copy. */
export const inject = ['slots', 'locale']

/** Register the OpenDesign Studio panel and its sidebar navigation entry.
 * @param ctx - browser root context.
 * @returns nothing; the slot and locale registrations follow this plugin's life.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-open-design: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, OpenDesignPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, OpenDesignPanelIcon))
}
