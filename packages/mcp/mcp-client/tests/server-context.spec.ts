import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import McpStatus from '@deepseek-ai/dsh-mcp-status'
import { createScope } from '@deepseek-ai/dsh-scope'
import { registerServerContext } from '../src/server-context.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

async function setup() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpResources)
  return ctx
}

const status = { snapshot: () => ({ state: 'connected' as const, tools: ['mcp__docs__read'] }), subscribe: () => () => {} }

describe('MCP server context', () => {
  it('publishes literal instructions and withdraws the prompt and resource provider together', async () => {
    const ctx = await setup()
    let instructions = 'MCP server: docs\nKeep {{server.template}} literal.'
    const fiber = await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, 'docs', {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => instructions,
        status,
      })
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(instructions)
    instructions = 'MCP server: docs\nUpdated instructions.'
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(instructions)
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('MCP server: docs')
    const result = await ctx.tools.execute({
      name: 'list_mcp_resources', arguments: { server: 'docs' },
      callId: ToolCallId('disposed-resource'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
  })

  it('shows scoped server instructions only to the owning scope', async () => {
    const ctx = await setup()
    const scopeKey = {}
    await ctx.plugin({ apply(inner: Context) {
      const scoped = createScope(inner, scopeKey)
      registerServerContext(scoped.ctx, 'private', {
        resources: { request: async () => ({ resources: [] }) },
        instructions: () => 'Private server instructions.',
        status,
      })
    } })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeKey }))).toContain('Private server instructions.')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Private server instructions.')
  })

  it('reports connection status while the status registry is mounted, including one mounted later', async () => {
    const ctx = await setup()
    let listener: () => void = () => {}
    const source = {
      snapshot: () => ({ state: 'connecting' as const, tools: [] }),
      subscribe: (next: () => void) => {
        listener = next
        return () => { listener = () => {} }
      },
    }
    const fiber = await ctx.plugin({ apply(inner: Context) {
      registerServerContext(inner, 'late', { resources: { request: async () => ({ resources: [] }) }, instructions: () => '', status: source })
    } })
    await ctx.plugin(McpStatus)
    const changes: number[] = []
    ctx.on('mcp-status/change', () => { changes.push(1) })
    expect(ctx.mcpStatus.list()).toEqual([{ server: 'late', state: 'connecting', tools: [] }])
    listener()
    expect(changes).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.mcpStatus.list()).toEqual([])
  })
})
