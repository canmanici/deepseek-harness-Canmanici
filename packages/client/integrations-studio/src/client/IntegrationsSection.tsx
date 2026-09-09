/**
 * Integrations settings section: hero header, one tab rail, and the active
 * tab's panel body.
 *
 * The section owns no child slot: everything below it is React state from the
 * section's own store, so its tabs' internals stay under the section's
 * ownership.
 */

import { useId } from 'react'
import clsx from 'clsx'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { IntegrationsStudioInjected, StudioTabId } from './studio-store.ts'
import { IntegrationsTab } from './IntegrationsTab.tsx'
import { MarketplaceTab } from './MarketplaceTab.tsx'
import css from './IntegrationsSection.module.css'

/** The section's props: the four shares, exactly as the slots discipline types them. */
export type IntegrationsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.integrations-studio'>
  & InjectFace<IntegrationsStudioInjected>

/** Ordered tab identities; the Marketplace is the resident default. */
const TAB_ORDER: readonly StudioTabId[] = ['marketplace', 'integrations', 'studio']

/** Render one tab's rail button. */
function TabButton(props: {
  readonly id: StudioTabId
  readonly label: string
  readonly active: boolean
  readonly onSelect: () => void
  readonly keydown: (event: React.KeyboardEvent) => void
}) {
  return (
    <button
      type='button'
      role='tab'
      data-tab={props.id}
      aria-selected={props.active}
      tabIndex={props.active ? 0 : -1}
      className={clsx(css.tab, props.active && css.tabActive)}
      onClick={props.onSelect}
      onKeyDown={props.keydown}
    >
      {props.label}
    </button>
  )
}

/** Render the Integrations section.
 *  @param props - the four props shares.
 *  @returns the section's rendered content. */
export function IntegrationsSection({ t, useStudio, actions }: IntegrationsSectionProps) {
  const view = useStudio(value => value)
  const tabsId = useId()

  function onRailKeydown(event: React.KeyboardEvent): void {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const rail = event.currentTarget.parentElement
    if (rail === null) return
    const buttons = Array.from(rail.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const index = buttons.findIndex(button => button.dataset.tab === view.tab)
    if (index === -1 || buttons.length === 0) return
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else next = buttons.length - 1
    const target = buttons[next] as HTMLButtonElement
    actions.setTab(String(target.dataset.tab) as StudioTabId)
    target.focus()
  }

  const tabsByTab: Record<StudioTabId, string> = {
    marketplace: t('tabMarketplace'),
    integrations: t('tabIntegrations'),
    studio: t('tabStudio'),
  }

  return (
    <div className={css.section}>
      <header className={css.hero}>
        <p className={css.eyebrow}>{t('nav')}</p>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.subtitle}>{t('intro')}</p>
      </header>
      <div className={css.rail} role='tablist' aria-label={t('tabs')}>
        {TAB_ORDER.map(id => (
          <TabButton
            key={id}
            id={id}
            label={tabsByTab[id]}
            active={id === view.tab}
            onSelect={() => { actions.setTab(id) }}
            keydown={onRailKeydown}
          />
        ))}
      </div>
      <div
        id={`${tabsId}-panel`}
        role='tabpanel'
        aria-labelledby={`${tabsId}-tab-${view.tab}`}
        className={css.panel}
      >
        {view.tab === 'marketplace'
          ? <MarketplaceTab t={t} query={view.query} kind={view.kind} category={view.category} />
          : <IntegrationsTab t={t} skills={view.skills} />}
      </div>
    </div>
  )
}
