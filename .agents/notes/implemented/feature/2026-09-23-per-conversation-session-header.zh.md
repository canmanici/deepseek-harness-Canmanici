# Agent Note: pi-ai 路由的按会话标头

Status: implemented

[English](2026-09-23-per-conversation-session-header.md) | 中文

## Problem

自 2026-09-05 起，OpenCode Go 会拒绝每个不带稳定按会话 id 标头（`x-opencode-session`）的推理请求，其运营方[请求本仓库](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)从每个适配器发送该标头。直接 DeepSeek 适配器已在两种协议上发送其原生 `x-deepseek-harness-session-id`，该网关也识别它；而 pi-ai 适配器什么都不发，因此每条 `opencode-go` 路由都返回 `400 MissingSessionID`——目录模型也不例外。配置层唯一的变通办法是静态 `headers` 条目，它能满足网关，却把每个会话坍缩进同一个亲和桶：讨论中两个部署报告采用后回合变慢、成本上升，因为网关无法再让每个会话的提示缓存保持热态。

## Decision

`PiAiProviderProfile.sessionHeader` 点名携带请求会话 id 的标头，`PiAiAdapter` 在唯一的 `streamSimple` 调用点把 `String(options.sessionId)` 写入其中。由于该调用点掌管每种协议格式的请求标头，两类路由——复用 pi-ai 提供方的目录路由与本包从协议表构建的路由——都会携带该标头，这正是此处"在所有适配器上发送"的含义。辅助调用（会话标题、压缩摘要）经同一选项传入同一会话 id，因此呈现同一身份。

对点名了会话 id 的请求，同名 `headers` 条目会被替换，因为固定值无法胜任按会话的 id；对不点名会话 id 的请求，它仍然生效，因此网关要求该标头的部署在 harness 无会话可点名时仍可路由。Harness 归属标头保留其保留名称；解析会拒绝空标头名或 Fetch 无法表示的标头名。

## Alternatives considered

**依赖 pi-ai 的 `sendSessionAffinityHeaders` 兼容开关。** 其格式写入 `x-session-id`（openrouter）或 `session_id`、`x-client-request-id`、`x-session-affinity`（openai）——其中没有 `x-opencode-session`——而本包的兼容门把两个开关都列为保留，部署无法开启。它需要上游新增一种亲和格式才能帮到该网关。

**升级 pi-ai，让它自己的提供方包装发送该标头。** pi-ai 0.87.1 包装其 `opencode` 与 `opencode-go` API 实现，使 `sessionId` 成为 `x-opencode-session`。这覆盖复用目录提供方的目录路由（常见情形），但不覆盖手工声明的路由或用 `api:` 改指的路由——两者都由本包的协议表构建。版本钉住、补丁重新应用与目录漂移是另一项独立改动；本字段现在就覆盖所有路由类型。

**从每条 pi-ai 路由发送直接适配器的原生 `x-deepseek-harness-session-id`。** 该网关接受它，因此可行且与直接适配器一致。但它也把 harness 身份发给部署配置的每个第三方提供方，这比点名网关真正需要的标头披露更广；`sessionHeader` 把该决定留给路由。

**为不点名会话 id 的请求生成新的 UUID。** 它无需配置即可满足标头要求，但它不是会话 id：路由与缓存得不到静态回退尚未提供的任何东西，而且同一会话各回合之间的值会不同。

## Consequences

配置 `sessionHeader: x-opencode-session` 的 `opencode-go` 路由恢复可用并具备按会话亲和，已在 `openai-completions` 与 `openai-responses` 路由上对真实网关验证。该字段与提供方无关：任何按会话路由的网关都可以点名自己的标头。既未配置该字段也未配置静态条目的路由不发送会话标头，这对不要求它的提供方是正确姿态，而对要求它的网关则是部署在首个请求就会看到的拒绝。

发现探测不变：模型列表不是会话，且各网关的列表端点在无该标头时也会应答。

验证：`tests/adapter.spec.ts` 覆盖由请求会话 id 写入的标头、不点名会话 id 时的静态回退、未配置该字段的路由、归属标头在与会话标头同名时获胜，以及空标头名或无法表示标头名的拒绝。
