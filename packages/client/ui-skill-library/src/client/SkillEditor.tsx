/** Inline create-or-edit form for one user skill, shown in the inspector pane. */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, MarkdownText, SegmentedTabs, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillEditor as SkillEditorState } from './controller.ts'
import { SKILL_NAME } from './helpers.ts'
import { useMarkdownLabels } from './SkillInspector.tsx'
import type { SkillLibraryPageProps } from './SkillLibraryPage.tsx'
import css from './SkillLibrary.module.css'

type View = 'write' | 'preview'

/** Render the editor for the controller's open draft. */
export function SkillEditor(props: SkillLibraryPageProps & { readonly editor: SkillEditorState }): ReactNode {
  const { t, editor, closeEditor, editDraft, saveEditor } = props
  const ids = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [view, setView] = useState<View>('write')
  const labels = useMarkdownLabels(t)
  const { draft, mode, busy, loading } = editor
  const creating = mode === 'create'
  useEffect(() => {
    if (creating) nameRef.current?.focus()
    else if (!loading) bodyRef.current?.focus()
  }, [creating, loading])
  const name = draft.name.trim()
  const nameValid = SKILL_NAME.test(name)
  const nameError = name.length > 0 && !nameValid
  const canSave = nameValid && draft.description.trim().length > 0 && !busy && !loading
  const locked = busy || loading
  return (
    <form
      className={css.editor}
      aria-labelledby={`${ids}-title`}
      aria-busy={loading}
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) saveEditor()
      }}
    >
      <header className={css.editorHead}>
        <div>
          <h2 id={`${ids}-title`} className={css.editorTitle}>{creating ? t('editorCreateTitle') : t('editorEditTitle', { name: draft.name })}</h2>
          {creating && <p className={css.editorNote}>{t('editorDescription')}</p>}
        </div>
        <div className={css.footActions}>
          <Button variant="ghost" disabled={busy} onClick={closeEditor}>{t('editorCancel')}</Button>
          <Button variant="primary" type="submit" disabled={!canSave}>
            {busy ? t('editorSaving') : creating ? t('editorCreate') : t('editorSave')}
          </Button>
        </div>
      </header>
      {loading && <p className={css.hint} role="status">{t('editorLoading')}</p>}
      <div className={css.nameBlock} data-invalid={nameError ? 'true' : undefined} data-readonly={creating ? undefined : 'true'}>
        <label className={css.nameLabel} htmlFor={`${ids}-name`} id={`${ids}-name-label`}>{t('fieldName')}</label>
        <div className={css.nameField}>
          <span className={css.commandSlashBig} aria-hidden="true">/</span>
          <input
            id={`${ids}-name`}
            ref={nameRef}
            className={css.nameInput}
            value={draft.name}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            readOnly={!creating}
            disabled={locked}
            aria-invalid={nameError}
            aria-labelledby={`${ids}-name-label`}
            aria-describedby={`${ids}-name-hint`}
            onChange={(event) => { editDraft({ name: event.target.value.toLowerCase().replace(/\s+/g, '-') }) }}
          />
        </div>
        <span id={`${ids}-name-hint`} className={nameError ? css.fieldError : css.fieldHint}>
          {nameError ? t('fieldNameInvalid') : nameValid ? t('fieldNameInvoke', { name }) : t('fieldNameHint')}
        </span>
      </div>
      <div className={css.fieldGrid}>
        <label className={css.field}>
          <span className={css.fieldLabel} id={`${ids}-description-label`}>{t('fieldDescription')}</span>
          <textarea
            className={css.textArea}
            rows={3}
            value={draft.description}
            disabled={locked}
            aria-labelledby={`${ids}-description-label`}
            aria-describedby={`${ids}-description-hint`}
            onChange={(event) => { editDraft({ description: event.target.value }) }}
          />
          <span id={`${ids}-description-hint`} className={css.fieldHint}>{t('fieldDescriptionHint')}</span>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel} id={`${ids}-when-label`}>{t('fieldWhenToUse')}</span>
          <textarea
            className={css.textArea}
            rows={3}
            value={draft.whenToUse ?? ''}
            placeholder={t('fieldWhenToUsePlaceholder')}
            disabled={locked}
            aria-labelledby={`${ids}-when-label`}
            onChange={(event) => { editDraft({ whenToUse: event.target.value }) }}
          />
        </label>
      </div>
      <div className={css.field}>
        <div className={css.instructionsHead}>
          <span className={css.fieldLabel} id={`${ids}-instructions`}>{t('fieldInstructions')}</span>
          <SegmentedTabs<View>
            className={css.viewTabs}
            label={t('editorTabs')}
            value={view}
            onChange={setView}
            items={[
              { value: 'write', label: t('editorWrite'), id: `${ids}-write`, panelId: `${ids}-write-panel` },
              { value: 'preview', label: t('editorPreview'), id: `${ids}-preview`, panelId: `${ids}-preview-panel` },
            ]}
          />
        </div>
        <div id={`${ids}-write-panel`} role="tabpanel" aria-labelledby={`${ids}-write`} hidden={view !== 'write'}>
          <textarea
            ref={bodyRef}
            className={css.bodyArea}
            value={draft.body}
            spellCheck={false}
            placeholder={t('fieldInstructionsPlaceholder')}
            aria-labelledby={`${ids}-instructions`}
            disabled={locked}
            onChange={(event) => { editDraft({ body: event.target.value }) }}
          />
        </div>
        <div id={`${ids}-preview-panel`} role="tabpanel" aria-labelledby={`${ids}-preview`} hidden={view !== 'preview'} className={css.document}>
          {draft.body.trim().length === 0
            ? <p className={css.hint}>{t('editorPreviewEmpty')}</p>
            : <MarkdownText text={draft.body} labels={labels} />}
        </div>
      </div>
      <div className={css.toggles}>
        <div className={css.toggle}>
          <span className={css.toggleText}>
            <span className={css.toggleTitle}>{t('editorModel')}</span>
            <span className={css.fieldHint}>{t('editorModelHint')}</span>
          </span>
          <Switch checked={draft.modelInvocable} disabled={locked} label={t('editorModel')} onChange={(value) => { editDraft({ modelInvocable: value }) }} />
        </div>
        <div className={css.toggle}>
          <span className={css.toggleText}>
            <span className={css.toggleTitle}>{t('editorCommand')}</span>
            <span className={css.fieldHint}>{t('editorCommandHint')}</span>
          </span>
          <Switch checked={draft.userInvocable} disabled={locked} label={t('editorCommand')} onChange={(value) => { editDraft({ userInvocable: value }) }} />
        </div>
      </div>
      {editor.error !== undefined && <p className={css.errorText} role="alert">{editor.error}</p>}
    </form>
  )
}
