/** Add-server dialog: a local command or a remote URL, filled by hand or from a registry server. */

import { useId, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconPlusOutlineRegular, IconWarningOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerForm } from './controller.ts'
import { kindLabel } from './DiscoverView.tsx'
import type { McpPageProps } from './McpPage.tsx'
import css from './McpLibrary.module.css'

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Render the dialog for the controller's open form. */
export function ServerFormDialog(props: McpPageProps & { readonly form: ServerForm }): ReactNode {
  const { t, form, closeForm, submitForm, editForm, editVariable, addVariable, removeVariable, selectOption } = props
  const ids = useId()
  if (!form.open) return null
  const local = form.transport === 'stdio'
  const nameValid = SERVER_NAME.test(form.serverName.trim())
  const missing = form.variables.some(variable => variable.required && variable.value.trim() === '')
  const canSubmit = nameValid && !missing && !form.busy && (local ? form.command.trim() !== '' : form.url.trim() !== '')
  const registry = form.registry
  return (
    <Modal
      open
      onClose={closeForm}
      title={registry === undefined ? t('formAddTitle') : t('formConnectTitle', { name: registry.server.title ?? registry.server.suggestedName })}
      closeLabel={t('close')}
      description={t('formDescription')}
      className={css.dialog as string}
      footer={(
        <div className={css.actions}>
          <Button variant="ghost" disabled={form.busy} onClick={closeForm}>{t('formCancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submitForm}>{form.busy ? t('formBusy') : t('formSubmit')}</Button>
        </div>
      )}
    >
      <form
        className={css.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) submitForm()
        }}
      >
        {registry !== undefined && registry.server.options.length > 1 && (
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('fieldOption')}</span>
            <div className={css.segment} role="group" aria-label={t('fieldOption')}>
              {registry.server.options.map((option, index) => (
                <button key={`${option.kind}-${String(index)}`} type="button" className={css.segmentButton} aria-pressed={registry.option === index} onClick={() => { selectOption(index) }}>
                  {kindLabel(option.kind, t)}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('fieldName')}</span>
          <input className={css.textInput} value={form.serverName} spellCheck={false} autoComplete="off" disabled={form.busy} aria-invalid={form.serverName !== '' && !nameValid} onChange={(event) => { editForm({ serverName: event.target.value }) }} />
          <span className={css.fieldHint}>{t('fieldNameHint')}</span>
        </label>
        {registry === undefined && (
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('fieldTransport')}</span>
            <div className={css.segment} role="group" aria-label={t('fieldTransport')}>
              <button type="button" className={css.segmentButton} aria-pressed={local} onClick={() => { editForm({ transport: 'stdio' }) }}>{t('transportLocal')}</button>
              <button type="button" className={css.segmentButton} aria-pressed={!local} onClick={() => { editForm({ transport: 'streamable-http' }) }}>{t('transportRemote')}</button>
            </div>
          </div>
        )}
        {local
          ? (
            <>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('fieldCommand')}</span>
                <input className={css.textInput} value={form.command} placeholder={t('fieldCommandPlaceholder')} spellCheck={false} disabled={form.busy} onChange={(event) => { editForm({ command: event.target.value }) }} />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('fieldArgs')}</span>
                <textarea
                  className={css.textArea}
                  rows={3}
                  value={form.args}
                  spellCheck={false}
                  disabled={form.busy}
                  onChange={(event) => { editForm({ args: event.target.value }) }}
                />
                <span className={css.fieldHint}>{t('fieldArgsHint')}</span>
              </label>
            </>
          )
          : (
            <label className={css.field}>
              <span className={css.fieldLabel}>{t('fieldUrl')}</span>
              <input className={css.textInput} type="url" value={form.url} placeholder={t('fieldUrlPlaceholder')} spellCheck={false} disabled={form.busy} onChange={(event) => { editForm({ url: event.target.value }) }} />
            </label>
          )}
        <div className={css.field}>
          <span className={css.fieldLabel} id={`${ids}-variables`}>{local ? t('fieldEnv') : t('fieldHeaders')}</span>
          <ul className={css.variables} aria-labelledby={`${ids}-variables`}>
            {form.variables.map((variable, index) => (
              <li key={index} className={css.variable}>
                <input className={css.textInput} value={variable.name} placeholder={t('variableName')} aria-label={t('variableName')} spellCheck={false} disabled={form.busy} onChange={(event) => { editVariable(index, { name: event.target.value }) }} />
                <input
                  className={css.textInput}
                  type={variable.secret ? 'password' : 'text'}
                  value={variable.value}
                  placeholder={variable.placeholder ?? (variable.required ? t('variableRequired') : t('variableValue'))}
                  aria-label={`${variable.name || t('variableName')} ${t('variableValue')}`}
                  aria-invalid={variable.required && variable.value.trim() === ''}
                  title={variable.description}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={form.busy}
                  onChange={(event) => { editVariable(index, { value: event.target.value }) }}
                />
                <button type="button" className={css.iconButton} aria-label={t('variableRemove', { name: variable.name })} disabled={form.busy} onClick={() => { removeVariable(index) }}>
                  <IconCloseOutlineRegular size={14} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular size={14} />} disabled={form.busy} onClick={addVariable}>{t('variableAdd')}</Button>
        </div>
        {form.error !== undefined && <p className={css.errorText} role="alert">{form.error}</p>}
        <p className={css.trust}><IconWarningOutlineRegular size={16} />{t('formTrust')}</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
