import { describe, expect, it } from 'vitest'
import { compact, detectKind, entryState, groupSkills, originOf, relativeTime, sourceLabel } from '../src/client/helpers.ts'
import { entry, inventory } from './fixtures.client.ts'

describe('skill library helpers', () => {
  it('classifies origins and groups skills in origin order', () => {
    expect(['remote:x', 'project-agents', 'user-agents', 'custom', 'bundled'].map(originOf)).toEqual(['remote', 'project', 'user', 'user', 'builtin'])
    const skills = inventory().skills
    const extra = [{ ...skills[1], name: 'gamma', source: 'remote:a' }, { ...skills[1], name: 'zeta', source: 'remote:z' }, { ...skills[0], name: 'delta', source: 'bundled' }, { ...skills[0], name: 'eps', source: 'user-agents' }] as typeof skills
    expect(groupSkills([...skills, ...extra]).map(group => [group.key, group.sourceId, group.skills.length])).toEqual([
      ['user', undefined, 2], ['remote:a', 'a', 1], ['remote:anthropic-skills', 'anthropic-skills', 1], ['remote:z', 'z', 1], ['builtin', undefined, 1],
    ])
  })

  it('labels sources by repository, folder, host, or id', () => {
    const label = (url: string, path?: string): string => sourceLabel({ url, id: 'fallback', ...path === undefined ? {} : { path } })
    expect(label('github:o/r')).toBe('o/r')
    expect(label('github:o/r', 'skills/pdf')).toBe('o/r/pdf')
    expect(label('https://github.com/o/r.git')).toBe('o/r')
    expect(label('https://github.com/o/r/tree/main/skills/pdf')).toBe('o/r/pdf')
    expect(label('https://github.com/o/r/blob/main/skills/pdf/SKILL.md')).toBe('o/r/pdf')
    expect(label('https://github.com/o/r/pulls')).toBe('o/r')
    expect(label('https://github.com/o/r', 'a/b')).toBe('o/r/b')
    expect(label('https://x.dev/packs/a.zip')).toBe('x.dev/a.zip')
    expect(label('https://x.dev/')).toBe('x.dev')
    expect(label('not a url')).toBe('fallback')
  })

  it('detects the kind of a pasted link', () => {
    expect(['', 'github:o/r', 'https://github.com/o/r', 'https://github.com/o/r/blob/main/a/SKILL.md', 'https://x.dev/a.zip?x=1', 'https://x.dev/a.md', 'https://x.dev/a', 'ftp://x.zip'].map(detectKind))
      .toEqual([undefined, 'github', 'github', 'skill-file', 'archive', 'skill-file', undefined, undefined])
  })

  it('formats relative times and compact counts', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    expect(relativeTime('2026-09-23T11:59:30.000Z', now)).toMatch(/30 seconds ago/)
    expect(relativeTime('2026-09-23T09:00:00.000Z', now)).toMatch(/3 hours ago/)
    expect(relativeTime('2024-09-23T12:00:00.000Z', now)).toMatch(/2 years ago/)
    expect(compact(1234)).toMatch(/1\.2K/)
  })

  it('derives the displayed install state from the inventory', () => {
    const skills = inventory().skills
    expect(entryState(entry('beta', { state: 'installing' }), undefined)).toBe('installing')
    expect(entryState(entry('beta', { state: 'installing' }), skills)).toBe('installed')
    expect(entryState(entry('new', { state: 'installing' }), skills)).toBe('installing')
    expect(entryState(entry('gone', { state: 'installed' }), skills)).toBe('available')
    expect(entryState(entry('beta', { state: 'installed' }), skills)).toBe('installed')
    expect(entryState(entry('alpha'), skills)).toBe('available')
  })
})
