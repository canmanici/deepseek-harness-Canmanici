/**
 * The Marketplace tab: a command-search browser over the bundled catalog.
 *
 * Scoring is the search unit's job (pure); this module renders the command
 * bar, the kind/category filter rail, and the ranked card grid with
 * install actions, empty states, and integrated-source cards.
 */

import { useId } from 'react'
import clsx from 'clsx'
import { MARKETPLACE_CATALOG, MARKETPLACE_SOURCES, type CatalogItem } from './catalog.ts'
import { rankItems } from './search.ts'
import type { CatalogKind, DeployedSkillEntry } from './studio-store.ts'
import css from './IntegrationsSection.module.css'

/** The Marketplace tab's props: state and mutation API from the section. */
export interface MarketplaceTabProps {
  /** Locale-bound dictionary; model/wire data stays verbatim. */
  readonly t: (key: MarketplaceKey) => string
  /** The live query draft. */
  readonly query: string
  /** Kind filter. */
  readonly kind: CatalogKind
  /** Category filter; 'all' shows every category. */
  readonly category: string
  /** The viewing-state mutation API, from the section's inject face. */
  readonly actions: {
    setQuery(query: string): void
    setKind(kind: CatalogKind): void
    setCategory(category: string): void
    /** One-click install: append the entry to the persisted document. */
    installSkill(entry: DeployedSkillEntry): Promise<void>
  }
}

/** Copy keys the tab renders. */
export type MarketplaceKey =
  | 'searchLabel' | 'searchPlaceholder' | 'searchHint' | 'clear' | 'resultsLine' | 'itemsLine'
  | 'kindAll' | 'kindMcp' | 'kindSkill' | 'catAll' | 'bestMatch' | 'install'
  | 'added' | 'addedHint' | 'emptyTitle' | 'emptyBody' | 'emptyClear' | 'loading' | 'docs'
  | 'sourcesTitle'

/** Kind segments; 'all' is the resident default. */
const KIND_ORDER: readonly { id: CatalogKind; key: 'kindAll' | 'kindMcp' | 'kindSkill' }[] = [
  { id: 'all', key: 'kindAll' },
  { id: 'mcp', key: 'kindMcp' },
  { id: 'skill', key: 'kindSkill' },
]

/** Render the Marketplace tab.
 *  @param props - the tab's props.
 *  @returns the command bar, filter rail, and ranked grid. */
export function MarketplaceTab({ t, query, kind, category, actions }: MarketplaceTabProps) {
  const searchId = useId()
  const searching = query.trim() !== ''
  const pool = MARKETPLACE_CATALOG.filter(item => (kind === 'all' || item.kind === kind)
    && (category === 'all' || item.category === category))
  const ranked = rankItems(pool, query)
  const categories = Array.from(new Set(MARKETPLACE_CATALOG.map(item => item.category))).sort()

  const installItem = (item: CatalogItem): void => {
    void actions.installSkill({
      name: item.name,
      description: item.description,
      whenToUse: item.whenToUse ?? '',
      instructions: item.content ?? '',
      deployedAt: new Date().toISOString(),
    })
  }

  return (
    <div className={css.panel}>
      <div className={css.search}>
        <span className={css.searchGlyph} aria-hidden='true'>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
            <circle cx='10.5' cy='10.5' r='6.5' />
            <line x1='15.5' y1='15.5' x2='20' y2='20' />
          </svg>
        </span>
        <input
          id={searchId}
          type='search'
          className={css.searchInput}
          value={query}
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => { actions.setQuery(event.target.value) }}
        />
        {searching
          ? <button type='button' className={clsx(css.catBtn, css.catBtnActive)} onClick={() => { actions.setQuery('') }}>{t('clear')}</button>
          : <span className={css.searchHint} aria-hidden='true'>{t('searchHint')}</span>}
      </div>
      <div className={css.filters} role='group' aria-label={t('searchLabel')}>
        <div className={css.seg}>
          {KIND_ORDER.map(segment => (
            <button
              key={segment.id}
              type='button'
              className={clsx(css.segBtn, kind === segment.id && css.segBtnActive)}
              aria-pressed={kind === segment.id}
              onClick={() => { actions.setKind(segment.id) }}
            >
              {t(segment.key)}
            </button>
          ))}
        </div>
        {['all', ...categories].map(cat => (
          <button
            key={cat}
            type='button'
            className={clsx(css.catBtn, category === cat && css.catBtnActive)}
            aria-pressed={category === cat}
            onClick={() => { actions.setCategory(cat) }}
          >
            {cat === 'all' ? t('catAll') : cat}
          </button>
        ))}
      </div>
      <div className={css.meta} role='status'>
        {searching ? t('resultsLine').replace('{query}', query.trim()).replace('{count}', String(ranked.length)) : t('itemsLine').replace('{count}', String(ranked.length))}
      </div>
      {ranked.length === 0
        ? (
          <div className={css.emptyState}>
            <p className={css.emptyTitle}>{t('emptyTitle').replace('{query}', query.trim())}</p>
            <p className={css.emptyBody}>{t('emptyBody')}</p>
            <button type='button' className={css.catBtn} onClick={() => { actions.setQuery(''); actions.setCategory('all') }}>
              {t('emptyClear')}
            </button>
          </div>
        )
        : (
          <div className={css.grid}>
            {ranked.map(({ item, match }) => (
              <ResultCard
                key={item.id}
                item={item}
                matchWeight={match.matchWeight}
                matchedTags={match.matchedTags}
                searching={searching}
                t={t}
                onInstall={installItem}
              />
            ))}
          </div>
        )}
      <div className={css.rows} aria-label={t('sourcesTitle')}>
        <h3 className={css.groupLabel}>{t('sourcesTitle')}</h3>
        {MARKETPLACE_SOURCES.map(source => (
          <div key={source.id} className={css.rowCard}>
            <span className={css.rowName}>{source.label}</span>
            <span className={css.rowHint}>{source.description}</span>
            <a className={css.rowHint} href={source.homepage} target='_blank' rel='noreferrer'>{source.homepage}</a>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One ranked catalog card: kind badge, name, publisher, description, tags, match meter. */
function ResultCard(props: {
  readonly item: CatalogItem
  readonly matchWeight: number
  readonly matchedTags: readonly string[]
  readonly searching: boolean
  readonly t: MarketplaceTabProps['t']
  readonly onInstall: (item: CatalogItem) => void
}) {
  const { item, searching } = props
  return (
    <article className={css.rowCard} aria-label={item.name}>
      <div className={css.rowHead}>
        <span className={css.kindBadge}>{item.kind === 'mcp' ? 'MCP' : 'Skill'}</span>
        <span className={css.rowName}>{item.name}</span>
        {item.transport !== undefined
          ? <span className={css.rowHint}>{item.transport === 'http' ? 'HTTP' : 'stdio'}</span>
          : null}
        {searching && props.matchWeight === 100
          ? <span className={css.bestMatch}>{props.t('bestMatch')}</span>
          : null}
      </div>
      <span className={css.rowPublisher}>{item.publisher}</span>
      <p className={css.rowDescription}>{item.description}</p>
      {item.tags.length > 0
        ? (
          <div className={css.filters}>
            {item.tags.map(tag => (
              <span
                key={tag}
                className={clsx(css.catBtn, searching && props.matchedTags.includes(tag) && css.catBtnActive)}
              >
                {tag}
              </span>
            ))}
          </div>
        )
        : null}
      <div className={css.rowFoot}>
        {item.docsUrl !== undefined
          ? <a className={css.rowHint} href={item.docsUrl} target='_blank' rel='noreferrer'>{props.t('docs')}</a>
          : <span />}
        <button
          type='button'
          className={clsx(css.catBtn, css.catBtnActive)}
          aria-label={`${props.t('install')}: ${item.name}`}
          onClick={() => { props.onInstall(item) }}
        >
          {props.t('install')}
        </button>
      </div>
      {searching && props.matchWeight > 0
        ? (
          <div className={css.meter} aria-hidden='true'>
            <div className={css.meterFill} style={{ width: `${String(props.matchWeight)}%` }} />
          </div>
        )
        : null}
    </article>
  )
}
