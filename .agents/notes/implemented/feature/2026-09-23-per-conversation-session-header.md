# Agent Note: Per-conversation session header for pi-ai routes

Status: implemented

English | [中文](2026-09-23-per-conversation-session-header.zh.md)

## Problem

OpenCode Go refuses every inference request without a stable per-conversation session id header (`x-opencode-session`) since 2026-09-05, and its operator [asked this repository](https://github.com/deepseek-ai/deepseek-harness/discussions/5495) to send one from every adapter. The direct DeepSeek adapter already sends its native `x-deepseek-harness-session-id` on both protocols, and that gateway recognizes it; the pi-ai adapter sends nothing, so every `opencode-go` route answered `400 MissingSessionID` — catalog models included. The only configuration-level workaround was a static `headers` entry, which satisfies the gateway but collapses every conversation into one affinity bucket: two deployments in the discussion reported slower turns and higher cost after adopting it, because the gateway can no longer keep each conversation's prompt cache warm.

## Decision

`PiAiProviderProfile.sessionHeader` names the header that carries the request's conversation id, and `PiAiAdapter` writes `String(options.sessionId)` into it at the single `streamSimple` call site. Because that site owns the request headers for every wire protocol, both route kinds — a catalog route reusing pi-ai's provider and a route this package builds from its protocol table — carry the header, which is what "send it across all adapters" means here. Auxiliary calls (session titles, compaction summaries) pass the same conversation id through the same options, so they present the same identity.

A same-named `headers` entry is replaced for a request that names a session id, because a fixed value cannot do a per-conversation id's job; it still applies to a request that names none, so a deployment whose gateway requires the header stays routable where the harness has no conversation to name. Harness attribution keeps reserved names, and resolution refuses an empty or Fetch-unrepresentable header name.

## Alternatives considered

**Rely on pi-ai's `sendSessionAffinityHeaders` compat.** Its formats write `x-session-id` (openrouter) or `session_id`, `x-client-request-id`, and `x-session-affinity` (openai) — none of which is `x-opencode-session` — and this package's compat gates withhold both switches, so a deployment could not turn it on. It needs an upstream affinity format before it can help this gateway.

**Upgrade pi-ai and let its own provider wrapper send the header.** pi-ai 0.87.1 wraps its `opencode` and `opencode-go` API implementations so `sessionId` becomes `x-opencode-session`. That covers catalog routes that reuse the catalog provider, which is the common case, but not a declared route or a route repointed with `api:` — both are built from this package's protocol table. The pin, the patch re-application, and the catalog drift are a separate change; this field covers every route kind now.

**Send the direct adapter's native `x-deepseek-harness-session-id` from every pi-ai route.** The gateway accepts it, so this would work and would match the direct adapter. It also sends a harness identity to every third-party provider a deployment configures, which is a wider disclosure than naming the header a gateway actually requires; `sessionHeader` keeps that decision with the route.

**Generate a fresh UUID for a request that names no session id.** It satisfies the header requirement without configuration, but it is not a conversation id: routing and caching gain nothing a static fallback does not already provide, and the value would differ between the turns of one conversation.

## Consequences

An `opencode-go` route with `sessionHeader: x-opencode-session` works again with per-conversation affinity, verified against the live gateway on `openai-completions` and `openai-responses` routes. The field is provider-agnostic: any gateway that routes by conversation names its own header. A route that configures neither the field nor a static entry sends no session header, which is the correct posture for a provider that asks for none and a refusal the deployment sees on the first request from a gateway that requires one.

Discovery probes are unchanged: a model listing is not a conversation, and the gateways' listing endpoints answer without the header.

Verification: `tests/adapter.spec.ts` covers the header written from the request session id, the static fallback for a request naming none, the route that configures none, attribution winning a colliding name, and the refusals for an empty or unrepresentable header name.
