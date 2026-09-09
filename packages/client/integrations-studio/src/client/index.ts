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
import type { IntegrationsStudioInjected } from './studio-store.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.integrations-studio'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/** Exported for the section's slot registration's locale seat. */
export { en, zh }

/**
 * Mount the Integrations section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'integrations-studio: section dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'integrations-studio',
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: (): IntegrationsStudioInjected => ({ hooks: { studio: undefined as never }, actions: undefined as never }),
    children: {},
  }, IntegrationsSection))
}
