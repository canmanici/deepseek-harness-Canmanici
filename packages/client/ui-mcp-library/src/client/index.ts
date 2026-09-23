/**
 * MCP page, browser half: the **MCP** entry of the sidebar, below Skills, and
 * the page it opens in the main column. The page lists configured MCP
 * servers with their live status and tools, switches and removes them, adds
 * servers by hand, and connects servers from the MCP Registry through the
 * `mcpManager` Remote.
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
import type {} from '@deepseek-ai/dsh-host-mcp-manager/types'
import { McpController } from './controller.ts'
import { McpPage } from './McpPage.tsx'
import { McpPanelIcon } from './McpPanelIcon.tsx'
import { en, zh, type McpLibraryLocaleKey } from './locales.ts'

export type { McpFace, McpState, McpManagerRemote } from './controller.ts'
export type { McpPageProps } from './McpPage.tsx'
export type { McpLibraryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP page copy. */
    'mcpLibrary': McpLibraryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'mcpLibrary'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'mcp' as MainPanelId

/** Services required by the sidebar registration and the Remote methods. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpManager']

/**
 * Contribute the MCP sidebar entry and its page, and keep the page current on Host changes.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mcp-library: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new McpController(ctx.remote.mcpManager)
  ctx.effect(() => () => { controller.dispose() }, 'ui-mcp-library: controller')
  ctx.effect(() => {
    // A page never rendered holds no snapshot to refresh.
    const refresh = (): void => {
      if (controller.state().status !== 'idle') void controller.load()
    }
    const disposers = [
      ctx.remote.$on('mcp-manager/changed', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-mcp-library: host invalidations')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => controller.inject(),
  }, McpPage))
  // Skills sits at order 5; MCP follows it directly.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 6,
    label: () => t('panel'),
    locale: NS,
  }, McpPanelIcon))
}
