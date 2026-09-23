import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SkillRegistry, { type SkillCandidate } from '@deepseek-ai/dsh-skill'
import SkillPreferences from '@deepseek-ai/dsh-skill-preferences'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as toolSkillManage from '../src/index.ts'

const temps: string[] = []
afterEach(async () => { await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tool-skill-manage-'))
  temps.push(dir)
  return dir
}

function candidate(name: string): SkillCandidate {
  return { name, description: `${name} skill`, invocation: { modelInvocable: true, userInvocable: true }, provider: 'memory', source: 'user-dsh', rank: 10, locator: undefined }
}

async function setup(options: { preferences?: boolean } = {}): Promise<{ ctx: Context; project: string }> {
  const home = await temp()
  const project = await temp()
  await mkdir(join(project, '.git'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  ctx.skills.registerProvider(() => ({ name: 'memory', list: async () => [candidate('alpha'), candidate('beta')], get: async skill => ({ ...skill, content: 'body' }) }))
  if (options.preferences !== false) await ctx.plugin(SkillPreferences, { dshHome: home, watch: false })
  await ctx.plugin(toolSkillManage)
  return { ctx, project }
}

function agentFor(cwd: string | undefined): Agent {
  const id = SessionId(`manage-${cwd ?? 'none'}`)
  const base: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false }
  const header: SessionHeader = cwd === undefined ? base : { ...base, cwd }
  const session = Session.create(id, [], header)
  return {
    ctx: new Context(), id, options: {}, session, inbox: unsupportedInbox(), status: 'idle',
    send: () => {}, followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  }
}

async function call(ctx: Context, agent: Agent, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('manage'), name: 'manage_skills', arguments: args, agent })
  const text = result.content.map(block => ('text' in block ? block.text : '')).join('')
  return { text, isError: result.isError }
}

describe('manage_skills', () => {
  it('lists skills with their enablement', async () => {
    const { ctx, project } = await setup()
    const agent = agentFor(project)
    expect((await call(ctx, agent, { action: 'list' })).text).toBe('2 of 2 skills enabled.\n- `alpha` (enabled, user-dsh): alpha skill\n- `beta` (enabled, user-dsh): beta skill')
  })

  it('disables and re-enables skills globally or for the current project', async () => {
    const { ctx, project } = await setup()
    const agent = agentFor(join(project))
    expect((await call(ctx, agent, { action: 'disable', names: ['alpha'] })).text).toBe('Disabled `alpha` for every project. The skill catalog updates at the next step.')
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['beta'])
    const enabled = await call(ctx, agent, { action: 'enable', names: ['alpha'], scope: 'project' })
    expect(enabled.text).toBe(`Enabled \`alpha\` for project ${project}. The skill catalog updates at the next step.`)
    expect((await ctx.skills.list({ cwd: project })).map(skill => skill.name)).toEqual(['alpha', 'beta'])
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['beta'])
    expect((await call(ctx, agent, { action: 'list' })).text).toContain('`alpha` (enabled')
    expect((await call(ctx, agentFor(undefined), { action: 'list' })).text).toContain('1 of 2 skills enabled.\n- `alpha` (disabled, user-dsh)')
  })

  it('reports missing names, unknown skills, and an impossible project scope', async () => {
    const { ctx, project } = await setup()
    const agent = agentFor(project)
    expect(await call(ctx, agent, { action: 'disable' })).toMatchObject({ isError: true, text: expect.stringContaining('needs at least one skill name') as string })
    expect(await call(ctx, agent, { action: 'disable', names: ['nope', 'Bad'] })).toMatchObject({ isError: true, text: expect.stringContaining('unknown skill "nope", "Bad"') as string })
    expect(await call(ctx, agentFor(undefined), { action: 'enable', names: ['alpha'], scope: 'project' })).toMatchObject({ isError: true, text: expect.stringContaining('needs a session with a working directory') as string })
  })

  it('refuses changes when skill preferences are not composed and lists an empty catalog', async () => {
    const { ctx, project } = await setup({ preferences: false })
    expect(await call(ctx, agentFor(project), { action: 'disable', names: ['alpha'] })).toMatchObject({ isError: true, text: expect.stringContaining('not available in this composition') as string })
    const empty = new Context()
    await empty.plugin(SystemPrompt)
    await empty.plugin(ToolRuntime)
    await empty.plugin(AgentRegistry)
    await empty.plugin(SkillRegistry)
    await empty.plugin(toolSkillManage)
    expect((await call(empty, agentFor(project), { action: 'list' })).text).toBe('No skills are installed.')
  })

  it('presents list and change calls', () => {
    const tool = (async () => {
      const { ctx } = await setup()
      return ctx.tools.get('manage_skills')
    })()
    return tool.then((registered) => {
      expect(registered?.presentCall?.({ action: 'list' })).toMatchObject({ title: 'List skills', kind: 'read' })
      expect(registered?.presentCall?.({ action: 'enable', names: ['a', 'b'] })).toMatchObject({ title: 'Enable skill a, b', kind: 'other' })
      expect(registered?.presentCall?.({ action: 'disable', names: [] })).toMatchObject({ title: 'Disable skill', kind: 'other' })
    })
  })
})
