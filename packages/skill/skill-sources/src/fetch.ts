/**
 * Bounded HTTP retrieval for source syncs.
 * @module
 */

/** Transport policy applied to every request and its final redirect target. */
export interface FetchPolicy {
  /** Largest accepted response body in bytes. */
  readonly maxBytes: number
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number
  /** Permit plain HTTP to loopback hosts, for local mirrors and test fixtures. */
  readonly allowHttpLoopback: boolean
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Reject a URL the policy does not permit.
 * @param url - request or redirect target.
 * @param policy - transport policy.
 */
export function assertFetchable(url: URL, policy: Pick<FetchPolicy, 'allowHttpLoopback'>): void {
  if (url.username !== '' || url.password !== '') throw new Error('source URLs must not contain credentials')
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && policy.allowHttpLoopback && LOOPBACK_HOSTS.has(url.hostname)) return
  throw new Error(`refusing ${url.protocol.replace(/:$/, '')} URL ${url.href}; skill sources require HTTPS`)
}

/**
 * Fetch one URL and return its complete body within the byte cap.
 * @param url - request URL.
 * @param headers - request headers.
 * @param policy - transport policy.
 * @param signal - caller cancellation.
 * @returns the response body.
 * @throws Error on a disallowed URL, a non-2xx status, an oversized body, timeout, or cancellation.
 */
export async function fetchBytes(
  url: string,
  headers: Record<string, string>,
  policy: FetchPolicy,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const target = new URL(url)
  assertFetchable(target, policy)
  const response = await fetch(target, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)]),
  })
  assertFetchable(new URL(response.url), policy)
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`GET ${target.href} failed: HTTP ${response.status}`)
  }
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (declared > policy.maxBytes) {
    await response.body?.cancel()
    throw tooLarge(target, policy.maxBytes)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength
    if (total > policy.maxBytes) throw tooLarge(target, policy.maxBytes)
    chunks.push(chunk)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function tooLarge(url: URL, maxBytes: number): Error {
  return new Error(`GET ${url.href} exceeded ${maxBytes} bytes`)
}
