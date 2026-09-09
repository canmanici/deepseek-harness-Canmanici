/**
 * Comment- and `!!js`-preserving editing of one user patch-layer file: the
 * single write path behind `pluginInventory/setEntryEnabled` and the durable
 * row check the package invariant re-runs. The file stays in the dialect
 * `@deepseek-ai/dsh-app-boot` parses (`@deepseek-ai/cordis-plugin-include`'s
 * patch list), so every committed edit re-boots and live-reloads unchanged.
 * @module @deepseek-ai/dsh-host-plugin-inventory/patch-file
 */

import { readFileSync } from 'node:fs'
import { Document, isMap, isSeq, parseDocument, type ScalarTag, type YAMLMap, type YAMLSeq } from 'yaml'

/**
 * Pass-through preservation of the patch dialect's `!!js` expression scalars:
 * the resolver keeps the raw expression text and the parsed node keeps its
 * tag, so re-stringifying a user file re-emits the exact tagged form instead
 * of resolving the expression against this process.
 */
const PRESERVED_JS_SCALAR: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (expression: string) => expression,
}

/** The `{ id, disabled }` override row every write path upserts. */
export interface EntryPatchRow {
  /** The entry's own config id, exactly as patch rows target it. */
  readonly id: string
  /** Requested effective enablement, written as `disabled: !enabled`. */
  readonly disabled: boolean
}

/**
 * Parse one patch-layer text, keeping comments and `!!js` scalars intact.
 * @param text - the file's text.
 * @returns the parsed document.
 * @throws SyntaxError when the text is not parseable YAML.
 */
export function parsePatchLayerDocument(text: string): Document {
  const doc = parseDocument(text, { customTags: [PRESERVED_JS_SCALAR] })
  if (doc.errors.length > 0) {
    throw new SyntaxError(doc.errors.map(error => error.message).join('; '))
  }
  return doc
}

/** @returns the document's top-level row list, materializing one for an empty document. */
function patchRowSeq(doc: Document): YAMLSeq {
  if (doc.contents === null) doc.contents = doc.createNode([])
  if (!isSeq(doc.contents)) {
    throw new TypeError('patch layer must be a top-level YAML array of loader patch rows')
  }
  return doc.contents
}

/**
 * Extract the document's top-level patch rows as mappings.
 * @param doc - parsed patch-layer document.
 * @returns the row mappings in file order; an empty document yields none.
 * @throws TypeError when the top level is not an array or any row is not a mapping —
 * a shape the launcher's own patch parser rejects, so failing loud here keeps
 * the file from drifting further from a bootable state.
 */
function patchRowMaps(doc: Document): readonly YAMLMap[] {
  return patchRowSeq(doc).items.map((row: unknown, index: number) => {
    if (!isMap(row)) {
      throw new TypeError(`patch layer row ${index + 1} must be a mapping (a loader patch row)`)
    }
    return row
  })
}

/**
 * Upsert the `{ id, disabled }` override row into a parsed patch-layer
 * document. When several rows share the id, the last one is updated: patch
 * lists apply later rows over earlier ones, so that row is the effective one.
 * @param doc - parsed patch-layer document (mutated in place).
 * @param row - the override row to upsert.
 * @returns whether the document changed; `false` leaves the caller nothing to write.
 */
export function upsertEntryPatchRow(doc: Document, row: EntryPatchRow): boolean {
  const rows = patchRowMaps(doc)
  for (const candidate of [...rows].reverse()) {
    if (candidate.get('id') !== row.id) continue
    if (candidate.get('disabled') === row.disabled) return false
    candidate.set('disabled', row.disabled)
    return true
  }
  patchRowSeq(doc).items.push(doc.createNode({ id: row.id, disabled: row.disabled }))
  return true
}

/**
 * Re-read the committed patch layer and check that it now carries the
 * requested override row — the durable fact every commit announces.
 * @param filename - absolute path of the patch layer file.
 * @param row - the override row the commit claims.
 * @returns `undefined` when the committed file carries the row, otherwise the mismatch description.
 */
export function patchLayerRowMismatch(filename: string, row: EntryPatchRow): string | undefined {
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error: unknown) {
    return `failed to read committed patch layer ${filename}: ${messageOf(error)}`
  }
  let rows: readonly YAMLMap[]
  try {
    rows = patchRowMaps(parsePatchLayerDocument(text))
  } catch (error: unknown) {
    return `committed patch layer ${filename} no longer parses as a patch-row list: ${messageOf(error)}`
  }
  for (const candidate of [...rows].reverse()) {
    if (candidate.get('id') !== row.id) continue
    if (candidate.get('disabled') === row.disabled) return undefined
    return `committed patch layer ${filename} keeps ${row.id} at disabled ${String(candidate.get('disabled'))} instead of ${row.disabled}`
  }
  return `committed patch layer ${filename} carries no ${row.id} row`
}

/** @returns the error's message without assuming an `Error` instance. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- the wrapped reads and parses throw Error instances */
  return error instanceof Error ? error.message : String(error)
}
