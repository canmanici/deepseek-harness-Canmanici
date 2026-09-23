// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { entry, inventory, source, unsynced } from './fixtures.client.ts'
import { fail, mount, ok, openInstalled, remote, set, tab } from './harness.client.tsx'

afterEach(cleanup)

const skill = (name: string, source: string, patch: Record<string, unknown> = {}) => ({
  name, description: `${name} skill`, source, provider: 'filesystem', modelInvocable: true, userInvocable: true, enabled: true,
  preference: 'default' as const, editable: false, deletable: false, customizable: false, uninstallable: false, ...patch,
})

describe('Installed view', () => {
  it('shows loading, error, locked, and incomplete states', async () => {
    const api = remote({ inventory: vi.fn(async () => fail('host down')), sources: vi.fn(async () => fail('no sources')) })
    const { controller } = mount(api)
    fireEvent.click(tab(/^Installed/))
    expect(screen.getByRole('status', { name: en.loading })).toBeDefined()
    await screen.findByText('Couldn’t read skills: host down'.replace('Couldn’t read skills', en.loadError.split(':')[0] as string))
    set(controller, { status: 'ready', inventory: inventory({ preferencesAvailable: false, complete: false }) })
    expect(screen.getByText(en.preferencesUnavailable)).toBeDefined()
    expect(screen.getByText(en.incomplete)).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Enable /alpha' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(tab(/^Sources/))
    expect(screen.getByRole('alert').textContent).toContain('no sources')
    set(controller, { sourcesStatus: 'ready', inventory: inventory({ sourcesAvailable: false }) })
    expect(screen.getByText(en.sourcesUnavailable)).toBeDefined()
    set(controller, { sourcesStatus: 'loading' })
    expect(screen.getAllByRole('status', { name: en.loading }).length).toBeGreaterThan(0)
  })

  it('groups every origin, scopes to a project, and resets an override', async () => {
    const api = remote({
      inventory: vi.fn(async (request: { projectRoot?: string }) => ok(inventory({
        skills: [
          skill('proj', 'project-dsh', { preference: request.projectRoot === undefined ? 'default' : 'project', editable: true }),
          skill('mine', 'user-dsh', { editable: true, deletable: true }),
          skill('shared', 'remote:gone', { enabled: false, preference: 'global', uninstallable: true, customizable: true }),
          skill('box', 'bundled', { customizable: true, modelInvocable: false, userInvocable: false, whenToUse: 'Rarely' }),
        ],
      }))),
    })
    mount(api)
    fireEvent.click(tab(/^Installed/))
    await screen.findByRole('button', { name: /\/proj/ })
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['This project1/1', 'Your skills1/1', 'gone0/1', 'Built in1/1'].map(text => text.replace('This project', en.groupProject).replace('Your skills', en.groupUser).replace('Built in', en.groupBuiltin)))

    fireEvent.click(screen.getByRole('button', { name: en.scopeMenu }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'App' }).catch(() => screen.getByText('App')))
    await waitFor(() => { expect(api.inventory).toHaveBeenLastCalledWith({ projectRoot: '/work/app' }) })
    fireEvent.click(screen.getByRole('button', { name: /\/proj/ }))
    await screen.findByText(en.originProject)
    fireEvent.click(screen.getByRole('button', { name: en.overrideReset }))
    expect(api.clearOverride).toHaveBeenCalledWith({ name: 'proj', projectRoot: '/work/app' })

    fireEvent.click(screen.getByRole('button', { name: /\/shared/ }))
    await screen.findByText(en.offEverywhere)
    expect(screen.getByText('From gone')).toBeDefined()
    fireEvent.click(screen.getAllByRole('switch', { name: 'Enable /shared' }).at(-1) as HTMLElement)
    expect(api.setEnabled).toHaveBeenLastCalledWith({ name: 'shared', enabled: true, projectRoot: '/work/app' })

    fireEvent.click(screen.getByRole('button', { name: /\/box/ }))
    await screen.findByText(en.originBuiltin)
    expect(screen.getByText(en.invocationHidden)).toBeDefined()
    expect(screen.getByText('Rarely')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /\/mine/ }))
    await screen.findByText(en.originUser)

    fireEvent.click(screen.getByRole('button', { name: en.scopeMenu }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: en.scopeGlobal }).catch(() => screen.getAllByText(en.scopeGlobal).at(-1) as HTMLElement))
    await waitFor(() => { expect(api.inventory).toHaveBeenLastCalledWith({}) })
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    await screen.findByText(en.inspectorEmpty)
  })

  it('reports an unreadable skill, an empty body, and a skill that vanished', async () => {
    const api = remote({ readSkill: vi.fn(async () => fail('gone')) })
    const { controller } = mount(api)
    await openInstalled()
    fireEvent.click(screen.getByRole('button', { name: /\/alpha/ }))
    await screen.findByText('Couldn’t read instructions: gone'.replace('Couldn’t read instructions', en.instructionsError.split(':')[0] as string))
    set(controller, { inspected: { name: 'alpha', loading: true } })
    expect(screen.getByRole('status').textContent).toBe(en.instructionsLoading)
    set(controller, { inspected: { name: 'alpha', loading: false, document: { skill: { name: 'alpha', description: 'd', body: '  ', modelInvocable: true, userInvocable: true }, path: '/p', editable: true } } })
    expect(document.querySelector('[class*="documentEmpty"]')).not.toBeNull()
    set(controller, { inspected: { name: 'ghost', loading: false, document: { skill: { name: 'ghost', description: 'd', body: 'x', modelInvocable: true, userInvocable: true }, path: '/p', editable: false } } })
    expect(screen.queryByRole('switch', { name: 'Enable /ghost' })).toBeNull()
    expect(screen.getByText('ghost')).toBeDefined()
  })
})

describe('Skill editor', () => {
  it('validates the name, previews Markdown, toggles invocation, and saves', async () => {
    const api = remote()
    mount(api)
    fireEvent.click(screen.getByRole('button', { name: en.newSkill }))
    const name = await screen.findByLabelText(en.fieldName)
    expect(screen.getByRole('button', { name: en.editorCreate }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(name, { target: { value: 'Bad_Name' } })
    expect(screen.getByText(en.fieldNameInvalid)).toBeDefined()
    fireEvent.change(name, { target: { value: 'Release Notes' } })
    expect((name as HTMLInputElement).value).toBe('release-notes')
    expect(screen.getByText('Runs as /release-notes.'.replace('Runs as /release-notes.', en.fieldNameInvoke.replace('{name}', 'release-notes')))).toBeDefined()
    fireEvent.change(screen.getByLabelText(en.fieldDescription), { target: { value: 'Draft notes' } })
    fireEvent.change(screen.getByLabelText(en.fieldWhenToUse), { target: { value: 'Before release' } })
    fireEvent.click(screen.getByRole('tab', { name: en.editorPreview }))
    expect(screen.getByText(en.editorPreviewEmpty)).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: en.editorWrite }))
    fireEvent.change(screen.getByLabelText(en.fieldInstructions), { target: { value: '# Steps' } })
    fireEvent.click(screen.getByRole('tab', { name: en.editorPreview }))
    expect(screen.getByRole('heading', { name: 'Steps' })).toBeDefined()
    fireEvent.click(screen.getByRole('switch', { name: en.editorModel }))
    fireEvent.click(screen.getByRole('switch', { name: en.editorCommand }))
    fireEvent.submit(screen.getByRole('button', { name: en.editorCreate }).closest('form') as HTMLFormElement)
    await waitFor(() => {
      expect(api.createSkill).toHaveBeenCalledWith({ name: 'release-notes', description: 'Draft notes', whenToUse: 'Before release', body: '# Steps', modelInvocable: false, userInvocable: false })
    })
  })

  it('shows the edit form busy, loading, and failed, and cancels', async () => {
    const api = remote()
    const { controller } = mount(api)
    set(controller, { editor: { open: true, mode: 'edit', loading: true, busy: false, draft: { name: 'alpha', description: '', body: '', modelInvocable: true, userInvocable: true } } })
    fireEvent.click(tab(/^Installed/))
    expect(await screen.findByText(en.editorLoading)).toBeDefined()
    fireEvent.submit(screen.getByLabelText(en.fieldName).closest('form') as HTMLFormElement)
    expect(api.updateSkill).not.toHaveBeenCalled()
    set(controller, { editor: { ...controller.state().editor, loading: false, busy: true, error: 'disk full', draft: { name: 'alpha', description: 'd', body: 'b', modelInvocable: true, userInvocable: true } } })
    expect(screen.getByRole('alert').textContent).toBe('disk full')
    expect(screen.getByRole('button', { name: en.editorSaving })).toBeDefined()
    set(controller, { editor: { ...controller.state().editor, busy: false } })
    fireEvent.click(screen.getByRole('button', { name: en.editorSave }))
    await waitFor(() => { expect(api.updateSkill).toHaveBeenCalled() })
    set(controller, { editor: { ...controller.state().editor, open: true, busy: false } })
    fireEvent.click(screen.getByRole('button', { name: en.editorCancel }))
    expect(controller.state().editor.open).toBe(false)
  })
})

describe('Sources view', () => {
  it('adds a source with advanced options and reports a failure in the dialog', async () => {
    const api = remote({ addSource: vi.fn(async () => fail('unsupported')) })
    const { controller } = mount(api)
    fireEvent.click(tab(/^Sources/))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.addSource) }))
    const url = await screen.findByLabelText(en.addUrl)
    expect(screen.getByRole('button', { name: en.addSubmit }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(url, { target: { value: 'https://github.com/o/r' } })
    expect(document.querySelector('[data-match="true"]')?.textContent).toBe(en.kindGithub)
    fireEvent.click(screen.getByRole('button', { name: en.addAdvanced }))
    fireEvent.change(screen.getByLabelText(en.addRef), { target: { value: 'main' } })
    fireEvent.change(screen.getByLabelText(en.addPath), { target: { value: 'skills' } })
    fireEvent.submit(url.closest('form') as HTMLFormElement)
    await screen.findByText('unsupported')
    expect(api.addSource).toHaveBeenCalledWith({ url: 'https://github.com/o/r', ref: 'main', path: 'skills' })
    set(controller, { add: { ...controller.state().add, busy: true } })
    expect(screen.getByRole('button', { name: en.addBusy })).toBeDefined()
    set(controller, { add: { ...controller.state().add, busy: false } })
    fireEvent.click(screen.getByRole('button', { name: en.editorCancel }))
    await waitFor(() => { expect(screen.queryByLabelText(en.addUrl)).toBeNull() })
  })

  it('renders every source kind and state, toggles, syncs, and removes after confirming', async () => {
    const listing = async () => ok({ sources: [
      source({ origin: 'default', ref: 'v1', path: 'skills' }),
      source({ id: 'zip', url: 'https://x.dev/pack.zip', kind: 'archive', origin: 'user', syncState: 'error', error: 'HTTP 500', enabled: false }),
      unsynced({ id: 'file', url: 'https://x.dev/a/SKILL.md', kind: 'skill-file', origin: 'user', syncState: 'syncing' }),
      unsynced({ id: 'new', url: 'github:o/new', origin: 'user', syncState: 'never' }),
    ] })
    const api = remote({
      sources: vi.fn(listing),
      checkUpdates: vi.fn(listing),
    })
    mount(api)
    fireEvent.click(tab(/^Sources/))
    await screen.findByText('HTTP 500')
    expect(screen.getByText(en.syncErrorState)).toBeDefined()
    expect(screen.getByText(en.syncing)).toBeDefined()
    expect(screen.getByText(en.neverSynced)).toBeDefined()
    expect(screen.getByText(en.kindArchive)).toBeDefined()
    expect(screen.getByText(en.kindFile)).toBeDefined()
    expect(document.body.textContent).toContain('https://github.com/anthropics/skills @v1 /skills')
    fireEvent.click(screen.getByRole('switch', { name: 'Turn on source x.dev/pack.zip'.replace('Turn on source', en.toggleSource.split(' {')[0] as string) }))
    expect(api.setSourceEnabled).toHaveBeenCalledWith({ id: 'zip', enabled: true })
    const cards = screen.getAllByRole('listitem').filter(item => item.getAttribute('data-state') !== null)
    fireEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: en.syncSource }))
    expect(api.syncSource).toHaveBeenCalledWith({ id: 'anthropic-skills' })

    const remove = within(cards[0] as HTMLElement).getByRole('button', { name: en.removeSource })
    await waitFor(() => { expect(remove.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(remove)
    await waitFor(() => { expect(document.body.textContent).toContain('This is a default source') })
    fireEvent.click(screen.getByRole('button', { name: en.editorCancel }))
    fireEvent.click(within(cards[1] as HTMLElement).getByRole('button', { name: en.removeSource }))
    fireEvent.click(await screen.findByRole('button', { name: en.removeConfirm }))
    expect(api.removeSource).toHaveBeenCalledWith({ id: 'zip' })
  })
})

describe('Discover view', () => {
  it('describes entries without a description by directory or repository', async () => {
    const api = remote({ searchMarketplace: vi.fn(async () => ok({ skills: [entry('a', { description: undefined } as never), { ...entry('b'), description: undefined, dir: undefined } as never], totals: {}, hasMore: false, nextOffset: 24, errors: [{ marketplace: 'x', message: 'y' }] })) })
    mount(api)
    expect(await screen.findByText('skills/a')).toBeDefined()
    expect(screen.getAllByText('o/r').length).toBeGreaterThan(1)
  })
})

describe('remaining states', () => {
  it('covers fallbacks for missing errors, marketplaces, and projects, and closes menus and dialogs', async () => {
    const api = remote({
      inventory: vi.fn(async () => ok(inventory({ projects: [], skills: [skill('off', 'user-dsh', { enabled: false })] }))),
      sources: vi.fn(async () => ok({ sources: [source(), source({ id: 'two', url: 'github:o/two' })] })),
      checkUpdates: vi.fn(async () => ok({ sources: [source({ updateAvailable: true }), source({ id: 'two', url: 'github:o/two', updateAvailable: true }), source({ id: 'three', url: 'github:o/three' })] })),
      searchMarketplace: vi.fn(async () => ok({ skills: [entry('stray', { marketplace: 'unlisted' })], totals: {}, hasMore: false, nextOffset: 6, errors: [] })),
      marketplaces: vi.fn(async () => ok({ marketplaces: [{ id: 'quiet', title: 'Quiet', kind: 'github', url: 'https://github.com/q/r', enabled: true, browsable: true }], available: true })),
    })
    const { controller } = mount(api)
    await screen.findByText('unlisted')
    expect(screen.getByRole('button', { name: 'Quiet' }).textContent).toBe('Quiet')
    fireEvent.click(screen.getByRole('button', { name: 'Quiet' }))
    fireEvent.click(screen.getByRole('button', { name: en.marketAll }))
    await waitFor(() => { expect(api.searchMarketplace).toHaveBeenLastCalledWith({ query: '', offset: 0 }) })
    set(controller, { discover: { ...controller.state().discover, status: 'error', error: undefined } })
    expect(screen.getByRole('alert').textContent).toBe(`${en.discoverError.replace('{error}', '')}${en.retry}`)

    fireEvent.click(tab(/^Installed/))
    await screen.findByText('2 sources have updates'.replace('2 sources have updates', en.updatesAvailableMany.replace('{count}', '2')))
    fireEvent.click(screen.getByRole('button', { name: en.filterOn }))
    expect(screen.getByText(en.emptyOn)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.scopeMenu }))
    expect(screen.getByRole('button', { name: en.scopeMenu }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => { expect(screen.getByRole('button', { name: en.scopeMenu }).getAttribute('aria-expanded')).toBe('false') })
    set(controller, { status: 'error', inventory: undefined, error: undefined })
    expect(screen.getByRole('alert').textContent).toContain(en.loadError.replace('{error}', ''))

    fireEvent.click(tab(/^Sources/))
    fireEvent.click(screen.getAllByRole('button', { name: en.removeSource })[0] as HTMLElement)
    await waitFor(() => { expect(document.body.textContent).toContain('This is a default source') })
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    await waitFor(() => { expect(document.body.textContent).not.toContain('This is a default source') })
    set(controller, { sourcesStatus: 'error', sourcesError: undefined })
    expect(screen.getAllByRole('alert').at(-1)?.textContent).toContain(en.loadError.replace('{error}', ''))
  })

  it('updates only sources with an update and ignores a superseded skill read', async () => {
    let release: (value: unknown) => void = () => {}
    const api = remote()
    const { controller } = mount(api)
    await openInstalled()
    set(controller, { sources: [source(), source({ id: 'fresh', updateAvailable: true })] })
    controller.inject().updateAll()
    await waitFor(() => { expect(api.syncSource).toHaveBeenCalledTimes(1) })
    expect(api.syncSource).toHaveBeenCalledWith({ id: 'fresh' })
    api.readSkill.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    fireEvent.click(screen.getByRole('button', { name: /\/alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: /\/beta/ }))
    release(ok({ skill: { name: 'alpha', description: 'd', body: 'Stale body', modelInvocable: true, userInvocable: true }, path: '/p', editable: true }))
    await screen.findByText('Do it.')
    expect(screen.queryByText('Stale body')).toBeNull()
  })
})
