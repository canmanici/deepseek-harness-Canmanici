/** Inspector for one skill: identity, switch, scope, invocation, and its full instructions. */

import { useMemo, useState, type ReactNode } from 'react'
import type { ManagedSkill } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  IconChevronLeftOutlineRegular,
  IconCopyOutlineRegular,
  IconEditOutlineRegular,
  IconSkillOutlineRegular,
  IconTrashOutlineRegular,
  MarkdownText,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillInspection, SkillsState } from './controller.ts'
import { originOf } from './helpers.ts'
import { groupTitle, OriginGlyph } from './LibraryView.tsx'
import type { SkillLibraryPageProps, Translate } from './SkillLibraryPage.tsx'
import css from './SkillLibrary.module.css'

/**
 * Localized Markdown chrome shared by the inspector and the editor preview.
 * @param t - copy lookup.
 * @returns code-block and footnote labels.
 */
export function useMarkdownLabels(t: Translate) {
  return useMemo(() => ({
    code: { copyLabel: t('mdCopy'), copiedLabel: t('mdCopied'), toolbarLabels: { codeLabel: t('mdCode'), wrapLabel: t('mdWrap'), unwrapLabel: t('mdUnwrap') } },
    footnotes: t('mdFootnotes'),
  }), [t])
}

/** Render the inspector for the selected skill. */
export function SkillInspector(props: SkillLibraryPageProps & {
  readonly state: SkillsState
  readonly skill: ManagedSkill | undefined
  readonly inspection: SkillInspection
}): ReactNode {
  const { t, state, skill, inspection, inspect, toggleSkill, resetSkill, openEdit, deleteSkill, customizeSkill, uninstallSkill } = props
  const [confirming, setConfirming] = useState<'delete' | 'uninstall' | undefined>()
  const labels = useMarkdownLabels(t)
  const origin = originOf(skill?.source ?? '')
  const project = state.inventory?.projects.find(entry => entry.root === state.projectRoot)
  const scoped = project !== undefined
  const pending = skill !== undefined && state.pendingSkills.includes(skill.name)
  const locked = state.inventory?.preferencesAvailable === false
  const document = inspection.document
  const editable = skill?.editable === true
  return (
    <article className={css.inspector} data-enabled={skill?.enabled === false ? 'false' : 'true'}>
      <button type="button" className={css.back} onClick={() => { inspect(undefined) }}>
        <IconChevronLeftOutlineRegular size={14} />
        {t('back')}
      </button>
      <header className={css.inspectorHead}>
        <div className={css.inspectorIdentity}>
          <p className={css.eyebrow} data-origin={origin}>
            <OriginGlyph origin={origin} size={13} />
            {origin === 'remote'
              ? t('originRemote', { source: groupTitle({ origin, sourceId: skill?.source.slice('remote:'.length) }, state.sources, t) })
              : origin === 'user' ? t('originUser') : origin === 'project' ? t('originProject') : t('originBuiltin')}
          </p>
          <h2 className={css.commandTitle}>
            <span className={css.commandSlashBig} aria-hidden="true">/</span>
            {inspection.name}
          </h2>
          {skill !== undefined && <p className={css.lede}>{skill.description}</p>}
        </div>
        {skill !== undefined && (
          <div className={css.power}>
            <span className={css.powerLabel} data-on={skill.enabled ? 'true' : undefined}>{skill.enabled ? t('statusOn') : t('statusOff')}</span>
            <Switch checked={skill.enabled} disabled={pending || locked} label={t('toggleSkill', { name: skill.name })} onChange={(enabled) => { toggleSkill(skill.name, enabled) }} />
          </div>
        )}
      </header>
      {skill !== undefined && (
        <div className={css.chips}>
          {skill.modelInvocable && <span className={css.chip}>{t('invocationAgent')}</span>}
          {skill.userInvocable && <span className={css.chip}>{t('invocationCommand', { name: skill.name })}</span>}
          {!skill.modelInvocable && !skill.userInvocable && <span className={css.chip}>{t('invocationHidden')}</span>}
          {scoped && skill.preference === 'project' && (
            <span className={css.chip} data-tone="project">
              {t('overrideTag', { project: project.title })}
              <button type="button" className={css.chipAction} disabled={pending || locked} onClick={() => { resetSkill(skill.name) }}>{t('overrideReset')}</button>
            </span>
          )}
          {scoped && skill.preference === 'global' && !skill.enabled && <span className={css.chip} data-tone="muted">{t('offEverywhere')}</span>}
        </div>
      )}
      {skill?.whenToUse !== undefined && (
        <section className={css.when}>
          <h3 className={css.sectionLabel}>{t('sectionWhen')}</h3>
          <p>{skill.whenToUse}</p>
        </section>
      )}
      <section className={css.instructions} aria-busy={inspection.loading}>
        <h3 className={css.sectionLabel}>{t('sectionInstructions')}</h3>
        {inspection.loading
          ? <p className={css.hint} role="status">{t('instructionsLoading')}</p>
          : inspection.error !== undefined
            ? <p className={css.errorText}>{t('instructionsError', { error: inspection.error })}</p>
            : document !== undefined && (
              <div className={css.document}>
                {document.skill.body.trim().length === 0
                  ? <span className={css.documentEmpty}><IconSkillOutlineRegular size={16} /></span>
                  : <MarkdownText text={document.skill.body} labels={labels} />}
              </div>
            )}
      </section>
      {document !== undefined && (
        <footer className={css.inspectorFoot}>
          {/* Left-to-right marks keep the path's slashes in place under the right-to-left truncation that shows its tail. */}
          <span className={css.filePath} title={document.path}>{`\u200E${document.path}\u200E`}</span>
          {skill !== undefined && confirming === undefined && (
            <span className={css.footActions}>
              {editable && <Button variant="outline" size="sm" icon={<IconEditOutlineRegular size={16} />} disabled={pending} onClick={() => { openEdit(inspection.name) }}>{t('edit')}</Button>}
              {skill.customizable && (
                <Button variant="outline" size="sm" icon={<IconCopyOutlineRegular size={16} />} disabled={pending} onClick={() => { customizeSkill(inspection.name) }}>{t('customize')}</Button>
              )}
              {skill.uninstallable && (
                <Button variant="ghost" size="sm" className={css.dangerGhost} icon={<IconTrashOutlineRegular size={16} />} disabled={pending} onClick={() => { setConfirming('uninstall') }}>{t('uninstall')}</Button>
              )}
              {skill.deletable && (
                <Button variant="ghost" size="sm" className={css.dangerGhost} icon={<IconTrashOutlineRegular size={16} />} disabled={pending} onClick={() => { setConfirming('delete') }}>{t('delete')}</Button>
              )}
            </span>
          )}
        </footer>
      )}
      {skill?.customizable === true && <p className={css.hint}>{t('customizeHint')}</p>}
      {confirming !== undefined && (
        <div className={css.confirm} role="alertdialog" aria-label={confirmText(t, confirming, inspection.name)}>
          <p>{confirmText(t, confirming, inspection.name)}</p>
          <span className={css.footActions}>
            <Button variant="ghost" size="sm" onClick={() => { setConfirming(undefined) }}>{t('deleteNo')}</Button>
            <Button
              variant="primary"
              size="sm"
              className={css.dangerSolid}
              onClick={() => {
                setConfirming(undefined)
                if (confirming === 'uninstall') uninstallSkill(inspection.name)
                else deleteSkill(inspection.name)
              }}
            >
              {confirming === 'uninstall' ? t('uninstall') : t('deleteYes')}
            </Button>
          </span>
        </div>
      )}
    </article>
  )
}

function confirmText(t: Translate, action: 'delete' | 'uninstall', name: string): string {
  return action === 'uninstall' ? t('uninstallConfirm', { name }) : t('deleteConfirm', { name })
}
