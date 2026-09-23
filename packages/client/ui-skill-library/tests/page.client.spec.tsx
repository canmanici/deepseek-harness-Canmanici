// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { entry, inventory, source, unsynced } from './fixtures.client.ts'
import { fail, mount, ok, openInstalled, page, remote, set, tab } from './harness.client.tsx'

afterEach(cleanup)

describe('SkillLibraryPage', () => {
  it('opens on Discover, lists marketplaces with counts, and browses the first page', async () => {
    const { api } = mount()
    expect(screen.getByRole('status').textContent).toBe(en.discoverLoading)
    await screen.findByText('/pdf'.slice(1))
    expect(tab(/^Discover/).getAttribute('aria-selected')).toBe('true')
    expect(tab(/^Installed/).textContent).toBe('Installed2')
    const rail = screen.getByRole('group', { name: en.marketFilter })
    const chips = within(rail).getAllByRole('button')
    expect(chips.map(chip => chip.textContent)).toEqual(['All marketplaces', 'Anthropic Skills2', 'claude-plugins.dev47.1K', 'SkillsMPSearch only', 'DownUnreachable'])
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Search skills across 4 marketplaces')
    expect(screen.getByText('2 matches')).toBeDefined()
    const cards = screen.getAllByRole('listitem').filter(item => item.getAttribute('data-state') !== null)
    expect(cards.map(card => card.getAttribute('data-state'))).toEqual(['available', 'installed'])
    expect(within(cards[1] as HTMLElement).getByText('1.2K installs')).toBeDefined()
    expect(within(cards[1] as HTMLElement).getByText(en.installed)).toBeDefined()
    expect(screen.getAllByRole('link', { name: 'o/r' })).toHaveLength(2)
    expect(api.searchMarketplace).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(api.checkUpdates).toHaveBeenCalled() })
  })

  it('searches after typing pauses, filters by marketplace, installs, and loads more', async () => {
    const api = remote({
      searchMarketplace: vi.fn(async () => ok(page([entry('pdf', { conflict: 'user-dsh' })], { hasMore: true, errors: [{ marketplace: 'down', message: 'x' }, { marketplace: 'gone', message: 'y' }] }))),
    })
    mount(api)
    await screen.findByText('pdf')
    expect(screen.getByText(en.conflict.replace('{source}', 'user-dsh'))).toBeDefined()
    expect(screen.getByText('Down, gone can’t be reached right now.')).toBeDefined()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pd' } })
    await waitFor(() => { expect(api.searchMarketplace).toHaveBeenLastCalledWith({ query: 'pd', offset: 0 }) })
    fireEvent.click(screen.getByRole('button', { name: /^claude-plugins\.dev/ }))
    await waitFor(() => { expect(api.searchMarketplace).toHaveBeenLastCalledWith({ query: 'pd', marketplace: 'cpd', offset: 0 }) })

    fireEvent.click(screen.getByRole('button', { name: 'Install /pdf' }))
    expect(api.installSkill).toHaveBeenCalledWith({ repository: 'o/r', name: 'pdf', dir: 'skills/pdf' })
    api.searchMarketplace.mockResolvedValueOnce(ok(page([entry('xlsx')], { nextOffset: 48 })))
    fireEvent.click(screen.getByRole('button', { name: en.loadMore }))
    await screen.findByText('xlsx')
    expect(screen.queryByRole('button', { name: en.loadMore })).toBeNull()
  })

  it('explains empty results, search-only marketplaces, a missing service, and load failures', async () => {
    const api = remote({ searchMarketplace: vi.fn(async () => ok(page([], { totals: {} }))) })
    const { controller } = mount(api)
    await screen.findByText('No skills match “”. Try another word or pick a different marketplace.')
    fireEvent.click(screen.getByRole('button', { name: /^SkillsMP/ }))
    await screen.findByText(en.discoverBrowseEmpty)

    set(controller, { discover: { ...controller.state().discover, status: 'ready', available: false } })
    expect(screen.getByText(en.discoverUnavailable)).toBeDefined()
    set(controller, { discover: { ...controller.state().discover, status: 'error', error: 'offline' } })
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t read skill marketplaces: offline')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(api.inventory).toHaveBeenCalledTimes(2) })
    set(controller, { discover: { ...controller.state().discover, status: 'ready', available: true, loadingMore: true, hasMore: true, searching: true, results: [entry('a', { state: 'installing' })] } })
    expect(screen.getByRole('button', { name: en.loadingMore }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Install /a' }).textContent).toBe(en.installing)
    expect(screen.getByRole('status', { name: en.discoverSearching })).toBeDefined()
  })

  it('switches views with the arrow keys and opens the editor from New skill', async () => {
    mount()
    await screen.findByText('pdf')
    fireEvent.keyDown(tab(/^Discover/), { key: 'ArrowLeft' })
    expect(tab(/^Sources/).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab(/^Sources/), { key: 'ArrowRight' })
    expect(tab(/^Discover/).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tab(/^Discover/), { key: 'Enter' })
    expect(tab(/^Discover/).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: en.newSkill }))
    expect(tab(/^Installed/).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('heading', { name: en.editorCreateTitle })).toBeDefined()
  })

  it('lists installed skills by origin, toggles them, filters, and offers updates', async () => {
    const api = remote({ checkUpdates: vi.fn(async () => ok({ sources: [source({ updateAvailable: true })] })) })
    mount(api)
    await openInstalled()
    expect(screen.getByRole('region', { name: en.groupUser })).toBeDefined()
    expect(screen.getByRole('region', { name: 'anthropics/skills' })).toBeDefined()
    fireEvent.click(screen.getByRole('switch', { name: 'Enable /alpha' }))
    expect(api.setEnabled).toHaveBeenCalledWith({ name: 'alpha', enabled: false })

    await screen.findByText(en.updatesAvailableOne)
    expect(tab(/^Sources/).textContent).toBe('Sources1')
    fireEvent.click(screen.getByText(en.updatesAvailableOne))
    expect(tab(/^Sources/).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab(/^Installed/))
    fireEvent.click(within(screen.getByText(en.updatesAvailableOne).parentElement as HTMLElement).getByRole('button', { name: en.updateAll }))
    expect(api.syncSource).toHaveBeenCalledWith({ id: 'anthropic-skills' })

    fireEvent.click(screen.getByRole('button', { name: en.filterOff }))
    expect(screen.queryByRole('button', { name: /\/alpha/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.filterOn }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: /\/beta/ })).toBeNull() })
  })

  it('shows the installed empty state and routes to Discover', async () => {
    const api = remote({ inventory: vi.fn(async () => ok(inventory({ skills: [] }))) })
    mount(api)
    fireEvent.click(tab(/^Installed/))
    await screen.findByText(en.emptyTitle)
    fireEvent.click(screen.getByRole('button', { name: en.emptySource }))
    expect(tab(/^Discover/).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(tab(/^Installed/))
    fireEvent.click(screen.getAllByRole('button', { name: en.newSkill }).at(-1) as HTMLElement)
    expect(await screen.findByRole('heading', { name: en.editorCreateTitle })).toBeDefined()
  })

  it('inspects a local skill, edits it, and deletes it after confirming', async () => {
    const api = remote()
    mount(api)
    await openInstalled()
    fireEvent.click(screen.getByRole('button', { name: /\/alpha/ }))
    await screen.findByText('Do it.')
    expect(screen.getByText('‎/h/skills/alpha/SKILL.md‎')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: en.deleteNo }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: en.deleteYes }))
    expect(api.deleteSkill).toHaveBeenCalledWith({ name: 'alpha' })
    await screen.findByText(en.inspectorEmpty)

    fireEvent.click(screen.getByRole('button', { name: /\/alpha/ }))
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    expect(await screen.findByRole('heading', { name: 'Edit /alpha' })).toBeDefined()
  })

  it('customizes and uninstalls a remote skill', async () => {
    const api = remote()
    mount(api)
    await openInstalled()
    fireEvent.click(screen.getByRole('button', { name: /\/beta/ }))
    await screen.findByText(en.customizeHint)
    expect(screen.queryByRole('button', { name: en.edit })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.uninstall }))
    expect(screen.getByRole('alertdialog').textContent).toContain('Uninstall /beta?')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: en.uninstall }))
    expect(api.uninstallSkill).toHaveBeenCalledWith({ name: 'beta' })
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: /\/beta/ }))
    fireEvent.click(await screen.findByRole('button', { name: en.customize }))
    expect(api.customizeSkill).toHaveBeenCalledWith({ name: 'beta' })
    expect(await screen.findByRole('heading', { name: 'Edit /beta' })).toBeDefined()
  })

  it('manages sources: checks for updates, updates, and shows installed out of available', async () => {
    const listing = async () => ok({ sources: [source({ updateAvailable: true, availableCount: 30, checkedAt: '2026-09-23T00:00:00.000Z' }), unsynced({ id: 'fresh', origin: 'user', syncState: 'never' }), source({ id: 'ok', checkedAt: '2026-09-23T00:00:00.000Z' })] })
    const api = remote({
      sources: vi.fn(listing),
      checkUpdates: vi.fn(listing),
    })
    const { controller } = mount(api)
    fireEvent.click(tab(/^Sources/))
    await screen.findByText('/30')
    expect(screen.getAllByText(en.updateAvailable)).toHaveLength(1)
    expect(screen.getByText(/Up to date/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.update }))
    expect(api.syncSource).toHaveBeenCalledWith({ id: 'anthropic-skills' })
    fireEvent.click(screen.getByRole('button', { name: en.checkUpdates }))
    await waitFor(() => { expect(api.checkUpdates).toHaveBeenCalledTimes(2) })
    set(controller, { checking: true })
    expect(screen.getByRole('button', { name: en.checkingUpdates }).hasAttribute('disabled')).toBe(true)
    set(controller, { checking: false, sources: [source({ updateAvailable: true })], pendingSources: [] })
    const updateAll = screen.getAllByRole('button', { name: en.updateAll }).at(-1) as HTMLElement
    fireEvent.click(updateAll)
    await waitFor(() => { expect(api.syncSource).toHaveBeenCalledTimes(2) })
  })

  it('reports a failed save in the notice bar and dismisses it', async () => {
    const api = remote({ installSkill: vi.fn(async () => fail('no network')) })
    mount(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Install /pdf' }))
    const notice = await screen.findByText('Couldn’t save: no network'.replace('Couldn’t save', en.saveFailed.split(':')[0] as string))
    fireEvent.click(within(notice.parentElement as HTMLElement).getByRole('button', { name: en.dismiss }))
    expect(screen.queryByText(/no network/)).toBeNull()
  })
})
