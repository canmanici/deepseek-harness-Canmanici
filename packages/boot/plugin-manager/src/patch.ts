/** Comment-preserving profile plugin enablement edits. */
import { readFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, type Document, type YAMLSeq } from 'yaml'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Replace the last matching override or append one after existing insertions.
 * @param filename Current profile patch file.
 * @param id Unique composition entry id.
 * @param name Module name used to match name-qualified overrides.
 * @param enabled Desired entry enablement.
 * @returns Whether the file changed.
 */
export async function writePluginEnabled(filename: string, id: string, name: string, enabled: boolean): Promise<boolean> {
  const document = await readPatch(filename)
  const items = document.contents.items
  const target = items.findLast((item, index) => {
    if (!isMap(item) || document.getIn([index, 'id']) !== id || item.has('insert')) return false
    const expectedName = document.getIn([index, 'name'])
    return !expectedName || expectedName === name
  })
  if (isMap(target)) {
    if (document.getIn([items.indexOf(target), 'disabled']) === !enabled) return false
    document.setIn([items.indexOf(target), 'disabled'], !enabled)
  } else {
    document.add({ id, disabled: !enabled })
  }
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
  return true
}

/** Insert one plugin entry that no row of the profile patch names yet.
 * @param filename Current profile patch file.
 * @param entry New entry: unique id, module name, and config.
 * @throws Error when any row or inserted entry of the patch already uses the id.
 */
export async function appendPluginEntry(
  filename: string,
  entry: { id: string; name: string; config: Record<string, unknown> },
): Promise<void> {
  const document = await readPatch(filename)
  const items = document.contents.items
  const taken = items.some((item, index) => document.getIn([index, 'id']) === entry.id
    || (isMap(item) && isSeq(item.get('insert')) && (item.get('insert') as YAMLSeq).items.some(inserted => isMap(inserted) && inserted.get('id') === entry.id)))
  if (taken) throw new Error(`a plugin entry with id "${entry.id}" already exists`)
  document.add(document.createNode({ insert: [{ id: entry.id, name: entry.name, config: entry.config }] }))
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
}

/** Remove an entry the profile patch inserts, together with every override row of it.
 * @param filename Current profile patch file.
 * @param id Composition entry id.
 * @param name Module name the inserted entry must carry.
 * @returns Whether the patch inserted the entry; entries from other layers are left alone.
 */
export async function removePluginEntry(filename: string, id: string, name: string): Promise<boolean> {
  const document = await readPatch(filename)
  const items = document.contents.items
  let removed = false
  for (let index = items.length - 1; index >= 0; index--) {
    const inserted = document.getIn([index, 'insert'], true)
    if (!isSeq(inserted)) continue
    const before = inserted.items.length
    inserted.items = inserted.items.filter(entry => !(isMap(entry) && entry.get('id') === id && entry.get('name') === name))
    if (inserted.items.length === before) continue
    removed = true
    if (inserted.items.length === 0) document.delete(index)
  }
  if (!removed) return false
  for (let index = items.length - 1; index >= 0; index--) {
    if (document.getIn([index, 'id']) === id) document.delete(index)
  }
  await writeFileAtomic(filename, String(document), { mode: 0o600 })
  return true
}

async function readPatch(filename: string): Promise<Document.Parsed & { contents: YAMLSeq }> {
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '[]\n'
  }
  const document = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) throw error
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  loadOptionalPatches('dsh', filename)
  return document as Document.Parsed & { contents: YAMLSeq }
}
