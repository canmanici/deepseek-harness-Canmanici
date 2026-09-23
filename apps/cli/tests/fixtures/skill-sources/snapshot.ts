import { fileURLToPath } from 'node:url'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill-preferences'
import type {} from '@deepseek-ai/dsh-skill-sources'
import type {} from '@deepseek-ai/dsh-tools'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('skill-sources snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('skill-sources-snapshot', rootConfigPath, [
  ...loadOverlayPatches('skill-sources-snapshot', basePatchPath),
  ...loadOverlayPatches('skill-sources-snapshot', overlayPath),
])

try {
  const agentId = SessionId('skill-sources-snapshot')
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
    inject: () => { throw new Error('skill-sources snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const before = ctx.skillSources.list()
  const synced = await ctx.skillSources.sync('fixture-skills')
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user' && message.source.kind === 'skill-catalog')?.content
    : undefined
  const result = await ctx.tools.execute({
    callId: ToolCallId('skill-sources-snapshot'),
    name: 'skill',
    arguments: { name: 'remote-notes' },
    agent,
    signal: new AbortController().signal,
  })
  await ctx.skillSources.setEnabled('fixture-skills', false)
  const afterDisable = (await ctx.skills.list()).map(skill => skill.name)
  process.stdout.write(`${JSON.stringify({ before, synced, catalog: catalog ?? null, result, afterDisable })}\n`)
} finally {
  await ctx.fiber.dispose()
}
