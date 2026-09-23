# Security Audit — DeepSeek Harness

Date: 2026-09-22 · Revision audited: `master` @ `00102833df` · Fix branch: `security/audit-fixes`

Read-only audit of the whole repository (7 parallel domain reviews plus repo-wide automated
scans), followed by a fix pass for the contained findings. Findings that change the product's
trust model are listed as **open** with a concrete proposal instead of being changed silently.

Trust model used throughout:

1. Model output and tool arguments are untrusted.
2. Repository content the harness reads (workspace files, session logs, skills, config, hooks,
   MCP results, fetched pages, webhook payloads) is untrusted unless code defensibly treats it
   as trusted.
3. The local user who launched the harness is trusted.
4. Credentials and session data are sensitive.

## 1. Automated results

| Check | Result |
|---|---|
| Secret patterns over 13,244 tracked files | 0 hits (prefix patterns + strict entropy) |
| Secret patterns over full git history | only fake test fixtures (`AKIAIOSFODNN7EXAMPLE` etc.) |
| `pnpm audit --prod` before fixes | 15 high, 20 moderate, 1 low, 0 critical |
| `pnpm audit --prod` after fixes | **0 high, 0 moderate (prod), 2 moderate dev-only** (`vitest`, `@vitest/mocker`) |
| Install-script policy | deny-by-default `allowBuilds`; `ignoredBuilds: []`; CI uses `--frozen-lockfile` |
| Lockfile provenance | all integrity-pinned; one non-registry source (`xlsx` from cdn.sheetjs.com, integrity-pinned) |
| Static pattern sweep | no `eval`/`new Function` reachable from model tools; no `shell: true` in production spawns; no TLS-verification disable |
| Security gate in CI | none (no `pnpm audit`/osv-scanner/CodeQL step); Dependabot configured with a 30-day cooldown |

## 2. Fixed in this branch

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | `sharp@0.35.3` (libheif heap overflow class) pinned for `attachment-local`; a crafted image decoded before the format whitelist could compromise the host | `sharp` → `^0.35.4`; overrides for the other advisories; `pnpm audit` clean for shipped deps |
| 2 | High | Non-admitted containers (HEIF/AVIF/SVG/…) reached the libvips decoder before the media-type check (`store.ts:62` ran the whitelist after `detectImage`) | Magic-byte admission gate before any decoder (`image.ts`), with tests |
| 3 | High | Settings writes could persist a `{__jsExpr: …}` marker, which the Loader evaluates → arbitrary JS in the host process, surviving restarts | `rejectLoaderExpression` refuses the marker in `update`/`replace`/`mutate`, with a test |
| 4 | Medium | `SSH_AUTH_SOCK`, `KUBECONFIG`, `GOOGLE_APPLICATION_CREDENTIALS`, `AWS_*`, `DOCKER_CONFIG`, `NETRC`, npm auth were inherited by model-controlled processes | Explicit credential-location deny list in `scrubbedParentEnv`, with tests |
| 5 | Medium | pi-ai model discovery sent the API key through redirects | `redirect: 'error'`, matching every other credentialed request |
| 6 | Medium | XLSX preview expanded ZIP entries from declared sizes with no bound (decompression bomb in the tab) | Uncompressed expansion bound in `unzipSync`, with a test |
| 7 | Medium | Skill discovery read any-sized file and followed symlinks out of the root | 1 MiB per-file read cap on both read paths, with tests |
| 8 | Low/Medium | Session-log export built ZIP entry paths from unvalidated attachment ids (zip-slip in whoever extracts) | Attachment ids must be one safe archive path segment, with a test |
| 9 | Low | Inspector `/json` and the CDP upgrade had no Host fence (DNS rebinding from a web page) | Loopback Host fence on both |
| 10 | Low | Preview deploy ran unpinned `npx wrangler@4` holding a Cloudflare token; PyPI publish used a mutable `@release/v1` branch ref with `id-token: write` | `wrangler@4.136.3`; action pinned to commit `dc37677b…` (`release/v1`) |

Verification for this branch:

- `pnpm audit --prod` — 0 critical/high/low, 2 dev-only moderate.
- `vitest run` on the touched packages (skill, inspector, gateway, llm-pi-ai) — 719 passed.
- Settings + subprocess — 30 passed; attachment — 21 passed; session-log-export — 53 passed;
  client Excel preview — 20 passed.
- `pnpm run test:gui` — 7,506 passed, 3 skipped (515 files passed, 2 skipped).
- `scripts/ci-workflow.spec.ts` + `scripts/preview-workflow.spec.ts` — 47 passed.
- `tsc -b` on every changed package — clean (exit 0, no diagnostics).

Note on the full `pnpm run typecheck` on this checkout: it stops before reaching the changed
packages on pre-existing `lib/` artifact-plane residue (first a stale
`packages/settings/settings/lib/types/invariant.js` from a removed invariant companion, then
`MISSING_EXPORT` while bundling invariants whose workspace imports resolve to `src` once the
artifacts are absent). `pnpm run clean` on a pristine checkout clears that class; no repository
source is affected and no tracked file changed. The deleted files were gitignored build outputs,
and `tsc -b` regenerated them.

## 3. Open — requires an owner decision

These change the product's security model, break documented behavior, or need an upstream
change. Each has a proposed patch.

| # | Severity | Finding | Proposal |
|---|---|---|---|
| A | High | **Reads and network are unconfined.** The file sandbox denies writes only; `read`/`bash` can read `$DSH_HOME/.credentials.yaml`, `~/.ssh`, `~/.aws`, session logs, and any HTTP egress is allowed. `DSH_HOME` is exported into model shells. A prompt injection in any untrusted content becomes credential exfiltration. | Mask `$DSH_HOME` (and `~/.ssh`, `~/.aws`, keychain paths) inside the bwrap/seatbelt profiles; stop exporting `DSH_HOME` to model shells; add an egress policy to the sandbox vocabulary or an approval for network-capable commands; state plainly in the permission picker that reads and network are not confined |
| B | High | **Credentials at rest are plaintext** (`$DSH_HOME/.credentials.yaml`, mode 0600); no OS keychain; Windows relies on inherited ACLs. | Keychain-backed credential provider (Keychain/DPAPI/libsecret) selected by composition, or field-level encryption with a keychain-held key; document the Windows limitation |
| C | Medium | **Auto-review bypass.** Under the Auto preset (`danger-full-access`, `approval: never`), the outer `run_code` transport and direct Node effects inside a PTC program never pass the reviewer; the reviewer is the same model and its decisions are not logged. | Exclude PTC/direct-effect runtimes from Auto or review the `run_code` body; persist the reviewer envelope as a log-only session event; state the bypass in the UI copy next to the preset |
| D | Medium | **Sandbox escalation is not bound to the denied command.** After any denial, the model may escalate any command; `plugin_manager install_bundle` skips approval entirely when the session is already `danger-full-access`, installing persistent in-process code. | Record the denial (mode + canonical command digest) and require the escalated call to match; require a distinct, non-escalation approval for bundle installation |
| E | Medium | **Webhooks have no replay protection** (the delivery id is outside the HMAC and not deduplicated); plain HTTP is permitted. | Default-on dedup keyed by `(source, deliveryId)` with a bounded TTL, and/or require HTTPS/loopback binds |
| F | Medium | **browser-use `attach` mode** drives the user's real browser profile (cookies, sessions) with no URL policy. | Document as "grants the model your logged-in browser" in the UI; consider a launch-mode navigation denylist for loopback/private hosts |
| G | Medium | **Client app shell is served without CSP or security headers.** Any future DOM-XSS executes with the page's full privilege (session cookie + harness control). | Serve `Content-Security-Policy` with a per-response nonce for the inline boot rows, plus `nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` |
| H | Low | **Gateway WebSocket frames are unbounded before parsing** (ws default 100 MiB). Tying `maxPayload` to the stream inbox breaks the documented graceful stream-overflow failure (verified by test), so it needs a pre-parse length check that emits the existing overflow error. | Implement the pre-parse check in the mux connection |
| I | Low | **Python PTC runtime** (experimental, published) runs model Python with no file confinement and rejects `sandboxPolicy`; no shipped profile mounts it. | Refuse to serve when the resolved session mode is confined, or wrap the interpreter in `ctx.sandbox.confine` |
| J | Low | **Proxied `web_fetch`** skips private-address validation for hostnames (only literals are refused); the proxy is operator-chosen. | Have the proxy policy refuse non-public proxy targets |
| K | Low | **MCP Streamable HTTP** sends configured headers (possibly `Authorization`) with the SDK's own redirect behavior, which is not readable in this checkout. | Verify the SDK's fetch policy; pass a fetch that sets `redirect: 'error'` if it follows redirects |
| L | Low | **CI hardening:** ~140 `uses:` are mutable tags (3 SHA-pinned); vendored upstream commits are not content-verified; the release-age policy (`minimumReleaseAge`) is not in-repo although the exemption list references it. | Pin all actions by SHA (Dependabot already tracks them); record per-file digests for `vendor/` and gate them; set `minimumReleaseAge` explicitly |
| M | Low | `vitest`/`@vitest/mocker` advisories (dev-only, path traversal in a mock redirect) need vitest ≥ 4.1.11. | Schedule the test-infra bump separately from security work |
| N | Low | Docs/limitations: sandbox modes are write-only; `hooks` bridges execute configured commands at deployment policy; Python SDK `patches`/`env`/`dsh_bin` are trusted-input-only; `/preview.html` is served unauthenticated in the preview build. | Doc updates with the bilingual workflow |
| O | Medium | **HTML preview dependency reads escape the workspace.** `WorkspaceFiles.readBytes` with `baseFile` resolves `../` relative references outside the workspace: `relativePath` calls `locateFile`, which never calls the existing `confine` helper (`workspace-files/src/index.ts:335-345,406-424`), so a workspace HTML file can make the session's file authority read arbitrary `.js`/`.css` on the host and hand them to the preview frame. A client-side rejection was implemented and reverted: `html-read-relative.client.spec.ts` documents that the client forwards relative paths and the Host decides ("outside workspace"), so the fix belongs in the Host. | In `relativePath`, confine the resolved path to the workspace root (reuse `confine`), keeping absolute-path reads unrestricted as `read` documents; add a host-side test for the `baseFile` + `../` case |

## 4. Verified defenses (no finding)

- `web_fetch` SSRF policy: HTTPS-only, no embedded credentials, DNS answer validation against
  globally-reachable unicast, pinned lookup per request, same-origin-only redirects with
  re-validation, byte/charset caps, no ambient credentials.
- Web UI/API server: loopback bind (0.0.0.0 refused), per-process launch token → HMAC cookie
  (`HttpOnly`, `SameSite=Strict`), Host/Origin/`Sec-Fetch-Site` fences, body caps.
- Filesystem writes: canonicalize-then-contain, staged 0700 directories, no-clobber publication.
- SQL: closed filter unions with bound parameters; FTS queries quoted; identifiers validated.
- SSH: `StrictHostKeyChecking=yes`, `BatchMode=yes`, `ForwardAgent=no`, TLS-PSK helper channels,
  zod-validated requests.
- PTC: separate process, JSON-only value crossing, inner calls re-enter the normal approval path.
- Desktop: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, webview navigation
  allowlist, origin-checked IPC, signature-pinned updates.
- Prompt-injection labeling for fetched web content; subagents cannot widen sandbox/approval.

## 5. Method and residual gaps

Method: repo-wide secret/entropy scans (working tree + git history), lockfile reachability
analysis for every flagged advisory, static dangerous-pattern sweep, then seven parallel
domain reviews (process/sandbox, fs/persistence, network/API/MCP, credentials/app shell,
guards/extensions, client UI, Python/native/supply chain), followed by a fix pass with focused
tests. Commands run for this branch are listed in §2 and the session transcript.

Gaps: no dynamic exploitation was attempted (no builds/tests that mutate the repo were run
during the audit); Windows-specific behavior (restricted tokens, ACL inheritance) was read from
code, not executed; LLM-behavior findings (auto-review, prompt-injection resistance) are not
testable in this environment; GitHub repository settings (environment protection, token scopes,
branch protection) are not visible from the tree.
