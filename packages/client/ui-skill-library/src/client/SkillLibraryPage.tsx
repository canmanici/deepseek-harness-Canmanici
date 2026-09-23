/** The Skills page: marketplace discovery, the installed library with an inspector, and the remote sources that feed it. */

import { useEffect, useId, useState, type ReactNode } from 'react'
import type { ManagedSource } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconPlusOutlineRegular, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsFace } from './controller.ts'
import { DiscoverView } from './DiscoverView.tsx'
import { LibraryView } from './LibraryView.tsx'
import { SourcesView } from './SourcesView.tsx'
import css from './SkillLibrary.module.css'

/** Full component props assembled by the main-panel slot renderer. */
export type SkillLibraryPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'skillLibrary'>
  & InjectFace<SkillsFace>

/** Copy lookup shared by the page's parts. */
export type Translate = SkillLibraryPageProps['t']

type View = 'discover' | 'library' | 'sources'

/**
 * Count copy that agrees in number.
 * @param count - how many.
 * @param one - key for exactly one.
 * @param many - key taking `{count}`.
 * @param t - copy lookup.
 * @returns the localized phrase.
 */
export function counted(count: number, one: 'skillsOne' | 'sourcesOne', many: 'skillsMany' | 'sourcesMany', t: Translate): string {
  return count === 1 ? t(one) : t(many, { count: String(count) })
}

/** Render the Skills page. */
export function SkillLibraryPage(props: SkillLibraryPageProps): ReactNode {
  const { t, useSkills, ensure } = props
  const ids = useId()
  const [view, setView] = useState<View>('discover')
  const state = useSkills(value => value)
  useEffect(() => { ensure() }, [ensure])
  const skills = state.inventory?.skills ?? []
  const on = skills.filter(skill => skill.enabled).length
  const sources: readonly ManagedSource[] = state.sources
  const updates = sources.filter(source => source.updateAvailable).length
  const views: ReadonlyArray<{ value: View; label: string; badge?: number }> = [
    { value: 'discover', label: t('viewDiscover') },
    { value: 'library', label: t('viewInstalled'), badge: skills.length },
    { value: 'sources', label: t('viewSources'), ...updates > 0 ? { badge: updates } : {} },
  ]
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
          {state.inventory !== undefined && (
            <p className={css.meta}>
              <span>{counted(skills.length, 'skillsOne', 'skillsMany', t)}</span>
              <span className={css.metaOn}>{t('statOn', { on: String(on) })}</span>
              {state.sourcesStatus === 'ready' && <span>{counted(sources.length, 'sourcesOne', 'sourcesMany', t)}</span>}
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
                  const index = views.findIndex(candidate => candidate.value === view)
                  const next = (views[(index + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length] as typeof views[number]).value
                  setView(next)
                  document.getElementById(`${ids}-${next}`)?.focus()
                }}
              >
                {entry.label}
                {entry.badge !== undefined && (
                  <span className={css.tabBadge} data-tone={entry.value === 'sources' ? 'update' : undefined}>{entry.badge}</span>
                )}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            icon={<IconPlusOutlineRegular size={16} />}
            onClick={() => {
              setView('library')
              props.openCreate()
            }}
          >
            {t('newSkill')}
          </Button>
        </div>
      </header>
      {state.notice !== undefined && (
        <div className={css.notice} role="alert">
          <IconWarningOutlineRegular size={16} />
          <span>{t('saveFailed', { error: state.notice })}</span>
          <button type="button" className={css.linkButton} onClick={props.dismissNotice}>{t('dismiss')}</button>
        </div>
      )}
      <div id={`${ids}-discover-panel`} role="tabpanel" aria-labelledby={`${ids}-discover`} hidden={view !== 'discover'} className={css.body}>
        {view === 'discover' && <DiscoverView {...props} state={state} />}
      </div>
      <div id={`${ids}-library-panel`} role="tabpanel" aria-labelledby={`${ids}-library`} hidden={view !== 'library'} className={css.body}>
        <LibraryView {...props} state={state} onBrowse={() => { setView('discover') }} onSources={() => { setView('sources') }} />
      </div>
      <div id={`${ids}-sources-panel`} role="tabpanel" aria-labelledby={`${ids}-sources`} hidden={view !== 'sources'} className={css.body}>
        <SourcesView {...props} state={state} />
      </div>
    </div>
  )
}
