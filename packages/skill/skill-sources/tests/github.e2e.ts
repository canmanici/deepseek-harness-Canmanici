import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SkillSources from '@deepseek-ai/dsh-skill-sources'
import { tempDir } from './fixtures.ts'

/**
 * Opt-in probe against the real GitHub API and the Anthropic public skills
 * repository shipped as the default source. Network access and GitHub's
 * anonymous rate limit make it unsuitable as a merge signal; set
 * DSH_SKILL_SOURCES_NETWORK_E2E=1 to run it.
 */
const maybe = process.env.DSH_SKILL_SOURCES_NETWORK_E2E === '1' ? describe : describe.skip

maybe('SkillSources against github.com', () => {
  it('syncs the default Anthropic skills repository and loads a skill body', async () => {
    const home = await tempDir()
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillSources, {
        dshHome: home.path,
        autoSyncOnStart: false,
        defaultSources: [{ id: 'anthropic-skills', url: 'https://github.com/anthropics/skills', enabled: true }],
      })
      const view = await ctx.skillSources.sync('anthropic-skills')
      expect(view.sync).toMatchObject({ state: 'ok', commit: expect.stringMatching(/^[0-9a-f]{40}$/) as string })
      const skills = await ctx.skills.list()
      expect(skills.length).toBeGreaterThan(0)
      expect(skills.every(skill => skill.source === 'remote:anthropic-skills')).toBe(true)
      expect((await ctx.skills.get(skills[0]!.name))?.content.length).toBeGreaterThan(0)
    } finally {
      await ctx.fiber.dispose()
      await home.cleanup()
    }
  }, 180_000)
})
