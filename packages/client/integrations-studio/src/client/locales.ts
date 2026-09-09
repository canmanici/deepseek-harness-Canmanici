/**
 * Locale bundles for the Integrations settings section.
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Locale keys this section renders. */
export type IntegrationsStudioLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'tabMarketplace' | 'tabIntegrations' | 'tabStudio'
  | 'statsMcp' | 'statsSkills' | 'quickDeploy'
  | 'searchLabel' | 'searchPlaceholder' | 'searchHint' | 'clear' | 'resultsLine' | 'itemsLine'
  | 'kindAll' | 'kindMcp' | 'kindSkill' | 'catAll' | 'bestMatch'
  | 'install' | 'added' | 'addedHint' | 'emptyTitle' | 'emptyBody' | 'emptyClear' | 'loading'
  | 'docs' | 'sourcesTitle' | 'questNothing'
  | 'mcpGroup' | 'skillGroup' | 'originMarketplace' | 'originStudio'
  | 'statusActive' | 'statusConfigured' | 'statusReachable' | 'statusUnreachable'
  | 'statusChecking' | 'statusInactive' | 'statusUnknown'
  | 'enableAria' | 'remove' | 'removeConfirm' | 'check' | 'checking' | 'viewSource' | 'hideSource'
  | 'studioIntro' | 'fieldName' | 'nameHint' | 'fieldDescription' | 'descriptionHint'
  | 'fieldWhenToUse' | 'whenToUseHint' | 'fieldInstructions' | 'instructionsHint'
  | 'fieldTags' | 'tagsHint' | 'previewTitle' | 'issuesNone'
  | 'deploy' | 'deploying' | 'deployedToast' | 'example' | 'reset'
  | 'issueRequired' | 'issueFormat' | 'issueTooLong' | 'issueTooShort'
  | 'issueDuplicate' | 'issueShadow' | 'issueRegistryUnavailable'

/** English copy. */
export const en: Record<IntegrationsStudioLocaleKey, string> = {
  nav: 'Integrations',
  title: 'Skills & MCP Integrations',
  intro: 'Browse marketplaces, toggle integrations on demand, and author custom skills — all inside this session.',
  tabs: 'Integration studio sections',
  tabMarketplace: 'Marketplace',
  tabIntegrations: 'My Integrations',
  tabStudio: 'Skill Studio',
  statsMcp: 'MCP enabled',
  statsSkills: 'skills live',
  quickDeploy: 'Deploy a skill',
  searchLabel: 'Search the marketplaces',
  searchPlaceholder: 'Search servers and skills…',
  searchHint: 'press / to focus',
  clear: 'Clear',
  resultsLine: '"{query}" · {count} result(s)',
  itemsLine: '{count} items',
  kindAll: 'All',
  kindMcp: 'MCP Servers',
  kindSkill: 'Skills',
  catAll: 'All categories',
  bestMatch: 'best match',
  install: 'Add & enable',
  added: 'Added',
  addedHint: 'manage under My Integrations',
  emptyTitle: 'No results for "{query}"',
  emptyBody: 'Try shorter words, different terms, or one of these close matches:',
  emptyClear: 'Clear search & filters',
  loading: 'Loading marketplace…',
  docs: 'Docs',
  sourcesTitle: 'Integrated marketplace sources',
  questNothing: 'Nothing installed yet',
  mcpGroup: 'MCP servers',
  skillGroup: 'Skills',
  originMarketplace: 'marketplace',
  originStudio: 'authored',
  statusActive: 'Active',
  statusConfigured: 'Configured',
  statusReachable: 'Reachable',
  statusUnreachable: 'Unreachable',
  statusChecking: 'Checking…',
  statusInactive: 'Inactive',
  statusUnknown: 'Unknown',
  enableAria: 'Enable {name}',
  remove: 'Remove',
  removeConfirm: 'Confirm remove',
  check: 'Check connection',
  checking: 'Checking…',
  viewSource: 'View source',
  hideSource: 'Hide source',
  studioIntro: 'Compose a skill, watch it validate live, then deploy it into the session skill catalog.',
  fieldName: 'Name',
  nameHint: 'lowercase-with-dashes, e.g. standup-notes',
  fieldDescription: 'Description',
  descriptionHint: 'What it does — shown in skill catalogs (max 1024 chars).',
  fieldWhenToUse: 'When to use (optional)',
  whenToUseHint: 'Routing guidance for the agent deciding when to load this skill.',
  fieldInstructions: 'Instructions (Markdown)',
  instructionsHint: 'The skill body the model follows when the skill is loaded.',
  fieldTags: 'Tags (comma-separated, optional)',
  tagsHint: 'Up to 8 tags, e.g. writing, meetings',
  previewTitle: 'Deployed source (SKILL.md)',
  issuesNone: 'All checks pass.',
  deploy: 'Deploy skill',
  deploying: 'Deploying…',
  deployedToast: 'Deployed "{name}" — it is live in the session skill catalog.',
  example: 'Fill with an example',
  reset: 'Reset',
  issueRequired: 'This field is required.',
  issueFormat: 'Use lowercase letters, digits, and dashes only (e.g. standup-notes).',
  issueTooLong: 'Too long.',
  issueTooShort: 'Too short — write at least 10 characters.',
  issueDuplicate: 'A skill with this name is already deployed from this studio; deploying again updates it.',
  issueShadow: 'A skill named like this already exists from source "{source}" and will take precedence.',
  issueRegistryUnavailable: 'The skill registry is not mounted in this host composition; deployment is unavailable.',
}

/** Simplified Chinese copy. */
export const zh: Record<IntegrationsStudioLocaleKey, string> = {
  nav: '集成',
  title: '技能与 MCP 集成',
  intro: '浏览市场、按需开关集成、编写自定义技能——全部在本会话内完成。',
  tabs: '集成工作台分区',
  tabMarketplace: '市场',
  tabIntegrations: '我的集成',
  tabStudio: '技能工作台',
  statsMcp: 'MCP 已启用',
  statsSkills: '技能已上线',
  quickDeploy: '部署技能',
  searchLabel: '搜索市场',
  searchPlaceholder: '搜索服务器与技能…',
  searchHint: '按 / 聚焦',
  clear: '清除',
  resultsLine: '"{query}" · {count} 条结果',
  itemsLine: '{count} 项',
  kindAll: '全部',
  kindMcp: 'MCP 服务器',
  kindSkill: '技能',
  catAll: '全部分类',
  bestMatch: '最佳匹配',
  install: '添加并启用',
  added: '已添加',
  addedHint: '在"我的集成"中管理',
  emptyTitle: '未找到 "{query}" 的结果',
  emptyBody: '试试更短的词、其他关键词，或以下相近项：',
  emptyClear: '清除搜索与筛选',
  loading: '正在加载市场…',
  docs: '文档',
  sourcesTitle: '已接入的市场来源',
  questNothing: '尚未安装任何集成',
  mcpGroup: 'MCP 服务器',
  skillGroup: '技能',
  originMarketplace: '来自市场',
  originStudio: '自行编写',
  statusActive: '已启用',
  statusConfigured: '已配置',
  statusReachable: '可达',
  statusUnreachable: '不可达',
  statusChecking: '检查中…',
  statusInactive: '未启用',
  statusUnknown: '未知',
  enableAria: '启用 {name}',
  remove: '移除',
  removeConfirm: '确认移除',
  check: '检查连接',
  checking: '检查中…',
  viewSource: '查看源',
  hideSource: '隐藏源',
  studioIntro: '编写技能、实时校验，然后部署到会话技能目录。',
  fieldName: '名称',
  nameHint: '小写连字符，例如 standup-notes',
  fieldDescription: '描述',
  descriptionHint: '它做什么——显示在技能目录中（最多 1024 字符）。',
  fieldWhenToUse: '何时使用（可选）',
  whenToUseHint: '供 Agent 决定何时加载此技能的路由提示。',
  fieldInstructions: '指令（Markdown）',
  instructionsHint: '技能被加载时模型遵循的正文。',
  fieldTags: '标签（逗号分隔，可选）',
  tagsHint: '最多 8 个标签，例如 writing, meetings',
  previewTitle: '部署后的源（SKILL.md）',
  issuesNone: '全部校验通过。',
  deploy: '部署技能',
  deploying: '部署中…',
  deployedToast: '已部署 "{name}"——它已在会话技能目录上线。',
  example: '填入示例',
  reset: '重置',
  issueRequired: '此字段必填。',
  issueFormat: '仅可使用小写字母、数字和连字符（例如 standup-notes）。',
  issueTooLong: '过长。',
  issueTooShort: '过短——至少写 10 个字符。',
  issueDuplicate: '同名技能已从此工作台部署；再次部署会更新它。',
  issueShadow: '已有同名技能来自来源 "{source}"，将优先于本次部署。',
  issueRegistryUnavailable: '技能注册表未在此 Host 组合中挂载，无法部署。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Integrations section: marketplace, toggles, and studio copy. */
    'settings.integrations-studio': IntegrationsStudioLocaleKey
  }
}
