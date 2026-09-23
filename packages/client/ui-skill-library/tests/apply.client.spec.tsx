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
import { SkillLibraryPage } from '../src/client/SkillLibraryPage.tsx'
import { SkillsPanelIcon } from '../src/client/SkillsPanelIcon.tsx'
import { inventory, source } from './fixtures.client.ts'

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
  const skillManager = {
    inventory: vi.fn(async () => ({ ok: true as const, value: inventory() })),
    sources: vi.fn(async () => ({ ok: true as const, value: { sources: [source()] } })),
    checkUpdates: vi.fn(async () => ({ ok: true as const, value: { sources: [source()] } })),
  }
  const remote = new TestRemote(ctx, { skillManager })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, remote, skillManager }
}

describe('ui-skill-library browser plugin', () => {
  it('has no Host behavior and declares only the services the page uses', () => {
    expect(root.apply).toBeTypeOf('function')
    root.apply()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.skillManager'])
  })

  it('registers the Skills sidebar entry after Plugins and its page, and reloads a rendered page on Host changes', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const page = b.slots.entries('main')[0]!
    expect(page.component).toBe(SkillLibraryPage)
    expect(page.options).toMatchObject({ key: PANEL_ID })
    expect(page.locale).toBe(NS)
    const entry = b.slots.entries('sidebar.panellist')[0]!
    expect(entry.component).toBe(SkillsPanelIcon)
    expect(entry.options).toMatchObject({ id: PANEL_ID, order: 5 })
    expect(resolveSlotLabel(entry.options.label)).toBe('技能')
    const unread = (): never => { throw new Error('The sidebar icon must not read application state') }
    const glyph = render(
      <SkillsPanelIcon
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

    // A page never rendered ignores Host changes.
    b.ctx.emit('connection/reset')
    expect(b.skillManager.inventory).not.toHaveBeenCalled()
    const face = page.inject?.()
    expect(face?.ensure).toBeTypeOf('function')
    // The slot stores the face as an untyped record; `ensure` is the page's zero-argument loader.
    ;(face?.ensure as () => void)()
    await vi.waitFor(() => { expect(b.skillManager.checkUpdates).toHaveBeenCalled() })
    const loads = b.skillManager.inventory.mock.calls.length
    b.remote.emit('skill-manager/changed', [])
    await vi.waitFor(() => { expect(b.skillManager.inventory).toHaveBeenCalledTimes(loads + 1) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.skillManager.inventory).toHaveBeenCalledTimes(loads + 2) })
  })
})
