// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
/** Test-double translate with the production `{name}` interpolation shape. */
const t = ((key: PluginInventoryLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  )) as PluginInventorySettingsTabProps['t']

function props(
  list: PluginInventorySettingsTabInjected['list'],
  setEnabled: PluginInventorySettingsTabInjected['setEnabled'],
): PluginInventorySettingsTabProps {
  return {
    t,
    list,
    setEnabled,
  } as PluginInventorySettingsTabProps
}

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@deepseek-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@deepseek-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
  ],
  writable: true,
  live: false,
} as unknown as Snapshot

const READ_ONLY_SNAPSHOT = { ...SNAPSHOT, writable: false } as unknown as Snapshot

function withEntryEnabled(entryId: string, enabled: boolean): Snapshot {
  return {
    ...SNAPSHOT,
    entries: SNAPSHOT.entries.map(entry => entry.entryId === entryId ? { ...entry, enabled } : entry),
  }
}

async function expandCard(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name }))
}

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list, vi.fn())} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(6)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.disable })).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
    expect(screen.getByRole('button', { name: en.enable })).toBeTruthy()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT, vi.fn())} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [], writable: true, live: false })
    render(<PluginInventorySettingsTab {...props(list, vi.fn())} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure, vi.fn())} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise, vi.fn())} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise, vi.fn())} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })

  it('enables a disabled entry, refetches, and shows the restart hint', async () => {    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
    .mockResolvedValueOnce(SNAPSHOT)
    .mockResolvedValueOnce(withEntryEnabled('disabled-entry', true))
  const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>().mockResolvedValue(undefined)
  render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

  await expandCard('directory-picker-native, Disabled')
  fireEvent.click(screen.getByRole('button', { name: en.enable }))
  await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('disabled-entry', true) })
  await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  expect(screen.getByText(en.restartEffect)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'directory-picker-native, Not mounted, Enabled' })).toBeTruthy()
  expect(screen.getByRole('button', { name: en.disable })).toBeTruthy()
  })

  it('shows the live hint instead of the restart hint on live-reload deployments', async () => {
    const LIVE_SNAPSHOT = { ...SNAPSHOT, live: true } as unknown as Snapshot
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockResolvedValueOnce(LIVE_SNAPSHOT)
      .mockResolvedValueOnce({ ...(withEntryEnabled('disabled-entry', true) as Snapshot), live: true })
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>().mockResolvedValue(undefined)
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('directory-picker-native, Disabled')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    await waitFor(() => { expect(screen.getByText(en.liveEffect)).toBeTruthy() })
    expect(screen.queryByText(en.restartEffect)).toBeNull()
  })

  it('requires confirmation before disabling and cancels back to idle', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockResolvedValueOnce(withEntryEnabled('8a1b2c3d', false))
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>().mockResolvedValue(undefined)
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('hmr, Mounted, Enabled')
    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    expect(screen.getByText(en.disableWarning)).toBeTruthy()
    expect(setEnabled).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByText(en.disableWarning)).toBeNull()
    expect(setEnabled).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.disable }))

    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmDisable }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('8a1b2c3d', false) })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(screen.getByText(en.restartEffect)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'hmr, Disabled' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.enable }))
  })

  it('disables controls and announces progress while saving', async () => {
    const list = vi.fn(async () => SNAPSHOT)
    const deferred = Promise.withResolvers<undefined>()
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>().mockReturnValue(deferred.promise)
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('directory-picker-native, Disabled')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    expect(screen.getByRole('status').textContent).toBe(en.saving)
    expect(screen.getByRole('button', { name: en.enable }).hasAttribute('disabled')).toBe(true)
    await act(async () => { deferred.resolve(undefined) })
    expect(await screen.findByText(en.restartEffect)).toBeTruthy()
  })

  it('surfaces a failed save and retries the same toggle', async () => {
    const list = vi.fn(async () => SNAPSHOT)
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockRejectedValueOnce(new Error('pluginInventory.setEntryEnabled failed: PATCH_WRITE_FAILED: disk full'))
      .mockResolvedValueOnce(undefined)
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('directory-picker-native, Disabled')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    expect(screen.queryByText('PATCH_WRITE_FAILED')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.restartEffect)).toBeTruthy()
  })

  it('names the missing services when a live enable does not apply', async () => {
    const list = vi.fn(async () => SNAPSHOT)
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockRejectedValueOnce(Object.assign(
        new Error('pluginInventory.setEntryEnabled failed: plugin-entry-not-applied: did not activate'),
        { code: 'plugin-entry-not-applied', details: { missingServices: ['workflowEngine'] } },
      ))
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('directory-picker-native, Disabled')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Could not enable this entry: enable workflowEngine first.')
  })

  it('falls back to the generic failure for malformed toggle rejections', async () => {
    const list = vi.fn(async () => SNAPSHOT)
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>()
      .mockRejectedValueOnce(Object.assign(new Error('nope'), {
        code: 'plugin-entry-not-applied',
        details: { missingServices: 42 },
      }))
      .mockRejectedValueOnce('a bare string rejection')
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('directory-picker-native, Disabled')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    expect(await screen.findByText(en.saveFailed)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.saveFailed)).toBeTruthy()
  })

  it('renders the read-only hint without action buttons when the snapshot is not writable', async () => {
    render(<PluginInventorySettingsTab {...props(async () => READ_ONLY_SNAPSHOT, vi.fn())} />)

    await expandCard('directory-picker-native, Disabled')
    expect(screen.getByText(en.readOnlyHint)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.enable })).toBeNull()
    expect(screen.queryByRole('button', { name: en.disable })).toBeNull()

    await expandCard('hmr, Mounted, Enabled')
    expect(screen.getByText(en.readOnlyHint)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.disable })).toBeNull()
  })

  it('falls back to the tab-level failure state when the post-toggle refetch fails', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockResolvedValueOnce(SNAPSHOT)
      .mockRejectedValueOnce(new Error('refetch transport failure'))
    const setEnabled = vi.fn<PluginInventorySettingsTabInjected['setEnabled']>().mockResolvedValue(undefined)
    render(<PluginInventorySettingsTab {...props(list, setEnabled)} />)

    await expandCard('directory-picker-native, Disabled')
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledOnce() })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(en.error)).toBeTruthy()
    expect(screen.queryByText(en.restartEffect)).toBeNull()
  })
})
