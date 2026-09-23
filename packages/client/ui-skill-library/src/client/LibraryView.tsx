/** Installed view: installed skills grouped by origin beside an inspector for the selected one. */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ManagedProject, ManagedSkill } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconArchiveOutlineRegular,
  IconChevronDownOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGlobeOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSkillOutlineRegular,
  IconUserOutlineRegular,
  Menu,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsState } from './controller.ts'
import { groupSkills, sourceLabel, type SkillOrigin } from './helpers.ts'
import { SkillInspector } from './SkillInspector.tsx'
import { SkillEditor } from './SkillEditor.tsx'
import type { SkillLibraryPageProps, Translate } from './SkillLibraryPage.tsx'
import css from './SkillLibrary.module.css'

type Filter = 'all' | 'on' | 'off'

/**
 * Glyph for one origin.
 * @param props.origin - where the skill comes from.
 * @returns the icon.
 */
export function OriginGlyph({ origin, size = 14 }: { readonly origin: SkillOrigin; readonly size?: number }): ReactNode {
  switch (origin) {
    case 'project': return <IconFolderOpenOutlineRegular size={size} />
    case 'user': return <IconUserOutlineRegular size={size} />
    case 'remote': return <IconGlobeOutlineRegular size={size} />
    case 'builtin': return <IconArchiveOutlineRegular size={size} />
  }
}

/**
 * Localized name of one group.
 * @param group - the group.
 * @param sources - known remote sources, for their display names.
 * @param t - copy lookup.
 * @returns the group title.
 */
export function groupTitle(group: { readonly origin: SkillOrigin; readonly sourceId?: string | undefined }, sources: SkillsState['sources'], t: Translate): string {
  switch (group.origin) {
    case 'project': return t('groupProject')
    case 'user': return t('groupUser')
    case 'builtin': return t('groupBuiltin')
    case 'remote': {
      const source = sources.find(entry => entry.id === group.sourceId)
      // Remote groups always carry their source id.
      return source === undefined ? group.sourceId as string : sourceLabel(source)
    }
  }
}

/** Render the library list and inspector. */
export function LibraryView(props: SkillLibraryPageProps & {
  readonly state: SkillsState
  /** Switch to the Discover view. */
  readonly onBrowse: () => void
  /** Switch to the Sources view. */
  readonly onSources: () => void
}): ReactNode {
  const { t, state, refresh, inspect, toggleSkill, openCreate, updateAll, onBrowse, onSources } = props
  const [filter, setFilter] = useState<Filter>('all')
  const inventory = state.inventory
  const groups = useMemo(() => groupSkills((inventory?.skills ?? []).filter(skill => filter === 'all' || (filter === 'on') === skill.enabled)), [inventory, filter])
  const updates = state.sources.filter(source => source.updateAvailable).length

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={css.skeleton} role="status" aria-label={t('loading')}>
        {[0, 1, 2, 3, 4].map(index => <span key={index} className={css.skeletonRow} style={{ '--delay': `${index * 80}ms` } as CSSProperties} />)}
      </div>
    )
  }
  if (state.status === 'error' || inventory === undefined) {
    return (
      <div className={css.stateBlock} role="alert">
        <p>{t('loadError', { error: state.error ?? '' })}</p>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} onClick={refresh}>{t('retry')}</Button>
      </div>
    )
  }
  const editing = state.editor.open
  const selected = inventory.skills.find(skill => skill.name === state.inspected?.name)
  const locked = !inventory.preferencesAvailable
  if (inventory.skills.length === 0 && !editing) {
    return (
      <div className={css.emptyHero}>
        <span className={css.emptyMark} aria-hidden="true">/</span>
        <h2>{t('emptyTitle')}</h2>
        <p>{t('emptyBody')}</p>
        <div className={css.emptyActions}>
          <Button variant="primary" icon={<IconPlusOutlineRegular size={16} />} onClick={openCreate}>{t('newSkill')}</Button>
          <Button variant="outline" onClick={onBrowse}>{t('emptySource')}</Button>
        </div>
      </div>
    )
  }
  const detailOpen = editing || state.inspected !== undefined
  return (
    <div className={css.library} data-detail={detailOpen ? 'open' : undefined}>
      <aside className={css.listPane}>
        <div className={css.listTools}>
          {updates > 0 && (
            <div className={css.updateBanner} role="status">
              <button type="button" className={css.updateText} onClick={onSources}>
                {updates === 1 ? t('updatesAvailableOne') : t('updatesAvailableMany', { count: String(updates) })}
              </button>
              <Button variant="primary" size="sm" icon={<IconRefreshOutlineRegular size={14} />} disabled={state.pendingSources.length > 0} onClick={updateAll}>{t('updateAll')}</Button>
            </div>
          )}
          <div className={css.toolRow}>
            <div className={css.segment} role="group" aria-label={t('filterLabel')}>
              {(['all', 'on', 'off'] as const).map(value => (
                <button key={value} type="button" className={css.segmentButton} aria-pressed={filter === value} onClick={() => { setFilter(value) }}>
                  {value === 'all' ? t('filterAll') : value === 'on' ? t('filterOn') : t('filterOff')}
                </button>
              ))}
            </div>
            <ScopePicker {...props} projects={inventory.projects} />
          </div>
          {locked && <p className={css.hint}>{t('preferencesUnavailable')}</p>}
          {!inventory.complete && <p className={css.hint}>{t('incomplete')}</p>}
        </div>
        <div className={css.list}>
          {groups.length === 0 && <p className={css.hint}>{filter === 'on' ? t('emptyOn') : t('emptyOff')}</p>}
          {groups.map(group => (
            <section key={group.key} className={css.group} aria-label={groupTitle(group, state.sources, t)}>
              <h3 className={css.groupHead} data-origin={group.origin}>
                <OriginGlyph origin={group.origin} size={13} />
                <span className={css.groupName}>{groupTitle(group, state.sources, t)}</span>
                <span className={css.groupCount}>{t('groupCount', { on: String(group.skills.filter(skill => skill.enabled).length), total: String(group.skills.length) })}</span>
              </h3>
              <ul className={css.rows}>
                {group.skills.map(skill => (
                  <SkillListRow
                    key={skill.name}
                    t={t}
                    skill={skill}
                    selected={!editing && skill.name === state.inspected?.name}
                    pending={state.pendingSkills.includes(skill.name)}
                    locked={locked}
                    onSelect={() => { inspect(skill.name) }}
                    onToggle={(enabled) => { toggleSkill(skill.name, enabled) }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
      <section className={css.detailPane} aria-live="polite">
        {editing
          ? <SkillEditor {...props} editor={state.editor} />
          : state.inspected === undefined
            ? (
              <div className={css.inspectorEmpty}>
                <span className={css.emptyMark} aria-hidden="true"><IconSkillOutlineRegular size={22} /></span>
                <p>{t('inspectorEmpty')}</p>
              </div>
            )
            : <SkillInspector {...props} state={state} skill={selected} inspection={state.inspected} />}
      </section>
    </div>
  )
}

function SkillListRow({ t, skill, selected, pending, locked, onSelect, onToggle }: {
  readonly t: Translate
  readonly skill: ManagedSkill
  readonly selected: boolean
  readonly pending: boolean
  readonly locked: boolean
  readonly onSelect: () => void
  readonly onToggle: (enabled: boolean) => void
}): ReactNode {
  return (
    <li className={css.row} data-selected={selected ? 'true' : undefined} data-enabled={skill.enabled ? 'true' : 'false'} data-skill={skill.name}>
      <button type="button" className={css.rowButton} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
        <span className={css.rowName}>/{skill.name}</span>
        <span className={css.rowDescription}>{skill.description}</span>
      </button>
      <Switch checked={skill.enabled} disabled={pending || locked} label={t('toggleSkill', { name: skill.name })} onChange={onToggle} className={css.rowSwitch} />
    </li>
  )
}

type ScopePickerProps = SkillLibraryPageProps & { readonly state: SkillsState; readonly projects: readonly ManagedProject[] }

function ScopePicker(props: ScopePickerProps): ReactNode {
  const { t, state, selectProject, projects } = props
  const [open, setOpen] = useState(false)
  // Project roots are absolute paths, so this id never collides with one.
  const GLOBAL = 'all-projects'
  const project = projects.find(entry => entry.root === state.projectRoot)
  const items = [
    { id: GLOBAL, label: t('scopeGlobal'), icon: <IconGlobeOutlineRegular size={16} /> },
    ...projects.length === 0 ? [] : [{ type: 'separator' as const, id: 'separator' }],
    ...projects.map(entry => ({ id: entry.root, label: entry.title, icon: <IconFolderOpenOutlineRegular size={16} /> })),
  ]
  return (
    <Menu
      className={css.scopeMenu}
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={project?.root ?? GLOBAL}
      align="end"
      onSelect={(id) => {
        setOpen(false)
        selectProject(id === GLOBAL ? undefined : id)
      }}
      anchor={(
        <button
          type="button"
          className={css.scope}
          data-scoped={project === undefined ? undefined : 'true'}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('scopeMenu')}
          title={project === undefined ? t('scopeHintGlobal') : t('scopeHintProject', { project: project.title })}
          onClick={() => { setOpen(value => !value) }}
        >
          {project === undefined ? <IconGlobeOutlineRegular size={14} /> : <IconFolderOpenOutlineRegular size={14} />}
          <span className={css.scopeValue}>{project?.title ?? t('scopeGlobal')}</span>
          <IconChevronDownOutlineRegular size={12} className={css.chevron} />
        </button>
      )}
    />
  )
}
