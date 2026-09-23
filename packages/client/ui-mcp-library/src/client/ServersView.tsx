/** Servers view: every configured MCP server with its live status, tools, switch, and removal. */

import { useState, type ReactNode } from 'react'
import type { ManagedMcpServer } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconCodeOutlineRegular,
  IconGlobeOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  StateDot,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpState } from './controller.ts'
import type { McpPageProps, Translate } from './McpPage.tsx'
import css from './McpLibrary.module.css'

/**
 * Localized label of a server's state.
 * @param server - the server.
 * @param t - copy lookup.
 * @returns the label.
 */
export function stateLabel(server: ManagedMcpServer, t: Translate): string {
  switch (server.state) {
    case 'connecting': return t('stateConnecting')
    case 'connected': return t('stateConnected')
    case 'reconnecting': return t('stateReconnecting', { attempt: String(server.attempt ?? 1) })
    case 'failed': return t('stateFailed')
    case 'stopped': return t('stateStopped')
    case 'disabled': return t('stateDisabled')
  }
}

function dotState(server: ManagedMcpServer): 'done' | 'ongoing' | 'error' | 'idle' {
  if (server.state === 'connected') return 'done'
  if (server.state === 'connecting' || server.state === 'reconnecting') return 'ongoing'
  return server.state === 'failed' ? 'error' : 'idle'
}

/** Render the configured servers. */
export function ServersView(props: McpPageProps & { readonly state: McpState; readonly onBrowse: () => void }): ReactNode {
  const { t, state, refresh, toggleServer, removeServer, openCustom, onBrowse } = props
  if (state.status === 'idle' || state.status === 'loading') return <p className={css.stateText} role="status">{t('loading')}</p>
  if (state.status === 'error' || state.view === undefined) {
    return (
      <div className={css.stateBlock} role="alert">
        <p>{t('loadError', { error: state.error ?? '' })}</p>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} onClick={refresh}>{t('retry')}</Button>
      </div>
    )
  }
  const { servers, manageable } = state.view
  if (servers.length === 0) {
    return (
      <div className={css.emptyHero}>
        <span className={css.emptyMark} aria-hidden="true"><IconGlobeOutlineRegular size={22} /></span>
        <h2>{t('emptyTitle')}</h2>
        <p>{t('emptyBody')}</p>
        <div className={css.emptyActions}>
          <Button variant="primary" onClick={onBrowse}>{t('emptyBrowse')}</Button>
          <Button variant="outline" icon={<IconPlusOutlineRegular size={16} />} disabled={!manageable} onClick={openCustom}>{t('addServer')}</Button>
        </div>
      </div>
    )
  }
  return (
    <div className={css.scroll}>
      {!manageable && <p className={css.hint}>{t('unmanageable')}</p>}
      <ul className={css.serverList}>
        {servers.map(server => (
          <ServerCard
            key={server.entryId}
            t={t}
            server={server}
            pending={state.pending.includes(server.entryId)}
            onToggle={(enabled) => { toggleServer(server.entryId, enabled) }}
            onRemove={() => { removeServer(server.entryId) }}
          />
        ))}
      </ul>
    </div>
  )
}

function ServerCard({ t, server, pending, onToggle, onRemove }: {
  readonly t: Translate
  readonly server: ManagedMcpServer
  readonly pending: boolean
  readonly onToggle: (enabled: boolean) => void
  readonly onRemove: () => void
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const local = server.transport === 'stdio'
  const target = local ? [server.command ?? '', ...server.args ?? []].join(' ') : server.url ?? ''
  const variables = local ? server.envNames : server.headerNames
  const prefix = `mcp__${server.serverName}__`
  return (
    <li className={css.serverCard} data-state={server.state}>
      <div className={css.serverTop}>
        <span className={css.serverGlyph} aria-hidden="true">{local ? <IconCodeOutlineRegular size={18} /> : <IconGlobeOutlineRegular size={18} />}</span>
        <div className={css.serverIdentity}>
          <h3 className={css.serverName}>{server.serverName}</h3>
          <p className={css.serverStatus}>
            <StateDot state={dotState(server)} />
            <span>{stateLabel(server, t)}</span>
            <span className={css.chip}>{local ? t('transportLocal') : t('transportRemote')}</span>
            {!server.manageable && <span className={css.chip}>{t('readOnly')}</span>}
          </p>
        </div>
        <Switch checked={server.enabled} disabled={pending || !server.manageable} label={t('toggleServer', { name: server.serverName })} onChange={onToggle} />
      </div>
      <p className={css.serverTarget} title={target}>{target}</p>
      {variables.length > 0 && <p className={css.hint}>{t('variablesSet', { names: variables.join(', ') })}</p>}
      {server.error !== undefined && server.state !== 'connected' && <p className={css.errorText}>{server.error}</p>}
      <div className={css.serverFoot}>
        {server.tools.length === 0
          ? <span className={css.hint}>{t('toolsNone')}</span>
          : (
            <button type="button" className={css.linkButton} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
              {expanded ? t('toolsHide') : t('toolsShow', { count: String(server.tools.length) })}
            </button>
          )}
        {server.manageable && !confirming && (
          <Button variant="ghost" size="sm" className={css.dangerGhost} icon={<IconTrashOutlineRegular size={16} />} disabled={pending} onClick={() => { setConfirming(true) }}>
            {t('remove')}
          </Button>
        )}
      </div>
      {expanded && (
        <ul className={css.toolList}>
          {server.tools.map(tool => (
            <li key={tool} className={css.toolChip}>{tool.startsWith(prefix) ? tool.slice(prefix.length) : tool}</li>
          ))}
        </ul>
      )}
      {confirming && (
        <div className={css.confirm} role="alertdialog" aria-label={t('removeConfirm', { name: server.serverName })}>
          <p>{t('removeConfirm', { name: server.serverName })}</p>
          <span className={css.actions}>
            <Button variant="ghost" size="sm" onClick={() => { setConfirming(false) }}>{t('removeNo')}</Button>
            <Button
              variant="primary"
              size="sm"
              className={css.dangerSolid}
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
            >
              {t('removeYes')}
            </Button>
          </span>
        </div>
      )}
    </li>
  )
}
