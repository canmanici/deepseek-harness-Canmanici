/**
 * The Marketplace tab: the ranked catalog view for one query.
 *
 * Scoring is the search unit's job (pure); this module renders the ranked
 * entries with their match-strength meters and matched-tag highlights.
 */

import { MARKETPLACE_CATALOG, type CatalogItem } from './catalog.ts'
import { rankItems } from './search.ts'
import css from './IntegrationsSection.module.css'

/** The Marketplace tab's props: the ranked query and its filters. */
export interface MarketplaceTabProps {
  /** Locale-bound dictionary. */
  readonly t: (key: 'searchLabel' | 'itemsLine' | 'bestMatch') => string
  /** The live query draft. */
  readonly query: string
  /** Kind filter. */
  readonly kind: 'all' | 'mcp' | 'skill'
  /** Category filter; 'all' shows every category. */
  readonly category: string
}

/** Render the Marketplace tab.
 *  @param props - the tab's props.
 *  @returns the ranked result list, or the plain catalog order on an empty query. */
export function MarketplaceTab({ t, query, kind, category }: MarketplaceTabProps) {
  const pool = POOL.filter(item => (kind === 'all' || item.kind === kind)
    && (category === 'all' || item.category === category))
  const ranked = rankItems(pool, query)
  return (
    <div className={css.rows}>
      {ranked.map(({ item, match }) => (
        <ResultRow key={item.id} item={item} matchWeight={match.matchWeight} matchedTags={match.matchedTags} searching={query.trim() !== ''} t={t} />
      ))}
    </div>
  )
}

/** One ranked result row: name, publisher, and its match meter while searching. */
function ResultRow(props: {
  readonly item: CatalogItem
  readonly matchWeight: number
  readonly matchedTags: readonly string[]
  readonly searching: boolean
  readonly t: MarketplaceTabProps['t']
}) {
  const { item } = props
  return (
    <div className={css.rowCard}>
      <div className={css.rowHead}>
        <span className={css.kindBadge}>{item.kind === 'mcp' ? 'MCP' : 'Skill'}</span>
        <span className={css.rowName}>{item.name}</span>
        {props.searching && props.matchWeight === 100
          ? <span className={css.bestMatch}>{props.t('bestMatch')}</span>
          : null}
      </div>
      <span className={css.rowPublisher}>{item.publisher}</span>
      <p className={css.rowDescription}>{item.description}</p>
      {props.searching && props.matchWeight > 0
        ? (
          <div className={css.meter} aria-hidden='true'>
            <div className={css.meterFill} style={{ width: `${String(props.matchWeight)}%` }} />
          </div>
        )
        : null}
    </div>
  )
}

const POOL: readonly CatalogItem[] = MARKETPLACE_CATALOG
