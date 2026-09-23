/** Shared model fields and actions for both adapter catalog editors. */

import type { ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import { ModelInputTypes } from './ModelInputTypes.tsx'
import { protocolLabel } from './protocol-label.ts'
import styles from './ModelsSection.module.css'

/** A capacity's editable text and adapter-specific inherited hint. */
interface CapacityInput {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBlur?: () => void
}

/**
 * Per-model protocol and endpoint, for an adapter whose models may speak
 * different ones. Absent values inherit: the route's, then the installed
 * catalog entry's.
 */
export interface ModelProtocolFields {
  /** Protocol this row names, or `undefined` to inherit. */
  api: string | undefined
  /** Every protocol the adapter accepts. */
  choices: readonly string[]
  /** Set or clear this row's protocol. */
  onApiChange: (api: string | undefined) => void
  /** Endpoint this row names, or `undefined` to inherit. */
  baseURL: string | undefined
  /** Set or clear this row's endpoint. */
  onBaseURLChange: (baseURL: string | undefined) => void
}

/** Adapter-owned data and actions for one model row. */
interface ModelRowProps {
  model: DeepSeekModelDraft
  position: number
  inputField: 'inputModalities' | 'input'
  inputFallback?: readonly string[] | undefined
  inputLoading?: boolean
  expanded: boolean
  disabled: boolean
  t: (key: ModelsKey) => string
  contextWindow: CapacityInput
  maxTokens: CapacityInput
  /** Present for adapters whose models may declare their own protocol and endpoint. */
  protocol?: ModelProtocolFields | undefined
  onFieldChange: (field: 'id' | 'name', value: string | undefined) => void
  onIdBlur?: (value: string) => void
  onChange: (model: DeepSeekModelDraft) => void
  onToggle: () => void
  onRemove: () => void
}

/**
 * Render consistent model identity, capacity, and input-type controls.
 * @param props - drafted fields and their owning editor's actions.
 * @returns one expandable model entry.
 */
export function ModelRow(props: ModelRowProps): ReactNode {
  const { model, position, t, disabled, protocol } = props
  return (
    <div className={styles['modelEntry']}>
      <div className={styles['modelRow']}>
        {(['id', 'name'] as const).map(field => (
          <input
            key={field}
            className={styles['input']}
            type="text"
            value={typeof model[field] === 'string' ? model[field] : ''}
            placeholder={t(field === 'id' ? 'modelId' : 'modelName')}
            aria-label={`${t(field === 'id' ? 'modelId' : 'modelName')} ${String(position)}`}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value
              props.onFieldChange(field, field === 'name' && value === '' ? undefined : value)
            }}
            onBlur={field === 'id' ? event => props.onIdBlur?.(event.target.value) : undefined}
          />
        ))}
        <button
          type="button"
          className={styles['iconButton']}
          aria-label={`${t('modelAdvanced')} ${String(position)}`}
          aria-expanded={props.expanded}
          title={t('modelAdvanced')}
          onClick={props.onToggle}
        >
          {props.expanded ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
        </button>
        <button
          type="button"
          className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
          aria-label={`${t('removeModel')} ${String(position)}`}
          title={t('removeModel')}
          disabled={disabled}
          onClick={props.onRemove}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
      </div>
      {props.expanded
        ? (
          <div className={styles['modelAdvanced']}>
            {protocol === undefined
              ? null
              : (
                <>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('customApi')}</span>
                    <select
                      className={`${styles['input']} ${styles['selectInput']}`}
                      value={protocol.api ?? ''}
                      aria-label={`${t('customApi')} ${String(position)}`}
                      disabled={disabled}
                      onChange={(event) => {
                        protocol.onApiChange(event.target.value === '' ? undefined : event.target.value)
                      }}
                    >
                      <option value="">{t('customApiUnset')}</option>
                      {protocol.choices.map(choice => (
                        <option key={choice} value={choice}>{protocolLabel(t, choice)}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('baseUrl')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      value={protocol.baseURL ?? ''}
                      placeholder={t('baseUrlDefault')}
                      aria-label={`${t('baseUrl')} ${String(position)}`}
                      disabled={disabled}
                      onChange={(event) => {
                        protocol.onBaseURLChange(event.target.value === '' ? undefined : event.target.value)
                      }}
                    />
                  </label>
                </>
              )}
            {(['contextWindow', 'maxTokens'] as const).map(field => (
              <label className={styles['modelField']} key={field}>
                <span className={styles['modelFieldLabel']}>{t(field)}</span>
                <input
                  className={styles['input']}
                  type="text"
                  inputMode="numeric"
                  value={props[field].value}
                  placeholder={props[field].placeholder}
                  aria-label={`${t(field)} ${String(position)}`}
                  disabled={disabled}
                  onChange={(event) => { props[field].onChange(event.target.value) }}
                  onBlur={props[field].onBlur}
                />
              </label>
            ))}
            <ModelInputTypes
              model={model} field={props.inputField} position={position}
              fallback={props.inputFallback} disabled={disabled || props.inputLoading === true} t={t} onChange={props.onChange}
            />
          </div>
        )
        : null}
    </div>
  )
}
