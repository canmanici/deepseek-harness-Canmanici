#!/usr/bin/env tsx
/**
 * File-size cap gate — mechanical enforcement of quality-gates.md § Code Organization Law.
 * Target ≤120 lines, hard cap 250 lines per file. Generated catalogs are exempt (derived, never hand-edited).
 * Lists violations instead of silently passing.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const CAP = 250
const TARGET = 120
const EXEMPT = new Set([
  // Generated / emitted — derived files regenerate, never hand-edit (security.md ownership rule).
  'packages/extensions/tool-cordis/src/api-catalog.ts',
  'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
  'packages/extensions/cordis-client-runner/src/client/api-catalog.ts',
  'packages/typert/generator/src/analyzer.ts',
])

/** Grandfathered violations — do not add new files here. Shrink this list by splitting files. */
const ALLOWLIST_PATH = join(ROOT, 'scripts/file-cap-allowlist.json')
let ALLOWLIST: Set<string> | undefined
try {
  const raw = await readFile(ALLOWLIST_PATH, 'utf8')
  ALLOWLIST = new Set(JSON.parse(raw) as string[])
} catch {
  ALLOWLIST = undefined
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git' || entry.name === 'dist') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx')) && !full.includes('/tests/')) out.push(full)
  }
}

const files: string[] = []
for (const root of [join(ROOT, 'packages'), join(ROOT, 'apps'), join(ROOT, 'scripts')]) {
  try { await stat(root); await walk(root, files) } catch {}
}

type Violation = { file: string; lines: number }
const violations: Violation[] = []
const warnings: Violation[] = []

for (const file of files) {
  const rel = relative(ROOT, file)
  if (EXEMPT.has(rel) || rel.includes('.generated.') || rel.endsWith('.g.ts')) continue
  if (ALLOWLIST?.has(rel)) continue
  const text = await readFile(file, 'utf8')
  const lines = text.split('\n').length
  if (lines > CAP) violations.push({ file: rel, lines })
  else if (lines > TARGET) warnings.push({ file: rel, lines })
}

if (violations.length > 0) {
  console.error(`\nverify-file-cap: ${violations.length} NEW file(s) exceed hard cap ${CAP} lines (target ${TARGET}):\n`)
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${String(v.lines).padStart(5)}  ${v.file}`)
  }
  console.error(`\nExempt (derived): ${[...EXEMPT].join(', ')}; allowlisted (grandfathered): ${ALLOWLIST?.size ?? 0} — do not extend.`)
  console.error('Fix: split by cohesion (one primary export per file, ≤120 target) per quality-gates.md.\n')
  process.exit(1)
}

if (warnings.length > 0) {
  console.log(`verify-file-cap: OK (cap ${CAP}), ${warnings.length} file(s) over target ${TARGET} — consider splitting next touch:`)
  for (const w of warnings.sort((a, b) => b.lines - a.lines).slice(0, 10)) console.log(`  ${String(w.lines).padStart(5)}  ${w.file}`)
}

console.log(`verify-file-cap: PASS — ${files.length} files checked, 0 over cap ${CAP} (exempt ${EXEMPT.size} derived).`)
