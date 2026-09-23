---
description: "Remote skill sources for users and maintainers who add skills from the Anthropic public repository, other GitHub repositories, ZIP archives, or single skill-file URLs."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-sources

English | [中文](README.zh.md)

## Summary

This package adds skills from remote sources: a GitHub repository, a ZIP archive, or one Markdown skill file at an HTTPS URL. A sync downloads a source into the DSH home and records the skills it contains; the model and the user then use those skills like local ones. The shipped composition starts with the [Anthropic public skills repository](https://github.com/anthropics/skills) enabled and downloads it when the Web or Desktop app starts. Users add, disable, re-sync, or remove sources through the `ctx.skillSources` service that the Skills page calls; the page also installs single skills from public marketplaces into a source's selection.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Source URLs

| URL form | Source |
|---|---|
| `https://github.com/<owner>/<repo>` or `github:<owner>/<repo>` | The repository's default branch |
| `https://github.com/<owner>/<repo>/tree/<ref>/<path>` | One ref, bounded to one subdirectory |
| `https://github.com/<owner>/<repo>/blob/<ref>/<file>.md` | One skill file, read from `raw.githubusercontent.com` |
| `https://<host>/<name>.zip` | A ZIP archive |
| `https://<host>/<name>.md` | One skill file |

An explicit `ref` or `path` overrides the value embedded in a URL. Only HTTPS is fetched, and URLs carrying credentials are rejected.

### What a sync does

A sync of a GitHub source asks the GitHub API for the commit of the configured ref and skips the download when that commit is already current. Otherwise it downloads the repository archive, extracts the files below the configured subdirectory, and finds every directory up to six levels deep that contains a valid `SKILL.md`. Discovery does not descend into a skill directory, so its scripts and references stay resources of that skill. The first directory in sorted path order wins a duplicate name, and invalid or oversized `SKILL.md` files are skipped with a warning.

Archive and skill-file sources use the SHA-256 of the downloaded bytes in place of a commit. A skill-file source becomes one skill directory named after its frontmatter `name`.

The sync writes the result to `<dshHome>/skill-sources/<id>/<commit>/` and then switches `current.json` to it. A failed sync keeps the previous skills and reports the error on the source.

### Service

`ctx.skillSources` exposes:

- `list()` returns every source with `origin` (`default` or `user`), `kind`, `enabled`, the optional `skills` selection, and `sync` (`state`, `commit`, `syncedAt`, `error`, `skillCount`, `availableCount`, `updateAvailable`, `latest`, `checkedAt`).
- `add({ url, ref?, path?, skills?, id? })` validates the URL, stores a user source with an id derived from the URL unless one is given, and starts its first sync. `skills` installs only the named skills; an entry matches a skill's name or its directory's last segment.
- `sync(id)` re-downloads one source; concurrent calls share one sync.
- `setEnabled(id, enabled)` hides or restores a source's skills without deleting files.
- `setSkills(id, skills)` replaces the installed selection without downloading again; `undefined` installs every skill of a user source and restores a default source's configured selection.
- `offers(id)` lists every skill the current generation contains, with whether the selection installs it.
- `checkUpdate(id)` asks the GitHub API for the ref's newest commit without downloading and sets `sync.updateAvailable` when it differs from the current generation. Archive and skill-file sources report no update until a sync downloads different bytes.
- `remove(id)` deletes a user source and its files. A default source is hidden instead, so configuration does not restore it.

Every change emits `skill-sources/change` and invalidates the skill catalog. User sources and default-source overrides persist in `<dshHome>/skill-sources.json`.

### Configuration

| Field | Default | Effect |
|---|---|---|
| `defaultSources` | `[]`; the shipped base composition lists `anthropic-skills` | Sources every user starts with: `id`, `url`, optional `ref`, `path`, `skills`, and `enabled`. An empty `skills` list installs every skill. |
| `autoSyncOnStart` | `true`; the shipped base composition enables it only for the `web` and `desktop` profiles | Sync enabled sources that have never synced when the plugin starts. |
| `rank` | `450` | Precedence of remote skills within one registry layer; project, custom, and `~/.dsh/skills` skills win a duplicate name, so a customized copy replaces the remote skill. `~/.agents/skills` and bundled skills lose to it. |
| `githubTokenRef` | `GITHUB_TOKEN` | Credential reference resolved through `ctx.credentials` for GitHub requests; an empty string sends no token. |
| `githubApiUrl` | `https://api.github.com` | GitHub REST API base URL. |
| `maxDownloadBytes`, `maxExtractedBytes`, `maxFiles`, `maxSkillBytes`, `maxDiscoveryDepth`, `fetchTimeoutMs` | 64 MiB, 256 MiB, 10000, 1 MiB, 6, 120 s | Download, extraction, discovery, and timeout bounds. |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Home holding the source list and synced files. |
| `allowHttpLoopback` | `false` | Permit plain HTTP to loopback hosts for local mirrors and tests. |

### Trust

A remote skill is an instruction the model follows once loaded. Add only sources you trust, as you would a dependency. Syncing never executes files from a source, and archive entries with absolute or parent-relative paths abort the sync.

### Observable success and failures

- After a sync, each skill appears with source `remote:<id>` in `ctx.skills.list()` and the model catalog.
- A network, HTTP, archive, or bound failure sets `sync.state` to `error` with the message and keeps the previous skills.
- A malformed `skill-sources.json`, `current.json`, or manifest stops the plugin from loading, naming the file.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

Discovery runs at sync time and writes a manifest, so catalog lookups read only memory and never touch the network or scan remote trees. Each generation lives in a commit-named directory; the staging tree is renamed into place before `current.json` switches, and the previous generation is deleted afterwards. Source-list writes hold the cross-process file lock and commit through an atomic rename. Disposal aborts in-flight downloads.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, provider registration, source list, sync pipeline, and file validation |
| [`src/source-spec.ts`](src/source-spec.ts) | URL parsing into GitHub, archive, and skill-file fetch plans |
| [`src/fetch.ts`](src/fetch.ts) | HTTPS policy, redirects, timeout, and byte cap |
| [`src/archive.ts`](src/archive.ts) | ZIP extraction with path and size checks, and sync-time discovery |
| — | No runtime invariant companion is published; the provider reads the same in-memory generations the sync commits, so no independent observations can diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill subsystem reference](../../../docs/subsystems/skills.md) — the provider contract and how remote skills rank against local ones.
- [skill-filesystem package](../skill-filesystem/README.md) — `parseSkillDocument()`, the shared `SKILL.md` rules.
- [skill-preferences package](../skill-preferences/README.md) — per-skill enablement, which also applies to remote skills.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which renders remote skills in the catalog and returns their bodies with the synced directory as the resource base.

#### KV Cache effect

A sync that changes the skill set changes the catalog; `dsh-tool-skill` appends a logged replacement catalog at the next step, leaving the earlier prefix cacheable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No scheduled updates** — `checkUpdate()` reports a newer commit, but a source changes only when a user syncs it or when a never-synced source starts under `autoSyncOnStart`.
- **Whole-repository downloads** — installing one skill downloads the repository archive; the selection only decides which discovered skills are exposed.
- **ZIP only** — tar archives and git protocols other than the GitHub API are not supported.
- **Anonymous GitHub rate limit** — without a token GitHub allows 60 API requests per hour per IP address.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
