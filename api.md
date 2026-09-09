# API Registry — DeepSeek Harness

> **Source:** `/storm -realty` 2026-08-29 · Generated from FE/BE storm features
> **Carrier:** `client/connection` (`/api` bridge) + `api/gateway` (Typert Remote) + exact Fetch routes
> **Auth:** Every call needs `Host` trust + `client-connection` cookie (401 vs 403 per `packages/client/connection/README.md`)

| ID | Method | Path | Owner | Consumer | Status | Mock | Description |
|----|--------|------|-------|----------|--------|------|-------------|
| API-001 | GET | `/api/sessions/search?q=&status=&preset=&from=&to=&limit=&cursor=` | BE-001 | FE-001, FE-006 | planned | MOCK-001 | FTS5 session search with snippet & keyset cursor (p95 200 ms). Error: 400 invalid query, 422 bad cursor |
| API-002 | GET | `/api/sessions/:id/export` | BE-004 | FE-005 (share) | planned | MOCK-014 | Stream session as zstd zip (JSONL+header+attachments). Query `?encrypt=1` uses age. 404/409/422 |
| API-003 | PATCH | `/api/sessions/:id/settings` | FE-005 / BE-002 | FE-005 | planned | MOCK-005 | Hot-swap model/preset per session (session-scoped settings). Body `{ model, preset }`. No restart |
| API-004 | GET | `/api/sessions/:id/usage` | BE-010 | FE-009 | planned | MOCK-009 | Token/cost meter for session (from `token-meter`). Returns `{ tokensIn, tokensOut, costUsd, budgetPct }` |
| API-005 | GET | `/metrics` | BE-010 | infra (Prometheus) | planned | none | Prometheus exposition: `http_request_duration_seconds`, `http_requests_total`, `process_*`. No auth (loopback only) |
| API-006 | POST | `ctx.web.fetch` provider internal (tool `web_fetch`) | BE-003 | BE-003 | planned | MOCK-013 | Not a raw HTTP path — tool `web_fetch` with per-host TokenBucket (10 cap, 2/s refill). 429 `WEB_RATE_LIMITED` |
| API-007 | POST | `/api/sessions/import` | BE-004 | CLI | planned | MOCK-014 | Multipart zip upload → new session `id`. 422 corrupt, 409 schema mismatch |
| API-008 | WS | `/api/terminal/:id` | BE-005 | FE (terminal UI) | planned | MOCK-015 | PTY stream with 64 kB replay on reconnect. 409 `PTY_NOT_READY` |
| API-009 | POST | `/api/sessions/:id/prompt` (add `Idempotency-Key`) | BE-007 | FE-003 | planned | MOCK-017 | Existing prompt endpoint now requires `Idempotency-Key` header. 422 on reuse-with-diff-payload |
| API-010 | POST | `/api/sessions/:id/cancel` (add `Idempotency-Key`) | BE-007 | FE-011 | planned | MOCK-017 | Cancel queued prompt. Idempotent |
| API-011 | GET | `/api/skills/cas/:sha` | BE-012 | BE-012 | planned | MOCK-021 | Content-addressed skill/bundle fetch by `sha256`. 412 `OFFLINE_MISSING_SKILL` when cache miss offline |

## Notes

- **Typert vs Fetch:** `API-001`/`API-003`/`API-004` will be Typert `remote` methods (typed), `API-002`/`API-007` are exact Fetch routes (binary zip), `API-005` is bare `/metrics`.
- **Pagination:** `API-001` uses `cursor = base64url(JSON(lastRowSortKey))` + canonical check (same as `session/list` at `packages/core/session/src/index.ts:472`), not `OFFSET`.
- **Rate tiers:** `API-001` 30r/s, `API-002` 2r/s + `10M` cap per `security.md §3.4`, `API-009` auth-tier `1r/s burst 5` if unauthenticated.
- **Status lifecycle:** `planned` → `mocked` (when MOCK exists) → `implemented` → `verified` (snapshot + e2e).
