---
description: "Public skill marketplaces for users who search and install skills from GitHub repositories, claude-plugins.dev, SkillsMP, and skills.sh."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-marketplace

English | [中文](README.zh.md)

## Summary

This package searches public skill marketplaces through `ctx.skillMarketplace`. A marketplace is either a GitHub repository scanned for `SKILL.md` files or a public search API: claude-plugins.dev, SkillsMP, or skills.sh. Every result names the GitHub repository and directory that holds the skill, and [dsh-skill-sources](../skill-sources/README.md) installs it from there. The package contains no skill list; each entry comes from the network when a search runs. The shipped Web composition lists sixteen marketplaces.

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

### Marketplace kinds

| `kind` | `url` | Empty query | Count |
|---|---|---|---|
| `github` | A repository URL, optionally `/tree/<ref>/<path>` | Lists every skill directory | Number of `SKILL.md` directories |
| `claude-plugins-dev` | `https://claude-plugins.dev` | Lists skills | The API's `total` |
| `skillsmp` | `https://skillsmp.com` | Returns nothing; the API needs a query | The API's `pagination.total` for a query |
| `skills-sh` | `https://skills.sh` | Returns nothing; the API needs two characters | None |

A `github` marketplace costs one GitHub API request per cache period: a recursive tree listing. Descriptions come from `raw.githubusercontent.com`, fetched only for the entries a page shows.

### Service

`ctx.skillMarketplace` exposes:

- `list()` returns every marketplace with `browsable` and the counts or errors of the latest `refreshCounts()`.
- `refreshCounts()` asks every enabled browsable marketplace how many skills it offers.
- `search({ query, marketplace?, offset?, limit? })` searches one marketplace or every enabled one. Results are deduplicated by `<owner>/<repo>/<directory>` and interleaved across marketplaces in configuration order. The result carries per-marketplace `totals`, `hasMore`, `nextOffset`, and `errors`; one failing marketplace does not fail the search.

### Configuration

| Field | Default | Effect |
|---|---|---|
| `marketplaces` | `[]`; the shipped Web composition lists sixteen | Entries with `id`, `title`, `kind`, `url`, and `enabled`. |
| `pageSize` | `24` | Entries per page when a search names one marketplace. |
| `mixedPageSize` | `6` | Entries per marketplace when a search spans every marketplace. |
| `maxPageSize` | `100` | Largest `limit` a search may request. |
| `cacheTtlMs` | 30 minutes | How long a response stays cached. |
| `fetchTimeoutMs`, `maxResponseBytes` | 20 s, 8 MiB | Per-request bounds. |
| `maxRepositorySkills`, `maxDiscoveryDepth`, `scanConcurrency` | 2000, 6, 8 | Bounds on one `github` marketplace. |
| `githubApiUrl`, `githubRawUrl` | `https://api.github.com`, `https://raw.githubusercontent.com` | GitHub endpoints. |
| `githubTokenRef` | `GITHUB_TOKEN` | Credential reference sent with GitHub API requests; an empty string sends none. |
| `allowHttpLoopback` | `false` | Permit plain HTTP to loopback hosts for tests. |

### Observable success and failures

- A search returns entries with `marketplace`, `key`, `name`, `repository`, `url`, and, where the marketplace reports them, `description`, `dir`, `installs`, and `stars`.
- An HTTP failure, a timeout, or invalid JSON appears in `errors` beside the other marketplaces' results, and the failed response is not cached.
- An unknown or disabled `marketplace` id rejects the search; a malformed marketplace entry fails the plugin at load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The service never installs anything. Each parser maps one API's JSON to entries that point at a GitHub repository, so installation always goes through a skill source with its commit pinning and archive checks. Entries without a GitHub location are dropped. Responses are cached per URL, and concurrent callers share one in-flight request.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, configuration, paging, caching, and GitHub repository scans |
| [`src/catalogs.ts`](src/catalogs.ts) | JSON parsers for each marketplace API and the GitHub tree |
| — | No runtime invariant companion is published; the service keeps no state that another observation could contradict. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [skill-sources package](../skill-sources/README.md) — installs a marketplace entry by adding its repository to a source's selection.
- [Skill subsystem reference](../../../docs/subsystems/skills.md) — how remote skills rank against local ones.

-----

<a id="model-experience"></a>
## Model Experience

None, as marketplace searches serve the Skills page only and nothing they return reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Anonymous GitHub rate limit** — without a token GitHub allows 60 API requests per hour, one per `github` marketplace per cache period.
- **Repository search matches paths** — a `github` marketplace filters by directory path, not by description.
- **Third-party APIs** — the claude-plugins.dev, SkillsMP, and skills.sh response fields are not versioned; a changed field drops entries instead of failing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
