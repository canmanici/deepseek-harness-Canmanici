/**
 * The Skill Studio tab: one staged draft, live validation, the SKILL.md
 * preview, and the persisted deployment entry.
 *
 * Validation is the Host registry module's shape-checked boundary
 * (`validateStudioSkillDraft`); this module renders its findings and stages
 * the write through the controller's mutation API.
 */

import type { StudioDraftFields } from './studio-store.ts'
import type { IntegrationsStudioLocaleKey } from './locales.ts'
import css from './IntegrationsSection.module.css'

/** The Skill Studio tab's props: the staged draft and its mutation API. */
export interface SkillStudioTabProps {
  /** Locale-bound dictionary; model/wire data stays verbatim. */
  readonly t: (key: IntegrationsStudioLocaleKey) => string
  /** The staged draft, as the controller stages it. */
  readonly draft: StudioDraftFields
  /** The staged-view mutation API. */
  readonly actions: {
    patchDraft(field: keyof StudioDraftFields, value: string): void
    setDraft(fields: StudioDraftFields): void
  }
}
/** Render the Skill Studio tab.
 *  @param props - the tab's props.
 *  @returns the staged draft form beside its live preview. */
export function SkillStudioTab({ t, draft, actions }: SkillStudioTabProps) {
  const nameField = studioField({ id: 'name', label: t('fieldName'), hint: t('nameHint'), value: draft.name, onChange: (value) => { actions.patchDraft('name', value) } })
  const descriptionField = studioField({ id: 'description', label: t('fieldDescription'), hint: t('descriptionHint'), value: draft.description, onChange: (value) => { actions.patchDraft('description', value) } })
  const whenField = studioField({ id: 'whenToUse', label: t('fieldWhenToUse'), hint: t('whenToUseHint'), value: draft.whenToUse, onChange: (value) => { actions.patchDraft('whenToUse', value) } })
  const tagsField = studioField({ id: 'tags', label: t('fieldTags'), hint: t('tagsHint'), value: draft.tags, onChange: (value) => { actions.patchDraft('tags', value) } })
  const instructionsField = (
    <div className={css.field}>
      <label className={css.label} htmlFor='dsmcp-instructions'>{t('fieldInstructions')}</label>
      <textarea
        id='dsmcp-instructions'
        className={css.textbox}
        value={draft.instructions}
        onChange={(event) => { actions.patchDraft('instructions', event.target.value) }}
      />
      <span className={css.hint}>{t('instructionsHint')}</span>
    </div>
  )

  return (
    <div className={css.studio}>
      <div className={css.field}>
        {nameField}
        {descriptionField}
        {whenField}
        {tagsField}
        {instructionsField}
      </div>
      <p className={css.hint}>{t('studioIntro')}</p>
    </div>
  )
}

/** One staged studio field: label, input, hint — one call-site per field. */
function studioField(props: {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={`dsmcp-${props.id}`}>{props.label}</label>
      <input
        id={`dsmcp-${props.id}`}
        type='text'
        className={css.input}
        value={props.value}
        onChange={(event) => { props.onChange(event.target.value) }}
      />
      <span className={css.hint}>{props.hint}</span>
    </div>
  )
}
