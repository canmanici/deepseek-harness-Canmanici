---
description: "The Web Skills page under Plugins for users who find skills in public marketplaces, install them in one click, switch them on or off, edit any skill, and keep sources up to date."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-skill-library

English | [中文](README.zh.md)

## Summary

This package adds a **Skills** entry to the Web and Desktop sidebar, directly below **Plugins**. **Discover** searches public skill marketplaces and installs a skill with one click. **Installed** lists every skill by origin with a switch, an inspector for its instructions, and edit, customize, uninstall, or delete actions. **Sources** shows each synced repository, checks for updates, and updates it. **New skill** writes your own skill to `~/.dsh/skills`.

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

Click **Skills** in the sidebar. The shipped Web composition mounts the row `ui-skill-library`; it requires the Host `skill-manager` row, and Discover requires the Host `skill-marketplace` row.

### Discover

- The search field queries every enabled marketplace after typing pauses; each marketplace chip shows how many skills it offers or matches, **Search only** for marketplaces that list nothing without a query, and **Unreachable** after a failed count.
- Each card shows the marketplace, install and star counts where reported, the skill's `/name`, its description, and its repository. **Install** adds the skill; **Installed** marks skills already present, and a warning names an installed skill with the same name.
- **Load more** appends the next page.

### Installed

- **All**, **On**, and **Off** filter by state; the scope picker applies switches to all projects or to one workspace project as a resettable override.
- Selecting a skill opens the inspector: origin, `/name`, description, a power switch, invocation tags, when-to-use guidance, the rendered instructions, and the file path.
- Local skills show **Edit**. Remote and bundled skills show **Customize**, which copies the skill into `~/.dsh/skills`, where the copy replaces the original; deleting the copy restores it. Remote skills show **Uninstall**, and skills in `~/.dsh/skills` show **Delete**; both ask for confirmation.
- A banner reports sources with updates and offers **Update all**.

### Sources

- Each card shows the source's kind, URL with ref and subfolder, installed out of available skills, short commit, sync age, and **Update available** after an update check.
- **Check for updates** asks every GitHub source for its newest commit; **Update** or **Sync** downloads it. **Add source** accepts a GitHub, `.zip`, or `SKILL.md` link.

### New and edited skills

The editor takes a name typed as it will be invoked, a description the agent routes on, optional when-to-use guidance, Markdown instructions with a **Preview** tab, and switches for model and `/` command invocation. Editing keeps the name fixed and preserves other frontmatter keys.

The page refreshes when the Host reports `skill-manager/changed`, including changes from another window, the CLI, an agent's `manage_skills` call, or edited files.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`SkillsController` owns one snapshot store. It loads the inventory and sources when the page first renders and then checks for updates, loads marketplaces when Discover first renders, applies a switch optimistically and rolls it back when the Host refuses, and ignores responses a newer request has replaced. An install shows **Installing** until a remote skill of that name appears in the inventory. All copy lives in `locales.ts`; colors come from the shared `--dsw-alias-*` tokens, and layout breakpoints are container queries on the page.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Sidebar entry, main panel registration, and Host event refresh |
| [`src/client/controller.ts`](src/client/controller.ts) | Page state and Remote round trips |
| [`src/client/SkillLibraryPage.tsx`](src/client/SkillLibraryPage.tsx) | Header, view tabs, and notices |
| [`src/client/DiscoverView.tsx`](src/client/DiscoverView.tsx) | Marketplace search, chips, and result cards |
| [`src/client/LibraryView.tsx`](src/client/LibraryView.tsx) | Installed list, filters, scope picker, and update banner |
| [`src/client/SkillInspector.tsx`](src/client/SkillInspector.tsx) | Skill inspector and its actions |
| [`src/client/SkillEditor.tsx`](src/client/SkillEditor.tsx) | Create-and-edit form with Markdown preview |
| [`src/client/SourcesView.tsx`](src/client/SourcesView.tsx) | Source cards, update checks, and add and remove dialogs |
| [`src/client/helpers.ts`](src/client/helpers.ts) | Grouping, labels, link kinds, and install state |
| [`src/client/SkillLibrary.module.css`](src/client/SkillLibrary.module.css) | Styles |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese copy |
| — | No runtime invariant companion is published; the page renders one store fed by one Remote. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [host-skill-manager](../../host/skill-manager/README.md) — the Remote this page calls.
- [skill-marketplace](../../skill/skill-marketplace/README.md) — the marketplaces Discover searches.
- [skill-preferences](../../skill/skill-preferences/README.md) and [skill-sources](../../skill/skill-sources/README.md) — where switches and installs persist.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side page that registers nothing model-facing; enablement and installs reach the model through the skill catalog.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No rename** — rename a skill by creating one with the new name and deleting the old one.
- **Same-name installs** — installing a skill whose name another installed skill uses shows a warning; whichever ranks higher stays active.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
