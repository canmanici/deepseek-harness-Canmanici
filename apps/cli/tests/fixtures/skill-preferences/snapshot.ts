import { fileURLToPath } from 'node:url'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill-preferences'
import type {} from '@deepseek-ai/dsh-tools'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('skill-preferences snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('skill-preferences-snapshot', rootConfigPath, [
  ...loadOverlayPatches('skill-preferences-snapshot', basePatchPath),
  ...loadOverlayPatches('skill-preferences-snapshot', overlayPath),
])

async function observe(label: string): Promise<unknown> {
  const agentId = SessionId(`skill-preferences-${label}`)
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
    inject: () => { throw new Error('skill-preferences snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user' && message.source.kind === 'skill-catalog')?.content
    : undefined
  const load = async (name: string): Promise<boolean> => {
    const result = await ctx.tools.execute({
      callId: ToolCallId(`skill-preferences-${label}-${name}`),
      name: 'skill',
      arguments: { name },
      agent,
      signal: new AbortController().signal,
    })
    return !result.isError
  }
  return {
    catalog: catalog ?? null,
    loads: { 'alpha-notes': await load('alpha-notes'), 'beta-notes': await load('beta-notes') },
  }
}

try {
  const initial = await observe('initial')
  const projectRoot = await ctx.skillPreferences.projectRootOf(process.cwd())
  await ctx.skillPreferences.setEnabled({ name: 'alpha-notes', enabled: false })
  await ctx.skillPreferences.setEnabled({ name: 'beta-notes', enabled: true, projectRoot })
  const toggled = await observe('toggled')
  process.stdout.write(`${JSON.stringify({ initial, toggled })}\n`)
} finally {
  await ctx.fiber.dispose()
}
