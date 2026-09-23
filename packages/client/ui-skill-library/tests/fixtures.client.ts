import type { ManagedSource, MarketplaceEntry, SkillManagerInventory } from '@deepseek-ai/dsh-api-remotes/client'

/** A two-skill inventory with one project scope. */
export function inventory(overrides: Partial<SkillManagerInventory> = {}): SkillManagerInventory {
  return {
    skills: [
      { name: 'alpha', description: 'Alpha', source: 'user-dsh', provider: 'filesystem', modelInvocable: true, userInvocable: true, enabled: true, preference: 'default', editable: true, deletable: true, customizable: false, uninstallable: false },
      { name: 'beta', description: 'Beta', source: 'remote:anthropic-skills', provider: 'skill-sources', modelInvocable: true, userInvocable: true, enabled: false, preference: 'global', editable: false, deletable: false, customizable: true, uninstallable: true },
    ],
    complete: true,
    projects: [{ root: '/work/app', title: 'App' }],
    preferencesAvailable: true,
    sourcesAvailable: true,
    ...overrides,
  }
}

/** The default Anthropic source, synced. */
export function source(overrides: Partial<ManagedSource> = {}): ManagedSource {
  return {
    id: 'anthropic-skills',
    url: 'https://github.com/anthropics/skills',
    enabled: true,
    origin: 'default',
    kind: 'github',
    syncState: 'ok',
    commit: 'a'.repeat(40),
    syncedAt: '2026-09-23T00:00:00.000Z',
    skillCount: 20,
    availableCount: 20,
    updateAvailable: false,
    ...overrides,
  }
}

/** A source that has never produced a generation: no commit and no sync time. */
export function unsynced(overrides: Partial<ManagedSource> = {}): ManagedSource {
  const { commit: _commit, syncedAt: _syncedAt, ...rest } = source(overrides)
  return rest
}

/** One available marketplace entry from `o/r`. */
export function entry(name: string, overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    marketplace: 'anthropic',
    key: `o/r/${name}`,
    name,
    description: `${name} skill`,
    repository: 'o/r',
    dir: `skills/${name}`,
    url: `https://github.com/o/r/tree/HEAD/skills/${name}`,
    state: 'available',
    ...overrides,
  }
}
