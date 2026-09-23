import { fileURLToPath } from 'node:url'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-skill-manager'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('skill-authoring snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('skill-authoring-snapshot', rootConfigPath, [
  ...loadOverlayPatches('skill-authoring-snapshot', basePatchPath),
  ...loadOverlayPatches('skill-authoring-snapshot', overlayPath),
])

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition not reached')
}

try {
  const agentId = SessionId('skill-authoring-snapshot')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx,
    id: agentId,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('skill-authoring snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const created = await ctx.skillManager.createSkill({
    name: 'gui-notes',
    description: 'Write notes created from the Settings page.',
    body: 'GUI-authored body.',
    modelInvocable: true,
    userInvocable: true,
  })
  await until(async () => (await ctx.skills.list({ cwd: process.cwd() })).some(skill => skill.name === 'gui-notes'))
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user' && message.source.kind === 'skill-catalog')?.content
    : undefined
  const load = async (): Promise<unknown> => await ctx.tools.execute({
    callId: ToolCallId('skill-authoring-load'),
    name: 'skill',
    arguments: { name: 'gui-notes' },
    agent,
    signal: new AbortController().signal,
  })
  const loaded = await load()
  const inventory = await ctx.skillManager.inventory({})
  await ctx.skillManager.deleteSkill({ name: 'gui-notes' })
  await until(async () => !(await ctx.skills.list({ cwd: process.cwd() })).some(skill => skill.name === 'gui-notes'))
  const afterDelete = await load()
  process.stdout.write(`${JSON.stringify({ created, catalog: catalog ?? null, loaded, editable: inventory.skills.find(skill => skill.name === 'gui-notes')?.editable, afterDelete })}\n`)
} finally {
  await ctx.fiber.dispose()
}
