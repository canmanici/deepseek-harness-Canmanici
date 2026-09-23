import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SearchMarketplaceValue } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsController, type RemoteResult, type SkillManagerRemote, type SkillsState } from '../src/client/controller.ts'
// Type-only: the skillLibrary locale namespace merge the page props read.
import type {} from '../src/client/index.ts'
import { SkillLibraryPage, type SkillLibraryPageProps } from '../src/client/SkillLibraryPage.tsx'
import { en, type SkillLibraryLocaleKey } from '../src/client/locales.ts'
import { entry, inventory, source } from './fixtures.client.ts'


export const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value })
export const fail = (message: string): RemoteResult<never> => ({ ok: false, error: { code: 'skill-manager/invalid-request', message } })

export const t = ((key: SkillLibraryLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as SkillLibraryPageProps['t']

export type MockRemote = { [K in keyof SkillManagerRemote]: ReturnType<typeof vi.fn> & SkillManagerRemote[K] }

export function page(skills = [entry('pdf'), entry('beta', { state: 'installed', installs: 1200, stars: 3 })], patch: Partial<SearchMarketplaceValue> = {}): SearchMarketplaceValue {
  return { skills, totals: { anthropic: 2 }, hasMore: false, nextOffset: 24, errors: [], ...patch }
}

export function remote(overrides: Partial<Record<keyof SkillManagerRemote, unknown>> = {}): MockRemote {
  return {
    inventory: vi.fn(async () => ok(inventory())),
    setEnabled: vi.fn(async () => ok(undefined)),
    clearOverride: vi.fn(async () => ok(undefined)),
    sources: vi.fn(async () => ok({ sources: [source()] })),
    addSource: vi.fn(async () => ok({ source: source({ id: 'extra' }) })),
    syncSource: vi.fn(async () => ok({ source: source() })),
    setSourceEnabled: vi.fn(async () => ok({ source: source() })),
    removeSource: vi.fn(async () => ok(undefined)),
    readSkill: vi.fn(async ({ name }: { name: string }) => ok({ skill: { name, description: 'Stored', body: '# Steps\n\nDo it.', modelInvocable: true, userInvocable: true }, path: `/h/skills/${name}/SKILL.md`, editable: true })),
    createSkill: vi.fn(async (skill: unknown) => ok({ skill, path: '/p', editable: true })),
    updateSkill: vi.fn(async (skill: unknown) => ok({ skill, path: '/p', editable: true })),
    deleteSkill: vi.fn(async () => ok(undefined)),
    customizeSkill: vi.fn(async ({ name }: { name: string }) => ok({ skill: { name, description: 'Copy', body: 'Copied', modelInvocable: true, userInvocable: true }, path: '/p', editable: true })),
    uninstallSkill: vi.fn(async () => ok(undefined)),
    marketplaces: vi.fn(async () => ok({
      marketplaces: [
        { id: 'anthropic', title: 'Anthropic Skills', kind: 'github', url: 'https://github.com/anthropics/skills', enabled: true, browsable: true, available: 20 },
        { id: 'cpd', title: 'claude-plugins.dev', kind: 'claude-plugins-dev', url: 'https://claude-plugins.dev', enabled: true, browsable: true, available: 47085 },
        { id: 'smp', title: 'SkillsMP', kind: 'skillsmp', url: 'https://skillsmp.com', enabled: true, browsable: false },
        { id: 'down', title: 'Down', kind: 'github', url: 'https://github.com/x/y', enabled: true, browsable: true, error: 'HTTP 404' },
        { id: 'off', title: 'Off', kind: 'skills-sh', url: 'https://skills.sh', enabled: false, browsable: false },
      ],
      available: true,
    })),
    searchMarketplace: vi.fn(async () => ok(page())),
    installSkill: vi.fn(async () => ok({ source: source() })),
    checkUpdates: vi.fn(async () => ok({ sources: [source()] })),
    ...overrides,
  } as MockRemote
}

export function mount(api: MockRemote = remote()): { controller: SkillsController; api: MockRemote } {
  const controller = new SkillsController(api)
  const { hooks, ...face } = controller.inject()
  const unused = (): never => { throw new Error('The skills page reads no global state') }
  const props = {
    usePanelInfo: unused, useWorkspaces: unused, useSessions: unused,
    useSessionStatus: unused, useSessionRetainInfo: unused, useResource: unused,
    t,
    ...face,
    useSkills: bindSnapshotSelector(hooks.skills),
  } as SkillLibraryPageProps
  render(<SkillLibraryPage {...props} />)
  return { controller, api }
}

export function tab(name: RegExp): HTMLElement {
  return screen.getByRole('tab', { name })
}

export async function openInstalled(): Promise<void> {
  fireEvent.click(tab(/^Installed/))
  await screen.findByRole('button', { name: /\/alpha/ })
}

export function set(controller: SkillsController, patch: Partial<SkillsState>): void {
  act(() => { controller.store.set({ ...controller.state(), ...patch }) })
}
