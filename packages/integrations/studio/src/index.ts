/**
 * Skill & MCP Integration Studio — Host half, node entry.
 *
 * Registers the durable `integrations-studio` settings namespace
 * (document shape: `{ skills }`) when a settings provider and a skill
 * registry exist, and deploys persisted skills into `ctx.skills` so the
 * marketplace's one-click install has a real effect on the live session.
 *
 * Capability seam: Service Definition (settings namespace + document schema)
 * and Service Provider (the deployment bridge below); the Consumers are the
 * browser page (`@deepseek-ai/dsh-client-integrations-studio`) and the
 * model-facing skill catalog reached through `ctx.skills`.
 *
 * @module @deepseek-ai/dsh-integrations-studio
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { StudioSettingsSchema, validateStudioSkillDraft } from './host-registry.ts'
import type { StudioSkillDraft } from './host-registry.ts'
// Type-only, side-effect pull: declaration-merges `ctx.skills` onto Context
// without reaching the skill package's source files (this project's include).

/** Durable settings namespace owned by this plugin. */
export const STUDIO_SETTINGS_NAMESPACE = 'integrations-studio'

export { apply as applyRegistry, isStudioSkillName, SKILL_NAME_PATTERN, STUDIO_DRAFT_LIMITS, toStudioEntry, validateStudioSkillDraft } from './host-registry.ts'
export type { StudioSkillDraft } from './host-registry.ts'

/**
 * Deploy one shape-checked draft into `ctx.skills`.
 * @returns the registration's disposer, owned by the calling fiber.
 */
function deploySkill(ctx: Context, draft: StudioSkillDraft): (() => void) | undefined {
  const skills = ctx.get('skills')
  if (skills === undefined) return undefined
  const issues = validateStudioSkillDraft(draft)
  if (issues.length > 0) {
    console.error(`integrations-studio: refusing to deploy "${draft.name}" — ${issues.map(issue => `${issue.field}:${issue.code}`).join(', ')}`)
    return undefined
  }
  const entry = draft.instructions
  void entry
  return skills.register({
    name: draft.name.trim(),
    description: draft.description.trim(),
    whenToUse: draft.whenToUse === undefined || draft.whenToUse.trim() === '' ? undefined : draft.whenToUse.trim(),
    source: 'user-studio',
    content: draft.instructions,
  })
}

/** Host registration: register the namespace and deploy persisted skills. */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'skills'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(
      settingsNamespace(STUDIO_SETTINGS_NAMESPACE),
      StudioSettingsSchema,
    )
    const disposers: (() => void)[] = []

    /**
     * (Re)deploy the persisted entries of the document snapshot.
     */
    const deployAll = (): void => {
      for (const disposer of disposers.splice(0)) disposer()
      // The document shape is schema-validated at read time; entries deploy in order.
      const entries = scope.get().skills
      for (const entry of entries) {
        const disposer = deploySkill(settingsCtx, entry)
        if (disposer !== undefined) disposers.push(disposer)
      }
    }

    settingsCtx.effect(() => {
      deployAll()
      const unsubscribe = scope.watch(() => { deployAll() })
      return () => {
        for (const disposer of disposers.splice(0)) disposer()
        unsubscribe()
      }
    }, 'integrations-studio: deploy persisted skills')
  })
}
