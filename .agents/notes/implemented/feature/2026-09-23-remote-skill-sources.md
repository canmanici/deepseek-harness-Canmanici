# Agent Note: Remote skill sources synced to disk

Status: implemented

English | [中文](2026-09-23-remote-skill-sources.zh.md)

## Problem

Users want skills from the Anthropic public repository, other GitHub repositories, and arbitrary web URLs without copying files by hand, managed from the GUI. The registry already accepted remote providers, but no provider fetched anything, and the [skill system](../../archived/feature/2026-07-05-skill-system.md) rejected nested recursive `SKILL.md` discovery for local roots, while public repositories such as `anthropics/skills` place skills below `skills/<name>/`.

## Decision

`dsh-skill-sources` owns `ctx.skillSources` and registers one `ctx.skills` provider. A source is a GitHub repository (optionally a ref and subdirectory), a ZIP archive URL, or a single skill-file URL. A sync resolves the GitHub commit through the REST API, skips unchanged commits, downloads the zipball, extracts it with path and size checks, and discovers skill directories up to a configured depth at sync time. The result is a manifest in a commit-named generation under `<dshHome>/skill-sources/<id>/`; `current.json` switches only after the generation is complete, and a failed sync keeps the previous generation. The provider lists candidates from in-memory manifests, so lookups never reach the network and lookup-time discovery stays flat.

Default sources are Loader configuration. The shipped base composition lists `https://github.com/anthropics/skills` as `anthropic-skills`, enabled, and syncs never-synced sources at startup only in the `web` and `desktop` profiles, so CLI, SDK, and test compositions never download at boot. User-added sources and default-source overrides persist in `<dshHome>/skill-sources.json`; removing a default source records a tombstone so configuration does not restore it. Remote candidates use source `remote:<id>` and rank 350, between custom directories and the user DSH directory within one layer. Enablement from [registry filters](2026-09-23-skill-enablement-filters.md) applies to remote skills unchanged.

## Alternatives considered

**Fetch on every lookup.** Rejected because catalog reads happen at every step, a network failure would make the catalog incomplete, and a skill body could change between discovery and load.

**Clone with git.** Rejected because it adds a host binary dependency and credentials handling; the GitHub zipball plus commit lookup gives the same pinning with plain HTTPS.

**Recursive discovery in `dsh-skill-filesystem` roots.** Rejected for the same reasons as before: lookup-time scans of large trees. Discovery at sync time bounds the cost to one scan per commit.

**Add a source as an npm package through the plugin manager.** Rejected because skill packs are Markdown trees, not plugins, and would need publishing.

## Consequences

The GUI calls `ctx.skillSources` to list, add, sync, enable, and remove sources, and reads `sync.state` and `sync.error` for status. Remote skills are instructions the model follows, so the README asks users to trust sources as they would a dependency; syncs never execute source files. Unit tests cover URL parsing, fetch policy, extraction guards, discovery, sync, rollback, persistence, and disposal against a loopback server; the assembled loader snapshot syncs through the shipped bundle; an opt-in network test syncs the real Anthropic repository.
