// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import * as root from '../src/index.ts'
import { McpPage } from '../src/client/McpPage.tsx'
import { McpPanelIcon } from '../src/client/McpPanelIcon.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  class LocaleHolder extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'localeHolder')
    }
  }
  new LocaleHolder(ctx)
  const mcpManager = { servers: vi.fn(async () => ({ ok: true as const, value: { servers: [], manageable: true } })) }
  const remote = new TestRemote(ctx, { mcpManager })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, remote, mcpManager }
}

describe('ui-mcp-library browser plugin', () => {
  it('has no Host behavior and declares only the services the page uses', () => {
    expect(root.apply).toBeTypeOf('function')
    root.apply()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mcpManager'])
  })

  it('registers the MCP sidebar entry after Skills and its page, and reloads a rendered page on Host changes', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const page = b.slots.entries('main')[0]!
    expect(page.component).toBe(McpPage)
    expect(page.options).toMatchObject({ key: PANEL_ID })
    expect(page.locale).toBe(NS)
    const entry = b.slots.entries('sidebar.panellist')[0]!
    expect(entry.component).toBe(McpPanelIcon)
    expect(entry.options).toMatchObject({ id: PANEL_ID, order: 6 })
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP')
    const unread = (): never => { throw new Error('The sidebar icon must not read application state') }
    const glyph = render(
      <McpPanelIcon
        size={18}
        active={false}
        usePanelInfo={unread}
        useSessions={unread}
        useSessionStatus={unread}
        useSessionRetainInfo={unread}
        useWorkspaces={unread}
        useResource={unread}
      />,
    )
    expect(glyph.container.querySelector('svg')?.getAttribute('width')).toBe('18')

    b.ctx.emit('connection/reset')
    expect(b.mcpManager.servers).not.toHaveBeenCalled()
    const face = page.inject?.()
    expect(face?.ensure).toBeTypeOf('function')
    // The slot stores the face as an untyped record; `ensure` is the page's zero-argument loader.
    ;(face?.ensure as () => void)()
    await vi.waitFor(() => { expect(b.mcpManager.servers).toHaveBeenCalledTimes(1) })
    b.remote.emit('mcp-manager/changed', [])
    await vi.waitFor(() => { expect(b.mcpManager.servers).toHaveBeenCalledTimes(2) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.mcpManager.servers).toHaveBeenCalledTimes(3) })
  })
})
