# Mock Registry — DeepSeek Harness

> **Source:** `/storm -realty` 2026-08-29 · L0=placeholder, L1=stub (real shape, fake data)
> **Tooling:** `packages/test-support/llm-mock-server`, `session-snapshot/src/suite.ts`, `test-support/client-runtime`

| ID | Feature | API | Maturity | Description | Fixture Shape |
|----|---------|-----|----------|-------------|---------------|
| MOCK-001 | FE-001 / BE-001 Search | API-001 | L1 | 50 sessions (active/archived, 3 presets, 7d/30d mix) with `marked_text` highlights | `tool-session-query/tests/fixtures/search-50.json` |
| MOCK-002 | FE-002 Diff Viewer | API-002 | L1 | 3 diffs: add (100L new file), edit (10L mid-file), rename | `ui-primitives/tests/fixtures/diff-3.json` |
| MOCK-003 | FE-003 Conversation+Meter | — | L1 | 120-turn chat with `TurnMetrics` (tokens, ttft, tps, cost) | `ui-chat/tests/fixtures/120-turns.json` |
| MOCK-004 | FE-004 States | — | L0 | 7 state snapshots: loading, empty, error, success, disabled, offline, rate-limited | `client/tests/fixtures/states-7.json` |
| MOCK-005 | FE-005 Hot Settings | API-003 | L1 | Settings store with `deepseek-chat` / `deepseek-reasoner` + cost pill | `settings/tests/fixtures/hot-settings.json` |
| MOCK-006 | FE-006 Palette | API-001 | L1 | 40 sessions + 5 commands + 3 workspaces for fuzzy palette | `ui-layout/tests/fixtures/palette-40.json` |
| MOCK-007 | FE-007 Mobile | — | L0 | Responsive snapshots 320/768/1024 for shell | `apps/web/tests/snapshots/responsive-3.json` |
| MOCK-008 | FE-008 Timeline | — | L1 | Trajectory 40 tool calls grouped by turn/step | `ui-trajectory/tests/fixtures/timeline-40.json` |
| MOCK-009 | FE-009 / BE-010 Budget | API-004 | L1 | `token-meter` high-usage sessions (75/80/95%) | `llm/token-meter/tests/fixtures/high.json` |
| MOCK-010 | FE-011 Notifications | — | L1 | Mixed `approval/request`, `ask-user`, `subagent/finished` queue | `interaction/tests/fixtures/notifications-3.json` |
| MOCK-011 | FE-012 Canvas | API-005 | L0 | Concurrent human+agent edits on same file (conflict marker) | `fs/tests/fixtures/concurrent-edits.json` |
| MOCK-012 | BE-002 ReqID logs | — | L1 | Structured log fixtures with `request_id`, `route`, `status`, `latency_ms` | `gateway/tests/fixtures/logs-3.json` |
| MOCK-013 | BE-003 Rate limit | API-006 | L1 | 20 fetches to same host (10 pass, 10x 429) + cross-host control | `web-fetch-http/tests/fixtures/rate-20.json` |
| MOCK-014 | BE-004 Export/Import | API-002/007 | L1 | Small session (50 turns), large (300 MiB), encrypted zip | `session/tests/fixtures/export-3.zip` |
| MOCK-015 | BE-005 PTY | API-008 | L1 | PTY with `sleep 10` + reconnect replay (64 kB buffer) | `terminal/tests/fixtures/pty-reconnect.json` |
| MOCK-016 | BE-006 Hot Skills | — | L1 | Skill FS add/edit/delete `SKILL.md` fixtures | `skill/tests/fixtures/hot-reload-3.json` |
| MOCK-017 | BE-007 Idempotency | API-009/010 | L1 | Same `Idempotency-Key` twice → same `callId`, diff payload → 422 | `gateway/tests/fixtures/idempotency-2.json` |
| MOCK-018 | BE-008 Python SDK | — | L1 | Snapshot fixtures for Python `session/query` parity | `python/tests/fixtures/session-50.json` |
| MOCK-019 | BE-009 Subagent | — | L1 | Parallel subagents (2), cancel, timeout (ordinal fix) | `subagent/tests/fixtures/parallel-cancel.json` |
| MOCK-020 | BE-011 E2B fallback | — | L1 | E2B quota 429 → fallback to local, card shows "ran locally" | `e2b/tests/fixtures/fallback.json` |
| MOCK-021 | BE-012 CAS | API-011 | L0 | `sha256` CAS hits/misses for offline bundle | `bundle/tests/fixtures/cas-2.json` |

## Maturity Guide

- **L0** placeholder: shape described, fixture not yet committed — `pnpm run test:snapshot:record` will create.
- **L1** stub: real TypeScript type shape, deterministic fake data, replay-safe — used in `test:snapshot` without `DEEPSEEK_API_KEY`.

## Next Mock Tasks

- Record `MOCK-001` via `pnpm --filter @deepseek-ai/dsh-tool-session-query test:snapshot:record` after BE-001 lands.
- Add `MOCK-002` `diff-3.json` when `CodeBlock` diff mode branches (FE-002).
- `MOCK-014` large 300 MiB zip is generated on demand, not committed — `.gitignore` entry.
