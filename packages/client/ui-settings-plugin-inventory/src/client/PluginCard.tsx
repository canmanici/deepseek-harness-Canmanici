/** One catalog card: disclosure header, details panel, and the enable/disable action. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PluginEntryId, PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** One non-group Loader entry row. */
export type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Interaction state of one card's toggle action. */
type CardToggleState =
  | { readonly status: 'idle' }
  | { readonly status: 'confirming' }
  | { readonly status: 'saving' }
  | { readonly status: 'failed'; readonly code?: string; readonly services?: readonly string[] }

/** Extract the Remote failure code and missing-service names from a toggle rejection. */
function toggleFailureOf(error: unknown): { code?: string; services?: readonly string[] } {
  if (typeof error !== 'object' || error === null) return {}
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string') return {}
  const details = (error as { details?: unknown }).details
  const missing = typeof details === 'object' && details !== null
    ? (details as { missingServices?: unknown }).missingServices
    : undefined
  const services = Array.isArray(missing) && missing.every((name): name is string => typeof name === 'string')
    ? missing
    : []
  return { code, services }
}

/** Props for one card, threaded from the tab's four shares. */
export interface PluginCardProps {
  readonly entry: PluginInventoryEntry
  readonly open: boolean
  /** Localized detail-panel DOM id backing the disclosure wiring. */
  readonly detailId: string
  readonly title: string
  /** Whether the deployment accepts entry-toggle writes. */
  readonly writable: boolean
  /** Whether committed toggles re-apply live (otherwise they need a restart). */
  readonly live: boolean
  readonly t: (key: PluginInventoryLocaleKey, params?: Record<string, unknown>) => string
  readonly setEnabled: (entryId: PluginEntryId, enabled: boolean) => Promise<void>
  /** Refetch the snapshot after a committed toggle. */
  readonly onRefresh: () => void
  readonly onToggleOpen: () => void
}

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(phase: PluginFiberPhase, t: PluginCardProps['t']): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Render one entry card with its confirm-gated, save-tracked toggle action. */
export function PluginCard({
  entry, open, detailId, title, writable, live, t, setEnabled, onRefresh, onToggleOpen,
}: PluginCardProps): ReactNode {
  const status = phaseLabel(entry.fiberPhase, t)
  const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
  const [toggle, setToggle] = useState<CardToggleState>({ status: 'idle' })
  const [committed, setCommitted] = useState(false)
  const actionRef = useRef<HTMLButtonElement>(null)
  const previousStatus = useRef<CardToggleState['status']>('idle')

  // Returning focus to the persistent action button after the confirm pair or
  // the save settles keeps keyboard users on the control they invoked.
  useEffect(() => {
    const returning = previousStatus.current === 'confirming' || previousStatus.current === 'saving'
    previousStatus.current = toggle.status
    if (returning && toggle.status !== 'saving') actionRef.current?.focus()
  }, [toggle.status])

  const save = (enabled: boolean): void => {
    setToggle({ status: 'saving' })
    void setEnabled(entry.entryId, enabled).then(
      () => {
        setToggle({ status: 'idle' })
        setCommitted(true)
        onRefresh()
      },
      (error: unknown) => { setToggle({ status: 'failed', ...toggleFailureOf(error) }) },
    )
  }

  const onAction = (): void => {
    if (!entry.enabled) {
      save(true)
      return
    }
    if (toggle.status === 'confirming') {
      save(false)
      return
    }
    setToggle({ status: 'confirming' })
  }

  const actionLabel = entry.enabled
    ? (toggle.status === 'confirming' ? t('confirmDisable') : t('disable'))
    : t('enable')

  return (
    <li className={css.card} data-plugin-entry={entry.entryId} data-open={open ? 'true' : undefined}>
      <button
        className={css.cardContent}
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
        onClick={onToggleOpen}
      >
        <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
        <span className={css.cardTrailing}>
          {entry.enabled ? (
            <span
              className={css.statusDot}
              data-phase={entry.fiberPhase ?? 'unobserved'}
              role="img"
              aria-label={status}
              title={status}
            />
          ) : null}
          <span className={css.configTag} data-enabled={entry.enabled ? 'true' : 'false'}>
            {configuration}
          </span>
          <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className={css.cardDetails} id={detailId}>
          <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>
          <dl className={css.details}>
            <div>
              <dt>{t('configuration')}</dt>
              <dd>{configuration}</dd>
            </div>
            {entry.enabled ? (
              <div>
                <dt>{t('cordis')}</dt>
                <dd>{status}</dd>
              </div>
            ) : null}
          </dl>
          {writable ? (
            <div className={css.actions} data-toggle-state={toggle.status}>
              {toggle.status === 'saving' ? <p role="status" className={css.actionStatus}>{t('saving')}</p> : null}
              {toggle.status === 'failed' ? (
                <p role="alert" className={css.actionStatus}>
                  {toggle.code === 'plugin-entry-not-applied' && toggle.services !== undefined && toggle.services.length > 0
                    ? t('notAppliedNeeds', { services: toggle.services.join(', ') })
                    : t('saveFailed')}
                </p>
              ) : null}
              {toggle.status === 'confirming' ? <p className={css.actionStatus}>{t('disableWarning')}</p> : null}
              <button
                ref={actionRef}
                type="button"
                disabled={toggle.status === 'saving'}
                onClick={onAction}
              >
                {actionLabel}
              </button>
              {toggle.status === 'confirming' ? (
                <button type="button" onClick={() => { setToggle({ status: 'idle' }) }}>
                  {t('cancel')}
                </button>
              ) : null}
              {toggle.status === 'failed' ? (
                <button type="button" onClick={() => { save(!entry.enabled) }}>
                  {t('retry')}
                </button>
              ) : null}
            </div>
          ) : (
            <p role="note" className={css.actionStatus}>{t('readOnlyHint')}</p>
          )}
          {committed && toggle.status === 'idle' ? (
            <p role="status" className={css.actionStatus}>{t(live ? 'liveEffect' : 'restartEffect')}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
