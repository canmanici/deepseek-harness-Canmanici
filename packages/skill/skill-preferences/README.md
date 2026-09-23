---
description: "Global and per-project skill enablement for users and maintainers who turn individual skills on or off without editing or deleting them."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-preferences

English | [中文](README.zh.md)

## Summary

This package lets a user turn any skill on or off by name, for every project or for one project. A disabled skill disappears from the model's skill catalog, the `skill` tool, the `/name` command, and the `/` suggestions, while its files stay untouched. Preferences live in one JSON file in the DSH home, so project repositories never change. The Skills page, the `manage_skills` agent tool, and other management surfaces write through the `ctx.skillPreferences` service; hand edits to the file are picked up while DSH runs.

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

The shipped composition enables the plugin with its defaults. Every skill is enabled until a preference disables it.

### Resolution order

For a lookup whose working directory lies inside a project, the first matching rule decides:

1. The project lists the skill under `enabled`: enabled.
2. The project lists the skill under `disabled`: disabled.
3. `global.disabled` lists the skill: disabled.
4. Otherwise: enabled.

The project root is the nearest ancestor containing `.git`, or the working directory itself, which is the same root project skill discovery uses. A lookup without a working directory applies only the global level.

### Preferences file

The default path is `<dshHome>/skill-preferences.json`, where `dshHome` resolves from configuration, then `$DSH_HOME`, then `~/.dsh`.

```json
{
  "version": 1,
  "global": { "disabled": ["pdf"] },
  "projects": {
    "/home/me/work/report": { "enabled": ["pdf"], "disabled": ["frontend-design"] }
  }
}
```

Project keys are absolute paths. Every name must be a kebab-case skill name. The service writes the file with sorted, deduplicated lists and owner-only permissions.

### Configuration

| Field | Default | Effect |
|---|---|---|
| `file` | `<dshHome>/skill-preferences.json` | Preferences file path. |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Home used when `file` is omitted. |
| `watch` | `true` | Reload the file after external edits. |

### Service

`ctx.skillPreferences` exposes:

- `setEnabled({ name, enabled, projectRoot? })` changes the global preference, or with `projectRoot` records a project override. A project change that matches the global preference removes the override instead.
- `clearOverride({ name, projectRoot })` removes one project override.
- `decide(name, projectRoot?)` returns `{ enabled, origin }`, where `origin` is `default`, `global`, or `project`.
- `projectRootOf(cwd)` resolves the project root a working directory keys on.
- `state()` returns the committed preferences.

Each mutation emits `skill-preferences/change` and `skills/change` after the file write commits.

### Observable success and failures

- A disabled skill is absent from `ctx.skills.list()`, `snapshot()`, and `get()`; `ctx.skills.inventory()` still lists it with `disabledBy: ["skill-preferences"]`.
- A malformed file at startup stops the plugin from loading, and the error names the file and field.
- A file that becomes malformed while DSH runs makes every skill read fail until the file is fixed, so a broken file never re-enables a disabled skill. Mutations also refuse to overwrite a malformed file.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The service registers one `ctx.skills` filter named `skill-preferences`. The registry applies filters to merged winners inside `list`, `snapshot`, and `get`, so no consumer can bypass a disable. A disabled winner is not replaced by a lower-ranked skill with the same name.

Mutations run one at a time within the process and hold the cross-process `withFileLock` lock around a read-modify-write cycle. The file commits through `writeFileAtomic`; the in-memory state and the catalog invalidation follow the commit. The Chokidar watcher ignores its own commits when the reloaded state equals the committed state.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service, filter registration, resolution, file validation, locked writes, and watcher |
| — | No runtime invariant companion is published; the committed state and the filter read the same in-memory value, so no independent observations can diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill subsystem reference](../../../docs/subsystems/skills.md) — the registry filter seam and how enablement combines with providers.
- [skill package](../skill/README.md) — `registerFilter()` and `inventory()`.
- [tool-skill package](../tool-skill/README.md) — how a catalog change reaches the model at the next step.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`: a disabled skill is omitted from the catalog it renders, and the `skill` tool reports the name as unknown.

#### KV Cache effect

A toggle changes the catalog. At the next step `dsh-tool-skill` appends a logged replacement catalog after the existing prefix, so the earlier prefix stays cacheable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Name-level control** — a preference applies to a skill name, not to one provider's copy; disabling a name hides every same-name candidate.
- **Host-local file** — preferences do not follow the user to another machine.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
