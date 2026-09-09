/** Request-ID propagation — observability.md §3 (request_id REQUIRED, ULID). */
import { randomUUID } from 'node:crypto'

/** Header name carrying the end-to-end request identifier. */
export const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Resolve or mint a request identifier. Accepts an inbound header (edge may already have set one)
 * or mints a new ULID-shaped value. The identifier is returned for logging and for echoing
 * as a response header so every hop can correlate.
 * @param inbound - value of the inbound X-Request-Id / request-id header, if any.
 * @returns canonical request identifier.
 */
export function resolveRequestId(inbound: string | undefined): string {
  if (inbound !== undefined && inbound.trim().length > 0 && /^[A-Za-z0-9_-]{8,64}$/.test(inbound.trim())) {
    return inbound.trim()
  }
  // ULID would be ideal; uuid v4 is available without a new dep and satisfies the contract
  // (unique, sortable by time via prefix if needed, 36 chars). Tagged for later replacement.
  return `req_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

/**
 * Build the structured log fields that must accompany every request per observability.md §3.
 * Never log secrets/tokens/raw PII — only the hashed user_id and the request_id.
 * @param requestId - resolved request identifier.
 * @param route - matched route (e.g. "/api/session/list").
 * @param status - response status.
 * @param latencyMs - measured duration.
 * @returns log record fragment.
 */
export function requestLogFields(
  requestId: string,
  route: string,
  status: number,
  latencyMs: number,
): Record<string, unknown> {
  return {
    request_id: requestId,
    route,
    status,
    latency_ms: latencyMs,
    // ts/service is filled by the caller; trace_id optional per OTel
  }
}
