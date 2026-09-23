/**
 * Archive extraction and sync-time skill discovery.
 * @module
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { parseSkillDocument, type SkillDocument } from '@deepseek-ai/dsh-skill-filesystem'

/** Bounds applied while extracting one archive. */
export interface ExtractLimits {
  /** Largest total uncompressed size in bytes. */
  readonly maxExtractedBytes: number
  /** Largest number of extracted files. */
  readonly maxFiles: number
}

/**
 * Extract the files of a ZIP archive that lie below `subpath`, relative to it.
 * A single top-level directory shared by every entry, as in GitHub zipballs,
 * is stripped first.
 * @param zip - archive bytes.
 * @param destination - empty directory receiving the files.
 * @param subpath - slash-separated subdirectory to keep; omitted keeps everything.
 * @param limits - extraction bounds.
 * @returns the number of files written.
 * @throws Error on unsafe entry names, exceeded bounds, or a missing subdirectory.
 */
export async function extractZip(
  zip: Uint8Array,
  destination: string,
  subpath: string | undefined,
  limits: ExtractLimits,
): Promise<number> {
  let declaredBytes = 0
  let declaredFiles = 0
  const entries = unzipSync(zip, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false
      declaredFiles += 1
      declaredBytes += file.originalSize
      if (declaredFiles > limits.maxFiles) throw new Error(`archive has more than ${limits.maxFiles} files`)
      if (declaredBytes > limits.maxExtractedBytes) throw new Error(`archive expands beyond ${limits.maxExtractedBytes} bytes`)
      return true
    },
  })
  const names = Object.keys(entries).map(name => ({ name, segments: safeSegments(name) }))
  const first = names[0]?.segments[0]
  const stripTop = first !== undefined && names.every(entry => entry.segments.length > 1 && entry.segments[0] === first)
  const prefix = subpath?.split('/') ?? []
  let written = 0
  for (const { name, segments } of names) {
    const relative = stripTop ? segments.slice(1) : segments
    if (!prefix.every((segment, index) => relative[index] === segment) || relative.length <= prefix.length) continue
    const target = join(destination, ...relative.slice(prefix.length))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, entries[name] as Uint8Array, { flag: 'wx', mode: 0o644 })
    written += 1
  }
  if (written === 0 && subpath !== undefined) throw new Error(`archive has no files below "${subpath}"`)
  return written
}

/** Reject absolute, parent-relative, or otherwise unsafe entry names. */
function safeSegments(name: string): string[] {
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`archive entry "${name}" has an unsafe path`)
  }
  const segments = name.split('/').filter(segment => segment.length > 0 && segment !== '.')
  if (segments.includes('..')) throw new Error(`archive entry "${name}" has an unsafe path`)
  return segments
}

/** One skill found in a synced tree. */
export interface DiscoveredSkill extends Omit<SkillDocument, 'content'> {
  /** Skill directory relative to the tree root, slash-separated; empty for the root itself. */
  readonly dir: string
}

/** Discovery bounds and diagnostics. */
export interface DiscoverOptions {
  /** Deepest directory level searched below the root. */
  readonly maxDepth: number
  /** Largest `SKILL.md` accepted in bytes. */
  readonly maxSkillBytes: number
  /** Receives one message per skipped `SKILL.md`. */
  readonly warn: (message: string) => void
}

/**
 * Find skill directories: every directory up to `maxDepth` levels deep that
 * holds a valid `SKILL.md`. Discovery does not descend into a skill directory,
 * and the first directory in sorted path order wins a duplicate name.
 * @param root - tree root.
 * @param options - discovery bounds and diagnostics.
 * @returns discovered skills sorted by directory.
 */
export async function discoverSkills(root: string, options: DiscoverOptions): Promise<DiscoveredSkill[]> {
  const found: DiscoveredSkill[] = []
  const names = new Set<string>()
  const visit = async (relative: string[]): Promise<void> => {
    const directory = join(root, ...relative)
    const entries = new Map((await readdir(directory, { withFileTypes: true })).map(entry => [entry.name, entry]))
    const dir = relative.join('/')
    if (entries.get('SKILL.md')?.isFile() === true) {
      const skill = await readSkill(join(directory, 'SKILL.md'), dir, options)
      if (skill === undefined) return
      if (names.has(skill.name)) {
        options.warn(`skill "${skill.name}" in ${dir} ignored: an earlier directory already provides it`)
        return
      }
      names.add(skill.name)
      found.push(skill)
      return
    }
    if (relative.length >= options.maxDepth) return
    for (const name of [...entries.keys()].sort()) {
      if (entries.get(name)?.isDirectory() === true && !name.startsWith('.')) await visit([...relative, name])
    }
  }
  await visit([])
  return found
}

async function readSkill(file: string, dir: string, options: DiscoverOptions): Promise<DiscoveredSkill | undefined> {
  const bytes = await readFile(file)
  if (bytes.byteLength > options.maxSkillBytes) {
    options.warn(`${label(dir)}/SKILL.md ignored: larger than ${options.maxSkillBytes} bytes`)
    return undefined
  }
  try {
    const { content: _content, ...summary } = parseSkillDocument(bytes.toString('utf8'))
    return { ...summary, dir }
  } catch (error) {
    options.warn(`${label(dir)}/SKILL.md ignored: ${(error as Error).message}`)
    return undefined
  }
}

function label(dir: string): string {
  return dir === '' ? '.' : dir
}
