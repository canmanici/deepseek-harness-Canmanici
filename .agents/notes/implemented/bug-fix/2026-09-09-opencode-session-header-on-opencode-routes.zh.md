# Agent Note: x-opencode-session on OpenCode routes

Status: implemented

[English](2026-09-09-opencode-session-header-on-opencode-routes.md) | 中文

## Problem

OpenCode Go 要求每个请求在 `x-opencode-session` 中携带稳定的每会话 id，用于路由与提示缓存，缺失该标头的请求会被错误拒绝（`MissingSessionID`）。`dsh-llm-pi-ai` 只把循环的会话 id 作为 pi-ai 的 `sessionId` 选项透传，而 pi-ai 仅在模型的 compat 启用 `sendSessionAffinityHeaders` 时才将其映射为 `x-session-affinity`／`x-session-id` 标头——已安装的 OpenCode 与 OpenCode Go 模型均未启用该开关，且已安装的 pi-ai 根本不知道 `x-opencode-session` 标头。因此 OpenCode Go 在 completions 与 anthropic-messages 两条路径上收不到任何会话信息（responses 路径携带 pi-ai 自有的会话标头，Go 可以识别），这类请求会被拒绝。

## Decision

`packages/llm/llm-pi-ai/src/adapter.ts` 中的 `PiAiAdapter` 为路由是 `opencode`／`opencode-go`、或解析后端点包含 `opencode.ai/zen` 的请求，从循环写入的 `GenerateOptions.sessionId` 派生 `x-opencode-session` 默认值，并将其合并在 profile `headers` 之下，使部署显式配置的值仍然获胜；Harness 归因标头按[强制应用归因标头](../architecture/2026-06-21-mandatory-app-attribution-headers.zh.md)在两者之上继续赢得保留名称。这是对[按提供方路由的适配器](../architecture/2026-07-14-provider-routed-llm-adapters.zh.md)决策所拥有的标头合并的扩展。该标头搭载 pi-ai 的单请求 `headers` 选项，而每个传输层最后合并的正是该选项，因此 completions、anthropic-messages、responses 三条路径都会携带它。没有会话 id 的请求不发送任何内容，非 OpenCode 路由不受影响。不发送任何客户端伪装标头：Harness 仍只用自己的 `User-Agent` 表明身份。

## Testing

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 用本地 HTTP 服务器锁定线上传输行为：opencode-go completions 发送会话 id 且流式传输正常、无会话时省略、部署覆盖值获胜、其余两条传输路径（anthropic-messages、responses）均发送该标头、而 `deepseek` 路由在同一会话 id 下不发送它。

## Alternatives considered

**把 `@earendil-works/pi-ai` 升级到 0.84 之后。** 已拒绝：0.85.1 仍只把 `sessionId` 映射为 `x-session-affinity`／`x-session-id`，不知道 `x-opencode-session`，升级无法提供所需的标头。

**在路由上启用 pi-ai 的 `sendSessionAffinityHeaders` compat。** 已拒绝：这些开关被刻意对 profile 隐藏，即使启用，发出的是 pi-ai 的亲和性词汇，而非 Go 要求的 `x-opencode-session` 名称。

**在会话标头旁再发送 `x-opencode-client`。** 已拒绝：Go 要求客户端用自己的 `User-Agent` 表明身份，强制的 Harness 归因已经做到了；额外的客户端标头对路由没有价值，反而有被视为 CLI 伪装的风险。

**经 profile `headers` 设置静态的按安装标头。** 已拒绝：它把所有会话钉到同一个 id，破坏按会话路由与缓存；需要它的部署仍可将其作为显式覆盖使用。

## Consequences

OpenCode Zen 与 Go 请求在三条传输路径上都携带稳定的每会话 id，恢复 Go 路由与提示缓存。已在 profile headers 中固定 `x-opencode-session` 的部署不受影响。适配器现在拥有一个提供方名称检查（`opencode`、`opencode-go`，外加面向指向 Zen 的手工声明路由的目录端点子串），pi-ai 原生发送该标头之日它即多余。
