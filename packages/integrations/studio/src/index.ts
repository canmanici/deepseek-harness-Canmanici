/**
 * Skill & MCP Integration Studio — Host half, node entry. Register the
 * durable `integrations-studio` settings namespace (document shape:
 * `{ skills }`) when a settings provider exists.
 *
 * Capability seam: Service Definition + Service Provider live here; the
 * Consumers are the browser page (`@deepseek-ai/dsh-client-integrations-studio`)
 * and the model-facing skill catalog's provenance markers carried through
 * `ctx.skills`. Disposal of the plugin releases everything these files own.
 *
 * @module @deepseek-ai/dsh-integrations-studio
 */

export { apply, isStudioSkillName, SKILL_NAME_PATTERN, STUDIO_DRAFT_LIMITS, STUDIO_SETTINGS_NAMESPACE, StudioSettingsSchema, toStudioEntry, validateStudioSkillDraft } from './host-registry.ts'
export type { StudioEntry, StudioSettings, StudioSkillDraft, StudioValidationIssue } from './host-registry.ts'
