/**
 * Model-facing skill enablement tool.
 *
 * Registers `manage_skills`, which lets an agent, including a subagent, list
 * installed skills with their enablement and switch skills on or off through
 * `ctx.skillPreferences`, the same service the Skills page writes. A change
 * reaches every agent's skill catalog at its next step.
 *
 * @module @deepseek-ai/dsh-tool-skill-manage
 */

import type { Context } from '@deepseek-ai/cordis'
import { isSkillName, type SkillInventoryEntry } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill-preferences'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Plugin name. */
export const name = 'tool-skill-manage'

/** Required services. */
export const inject = ['skills', 'tools']

/** Register the `manage_skills` tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'manage_skills',
    description: 'List installed skills with whether each is enabled, or enable or disable skills by name. '
      + 'A disabled skill leaves the skill catalog and cannot be loaded. Changes apply from the next step. '
      + 'Use scope "project" to change a skill only for the current project; the default changes it for every project.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'enable', 'disable'], description: 'list, enable, or disable.' },
      names: { type: 'array', items: { type: 'string' }, description: 'Exact skill names to enable or disable.' },
      scope: { type: 'string', enum: ['global', 'project'], description: 'global (default): every project. project: only the current project.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      const lookup = { cwd, signal: exec.signal, scope: exec.agent }
      const inventory = await ctx.skills.inventory(lookup)
      if (args.action === 'list') return renderList(inventory.skills)

      const preferences = ctx.get('skillPreferences')
      if (preferences === undefined) throw new Error('skill enablement is not available in this composition')
      const names = args.names ?? []
      if (names.length === 0) throw new Error(`${args.action} needs at least one skill name in "names"`)
      const unknown = names.filter(skill => !isSkillName(skill) || !inventory.skills.some(entry => entry.name === skill))
      if (unknown.length > 0) throw new Error(`unknown skill ${unknown.map(skill => `"${skill}"`).join(', ')}; call manage_skills with action "list" for exact names`)
      if (args.scope === 'project' && cwd === undefined) throw new Error('scope "project" needs a session with a working directory')
      const projectRoot = args.scope === 'project' && cwd !== undefined ? await preferences.projectRootOf(cwd) : undefined
      const enabled = args.action === 'enable'
      for (const skill of names) await preferences.setEnabled({ name: skill, enabled, projectRoot })
      const where = projectRoot === undefined ? 'every project' : `project ${projectRoot}`
      return `${enabled ? 'Enabled' : 'Disabled'} ${names.map(skill => `\`${skill}\``).join(', ')} for ${where}. The skill catalog updates at the next step.`
    },
    presentCall(args) {
      const target = args.names === undefined || args.names.length === 0 ? '' : ` ${args.names.join(', ')}`
      return { card: 'generic', title: args.action === 'list' ? 'List skills' : `${args.action === 'enable' ? 'Enable' : 'Disable'} skill${target}`, kind: args.action === 'list' ? 'read' : 'other', rawInput: args }
    },
  }))
}

function renderList(skills: readonly SkillInventoryEntry[]): string {
  if (skills.length === 0) return 'No skills are installed.'
  const lines = skills.map(skill => `- \`${skill.name}\` (${skill.enabled ? 'enabled' : 'disabled'}, ${skill.source}): ${skill.description}`)
  const on = skills.filter(skill => skill.enabled).length
  return [`${on} of ${skills.length} skills enabled.`, ...lines].join('\n')
}
