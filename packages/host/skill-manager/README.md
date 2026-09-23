---
description: "The skillManager Remote for maintainers of the Skills page: installed skills, per-skill enablement, authoring, marketplace installs, updates, and remote skill sources."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-skill-manager

English | [中文](README.zh.md)

## Summary

This package serves the `skillManager` Remote namespace that the Web **Skills** page calls. It lists every installed skill with its enablement, switches skills on or off globally or per project, and creates, edits, customizes, and deletes skills. It searches public marketplaces, installs and uninstalls single skills, checks sources for updates, and manages remote sources. Enablement persists through `ctx.skillPreferences`, installs through `ctx.skillSources`, and user skills are `SKILL.md` files under `<dshHome>/skills`.

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

The shipped Web composition mounts the row `skill-manager` next to `plugin-inventory`. The plugin needs `ctx.skills`; skill preferences, skill sources, the workspace registry, and the agent preset roster are optional.

### Remote methods

| Method | Result |
|---|---|
| `inventory({ projectRoot? })` | Sorted skills with `enabled` and `preference` (`default`, `global`, or `project`), workspace projects, and whether preferences and sources are mounted |
| `setEnabled({ name, enabled, projectRoot? })` | Global preference, or a project override with `projectRoot` |
| `clearOverride({ name, projectRoot })` | Removes one project override |
| `sources()` | Remote sources with sync state, commit, time, error, installed and available counts, and update state |
| `addSource({ url, ref?, path? })` | Adds a source and starts its first sync |
| `syncSource({ id })`, `setSourceEnabled({ id, enabled })`, `removeSource({ id })` | Source operations |
| `readSkill({ name })` | Any installed skill's fields, file path, and whether it is editable in place |
| `createSkill(draft)` | Writes `<dshHome>/skills/<name>/SKILL.md`; refuses a name any installed skill already uses |
| `updateSkill(draft)` | Rewrites a local skill's fields in place and keeps its other frontmatter keys; the name cannot change |
| `deleteSkill({ name })` | Deletes a user skill's bundle directory or flat Markdown file; deleting a customized copy restores the original |
| `customizeSkill({ name })` | Copies a remote or bundled skill's directory into `<dshHome>/skills`, where the copy outranks the original |
| `marketplaces({ refresh? })` | Marketplaces with skill counts; `refresh` asks them first |
| `searchMarketplace({ query, marketplace?, offset?, limit? })` | Marketplace entries marked `available`, `installing`, or `installed`, with a `conflict` source label for a same-name installed skill |
| `installSkill({ repository, dir?, name })` | Adds the skill to the selection of the source that tracks the repository, or adds a source that installs only this skill, and syncs it |
| `uninstallSkill({ name })` | Removes a remote skill from its source's selection; an emptied user source is removed |
| `sourceSkills({ id })`, `setSourceSkills({ id, skills? })` | A source's offered skills, and replacing its selection |
| `checkUpdates()` | Asks every enabled GitHub source for its newest commit |

The inventory reads the default agent preset's scope, so it lists the skills a new session sees. Workspace projects are keyed by the same project root that per-project preferences use. A skill is `editable` in place when its winning file comes from the user, `~/.agents`, project, or custom skill directories; it is `deletable` when that file is `<dshHome>/skills/<name>/SKILL.md` or `<dshHome>/skills/<name>.md`; it is `customizable` when it is any other skill with a file; and it is `uninstallable` when it comes from a remote source. A draft has `name`, `description`, optional `whenToUse`, `body`, `modelInvocable`, and `userInvocable`; the service renders it with the same rules local discovery parses, so a saved skill always loads. Set `dshHome` to the same value as `dsh-skill-filesystem`'s when a deployment overrides it.

### Events and errors

The Host forwards `skill-manager/changed` whenever `skills/change`, `skill-preferences/change`, or `skill-sources/change` fires; clients refetch their view. After each skill file write it emits `skill-filesystem/changed`, so the catalog updates without waiting for a file watcher. A write to a service the composition does not mount fails with `skill-manager/unavailable`; a validation failure fails with `skill-manager/invalid-request` carrying its message; editing a skill that is not local, customizing a local skill, or uninstalling a skill that is not remote fails with `skill-manager/read-only`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `SkillManager` Remote service, projections, and event forwarding |
| [`src/authoring.ts`](src/authoring.ts) | `SKILL.md` rendering and parsing, and the user skills directory |
| [`src/types.ts`](src/types.ts) | Wire types, error details, and the `skill-manager/changed` event declaration |
| — | No runtime invariant companion is published; the service holds no state that could diverge from the services it reads. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill subsystem reference](../../../docs/subsystems/skills.md) — filters, preferences, and remote sources.
- [ui-skill-library](../../client/ui-skill-library/README.md) — the Skills page that calls this Remote.
- [skill-marketplace](../../skill/skill-marketplace/README.md) — the service behind marketplace searches.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a Remote management view; writes reach the model through `dsh-skill-preferences` and `dsh-skill-sources`, which change the catalog `dsh-tool-skill` renders.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Default preset view** — the inventory lists the default agent preset's skills; skills a different preset adds through its own directories are not shown.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
