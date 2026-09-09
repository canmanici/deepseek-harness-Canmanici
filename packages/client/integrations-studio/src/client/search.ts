/**
 * Ranked search over the bundled marketplace catalog — the page's single
 * scoring unit, derived from pure inputs only.
 *
 * One query scores each item by weighted token match: name (10 prefix / 8
 * substring), tags (6 exact / 5 prefix / 3 substring), publisher (4 prefix /
 * 2 substring), category (3 prefix), description (1 substring). A token that
 * matches nothing scores the item zero AND-gates the whole query, so a
 * multi-word query narrows rather than floods.
 *
 * @module search
 */

import type { CatalogItem } from './catalog.ts'

/** Weighted match outcome for a single entry. */
export interface SearchMatch {
  /** Summed token score; 0 when the query does not match the item. */
  readonly score: number
  /** Tags that matched at least one token, in entry order. */
  readonly matchedTags: readonly string[]
  /** Normalized match strength (0..100); 0 whenever the score is zero. */
  readonly matchWeight: number
}

/** Score one token against one item.
 *  @returns the token's best weight plus any tags it matched. */
function tokenScore(item: CatalogItem, token: string): { best: number; matchedTags: string[] } {
  let best = 0
  if (item.name.toLowerCase().startsWith(token)) best = 10
  else if (item.name.toLowerCase().includes(token)) best = 8
  const matchedTags: string[] = []
  for (const tag of item.tags) {
    let tagScore = 0
    if (tag === token) tagScore = 6
    else if (tag.startsWith(token)) tagScore = 5
    else if (tag.includes(token)) tagScore = 3
    if (tagScore > 0) matchedTags.push(tag)
    if (tagScore > best) best = tagScore
  }
  if (item.category.startsWith(token) && best < 3) best = 3
  const publisher = item.publisher.toLowerCase()
  if (publisher.startsWith(token)) best = Math.max(best, 4)
  else if (publisher.includes(token)) best = Math.max(best, 2)
  if (item.description.toLowerCase().includes(token)) best = Math.max(best, 1)
  return { best, matchedTags }
}

/** Tokenize a query: lowercase, dash-instead-of-space allowed, at most 8 tokens. */
export function tokenize(query: string): readonly string[] {
  return query.toLowerCase().split(/[^a-z0-9-]+/).filter(token => token !== '').slice(0, 8)
}

/**
 * Rank the catalog against one tokenized query, sorted by score then name.
 * @returns matches in item order; non-matching items are omitted.
 */
export function rankItems(items: readonly CatalogItem[], query: string): readonly { item: CatalogItem; match: SearchMatch }[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return items.map(item => ({ item, match: { score: 0, matchedTags: [], matchWeight: 0 } }))
  }
  const scored: { item: CatalogItem; score: number; matchedTags: string[] }[] = []
  for (const item of items) {
    let score = 0
    const matchedTags: string[] = []
    const seen = new Set<string>()
    let matched = true
    for (const token of tokens) {
      const { best, matchedTags: tags } = tokenScore(item, token)
      if (best === 0) {
        matched = false
        break
      }
      score += best
      for (const tag of tags) {
        if (!seen.has(tag)) {
          seen.add(tag)
          matchedTags.push(tag)
        }
      }
    }
    if (matched) {
      scored.push({ item, score, matchedTags })
    }
  }
  scored.sort((left, right) => right.score - left.score
    || (left.item.name < right.item.name ? -1 : 1))
  const maxScore = scored[0]?.score ?? 0
  return scored.map(({ item, score, matchedTags }) => ({
    item,
    match: {
      score,
      matchedTags,
      matchWeight: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
    },
  }))
}
