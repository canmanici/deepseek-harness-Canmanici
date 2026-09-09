# Agent Note: Web 设置插件列表条目切换

Status: implemented

[English](2026-09-09-plugin-inventory-entry-toggle.md) | 中文

## Problem

设置 → 插件的「插件列表」标签页（`@deepseek-ai/dsh-client-ui-settings-plugin-inventory`）此前是只读投影：操作者能看到哪些 Loader 条目已启用，但修改启用状态必须编辑补丁文件或使用 CLI。宿主新增了 `pluginInventory/setEntryEnabled` 与快照 `writable` 标志；客户端需要一个逐条目的切换交互，且必须对部署安全——停用可能破坏部署，只读部署则完全不应显示操作。

## Decision

标签页展开的卡片携带 Enable/Disable 操作，由三层保护：

- **停用前确认。** Disable 按钮变为卡片内渲染的 Confirm disable/Cancel 按钮对；启用无需确认。写入进行中时卡片播报进度（`role="status"`）并禁用其控件；失败在卡片内以 `role="alert"` 与 Retry 控件呈现——宿主报告条目未实时生效时还会点名缺失的服务；提交成功的切换会重新读取快照、保持卡片展开，并显示一行生效提示（按快照的 `live` 标志区分实时或重启）。
- **在做出决策的操作中强制可写性门控。** 浏览器 apply 闭包从其 `list()` 结果跟踪最后已知快照的可写性（`src/client/toggle-gate.ts`），并拒绝任何在可写快照被观察到之前发出的 `setEnabled` 调用；当 `snapshot.writable === false` 时，组件不渲染操作按钮并显示本地化拥有的只读提示。
- **事务性 live 启用，不自动处理依赖。** live 启用会等待树进入 `active`，超时则还原文件（`plugin-entry-not-applied`，`details.missingServices` 列出没有运行中条目提供的注入服务）；停用与冻结 profile 保持只写。启用目标不会连带启用其提供方条目：已停用行不存在可靠的服务→条目映射，自动启用会不可预测地级联——因此操作以确切缺失项大声失败，而不是猜测。服务冲突（启用启动器仅监视回退实例已提供的服务的行，如 `hmr`）同样报告失败并还原，而不是谎报成功。
- **生效提示按快照的 `live` 标志分支。** `PluginInventorySnapshot` 携带 `writable` 与 `live`（启动器的补丁监视状态）；切换成功后，`live` 为真时卡片显示「已实时生效」，否则显示「应用重启后生效」。

不变量伴生程序保持有解释的空实现：可写性关系存在于浏览器树中，node 侧伴生程序在生产中无法观察。其理由已重写（旧的「只读贡献」理由不再为真），`tests/invariant.client.spec.ts` 现在通过共享门控模块演练两条拒绝分支。

## Alternatives considered

### 用共享 `RiskConfirmation` 对话框做停用确认

该原语对话框把主操作门控在复选框确认之后——对单次切换而言比两步按钮对更重，每张卡片多一次模态焦点往返，还要向卡片传六个 label 属性。内联按钮对把焦点留在卡片内（焦点返回操作按钮），只需两个文案，也是本需求明确许可的方案。若未来的切换需要确认级别的重量，共享原语仍在。

### 围绕切换关系建一个真实的 node 侧不变量伴生程序

门控状态唯一的生产宿主是浏览器 apply 闭包；不变量注册表只挂在 node Loader 树中，任何伴生检查都会沦为固定纯示例——正是包不变量规则禁止的。在操作中强制执行加上规格演练两条分支，才是诚实的分工。

### 在保存失败状态中展示宿主失败 code/message

该方案对一种情况已被取代：通用失败仍隐藏传输细节（通用 `saveFailed` 文案），但携带已点名缺失服务的 `plugin-entry-not-applied` 拒绝会渲染自己本地化拥有的提示（`notAppliedNeeds` 加服务列表），因为「先启用 X」正是该失败的可操作内容——隐藏它只会把操作者赶去服务器日志里找 UI 早已知晓的东西。抛出的错误仍携带 `code`/`details` 供日志与测试使用。

## Consequences

- 从 Web UI 停用插件现在需要两次刻意点击，只读部署也能渲染目录而不提供无法生效的操作。
- `setEnabled` 直接调用生成的 `pluginInventory/setEntryEnabled` Remote face；inject face 贯穿宿主的品牌化 `PluginEntryId`（经 `api-remotes/client` 再导出），因此不存在转换。
- 不变量伴生规则仍由理由为真的有解释空实现满足；门控模块由不变量规格覆盖到 100%，移除门控会触发覆盖率失败，而不是留下未强制的承诺。

## Testing

`tests/components.client.spec.tsx` 覆盖启用流程、确认/取消、保存中、失败+重试、只读渲染、切换后重新读取失败、缺失服务提示与畸形拒绝；`tests/browser-plugin.client.spec.tsx` 通过伪 Remote 驱动 inject face，包括两次门控拒绝与失败 code/details 传递；`tests/invariant.client.spec.ts` 演练门控模块分支。宿主 `tests/inventory.spec.ts` 覆盖事务性启用（live 成功、超时还原新增与已有行、激活拒绝、目录丢失时的还原失败、树退出、冻结跳过），以及一个代替启动器监视的种子应用驱动。逐文件覆盖率保持 100%。
