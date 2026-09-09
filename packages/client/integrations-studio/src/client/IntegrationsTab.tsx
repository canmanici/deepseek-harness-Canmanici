/**
 * The My-Integrations tab: the deployed skill entries, verbatim from the
 * settings snapshot, each row with its deployment stamp and routing hint.
 */

import type { DeployedSkillEntry } from './studio-store.ts'
import css from './IntegrationsSection.module.css'

/** The Integrations tab's props: the deployed entries as the controller reads them. */
export interface IntegrationsTabProps {
  /** Locale-bound dictionary; unset fields render verbatim (model/wire data). */
  readonly t: (key: 'mcpGroup' | 'skillGroup' | 'questNothing' | 'remove' | 'removeConfirm') => string
  /** The deployed skill entries, in deployment order. */
  readonly skills: readonly DeployedSkillEntry[]
}

/** Render the My-Integrations tab.
 *  @param props - the tab's props.
 *  @returns the tab's rendered content, or the empty state when none are deployed. */
export function IntegrationsTab({ t, skills }: IntegrationsTabProps) {
  if (skills.length === 0) {
    return (
      <div className={css.emptyState}>
        <p className={css.emptyTitle}>{t('questNothing')}</p>
        <p className={css.emptyBody}>{t('mcpGroup')}</p>
      </div>
    )
  }
  return (
    <div className={css.rows}>
      <h3 className={css.groupLabel}>{t('skillGroup')}</h3>
      {skills.map(skill => (
        <div key={skill.name} className={css.rowCard}>
          <span className={css.rowName}>{skill.name}</span>
          <span className={css.rowHint}>{skill.whenToUse === '' ? '' : skill.whenToUse}</span>
          <span className={css.rowStamp}>{skill.deployedAt}</span>
        </div>
      ))}
    </div>
  )
}
