import { describe, expect, it } from 'vitest'
import { parseClaudePluginsDev, parseSkillsMp, parseSkillsSh, parseSkillTree } from '../src/catalogs.ts'

describe('catalog parsers', () => {
  it('maps skills.sh entries to repositories and drops entries without an owner/repo source', () => {
    const page = parseSkillsSh('ssh', 'https://skills.sh', {
      skills: [
        { id: 'anthropics/skills/pdf', skillId: 'pdf', name: 'pdf', installs: 12.7, source: 'anthropics/skills' },
        { id: 'x/y/z', name: 'fallback-name', source: 'x/y' },
        { id: 'bad', skillId: 'bad', source: 'not a repo' },
        { skillId: 'no-id', source: 'a/b' },
        'junk',
      ],
    })
    expect(page).toEqual({
      skills: [
        { marketplace: 'ssh', key: 'anthropics/skills/pdf', name: 'pdf', repository: 'anthropics/skills', url: 'https://skills.sh/anthropics/skills/pdf', installs: 12 },
        { marketplace: 'ssh', key: 'x/y/fallback-name', name: 'fallback-name', repository: 'x/y', url: 'https://skills.sh/x/y/z' },
      ],
    })
    expect(parseSkillsSh('ssh', 'https://skills.sh/', null)).toEqual({ skills: [] })
    expect(parseSkillsSh('ssh', 'https://skills.sh/', { skills: [{ id: 'a/b/c', skillId: 'c', source: 'a/b' }] }).skills[0]?.url).toBe('https://skills.sh/a/b/c')
  })

  it('maps claude-plugins.dev entries through their GitHub tree URLs and keeps the total', () => {
    const page = parseClaudePluginsDev('cpd', {
      total: 510,
      skills: [
        { name: 'pdf', description: 'PDFs', sourceUrl: 'https://github.com/anthropics/skills/tree/main/skills/pdf', stars: 5, installs: -1 },
        { name: 'root', sourceUrl: 'https://github.com/o/r' },
        { name: 'elsewhere', sourceUrl: 'https://example.com/x.md' },
        { name: 'broken', sourceUrl: 'not a url' },
        { sourceUrl: 'https://github.com/o/r' },
      ],
    })
    expect(page.total).toBe(510)
    expect(page.skills).toEqual([
      { marketplace: 'cpd', key: 'anthropics/skills/pdf', name: 'pdf', description: 'PDFs', repository: 'anthropics/skills', dir: 'skills/pdf', url: 'https://github.com/anthropics/skills/tree/main/skills/pdf', stars: 5 },
      { marketplace: 'cpd', key: 'o/r/root', name: 'root', repository: 'o/r', url: 'https://github.com/o/r' },
    ])
    expect(parseClaudePluginsDev('cpd', { skills: [] })).toEqual({ skills: [] })
  })

  it('maps SkillsMP entries and reads the pagination total', () => {
    const page = parseSkillsMp('smp', {
      data: {
        skills: [
          { name: 'nano-pdf', description: 'Edit', githubUrl: 'https://github.com/o/r/tree/main/skills/nano-pdf', skillUrl: 'https://skillsmp.com/x', stars: 3 },
          { name: 'plain', githubUrl: 'https://github.com/o/r/tree/main/skills/plain' },
          { name: 'no-url' },
        ],
        pagination: { total: 42 },
      },
    })
    expect(page.total).toBe(42)
    expect(page.skills.map(skill => [skill.key, skill.url])).toEqual([
      ['o/r/nano-pdf', 'https://skillsmp.com/x'],
      ['o/r/plain', 'https://github.com/o/r/tree/main/skills/plain'],
    ])
  })

  it('finds SKILL.md directories within a subdirectory and depth', () => {
    const tree = {
      tree: [
        { path: 'SKILL.md', type: 'blob' },
        { path: 'skills/a/SKILL.md', type: 'blob' },
        { path: 'skills/a/b/c/d/SKILL.md', type: 'blob' },
        { path: 'skills/tree/SKILL.md', type: 'tree' },
        { path: 'skills/a/README.md', type: 'blob' },
        { path: 'other/x/SKILL.md', type: 'blob' },
      ],
    }
    expect(parseSkillTree(tree, undefined, 6)).toEqual(['', 'skills/a', 'skills/a/b/c/d', 'other/x'])
    expect(parseSkillTree(tree, 'skills', 2)).toEqual(['skills/a'])
    expect(parseSkillTree({}, undefined, 6)).toEqual([])
  })
})
