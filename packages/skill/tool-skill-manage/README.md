---
description: "The manage_skills tool for agents and subagents that list installed skills and switch them on or off."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-skill-manage

English | [中文](README.zh.md)

## Summary

This package registers the `manage_skills` tool. An agent or subagent calls it to list installed skills with their enablement, or to enable or disable skills by name for every project or only the current one. Writes go through `ctx.skillPreferences`, the service the Skills page uses, so a change made by an agent and a change made in the page are the same preference. The change reaches every agent's skill catalog at its next step.

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

The shipped base composition loads the tool after `tool-skill`. Its arguments:

| Argument | Values | Effect |
|---|---|---|
| `action` | `list`, `enable`, `disable` | `list` returns every installed skill; the others change enablement. |
| `names` | Exact skill names | Skills to change; required for `enable` and `disable`. |
| `scope` | `global` (default), `project` | `project` writes an override for the session's project root only. |

A name missing from the inventory, an empty `names`, a `project` scope without a working directory, or a composition without `skill-preferences` returns an error to the model and changes nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The tool reads `ctx.skills.inventory()` in the calling agent's scope, so it lists disabled skills too, and writes one preference per name through `ctx.skillPreferences.setEnabled()`. The registry filter from `dsh-skill-preferences` then hides or restores the skill, and `dsh-tool-skill` logs a replacement catalog at the next step, which keeps the model-visible catalog reconstructable from the session log.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool definition, validation, and list rendering |
| — | No runtime invariant companion is published; the tool keeps no state. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [skill-preferences package](../skill-preferences/README.md) — how global and per-project preferences resolve.
- [tool-skill package](../tool-skill/README.md) — the catalog that reflects each change.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`manage_skills` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-skill-manage).

#### Token effect

Fixed schema cost per request where the tool is visible.

#### KV Cache effect

The schema is part of the stable tool prefix and does not change between steps.

### Tool results

#### What the model sees

`list` returns a count line and one line per skill, or `No skills are installed.`; `enable` and `disable` return one confirmation line.

##### Result templates

```markdown
<on> of <total> skills enabled.
- `<name>` (<enabled|disabled>, <source>): <description>

<Enabled|Disabled> `<name>`, `<name>` for <every project|project <root>>. The skill catalog updates at the next step.
```

#### Token effect

A `list` result grows with the number of installed skills and their descriptions.

#### KV Cache effect

Results append to the conversation and leave the earlier prefix cacheable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No installs** — the tool changes enablement only; installing skills from a marketplace stays a user action in the Skills page, because a remote skill becomes instructions the model follows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
