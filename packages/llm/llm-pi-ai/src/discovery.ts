/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A route the installed pi-ai catalog ships is answered **from that catalog**,
 * with no network call at all: pi-ai's registry is the authoritative list for
 * its own providers, and it carries the capacities a listing endpoint would
 * not disclose. Only a route the catalog does not describe — a gateway, a
 * self-hosted server — is interrogated over the wire.
 *
 * A request that asks for a live answer (`LlmModelDiscoveryRequest.live`)
 * interrogates a catalog route's own endpoint as well, because the installed
 * catalog is a snapshot: a provider that added a model since that snapshot
 * answers with an id the catalog has never heard of. The endpoint's listing
 * decides which ids are offered and in what order; the installed entry's
 * metadata — name, capacities, input modalities — describes every id the
 * catalog knows, so a live row is as complete as a registry row. The route's
 * most-used endpoint is asked first and the first endpoint that answers a
 * readable listing is the one that answers: asking every endpoint would merge
 * listings authenticated differently from the route's stored credential and
 * report models the route cannot serve.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `cordis.patch.yml` remains the only
 * thing that decides what a route serves.
 *
 * OpenAI-compatible and Anthropic Messages protocols are interrogated through
 * their native model-listing endpoints. The parser accepts the standard
 * `data` array and the enriched `models` map some compatible gateways expose.
 * Every other protocol reports that it cannot be interrogated so the surface
 * falls back to hand-entry rather than guessing its response fields.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { Api, Model } from '@earendil-works/pi-ai'
import { catalogModels } from './catalog.ts'

/**
 * Protocols whose model listing this module can read. OpenAI protocols use
 * bearer auth at `GET {baseURL}/models`; Anthropic Messages uses `x-api-key`
 * and `anthropic-version` at its native `GET /v1/models`. Azure is absent
 * despite its OpenAI lineage — it authenticates with an `api-key` header and
 * requires an `api-version` query — and Codex authenticates through OAuth;
 * guessing at either would report an authentication failure as a provider
 * with no models. pi-ai's remaining protocols are absent for the same reason.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
])

/** Stable API version required by Anthropic's model-listing endpoint. */
const ANTHROPIC_VERSION = '2023-06-01'

/** Largest model-list page accepted by Anthropic's public endpoint; discovery reads one page and does not follow `has_more`. */
const ANTHROPIC_MODEL_LIMIT = 1000

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** Capacity fields nested by enriched model-directory replies. */
interface ListingLimit {
  context?: unknown
  output?: unknown
}

/** Per-route capacities OpenRouter nests under each entry. */
interface ListingTopProvider {
  max_completion_tokens?: unknown
}

/** One entry of a supported `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  displayName?: unknown
  contextWindow?: unknown
  context_window?: unknown
  context_length?: unknown
  max_input_tokens?: unknown
  maxOutputTokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  maxTokens?: unknown
  limit?: ListingLimit | null
  top_provider?: ListingTopProvider | null
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the protocol's listing path. The base is
 * treated as a prefix rather than a URL to resolve against, so a deployment
 * path such as `https://gateway.example/openai/v1` keeps its segments instead
 * of losing them to `URL` resolution. OpenAI protocols list at
 * `{baseURL}/models`. Anthropic lists at `{root}/v1/models`, where the root is
 * the base without trailing slashes and without one trailing `/v1` segment:
 * gateway documentation publishes both spellings of the same root. Only this
 * listing URL normalizes that segment; model requests receive the configured
 * `baseURL` unchanged.
 */
function listingUrl(baseURL: string, api: string): string {
  const base = baseURL.replace(/\/+$/, '')
  if (api !== 'anthropic-messages') return `${base}/models`
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base
  return `${root}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one supported model-listing reply. The standard `data` array takes
 * precedence when both supported formats are present. An enriched `models`
 * map uses each property key as the endpoint-facing id; its nested `id` is
 * only a fallback for an empty key because gateways may put a canonical model
 * identity there instead of the alias they accept on requests. Only
 * object-valued map entries are models; primitive properties are ignored
 * because they may be directory metadata rather than model records.
 *
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation: a single malformed row should not deny the user the rest of
 * a working endpoint's catalog. Missing names fall back to the adopted id so
 * the Web form receives a complete human-readable row.
 */
function readListing(body: unknown): LlmDiscoveredModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null
  const data = listing?.data
  let listed: { readonly key?: string; readonly raw: unknown }[]
  if (Array.isArray(data)) {
    const rows = data as readonly unknown[]
    listed = rows.map(raw => ({ raw }))
  } else {
    const models = listing?.models
    if (models === null || typeof models !== 'object' || Array.isArray(models)) {
      throw new LlmError(
        'the endpoint\'s model listing has neither a "data" array nor a "models" object; '
        + 'enter this provider\'s models by hand',
        'DISCOVERY_FAILED',
      )
    }
    listed = Object.entries(models as Record<string, unknown>)
      .filter(([, raw]) => raw !== null && typeof raw === 'object' && !Array.isArray(raw))
      .map(([key, raw]) => ({ key, raw }))
  }
  const models: LlmDiscoveredModel[] = []
  for (const { key, raw } of listed) {
    const entry = raw as ListingEntry | null
    const id = label(key, entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name, entry?.displayName) ?? id
    const contextWindow = capacity(
      entry?.contextWindow,
      entry?.context_window,
      entry?.context_length,
      entry?.max_input_tokens,
      entry?.limit?.context,
    )
    const maxTokens = capacity(
      entry?.maxOutputTokens,
      entry?.max_output_tokens,
      entry?.maxTokens,
      entry?.max_tokens,
      entry?.limit?.output,
      entry?.top_provider?.max_completion_tokens,
    )
    models.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/** Host-owned profile inputs that a configuration draft deliberately omits. */
export interface StoredModelDiscoveryProfile {
  /** Deployment headers configured on the named route. */
  readonly headers: Readonly<Record<string, string>> | undefined
  /** Resolve the named route's credential only when the draft carries none. */
  readonly resolveApiKey: () => Promise<string | undefined>
}

/** One endpoint a live interrogation asks, with the protocol that reaches it. */
interface InterrogationTarget {
  /** Endpoint base, as the route's models use it. */
  baseURL: string
  /** Wire protocol that reaches this endpoint. */
  api: string
}

/** The discovery row one installed catalog entry becomes. */
function catalogRow(model: Model<Api>): LlmDiscoveredModel {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    inputModalities: [...model.input],
  }
}

/**
 * The endpoints a live interrogation asks, in the order they are asked.
 *
 * A draft that names an endpoint is asked there alone. A draft that names no
 * protocol is asked as OpenAI Chat Completions: it is the shape a gateway is
 * overwhelmingly likely to speak, and the alternative — refusing until the
 * field is filled — would withhold the action from the case it exists for.
 * The cost is a misdirected message when the endpoint speaks something else
 * (an Anthropic gateway answers 401, which reads as a credential problem), and
 * hand-entry remains the way out.
 *
 * A catalog route names no endpoint, so its models' own endpoints supply the
 * answer, most-used first: the endpoint most of its models use is the one
 * whose listing describes the route, while asking every endpoint would merge
 * listings authenticated differently from the route's stored credential and
 * report models the route cannot serve. Models that list at one URL are one
 * target, so a route whose protocols share a listing endpoint is asked once,
 * with the protocol of the first model that reaches it. Ties keep catalog
 * order.
 * @param request - the draft being interrogated.
 * @param installed - the route's installed catalog, when it ships one.
 * @returns the endpoints to ask; empty when neither the draft nor a catalog names one.
 */
function interrogationTargets(
  request: LlmModelDiscoveryOperation,
  installed: ReadonlyMap<string, Model<Api>> | undefined,
): readonly InterrogationTarget[] {
  if (request.baseURL !== undefined && request.baseURL.length > 0) {
    return [{ baseURL: request.baseURL, api: request.api ?? 'openai-completions' }]
  }
  if (installed === undefined) return []
  const order: { target: InterrogationTarget; uses: number }[] = []
  const seen = new Map<string, { target: InterrogationTarget; uses: number }>()
  for (const model of installed.values()) {
    const key = listingUrl(model.baseUrl, model.api)
    const known = seen.get(key)
    if (known === undefined) {
      const entry = { target: { baseURL: model.baseUrl, api: model.api }, uses: 1 }
      seen.set(key, entry)
      order.push(entry)
    } else {
      known.uses += 1
    }
  }
  // Array.prototype.sort is stable, so equal counts keep catalog order.
  return [...order].sort((a, b) => b.uses - a.uses).map(entry => entry.target)
}

/**
 * Merge one live listing under the installed catalog's metadata: the endpoint
 * decides which ids the route offers and in what order, and the installed
 * entry describes every id it knows — the capacities and input modalities no
 * listing endpoint reports. A catalog model the listing omits stays, so a
 * provider's temporary gap does not read as a deleted model.
 * @param installed - the route's installed catalog.
 * @param listed - the endpoint's own listing.
 * @returns the merged candidates in listing order, then catalog-only entries.
 */
function mergeCatalog(
  installed: ReadonlyMap<string, Model<Api>>,
  listed: readonly LlmDiscoveredModel[],
): LlmDiscoveredModel[] {
  const merged: LlmDiscoveredModel[] = []
  const seen = new Set<string>()
  for (const candidate of listed) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    const known = installed.get(candidate.id)
    merged.push(known === undefined ? candidate : catalogRow(known))
  }
  for (const [id, model] of installed) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(catalogRow(model))
  }
  return merged
}

/**
 * Ask one endpoint for its model listing.
 * @param target - endpoint base and the protocol that reaches it.
 * @param apiKey - resolved credential, or `undefined` to probe unauthenticated.
 * @param deploymentHeaders - headers the named route's profile configures.
 * @param signal - caller cancellation.
 * @returns the advertised models in endpoint order.
 * @throws LlmError when the endpoint refuses or fails the request, the reply
 *   outgrows the byte ceiling, or the reply is not a model listing.
 */
async function interrogate(
  target: InterrogationTarget,
  apiKey: string | undefined,
  deploymentHeaders: Readonly<Record<string, string>> | undefined,
  signal: AbortSignal | undefined,
): Promise<readonly LlmDiscoveredModel[]> {
  const url = listingUrl(target.baseURL, target.api)
  let response: Response
  try {
    const headers = new Headers(deploymentHeaders === undefined ? undefined : Object.entries(deploymentHeaders))
    headers.set('accept', 'application/json')
    if (target.api === 'anthropic-messages') {
      headers.set('anthropic-version', ANTHROPIC_VERSION)
      if (apiKey !== undefined) headers.set('x-api-key', apiKey)
    } else if (apiKey !== undefined) {
      headers.set('authorization', `Bearer ${apiKey}`)
    }
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    response = await fetch(url, {
      method: 'GET',
      headers,
      // Discovery carries a credential; a redirect must never forward it to
      // another origin, matching every other credentialed request in the repo.
      redirect: 'error',
      ...signal === undefined ? {} : { signal },
    })
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return readListing(body)
}

/**
 * Interrogate one draft provider endpoint for the models it advertises, or
 * answer a route the installed catalog describes.
 * @param request - the endpoint, protocol, one-shot credential, and whether a
 *   live answer is wanted.
 * @param storedProfile - Host-owned headers and lazy credential resolution for
 *   the named route. It is read only on the path that reaches the network; the
 *   credential is resolved only when the draft carries none.
 * @returns the advertised models in endpoint order, or the catalog's own order.
 * @throws LlmError when the protocol has no readable listing, no endpoint is
 *   known, every endpoint fails, or a reply is not a model listing.
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  storedProfile?: () => StoredModelDiscoveryProfile | undefined,
): Promise<readonly LlmDiscoveredModel[]> {
  const installed = request.provider === undefined ? undefined : catalogModels(request.provider)
  const catalog = installed !== undefined && installed.size > 0 ? installed : undefined
  // A catalog route already has its answer, and a better one: the installed
  // entries carry context windows and output caps no listing endpoint reports.
  // A caller that asked for a live answer still gets one, because the catalog
  // is a snapshot and the endpoint is not.
  if (catalog !== undefined && request.live !== true) return [...catalog.values()].map(catalogRow)
  const targets = interrogationTargets(request, catalog)
  if (targets.length === 0) {
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A protocol with no readable listing contributes nothing; only when no
  // target on the route is listable is there nothing to ask.
  const listable = targets.filter(target => LISTABLE_PROTOCOLS.has(target.api))
  if (listable.length === 0) {
    throw new LlmError(
      `pi-ai protocol "${targets.map(target => target.api).join(', ')}" has no model listing this build can read;`
      + " enter this provider's models by hand",
      'DISCOVERY_UNSUPPORTED',
    )
  }
  // A key typed into the form wins: it may replace the stored key that is
  // failing. The stored profile is asked past the catalog and protocol checks,
  // and its credential resolver remains lazy so a typed key cannot fail over a
  // stored credential it supersedes. A route may still authenticate through a
  // deployment-owned Authorization header when neither key exists.
  const stored = storedProfile?.()
  const supplied = request.apiKey ?? await stored?.resolveApiKey()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let firstFailure: unknown
  for (const target of listable) {
    try {
      const listed = await interrogate(target, apiKey, stored?.headers, request.signal)
      return catalog === undefined ? listed : mergeCatalog(catalog, listed)
    } catch (error: unknown) {
      // An abort ends the interrogation; any other failure moves on to the
      // next endpoint, and the first failure is what a route none of whose
      // endpoints answered reports.
      if (request.signal?.aborted) throw error
      firstFailure ??= error
    }
  }
  throw firstFailure
}
