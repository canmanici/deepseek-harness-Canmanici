import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpStatus, { type McpConnectionStatus } from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

function source(initial: McpConnectionStatus) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    set(next: McpConnectionStatus) {
      current = next
      for (const listener of listeners) listener()
    },
    listeners,
    snapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

describe('McpStatusRegistry', () => {
  it('lists registered servers by name, announces changes, and drops a registration with its context', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(McpStatus)
    let changes = 0
    ctx.on('mcp-status/change', () => { changes += 1 })
    const beta = source({ state: 'connecting', tools: [] })
    const alpha = source({ state: 'failed', tools: [], error: 'spawn ENOENT', attempt: 2 })
    const dispose = ctx.mcpStatus.register('beta', beta)
    const fiber = await ctx.plugin({ inject: ['mcpStatus'], apply(inner: Context) { inner.mcpStatus.register('alpha', alpha) } })
    expect(changes).toBe(2)
    expect(ctx.mcpStatus.list().map(entry => entry.server)).toEqual(['alpha', 'beta'])
    beta.set({ state: 'connected', tools: ['mcp__beta__x'], connectedAt: '2026-09-23T00:00:00.000Z' })
    expect(changes).toBe(3)
    expect(ctx.mcpStatus.list()[1]).toEqual({ server: 'beta', state: 'connected', tools: ['mcp__beta__x'], connectedAt: '2026-09-23T00:00:00.000Z' })
    await fiber.dispose()
    expect(alpha.listeners.size).toBe(0)
    expect(ctx.mcpStatus.list().map(entry => entry.server)).toEqual(['beta'])
    dispose()
    expect(ctx.mcpStatus.list()).toEqual([])
    expect(changes).toBe(5)
  })
})
