import { describe, expect, it } from 'vitest'
import { normalizeSubpath, resolveSourceSpec, suggestSourceId } from '../src/index.ts'

describe('resolveSourceSpec', () => {
  it.each([
    [{ url: 'https://github.com/anthropics/skills' }, { kind: 'github', owner: 'anthropics', repo: 'skills' }],
    [{ url: 'https://github.com/anthropics/skills.git' }, { kind: 'github', owner: 'anthropics', repo: 'skills' }],
    [{ url: 'github:anthropics/skills/document-skills' }, { kind: 'github', owner: 'anthropics', repo: 'skills', path: 'document-skills' }],
    [{ url: 'https://github.com/o/r/tree/main/skills/pdf' }, { kind: 'github', owner: 'o', repo: 'r', ref: 'main', path: 'skills/pdf' }],
    [{ url: 'https://github.com/o/r/tree/main', ref: 'v2', path: 'x/' }, { kind: 'github', owner: 'o', repo: 'r', ref: 'v2', path: 'x' }],
    [{ url: 'https://github.com/o/r/blob/main/skills/a/SKILL.md' }, { kind: 'skill-file', url: 'https://raw.githubusercontent.com/o/r/main/skills/a/SKILL.md' }],
    [{ url: 'https://example.com/pack.ZIP', path: 'skills' }, { kind: 'archive', url: 'https://example.com/pack.ZIP', path: 'skills' }],
    [{ url: ' https://example.com/a/SKILL.md ' }, { kind: 'skill-file', url: 'https://example.com/a/SKILL.md' }],
  ])('resolves %j', (location, expected) => {
    expect(resolveSourceSpec(location)).toEqual(expected)
  })

  it.each([
    [{ url: 'not a url' }, 'is not a URL'],
    [{ url: 'https://user:pw@example.com/a.zip' }, 'must not contain credentials'],
    [{ url: 'https://github.com/o/r/issues/1' }, 'unsupported GitHub URL'],
    [{ url: 'https://github.com/o' }, 'need an owner and a repository'],
    [{ url: 'github:o/r', ref: 'a..b' }, 'invalid git ref'],
    [{ url: 'github:o/r', ref: '' }, 'invalid git ref'],
    [{ url: 'https://example.com/page' }, 'unsupported source URL'],
    [{ url: 'github:o/r', path: '../x' }, 'must not contain ".."'],
  ])('rejects %j', (location, message) => {
    expect(() => resolveSourceSpec(location)).toThrow(message)
  })
})

describe('suggestSourceId', () => {
  it('derives lowercase hyphenated ids', () => {
    expect(suggestSourceId({ kind: 'github', owner: 'Anthropics', repo: 'skills' })).toBe('anthropics-skills')
    expect(suggestSourceId({ kind: 'github', owner: 'o', repo: 'r', path: 'a/b' })).toBe('o-r-a-b')
    expect(suggestSourceId({ kind: 'archive', url: 'https://example.com/packs/My_Pack.zip' })).toBe('example-com-packs-my-pack')
    expect(suggestSourceId({ kind: 'skill-file', url: 'https://x.io/' + 'a'.repeat(80) + '.md' })).toHaveLength(64)
    expect(suggestSourceId({ kind: 'archive', url: 'https://___/' })).toBe('source')
  })
})

describe('normalizeSubpath', () => {
  it('drops empty and dot segments', () => {
    expect(normalizeSubpath(undefined)).toBeUndefined()
    expect(normalizeSubpath('./')).toBeUndefined()
    expect(normalizeSubpath('\\a//./b/')).toBe('a/b')
  })
})
