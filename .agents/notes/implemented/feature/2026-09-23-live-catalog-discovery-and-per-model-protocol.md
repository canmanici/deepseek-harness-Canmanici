# Agent Note: Live model discovery and per-model protocol for catalog routes

Status: implemented

English | [中文](2026-09-23-live-catalog-discovery-and-per-model-protocol.zh.md)

## Problem

The pi-ai catalog this adapter ships is a snapshot generated upstream, so a provider that adds a model after that snapshot serves an id the route cannot describe: the model never appears in a listing, and adding it to a catalog route is refused because a model entry had nowhere to name its protocol or endpoint. A route whose installed models disagree about their protocols — `opencode-go` serves Anthropic Messages, Chat Completions, and Responses models from two endpoints — could therefore never gain a model newer than the snapshot, and the documented workaround was one route per protocol.

The Models page's fetch action made the gap invisible rather than navigable: a catalog route answered from the snapshot with no network call, which is the better answer for capacities but not for currency. Nothing asked the endpoint the user was looking at.

## Decision

`LlmModelDiscoveryRequest.live` makes an interrogation ask the endpoint even when the adapter already describes the route. The Models page sends it from its fetch action alone; the automatic catalog read that feeds inherited input types stays registry-only, so opening a card costs no network call and still renders offline. A live answer on a catalog route merges the endpoint's listing with the installed metadata: the listing decides which ids the route offers and in what order, the installed entry supplies the name, capacities, and input modalities of every id the catalog knows, and a catalog model the listing omits stays behind them. The route's most-used endpoint is asked first and the first endpoint answering a readable listing is the one that answers — asking every endpoint would merge listings authenticated differently from the route's stored credential, which on `opencode.ai` reports a superset the plan does not serve. A draft that names its own endpoint is asked there instead, and a live interrogation no endpoint answers reports its failure rather than returning the snapshot it was asked to refresh.

`PiAiModelProfile` gains `api` and `baseURL`, each winning over the route-level field of the same name, so one route serves several wire formats. `buildProvider` collects an implementation per protocol its models name and passes the map to the package's own `createProvider`, which now dispatches by `model.api` and fails a model whose protocol has no implementation instead of sending it through another. A protocol this build cannot serve is refused where the configuration is written; a protocol the installed catalog provider does not implement fails the request with pi-ai's own message, because a `Provider` does not expose its protocol map. The Models page renders the two fields in a row's advanced fold, reusing the route-level protocol labels.

## Alternatives considered

**Probe every endpoint of a catalog route and union the listings.** `https://opencode.ai/zen/go/v1/models` answers an authenticated request with the 33 models the plan serves and an unauthenticated or `x-api-key` request with a 40-model superset, so a union reports models the route's credential cannot serve. First-endpoint-that-answers keeps the answer describable and the requests bounded.

**Serve the live list from the route itself.** The served catalog would stop being a settings fact: registration is configuration-derived, pi-ai's provider reuse deliberately drops its own dynamic refresh so a background refresh cannot contradict the settings document, and a model list that changes under a running session changes what a request can name. Discovery stays candidate metadata a surface adopts explicitly.

**Infer a live-only model's protocol from the endpoint that listed it.** The listing endpoint serves several protocols' models — `opencode.ai`'s `/v1/models` includes the Anthropic-served ids — so inference would mislabel and over-claim; the user declares the protocol once per model.

**Keep the protocol at the route level and split one route per protocol.** This was the documented workaround; it multiplies routes and credential references for one provider, and it cannot express a route whose models disagree about their protocols without restating the endpoint on every split.

## Consequences

The fetch action is now a network call for catalog routes: slower, and it can fail where it previously answered from the snapshot. That is deliberate — a silent stale answer is the defect this change removes — and hand-entry plus the registry-backed inherited hints remain the offline paths. One endpoint answers per route, so a model served only by another endpoint of the same route is added by hand; both facts are recorded under the package's known limitations.

A catalog route's per-model protocol is checked against the installed provider at request time, not at write time, so a misdeclared protocol fails with pi-ai's message naming the provider and protocol. Hand-declared routes are checked where the configuration is written, because the adapter builds their implementations itself.

Verification: `tests/discovery.spec.ts` covers the live merge, the principal endpoint, the named-endpoint override, the next-endpoint fallback, and the reported first failure; `tests/catalog.spec.ts` covers per-model protocol and endpoint resolution, dispatch to two wire formats on one route, and the refusals for an empty or unserved protocol; `tests/config.spec.ts` covers the schema boundary; `apps/web/tests/models-settings.e2e.ts` covers a catalog route's fetch reaching its endpoint and records the expanded row's new controls in its goldens; `tests/provider-form.client.spec.tsx` covers the request shape and the row's protocol and endpoint edits.
