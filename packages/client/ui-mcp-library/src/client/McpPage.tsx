/** The MCP page: configured servers with live status, and MCP Registry discovery. */

import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpFace } from './controller.ts'
import { DiscoverView } from './DiscoverView.tsx'
import { ServerFormDialog } from './ServerFormDialog.tsx'
import { ServersView } from './ServersView.tsx'
import css from './McpLibrary.module.css'

/** Full component props assembled by the main-panel slot renderer. */
export type McpPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'mcpLibrary'>
  & InjectFace<McpFace>

/** Copy lookup shared by the page's parts. */
export type Translate = McpPageProps['t']

type View = 'servers' | 'discover'

/** Render the MCP page. */
export function McpPage(props: McpPageProps): ReactNode {
  const { t, useMcp, ensure, openCustom, dismissNotice } = props
  const ids = useId()
  const [view, setView] = useState<View>('servers')
  const state = useMcp(value => value)
  useEffect(() => { ensure() }, [ensure])
  const servers = state.view?.servers ?? []
  const connected = servers.filter(server => server.state === 'connected').length
  const tools = servers.reduce((sum, server) => sum + server.tools.length, 0)
  const views: ReadonlyArray<{ value: View; label: string; badge?: number }> = [
    { value: 'servers', label: t('viewServers'), badge: servers.length },
    { value: 'discover', label: t('viewDiscover') },
  ]
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
          {state.view !== undefined && (
            <p className={css.meta}>
              <span>{servers.length === 1 ? t('serversOne') : t('serversMany', { count: String(servers.length) })}</span>
              <span className={css.metaOn}>{t('statConnected', { count: String(connected) })}</span>
              <span>{t('statTools', { count: String(tools) })}</span>
            </p>
          )}
        </div>
        <div className={css.headerActions}>
          <div className={css.viewSwitch} role="tablist" aria-label={t('views')}>
            {views.map(entry => (
              <button
                key={entry.value}
                id={`${ids}-${entry.value}`}
                type="button"
                role="tab"
                className={css.viewTab}
                aria-selected={view === entry.value}
                aria-controls={`${ids}-${entry.value}-panel`}
                tabIndex={view === entry.value ? 0 : -1}
                onClick={() => { setView(entry.value) }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                  event.preventDefault()
                  const next: View = view === 'servers' ? 'discover' : 'servers'
                  setView(next)
                  document.getElementById(`${ids}-${next}`)?.focus()
                }}
              >
                {entry.label}
                {entry.badge !== undefined && <span className={css.tabBadge}>{entry.badge}</span>}
              </button>
            ))}
          </div>
          <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} disabled={state.view?.manageable === false} onClick={openCustom}>
            {t('addServer')}
          </Button>
        </div>
      </header>
      {state.notice !== undefined && (
        <div className={css.notice} role={state.notice.kind === 'error' ? 'alert' : 'status'} data-kind={state.notice.kind}>
          <IconWarningOutlineRegular size={16} />
          <span>{state.notice.kind === 'error' ? t('saveFailed', { error: state.notice.message }) : t('restartRequired')}</span>
          <button type="button" className={css.linkButton} onClick={dismissNotice}>{t('dismiss')}</button>
        </div>
      )}
      <div id={`${ids}-servers-panel`} role="tabpanel" aria-labelledby={`${ids}-servers`} hidden={view !== 'servers'} className={css.body}>
        <ServersView {...props} state={state} onBrowse={() => { setView('discover') }} />
      </div>
      <div id={`${ids}-discover-panel`} role="tabpanel" aria-labelledby={`${ids}-discover`} hidden={view !== 'discover'} className={css.body}>
        {view === 'discover' && <DiscoverView {...props} state={state} />}
      </div>
      <ServerFormDialog {...props} form={state.form} />
    </div>
  )
}
