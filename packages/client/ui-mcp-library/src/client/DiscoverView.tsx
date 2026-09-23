/** Discover view: MCP Registry search with one-click connect. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { McpRegistryOption, McpRegistryServer } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconCheckOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpState } from './controller.ts'
import type { McpPageProps, Translate } from './McpPage.tsx'
import css from './McpLibrary.module.css'

/** Typing pauses this long before a search goes to the Host. */
const SEARCH_DELAY_MS = 300

/**
 * Localized label of a run option kind.
 * @param kind - option kind.
 * @param t - copy lookup.
 * @returns the label.
 */
export function kindLabel(kind: McpRegistryOption['kind'], t: Translate): string {
  switch (kind) {
    case 'npm': return t('kindNpm')
    case 'pypi': return t('kindPypi')
    case 'oci': return t('kindOci')
    case 'remote': return t('kindRemote')
  }
}

/** Render the registry search and results. */
export function DiscoverView(props: McpPageProps & { readonly state: McpState }): ReactNode {
  const { t, state, ensureDiscover, search, loadMore, openRegistry } = props
  const discover = state.discover
  const [draft, setDraft] = useState(discover.query)
  const first = useRef(true)
  useEffect(() => { ensureDiscover() }, [ensureDiscover])
  useEffect(() => {
    // The mount run would repeat the page ensureDiscover already started.
    if (first.current) {
      first.current = false
      return undefined
    }
    const timer = setTimeout(() => { search(draft) }, SEARCH_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [draft, search])
  const manageable = state.view?.manageable !== false
  return (
    <div className={css.scroll}>
      <section className={css.discoverHero}>
        <h2 className={css.eyebrow}>{t('discoverTitle')}</h2>
        <label className={css.bigSearch}>
          <IconSearchOutlineRegular size={18} />
          <input type="search" value={draft} spellCheck={false} autoComplete="off" placeholder={t('discoverSearch')} aria-label={t('discoverSearch')} onChange={(event) => { setDraft(event.target.value) }} />
        </label>
      </section>
      {discover.status === 'error' && (
        <div className={css.stateBlock} role="alert">
          <p>{t('discoverError', { error: discover.error ?? '' })}</p>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} onClick={() => { search(draft) }}>{t('retry')}</Button>
        </div>
      )}
      {(discover.status === 'idle' || discover.status === 'loading') && <p className={css.stateText} role="status">{t('discoverLoading')}</p>}
      {discover.status === 'ready' && discover.results.length === 0 && <p className={css.stateText}>{t('discoverEmpty', { query: discover.query.trim() })}</p>}
      {discover.status === 'ready' && discover.results.length > 0 && (
        <ul className={css.resultGrid}>
          {discover.results.map(server => (
            <RegistryCard key={server.name} t={t} server={server} manageable={manageable} onConnect={() => { openRegistry(server) }} />
          ))}
        </ul>
      )}
      {discover.status === 'ready' && discover.nextCursor !== undefined && (
        <div className={css.moreRow}>
          <Button variant="outline" disabled={discover.loadingMore} onClick={loadMore}>{discover.loadingMore ? t('loadingMore') : t('loadMore')}</Button>
        </div>
      )}
    </div>
  )
}

function RegistryCard({ t, server, manageable, onConnect }: {
  readonly t: Translate
  readonly server: McpRegistryServer
  readonly manageable: boolean
  readonly onConnect: () => void
}): ReactNode {
  const kinds = [...new Set(server.options.map(option => option.kind))]
  const link = server.repository ?? server.websiteUrl
  return (
    <li className={css.resultCard} data-installed={server.installed ? 'true' : undefined}>
      <div className={css.resultTop}>
        <span className={css.resultKinds}>
          {kinds.length === 0 ? <span className={css.chip}>{t('unsupported')}</span> : kinds.map(kind => <span key={kind} className={css.chip}>{kindLabel(kind, t)}</span>)}
        </span>
        {server.version !== '' && <span className={css.resultVersion}>{t('version', { version: server.version })}</span>}
      </div>
      <h3 className={css.resultName}>{server.title ?? server.suggestedName}</h3>
      <p className={css.resultRegistryName}>{server.name}</p>
      <p className={css.resultDescription}>{server.description}</p>
      <div className={css.resultFoot}>
        {link === undefined ? <span /> : <a className={css.resultLink} href={link} target="_blank" rel="noreferrer noopener">{t('openRepository')}</a>}
        {server.installed
          ? <span className={css.installedMark}><IconCheckOutlineRegular size={14} />{t('connected')}</span>
          : <Button variant="primary" size="sm" disabled={!manageable || server.options.length === 0} onClick={onConnect}>{t('connect')}</Button>}
      </div>
    </li>
  )
}
