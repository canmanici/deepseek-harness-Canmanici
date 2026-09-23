/** DSH-embedded OpenDesign panel copy. */

/** Locale keys required by the panel and its sidebar row. */
export type OpenDesignLocaleKey = keyof typeof en

/** Simplified Chinese dictionary. */
export const zh = {
  panel: 'OpenDesign',
  title: 'OpenDesign Studio',
  intro: 'OpenDesign 在 DSH 管理的可选运行时中运行。',
  idle: '正在连接 DSH 管理的 OpenDesign 运行时…',
  downloading: '正在下载 OpenDesign 运行时…',
  verifying: '正在校验运行时完整性…',
  extracting: '正在安装运行时…',
  starting: '正在启动 Studio 和本地守护进程…',
  ready: 'OpenDesign Studio 已就绪',
  failed: 'OpenDesign 无法启动',
  retry: '重试',
  progress: '已下载 {downloaded}，共 {total}',
  indeterminate: '已下载 {downloaded}',
  bytes: '{count} 字节',
  kib: '{count} KiB',
  mib: '{count} MiB',
  safety: 'OpenDesign 工具通过本机守护进程访问项目文件。DSH 的工作区文件权限和沙箱不会限制这些操作。',
  localOnly: '嵌入式 Studio 目前仅支持从运行 DSH 的同一台电脑访问。',
  frameTitle: 'OpenDesign Studio 嵌入式界面',
} as const

/** English dictionary. */
export const en = {
  panel: 'OpenDesign',
  title: 'OpenDesign Studio',
  intro: 'OpenDesign runs in an optional runtime managed by DSH.',
  idle: 'Connecting to the DSH-managed OpenDesign runtime…',
  downloading: 'Downloading the OpenDesign runtime…',
  verifying: 'Verifying runtime integrity…',
  extracting: 'Installing the runtime…',
  starting: 'Starting Studio and its local daemon…',
  ready: 'OpenDesign Studio is ready',
  failed: 'OpenDesign could not start',
  retry: 'Retry',
  progress: '{downloaded} downloaded of {total}',
  indeterminate: '{downloaded} downloaded',
  bytes: '{count} B',
  kib: '{count} KiB',
  mib: '{count} MiB',
  safety: 'OpenDesign tools access project files through a local daemon. DSH workspace file permissions and sandboxing do not restrict those operations.',
  localOnly: 'The embedded Studio currently works only from the same computer running DSH.',
  frameTitle: 'Embedded OpenDesign Studio',
} as const
