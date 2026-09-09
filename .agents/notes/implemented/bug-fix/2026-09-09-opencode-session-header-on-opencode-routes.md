# Agent Note: x-opencode-session on OpenCode routes

Status: implemented

English | [中文](2026-09-09-opencode-session-header-on-opencode-routes.zh.md)

## Problem

OpenCode Go requires every request to carry a stable per-conversation id in `x-opencode-session` for routing and prompt caching, and errors requests that omit it (`MissingSessionID`). `dsh-llm-pi-ai` forwarded the loop's session id only as pi-ai's `sessionId` option, which pi-ai maps to `x-session-affinity`/`x-session-id` headers solely when a model's compat enables `sendSessionAffinityHeaders` — no installed OpenCode or OpenCode Go model enables it, and the installed pi-ai knows no `x-opencode-session` header at all. OpenCode Go therefore received no session information on the completions and anthropic-messages paths (the responses path carries pi-ai's own session headers, which Go recognizes), and rejects those requests.

## Decision

`PiAiAdapter` in `packages/llm/llm-pi-ai/src/adapter.ts` derives an `x-opencode-session` default from the loop-stamped `GenerateOptions.sessionId` for requests whose route is `opencode`/`opencode-go` or whose resolved endpoint contains `opencode.ai/zen`, and merges it below the profile `headers` so an explicit deployment value still wins; Harness attribution keeps winning its reserved names above both, per the [mandatory attribution headers](../architecture/2026-06-21-mandatory-app-attribution-headers.md). This extends the header merge the [provider-routed adapters](../architecture/2026-07-14-provider-routed-llm-adapters.md) decision owns. The header rides pi-ai's per-request `headers` option, which every transport merges last, so the completions, anthropic-messages, and responses paths all carry it. Requests without a session id send nothing, and non-OpenCode routes are untouched. No client-impersonation header is sent: the Harness keeps identifying itself only through its own `User-Agent`.

## Testing

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` pins the wire behavior against a local HTTP server: opencode-go completions sends the session id and still streams, omission without a session, a deployment override winning, both remaining transports (anthropic-messages, responses) sending it, and the `deepseek` route sending nothing under the same session id.

## Alternatives considered

**Bumping `@earendil-works/pi-ai` past 0.84.** Rejected: 0.85.1 still maps `sessionId` only to `x-session-affinity`/`x-session-id` and knows no `x-opencode-session`, so the upgrade cannot supply the required header.

**Enabling pi-ai's `sendSessionAffinityHeaders` compat on the routes.** Rejected: those switches are deliberately withheld from profiles, and even enabled they emit pi-ai's affinity vocabulary rather than the `x-opencode-session` name Go requires.

**Sending `x-opencode-client` beside the session header.** Rejected: Go asks clients to identify with their own `User-Agent`, which the mandatory Harness attribution already sends; an extra client header adds no routing value and risks reading as CLI impersonation.

**A static per-installation header via profile `headers`.** Rejected: it pins every conversation to one id, defeating per-conversation routing and caching; it remains available as an explicit override for deployments that want it.

## Consequences

OpenCode Zen and Go requests carry a stable per-conversation id on all three transports, restoring Go routing and prompt caching. Deployments that already pin `x-opencode-session` in profile headers see no change. The adapter now owns one provider-name check (`opencode`, `opencode-go`, plus the catalog endpoint substring for hand-declared routes pointed at Zen), which becomes redundant the day pi-ai natively sends the header.
