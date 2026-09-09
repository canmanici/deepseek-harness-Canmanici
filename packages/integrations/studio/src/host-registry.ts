/**
 * Skill & MCP Integration Studio — Host half, registry module.
 *
 * Owns the durable `integrations-studio` settings namespace (document shape:
 * `{ skills }`), the skill-name grammar shared with the model-facing skill
 * catalog, the shape-checked draft validation, and the persisted-entry render.
 *
 * Capability seam: Service Definition (settings namespace + schema) lives here;
 * the Service Provider is the deployment bridge below, and the Consumers are
 * the browser page (`@deepseek-ai/dsh-client-integrations-studio`) plus the
 * provenance markers carried through `ctx.skills`.
 *
 * @module @deepseek-ai/dsh-integrations-studio/registry
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Durable settings namespace owned by this plugin. */
export const STUDIO_SETTINGS_NAMESPACE = 'integrations-studio'

/** Deployed skill entry: name, routing description, Markdown body. */
export interface StudioEntry {
  /** Kebab-case skill name; consumed by the skill registry's name grammar. */
  name: string
  /** Routing description (skill catalogs). */
  description: string
  /** Routing hint the catalog surfaces beside the description; empty when none. */
  whenToUse: string
  /** Raw Markdown instruction body, kept verbatim. */
  instructions: string
  /** ISO deployment stamp. */
  deployedAt: string
}

/** Persisted studio settings document. */
export interface StudioSettings {
  /** Deployed skills, in deployment order. */
  skills: StudioEntry[]
}

/** Name grammar shared with the skill registry's public skill-name shape. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Field limits the studio enforces at the draft boundary. */
export const STUDIO_DRAFT_LIMITS = {
  nameMax: 64,
  descriptionMax: 1024,
  instructionsMax: 20_000,
  instructionsMin: 10,
} as const

/** One shape-checked draft. */
export interface StudioSkillDraft {
  /** Kebab-case skill name. */
  name: string
  description: string
  whenToUse?: string
  instructions: string
}

/** Whether one skill name satisfies the studio's grammar. */
export const isStudioSkillName = (name: string): boolean => SKILL_NAME_PATTERN.test(name)

/** One validation finding, machine-coded per field. */
export interface StudioValidationIssue {
  readonly field: 'name' | 'description' | 'instructions'
  readonly code: 'required' | 'format' | 'tooLong' | 'tooShort'
  readonly severity: 'error'
}

/**
 * Validate one draft; machine-coded findings per field.
 * @returns the ordered findings; empty when the draft persists.
 */
export function validateStudioSkillDraft(draft: StudioSkillDraft): readonly StudioValidationIssue[] {
  const found: StudioValidationIssue[] = []
  const push = (field: StudioValidationIssue['field'], code: StudioValidationIssue['code']): void => {
    found.push({ field, code, severity: 'error' })
  }
  const name = draft.name.trim()
  if (name === '') push('name', 'required')
  else if (!SKILL_NAME_PATTERN.test(name)) push('name', 'format')
  else if (name.length > STUDIO_DRAFT_LIMITS.nameMax) push('name', 'tooLong')
  const description = draft.description.trim()
  if (description === '') push('description', 'required')
  else if (description.length > STUDIO_DRAFT_LIMITS.descriptionMax) push('description', 'tooLong')
  const body = draft.instructions.trim()
  if (body === '') push('instructions', 'required')
  else if (body.length < STUDIO_DRAFT_LIMITS.instructionsMin) push('instructions', 'tooShort')
  else if (body.length > STUDIO_DRAFT_LIMITS.instructionsMax) push('instructions', 'tooLong')
  return found
}

/**
 * Render the persisted user-section entry from one shape-checked draft.
 * @returns the entry carried into the settings document.
 */
export const toStudioEntry = (draft: StudioSkillDraft, nowIso: () => string): StudioEntry => ({
  name: draft.name.trim(),
  description: draft.description.trim(),
  whenToUse: draft.whenToUse === undefined ? '' : draft.whenToUse.trim(),
  instructions: draft.instructions,
  deployedAt: nowIso(),
})

/** The durable settings-namespace schema validated at `settings.register`. */
export const StudioSettingsSchema: z<StudioSettings> = z.object({
  skills: z.array(z.object({
    name: z.string().min(1).pattern(SKILL_NAME_PATTERN),
    description: z.string().min(1),
    whenToUse: z.string().min(1),
    instructions: z.string().min(10),
    deployedAt: z.string().min(1),
  })),
})

/** Register the durable settings namespace when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(STUDIO_SETTINGS_NAMESPACE),
      StudioSettingsSchema,
    )
  })
}
