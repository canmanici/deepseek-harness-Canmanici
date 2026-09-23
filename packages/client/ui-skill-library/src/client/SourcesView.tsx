/** Sources view: a grid of remote skill sources with an add tile and add/remove dialogs. */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { ManagedSource } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconArchiveOutlineRegular,
  IconBranchOutlineRegular,
  IconChevronDownOutlineRegular,
  IconLinkOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsState } from './controller.ts'
import { detectKind, relativeTime, sourceLabel } from './helpers.ts'
import { counted, type SkillLibraryPageProps, type Translate } from './SkillLibraryPage.tsx'
import css from './SkillLibrary.module.css'

function kindLabel(kind: ManagedSource['kind'], t: Translate): string {
  return kind === 'github' ? t('kindGithub') : kind === 'archive' ? t('kindArchive') : t('kindFile')
}

function KindGlyph({ kind }: { readonly kind: ManagedSource['kind'] }): ReactNode {
  return kind === 'github' ? <IconBranchOutlineRegular size={18} /> : kind === 'archive' ? <IconArchiveOutlineRegular size={18} /> : <IconLinkOutlineRegular size={18} />
}

/** Render the sources grid. */
export function SourcesView(props: SkillLibraryPageProps & { readonly state: SkillsState }): ReactNode {
  const { t, state, refresh, openAdd, syncSource, toggleSource, removeSource, checkUpdates, updateAll } = props
  const updates = state.sources.filter(source => source.updateAvailable).length
  const [removing, setRemoving] = useState<ManagedSource | undefined>()
  if (state.sourcesStatus === 'idle' || state.sourcesStatus === 'loading') {
    return <div className={css.skeleton} role="status" aria-label={t('loading')}><span className={css.skeletonRow} /></div>
  }
  if (state.sourcesStatus === 'error') {
    return (
      <div className={css.stateBlock} role="alert">
        <p>{t('loadError', { error: state.sourcesError ?? '' })}</p>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} onClick={refresh}>{t('retry')}</Button>
      </div>
    )
  }
  if (state.inventory?.sourcesAvailable === false) return <p className={css.hint}>{t('sourcesUnavailable')}</p>
  return (
    <div className={css.sources}>
      <div className={css.sourcesHead}>
        <p className={css.sourcesIntro}>{t('sourcesIntro')}</p>
        <span className={css.footActions}>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={14} className={clsx(state.checking && css.spin)} />} disabled={state.checking} onClick={checkUpdates}>
            {state.checking ? t('checkingUpdates') : t('checkUpdates')}
          </Button>
          {updates > 0 && <Button variant="primary" size="sm" disabled={state.pendingSources.length > 0} onClick={updateAll}>{t('updateAll')}</Button>}
        </span>
      </div>
      <ul className={css.sourceGrid}>
        {state.sources.map(source => (
          <SourceCard
            key={source.id}
            t={t}
            source={source}
            pending={state.pendingSources.includes(source.id)}
            onSync={() => { syncSource(source.id) }}
            onToggle={(enabled) => { toggleSource(source.id, enabled) }}
            onRemove={() => { setRemoving(source) }}
          />
        ))}
        <li>
          <button type="button" className={css.addTile} onClick={openAdd}>
            <span className={css.addTileMark} aria-hidden="true"><IconPlusOutlineRegular size={20} /></span>
            <span className={css.addTileTitle}>{t('addSource')}</span>
            <span className={css.addTileHint}>{t('addTileHint')}</span>
          </button>
        </li>
      </ul>
      <AddSourceDialog {...props} />
      {removing !== undefined && (
        <Modal
          open
          onClose={() => { setRemoving(undefined) }}
          title={t('removeTitle', { source: sourceLabel(removing) })}
          closeLabel={t('close')}
          description={t(removing.origin === 'default' ? 'removeDefaultDescription' : 'removeDescription', { skills: counted(removing.skillCount, 'skillsOne', 'skillsMany', t) })}
          footer={(
            <div className={css.dialogFooter}>
              <Button variant="ghost" onClick={() => { setRemoving(undefined) }}>{t('editorCancel')}</Button>
              <Button
                variant="primary"
                className={css.dangerSolid}
                onClick={() => {
                  removeSource(removing.id)
                  setRemoving(undefined)
                }}
              >
                {t('removeConfirm')}
              </Button>
            </div>
          )}
        />
      )}
    </div>
  )
}

function SourceCard({ t, source, pending, onSync, onToggle, onRemove }: {
  readonly t: Translate
  readonly source: ManagedSource
  readonly pending: boolean
  readonly onSync: () => void
  readonly onToggle: (enabled: boolean) => void
  readonly onRemove: () => void
}): ReactNode {
  const syncing = source.syncState === 'syncing'
  const label = sourceLabel(source)
  const dot = syncing ? 'ongoing' : source.syncState === 'error' ? 'error' : source.syncState === 'ok' ? 'done' : 'idle'
  return (
    <li className={css.sourceCard} data-state={source.syncState} data-enabled={source.enabled ? 'true' : 'false'}>
      <div className={css.sourceTop}>
        <span className={css.sourceGlyph} aria-hidden="true"><KindGlyph kind={source.kind} /></span>
        <span className={css.sourceTags}>
          <span className={css.chip}>{kindLabel(source.kind, t)}</span>
          {source.origin === 'default' && <span className={css.chip} data-tone="accent">{t('sourceDefault')}</span>}
          {source.updateAvailable && <span className={css.chip} data-tone="update">{t('updateAvailable')}</span>}
        </span>
        <Switch checked={source.enabled} disabled={pending} label={t('toggleSource', { source: label })} onChange={onToggle} />
      </div>
      <h3 className={css.sourceName}>{label}</h3>
      <p className={css.sourceUrl}>
        {source.url}
        {source.ref !== undefined && <span className={css.sourceMeta}> @{source.ref}</span>}
        {source.path !== undefined && <span className={css.sourceMeta}> /{source.path}</span>}
      </p>
      <dl className={css.sourceStats}>
        <div>
          <dt>{t('sourceSkills')}</dt>
          <dd className={css.statNumber} title={t('sourceInstalled', { installed: String(source.skillCount), available: String(source.availableCount) })}>
            {source.skillCount}
            {source.availableCount > source.skillCount && <span className={css.statOf}>/{source.availableCount}</span>}
          </dd>
        </div>
        <div>
          <dt>{t('sourceCommit')}</dt>
          <dd className={css.statMono}>{source.commit?.slice(0, 7) ?? '—'}</dd>
        </div>
      </dl>
      <div className={css.sourceStatus}>
        <StateDot state={dot} />
        <span>
          {syncing
            ? t('syncing')
            : source.syncState === 'error'
              ? t('syncErrorState')
              : source.syncedAt === undefined
                ? t('neverSynced')
                : `${t('sourceSynced', { when: relativeTime(source.syncedAt) })}${source.checkedAt !== undefined && !source.updateAvailable ? ` · ${t('upToDate')}` : ''}`}
        </span>
      </div>
      {source.error !== undefined && <p className={css.sourceError}>{source.error}</p>}
      <div className={css.sourceActions}>
        <Button variant={source.updateAvailable ? 'primary' : 'outline'} size="sm" icon={<IconRefreshOutlineRegular size={16} className={clsx(syncing && css.spin)} />} disabled={pending || syncing} onClick={onSync}>
          {source.updateAvailable ? t('update') : t('syncSource')}
        </Button>
        <Button variant="ghost" size="sm" className={css.dangerGhost} icon={<IconTrashOutlineRegular size={16} />} disabled={pending} onClick={onRemove}>
          {t('removeSource')}
        </Button>
      </div>
    </li>
  )
}

function AddSourceDialog({ t, state, closeAdd, editAdd, submitAdd }: SkillLibraryPageProps & { readonly state: SkillsState }): ReactNode {
  const draft = state.add
  const urlRef = useRef<HTMLInputElement>(null)
  const [advanced, setAdvanced] = useState(false)
  const errorId = useId()
  const detected = detectKind(draft.url)
  useEffect(() => {
    if (!draft.open) {
      setAdvanced(false)
      return
    }
    urlRef.current?.focus()
  }, [draft.open])
  if (!draft.open) return null
  const kinds: ReadonlyArray<ManagedSource['kind']> = ['github', 'archive', 'skill-file']
  return (
    <Modal
      open
      onClose={closeAdd}
      title={t('addTitle')}
      closeLabel={t('close')}
      description={t('addDescription')}
      className={css.addDialog as string}
      footer={(
        <div className={css.dialogFooter}>
          <Button variant="ghost" disabled={draft.busy} onClick={closeAdd}>{t('editorCancel')}</Button>
          <Button variant="primary" disabled={draft.busy || draft.url.trim() === ''} onClick={submitAdd}>
            {draft.busy ? t('addBusy') : t('addSubmit')}
          </Button>
        </div>
      )}
    >
      <form
        className={css.form}
        onSubmit={(event) => {
          event.preventDefault()
          submitAdd()
        }}
      >
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('addUrl')}</span>
          <input
            ref={urlRef}
            className={css.textInput}
            type="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            value={draft.url}
            placeholder={t('addUrlPlaceholder')}
            aria-invalid={draft.error !== undefined}
            aria-describedby={draft.error === undefined ? undefined : errorId}
            disabled={draft.busy}
            onChange={(event) => { editAdd({ url: event.target.value }) }}
          />
        </label>
        <div className={css.kinds} aria-live="polite">
          {kinds.map(kind => <span key={kind} className={css.kind} data-match={detected === kind ? 'true' : undefined}>{kindLabel(kind, t)}</span>)}
        </div>
        <button type="button" className={css.disclosure} aria-expanded={advanced} onClick={() => { setAdvanced(value => !value) }}>
          <IconChevronDownOutlineRegular size={14} className={css.chevron} />
          {t('addAdvanced')}
        </button>
        {advanced && (
          <div className={css.fieldGrid}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('addRef')}</span>
              <input className={css.textInput} value={draft.ref} placeholder={t('addRefPlaceholder')} spellCheck={false} disabled={draft.busy} onChange={(event) => { editAdd({ ref: event.target.value }) }} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('addPath')}</span>
              <input className={css.textInput} value={draft.path} placeholder={t('addPathPlaceholder')} spellCheck={false} disabled={draft.busy} onChange={(event) => { editAdd({ path: event.target.value }) }} />
            </label>
          </div>
        )}
        {draft.error !== undefined && <p id={errorId} className={css.errorText} role="alert">{draft.error}</p>}
        <p className={css.trust}><IconWarningOutlineRegular size={16} />{t('addTrust')}</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
