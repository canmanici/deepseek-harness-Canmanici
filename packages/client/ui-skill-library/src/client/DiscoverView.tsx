/** Discover view: one search across every public skill marketplace, with one-click installs. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ManagedMarketplace, MarketplaceEntry } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconCheckOutlineRegular,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsState } from './controller.ts'
import { compact, entryState } from './helpers.ts'
import type { SkillLibraryPageProps, Translate } from './SkillLibraryPage.tsx'
import css from './SkillLibrary.module.css'

/** Typing pauses this long before a search goes to the Host. */
const SEARCH_DELAY_MS = 280

/** Render the marketplace search and results. */
export function DiscoverView(props: SkillLibraryPageProps & { readonly state: SkillsState }): ReactNode {
  const { t, state, ensureDiscover, search, selectMarketplace, loadMore, install, refresh } = props
  const discover = state.discover
  const [draft, setDraft] = useState(discover.query)
  const first = useRef(true)
  useEffect(() => { ensureDiscover() }, [ensureDiscover])
  useEffect(() => {
    // The mount run would repeat the browse ensureDiscover already started.
    if (first.current) {
      first.current = false
      return undefined
    }
    const timer = setTimeout(() => { search(draft) }, SEARCH_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [draft, search])

  if (discover.status === 'idle' || discover.status === 'loading') {
    return <p className={css.discoverState} role="status">{t('discoverLoading')}</p>
  }
  if (discover.status === 'error') {
    return (
      <div className={css.stateBlock} role="alert">
        <p>{t('discoverError', { error: discover.error ?? '' })}</p>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} onClick={refresh}>{t('retry')}</Button>
      </div>
    )
  }
  if (!discover.available) return <p className={css.discoverState}>{t('discoverUnavailable')}</p>

  const enabled = discover.marketplaces.filter(market => market.enabled)
  const selected = enabled.find(market => market.id === discover.marketplace)
  const failed = discover.errors.map(error => enabled.find(market => market.id === error.marketplace)?.title ?? error.marketplace).filter(title => title !== '')
  const total = Object.values(discover.totals).reduce((sum, value) => sum + value, 0)
  const query = discover.query.trim()
  return (
    <div className={css.discover}>
      <section className={css.discoverHero}>
        <h2 className={css.discoverTitle}>{t('discoverTitle')}</h2>
        <label className={css.bigSearch}>
          <span className={css.commandSlashBig} aria-hidden="true">/</span>
          <input
            type="search"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('discoverSearch', { count: String(enabled.length) })}
            aria-label={t('discoverSearchLabel')}
            onChange={(event) => { setDraft(event.target.value) }}
          />
          {discover.searching && <span className={css.searchSpinner} role="status" aria-label={t('discoverSearching')} />}
        </label>
        <div className={css.marketRail} role="group" aria-label={t('marketFilter')}>
          <MarketChip t={t} label={t('marketAll')} pressed={discover.marketplace === undefined} onClick={() => { selectMarketplace(undefined) }} />
          {enabled.map(market => (
            <MarketChip
              key={market.id}
              t={t}
              label={market.title}
              market={market}
              count={discover.totals[market.id]}
              pressed={discover.marketplace === market.id}
              onClick={() => { selectMarketplace(market.id) }}
            />
          ))}
        </div>
      </section>
      <div className={css.resultsBar} aria-live="polite">
        <span>{t('discoverResults', { shown: String(discover.results.length) })}</span>
        {total > 0 && <span className={css.resultsTotal}>{t('discoverTotal', { total: total.toLocaleString() })}</span>}
        {failed.length > 0 && (
          <span className={css.resultsWarn}>
            <IconWarningOutlineRegular size={14} />
            {t('discoverPartial', { markets: failed.join(', ') })}
          </span>
        )}
      </div>
      {discover.results.length === 0 && !discover.searching
        ? (
          <p className={css.discoverState}>
            {selected !== undefined && !selected.browsable && query.length < 2 ? t('discoverBrowseEmpty') : t('discoverEmpty', { query })}
          </p>
        )
        : (
          <ul className={css.resultGrid} data-busy={discover.searching ? 'true' : undefined}>
            {discover.results.map(entry => (
              <ResultCard
                key={entry.key}
                t={t}
                entry={entry}
                state={entryState(entry, state.inventory?.skills)}
                market={discover.marketplaces.find(market => market.id === entry.marketplace)}
                onInstall={() => { install(entry) }}
              />
            ))}
          </ul>
        )}
      {discover.hasMore && (
        <div className={css.moreRow}>
          <Button variant="outline" disabled={discover.loadingMore} onClick={loadMore}>
            {discover.loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  )
}

function MarketChip({ t, label, market, count, pressed, onClick }: {
  readonly t: Translate
  readonly label: string
  readonly market?: ManagedMarketplace
  /** Matches for the current query, when this marketplace reported them. */
  readonly count?: number | undefined
  readonly pressed: boolean
  readonly onClick: () => void
}): ReactNode {
  const figure = count ?? market?.available
  return (
    <button type="button" className={css.marketChip} aria-pressed={pressed} data-failed={market?.error === undefined ? undefined : 'true'} onClick={onClick}>
      <span>{label}</span>
      {market !== undefined && (
        <span className={css.marketCount} title={market.error}>
          {market.error !== undefined ? t('marketFailed') : figure !== undefined ? t('marketAvailable', { count: compact(figure) }) : market.browsable ? '' : t('marketSearchOnly')}
        </span>
      )}
    </button>
  )
}

function ResultCard({ t, entry, state, market, onInstall }: {
  readonly t: Translate
  readonly entry: MarketplaceEntry
  readonly state: MarketplaceEntry['state']
  readonly market: ManagedMarketplace | undefined
  readonly onInstall: () => void
}): ReactNode {
  return (
    <li className={css.resultCard} data-state={state}>
      <div className={css.resultTop}>
        <span className={css.resultMarket}>{market?.title ?? entry.marketplace}</span>
        <span className={css.resultStats}>
          {entry.installs !== undefined && <span>{t('installsCount', { count: compact(entry.installs) })}</span>}
          {entry.stars !== undefined && <span>{t('starsCount', { count: compact(entry.stars) })}</span>}
        </span>
      </div>
      <h3 className={css.resultName}><span aria-hidden="true">/</span>{entry.name}</h3>
      <p className={css.resultDescription}>{entry.description ?? entry.dir ?? entry.repository}</p>
      {entry.conflict !== undefined && state === 'available' && <p className={css.resultConflict}>{t('conflict', { source: entry.conflict })}</p>}
      <div className={css.resultFoot}>
        <a className={css.resultRepo} href={entry.url} target="_blank" rel="noreferrer noopener" title={t('openPage')}>{entry.repository}</a>
        {state === 'installed'
          ? <span className={css.installedMark}><IconCheckOutlineRegular size={14} />{t('installed')}</span>
          : (
            <Button
              variant={state === 'installing' ? 'outline' : 'primary'}
              size="sm"
              icon={<IconDownloadOutlineRegular size={14} />}
              disabled={state === 'installing'}
              aria-label={t('installFor', { name: entry.name })}
              onClick={onInstall}
            >
              {state === 'installing' ? t('installing') : t('install')}
            </Button>
          )}
      </div>
    </li>
  )
}
