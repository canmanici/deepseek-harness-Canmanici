# Agent Note: Per-skill enablement enforced by registry filters

Status: implemented

English | [中文](2026-09-23-skill-enablement-filters.zh.md)

## Problem

A user could stop a skill from reaching the model only by deleting or editing its files, or by disabling a whole provider plugin in `cordis.yml`. The GUI-first skill management work needs an instant, reversible switch per skill name that applies to every project or to one project, including skills from packaged or remote providers whose files the user does not own.

## Decision

`ctx.skills.registerFilter()` registers a host-wide `SkillFilter` whose `resolve(options)` returns a predicate for one lookup. The registry applies every filter to merged winners inside `list`, `snapshot`, and `get`, the operations that decide what the model catalog, the `skill` tool, `/name` invocation, and the Browser Session catalog see. A disabled winner is removed outright; a lower-ranked candidate with the same name does not take its place, so disabling a name never silently substitutes a different body. A rejected `resolve()` rejects the read, so a broken policy fails closed. `inventory()` returns every winner with `enabled` and the disabling filter names for management surfaces, without loading bodies.

`dsh-skill-preferences` is the shipped filter. It stores `global.disabled` plus per-project `enabled` and `disabled` override lists in `<dshHome>/skill-preferences.json`. Project keys use the root that project skill discovery uses, exported from `dsh-skill-filesystem` as `resolveSkillProjectRoot()`. Writes hold the cross-process file lock, commit with an atomic rename, and invalidate the catalog only after the commit. A malformed file blocks plugin load at startup; after an external edit makes it malformed, every skill read fails and mutations refuse to overwrite it until the file is fixed.

A toggle reaches a running Session through the existing catalog replacement in `dsh-tool-skill`: `skills/change` invalidates the catalog, and the next step logs a replacement catalog message, so model-visible state stays reconstructable from the session log without a new event type.

## Alternatives considered

**Filter in each consumer.** Rejected because the model tool, `/name` pre-step, Browser Session catalog, and future surfaces would each need the same check, and a missed consumer would expose a disabled skill. The invocation-policy decision kept consumer predicates because that policy depends on the calling surface; enablement does not.

**Filter before merging so a shadowed same-name skill takes over.** Rejected because the user disables a name they see in the catalog; replacing it with another provider's body under the same name would be a surprising substitution.

**Store preferences as a `.volatile()` Config field in the profile patch.** Rejected because per-project overrides keyed by absolute project roots do not belong in a profile's plugin configuration, and a Config change reloads the registry and its dependents instead of invalidating one catalog.

**Write overrides into each project's `.dsh/` directory.** Rejected because toggling a skill would modify the user's repository.

## Consequences

Any future enablement source, such as an organization policy, registers another filter and is reported by name in `inventory()`. Management GUIs read `inventory()` and write through `ctx.skillPreferences`. The registry unit tests cover filtered reads, fail-closed rejection, abort, and disposal; the preferences tests cover resolution, locked writes, the watcher, and file validation; the assembled loader snapshot proves that the shipped bundle omits a disabled skill from the catalog and the `skill` tool and applies project overrides.
