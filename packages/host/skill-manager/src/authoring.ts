/**
 * User skill files: render, read, and write `<dshHome>/skills/<name>/SKILL.md`.
 * @module
 */

import { mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { parseSkillDocument } from '@deepseek-ai/dsh-skill-filesystem'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { SkillDraft } from './types.ts'

/** Frontmatter keys the draft owns; every other key in an existing file is preserved. */
const OWNED_KEYS = ['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable'] as const

/**
 * Render a draft as `SKILL.md` text and prove it parses as a skill.
 * @param draft - author-controlled fields.
 * @param preserved - frontmatter keys from an existing file that the draft does not own.
 * @returns the complete file text.
 * @throws Error when the draft does not form a valid skill.
 */
export function renderSkillFile(draft: SkillDraft, preserved: Readonly<Record<string, unknown>> = {}): string {
  const frontmatter: Record<string, unknown> = { name: draft.name, description: draft.description.trim() }
  const whenToUse = draft.whenToUse?.trim()
  if (whenToUse !== undefined && whenToUse.length > 0) frontmatter.whenToUse = whenToUse
  if (!draft.modelInvocable) frontmatter['disable-model-invocation'] = true
  if (!draft.userInvocable) frontmatter['user-invocable'] = false
  for (const [key, value] of Object.entries(preserved)) {
    if (!(OWNED_KEYS as readonly string[]).includes(key)) frontmatter[key] = value
  }
  // lineWidth 0 keeps each frontmatter value on one line, the way people write them by hand.
  const text = `---\n${stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n\n${draft.body.trim()}\n`
  parseSkillDocument(text)
  return text
}

/**
 * Split `SKILL.md` text into its draft fields and the frontmatter keys the draft does not own.
 * @param raw - complete file text.
 * @returns the draft and preserved keys.
 * @throws Error when the file is not a valid skill.
 */
export function readSkillFile(raw: string): { draft: SkillDraft; preserved: Record<string, unknown> } {
  const document = parseSkillDocument(raw)
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  const data = parseYaml((match as RegExpExecArray)[1] as string) as Record<string, unknown>
  const preserved = Object.fromEntries(Object.entries(data).filter(([key]) => !(OWNED_KEYS as readonly string[]).includes(key)))
  return {
    draft: {
      name: document.name,
      description: document.description,
      ...document.whenToUse === undefined ? {} : { whenToUse: document.whenToUse },
      body: document.content,
      modelInvocable: document.invocation.modelInvocable,
      userInvocable: document.invocation.userInvocable,
    },
    preserved,
  }
}

/** The user skills directory and the files inside it that the page may change. */
export class UserSkillRoot {
  /** @param root - absolute `<dshHome>/skills` directory. */
  constructor(readonly root: string) {}

  /**
   * Path a new skill is written to.
   * @param name - kebab-case skill name.
   * @returns `<root>/<name>/SKILL.md`.
   */
  bundlePath(name: string): string {
    assertName(name)
    return join(this.root, name, 'SKILL.md')
  }

  /**
   * Whether a discovered skill file is one of this root's own skills.
   * @param name - skill name.
   * @param path - discovered `SKILL.md` or flat Markdown path, already canonical.
   * @returns whether the page may edit or delete it.
   */
  async owns(name: string, path: string | undefined): Promise<boolean> {
    if (path === undefined || !isSkillName(name)) return false
    const root = await canonical(this.root)
    return path === join(root, name, 'SKILL.md') || path === join(root, `${name}.md`)
  }

  /**
   * Create a skill bundle.
   * @param draft - author-controlled fields.
   * @returns the written path.
   * @throws Error when the directory or file already exists or the draft is invalid.
   */
  async create(draft: SkillDraft): Promise<string> {
    const path = this.bundlePath(draft.name)
    const text = renderSkillFile(draft)
    if (await exists(dirname(path)) || await exists(join(this.root, `${draft.name}.md`))) {
      throw new Error(`a skill named "${draft.name}" already exists in ${this.root}`)
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, text, { mode: 0o644 })
    return path
  }

  /**
   * Replace an owned skill file, keeping frontmatter keys the draft does not own.
   * @param path - owned file path.
   * @param draft - author-controlled fields; the name must match the file's.
   */
  async update(path: string, draft: SkillDraft): Promise<void> {
    const { draft: current, preserved } = readSkillFile(await readFile(path, 'utf8'))
    if (current.name !== draft.name) throw new Error(`renaming "${current.name}" to "${draft.name}" is not supported; create a new skill instead`)
    await writeFileAtomic(path, renderSkillFile(draft, preserved), { mode: 0o644 })
  }

  /**
   * Delete an owned skill: its bundle directory, or its flat Markdown file.
   * @param name - skill name.
   * @param path - owned file path.
   */
  async remove(name: string, path: string): Promise<void> {
    const bundle = join(await canonical(this.root), name)
    await rm(path.startsWith(bundle + sep) ? bundle : path, { recursive: true, force: true })
  }
}

function assertName(name: string): void {
  if (!isSkillName(name)) throw new Error(`"${name}" is not a valid skill name; use lowercase letters, digits, and hyphens`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Resolve symlinks so owned-path comparison matches the canonical paths discovery reports. */
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path
    throw error
  }
}
