/** DSH global panel for starting OpenDesign and hosting its local Studio UI. */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconPluginPinwheelOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenDesignRuntimePhase, OpenDesignRuntimeStatus } from '@deepseek-ai/dsh-host-open-design/shared'
import type { OpenDesignLocaleKey } from './locales.ts'
import css from './OpenDesignPanel.module.css'

const OPEN_DESIGN_START_PATH = '/open-design/start'
const OPEN_DESIGN_STATUS_PATH = '/open-design/status'

/** Full props shared by the global panel and its localized navigation row. */
export type OpenDesignPanelProps = PropsRuntime<'main'> & PropsLocale<'open-design'>

/** Narrow one string to a known Host runtime phase. */
function parsePhase(value: unknown): OpenDesignRuntimePhase | null {
  switch (value) {
    case 'idle':
    case 'downloading':
    case 'verifying':
    case 'extracting':
    case 'starting':
    case 'ready':
    case 'failed':
      return value
    default:
      return null
  }
}

/** Validate the local JSON response before it controls the page or iframe URL. */
function parseStatus(value: unknown): OpenDesignRuntimeStatus {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('OpenDesign returned invalid status data')
  const status = value as Record<string, unknown>
  const phase = parsePhase(status.phase)
  if (phase === null
    || typeof status.bytesDownloaded !== 'number' || !Number.isSafeInteger(status.bytesDownloaded) || status.bytesDownloaded < 0
    || !(status.totalBytes === null || (typeof status.totalBytes === 'number' && Number.isSafeInteger(status.totalBytes) && status.totalBytes > 0))
    || !(status.studioUrl === null || typeof status.studioUrl === 'string')
    || !(status.error === null || typeof status.error === 'string')) {
    throw new Error('OpenDesign returned invalid status fields')
  }
  if (typeof status.studioUrl === 'string') {
    const url = new URL(status.studioUrl)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      throw new Error('OpenDesign returned an unsafe Studio URL')
    }
  }
  if ((phase === 'ready') !== (status.studioUrl !== null)) throw new Error('OpenDesign returned inconsistent Studio readiness data')
  return {
    phase,
    bytesDownloaded: status.bytesDownloaded,
    totalBytes: status.totalBytes,
    studioUrl: status.studioUrl,
    error: status.error,
  }
}

/** Read one authenticated Host status response. */
async function readStatus(signal: AbortSignal): Promise<OpenDesignRuntimeStatus> {
  const response = await fetch(OPEN_DESIGN_STATUS_PATH, { cache: 'no-store', credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`OpenDesign status request failed (${String(response.status)})`)
  return parseStatus(await response.json())
}

/** Format archive progress as readable binary units. */
function formatBytes(bytes: number, t: PropsLocale<'open-design'>['t']): string {
  if (bytes === 0) return t('bytes', { count: 0 })
  if (bytes < 1024 * 1024) return t('kib', { count: Math.max(1, Math.round(bytes / 1024)) })
  return t('mib', { count: (bytes / (1024 * 1024)).toFixed(1) })
}

/** Whether this browser's loopback address refers to the local DSH host. */
function isLocalBrowser(): boolean {
  return window.location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)
}

/** Map the Host phase to its localized panel copy. */
function phaseText(phase: OpenDesignRuntimePhase, t: PropsLocale<'open-design'>['t']): string {
  return t(phase)
}

/** Render the status card until ready, then dedicate the panel body to Studio.
 * @param props - renderer seats for the global panel and its localized copy.
 * @returns the runtime manager or embedded Studio panel.
 */
export function OpenDesignPanel({ t }: OpenDesignPanelProps): ReactNode {
  const [status, setStatus] = useState<OpenDesignRuntimeStatus | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [pollKey, setPollKey] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const poll = async (): Promise<void> => {
      try {
        const next = await readStatus(abort.signal)
        if (disposed) return
        setStatus(next)
        setRequestError(null)
        if (next.phase !== 'ready' && next.phase !== 'failed') timer = setTimeout(() => { void poll() }, 1000)
      } catch (error) {
        if (disposed || abort.signal.aborted) return
        setRequestError(error instanceof Error ? error.message : String(error))
        timer = setTimeout(() => { void poll() }, 1000)
      }
    }
    void poll()
    return () => {
      disposed = true
      abort.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [pollKey])

  const start = async (): Promise<void> => {
    setStarting(true)
    setRequestError(null)
    try {
      const response = await fetch(OPEN_DESIGN_START_PATH, { method: 'POST', credentials: 'same-origin' })
      if (!response.ok && response.status !== 202) throw new Error(`OpenDesign start request failed (${String(response.status)})`)
      setStatus(parseStatus(await response.json()))
      setPollKey(value => value + 1)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  if (status?.phase === 'ready' && status.studioUrl !== null && isLocalBrowser()) {
    return (
      <section className={css.panel} aria-label={t('title')}>
        <header className={css.toolbar}>
          <div className={css.heading}>
            <h1 className={css.title}>{t('title')}</h1>
            <p className={css.intro}>{t('ready')}</p>
          </div>
          <span className={css.icon} aria-hidden="true"><IconPluginPinwheelOutlineRegular size={18} /></span>
        </header>
        <iframe
          className={css.frame}
          src={status.studioUrl}
          title={t('frameTitle')}
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write; fullscreen"
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
        />
      </section>
    )
  }

  const phase = status?.phase ?? 'idle'
  const downloading = phase === 'downloading'
  const progress = status?.totalBytes === null || status?.totalBytes === undefined
    ? null
    : Math.min(100, status.bytesDownloaded / status.totalBytes * 100)
  const progressLabel = status?.totalBytes === null || status?.totalBytes === undefined
    ? t('indeterminate', { downloaded: formatBytes(status?.bytesDownloaded ?? 0, t) })
    : t('progress', { downloaded: formatBytes(status.bytesDownloaded, t), total: formatBytes(status.totalBytes, t) })
  const showRetry = status === null || phase === 'idle' || phase === 'failed'

  return (
    <section className={css.panel} aria-label={t('title')}>
      <header className={css.toolbar}>
        <div className={css.heading}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <span className={css.icon} aria-hidden="true"><IconPluginPinwheelOutlineRegular size={18} /></span>
      </header>
      <div className={css.stage}>
        <div className={css.card}>
          <p className={css.message} role="status" aria-live="polite">{phaseText(phase, t)}</p>
          {downloading ? <progress className={css.progress} max={100} value={progress ?? undefined} aria-label={progressLabel} /> : null}
          {downloading ? <p className={css.message}>{progressLabel}</p> : null}
          {status?.error === null || status?.error === undefined ? null : <p className={css.error}>{status.error}</p>}
          {requestError === null ? null : <p className={css.error}>{requestError}</p>}
          <p className={css.safety}>{t('safety')}</p>
          {showRetry
            ? <Button variant="primary" disabled={starting} aria-busy={starting} onClick={() => { void start() }}>{t('retry')}</Button>
            : null}
          {phase === 'ready' && !isLocalBrowser() ? <p className={css.error}>{t('localOnly')}</p> : null}
        </div>
      </div>
    </section>
  )
}

/** Sidebar glyph for the Studio panel.
 * @param props - standard sidebar icon size.
 * @returns the OpenDesign pinwheel icon.
 */
export function OpenDesignPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconPluginPinwheelOutlineRegular size={size} />
}

/** Typed copy key reference retained for component metadata. */
export type { OpenDesignLocaleKey }
