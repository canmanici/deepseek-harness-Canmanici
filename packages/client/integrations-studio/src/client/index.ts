/**
 * Integrations settings surface, browser half — one section page: the
 * marketplace browser (MCP servers + skills), integration toggles, and the
 * custom-skill authoring studio.
 *
 * The section's durable `integrations-studio` namespace is owned by the Host
 * plugin `@deepseek-ai/dsh-integrations-studio`; this package binds its scope
 * and registers the one section, so the page mounts through the settings
 * shell and contributes nothing to Settings nav ownership itself.
 */

// Type-only pulls: the ctx.locale and ctx.slots Context merges the section binds.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IntegrationsSection } from './IntegrationsSection.tsx'
import { IntegrationsStudioController } from './studio-store.ts'
import { decodeStudioDocument } from './studio-store.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.integrations-studio'

/** Settings namespace the Host plugin registered; spelled here (no Host import). */
const STUDIO_SETTINGS_NAMESPACE = 'integrations-studio'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Mount the Integrations section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'integrations-studio: section dictionaries')

  const studio = new IntegrationsStudioController(
    ctx.settingsScope.bind({
      namespace: STUDIO_SETTINGS_NAMESPACE,
      decode: decodeStudioDocument,
    }),
  )
  ctx.effect(() => () => { studio.dispose() }, 'integrations-studio: section controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'integrations-studio',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: () => studio.inject(),
    children: {},
  }, IntegrationsSection))
}
