import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PluginsInvariant from '../src/invariant.ts'
import { createToggleGate } from '../src/client/toggle-gate.ts'

describe('ui-settings-plugin-inventory invariant companion', () => {
  it('registers the explained companion and keeps the node half inert', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PluginsInvariant).await()).resolves.toBeDefined()
    const { apply } = await import('../src/index.ts')
    apply()
    await ctx.fiber.dispose()
  })
})

describe('entry-toggle writability gate', () => {
  it('rejects toggling until a writable snapshot was last observed', () => {
    const gate = createToggleGate()
    expect(() => { gate.assertToggleAllowed() }).toThrow('no inventory snapshot has been read')

    gate.observe({ writable: false })
    expect(() => { gate.assertToggleAllowed() }).toThrow('not writable')

    gate.observe({ writable: true })
    expect(() => { gate.assertToggleAllowed() }).not.toThrow()

    gate.observe({})
    expect(() => { gate.assertToggleAllowed() }).not.toThrow()
  })
})
