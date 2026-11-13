# Neon Deck (fork)

**Plugin id:** `neon-deck-fork` · **Name:** Neon Deck (fork) — placeholder, to be renamed before any release
**Fork by:** {{CO_AUTHOR}}, with Claude
**Repository:** {{REPO_URL}}
**Based on:** [Neon Deck](https://github.com/Yobzs/neon-deck-obsidian) by Yobzs, version 2.2.0 (CC BY-NC-SA 4.0). The same licence applies to this fork; the changes are listed below.

The aim is to use Neon Deck with an existing vault without it changing, moving or creating notes, and to fit a vault organised by customer (`1.Customers/<customer>/Meetings|People|Projects|Research`).

Work happens on the `claudeai` branch.

## Placeholders to fill in

Search the repo for `{{CO_AUTHOR}}` and `{{REPO_URL}}`. They appear in:

- `src/kernel/manifest.json` (`author`, `authorUrl`), copied to `manifest.json` by the build
- `src/kernel/_header.js` (the comment at the top of `main.js`)
- `README.md` and this file

To rename the plugin, change `id` and `name` in `src/kernel/manifest.json`, along with the zip name in `.github/workflows/package-installer.yml`. The build folder and the checks follow the id. The id is also the plugin's folder name in `.obsidian/plugins/`, which holds the settings, so renaming it later means moving that folder.

## What is different from upstream

| Change | What it means |
|---|---|
| **Own plugin id and name** | Installs next to, not over, the original. If the original Neon Deck is also on, the fork refuses to start (they share views and commands). |
| **Read-only, on by default** | The plugin only reads the vault: every create, change, move, rename or delete is refused, apart from its own settings files. Background jobs are refused quietly; a notice appears when a write follows your click or key press. Switch it off in *Overview*. |
| **One settings page** | Sections for Overview, Dashboard, Tasks, Projects, Research, Time and Write. Folder and file fields suggest vault paths as you type. |
| **No `Core` folder, a base folder instead** | Nothing is moved, ever. Asked once on first start: the folder where the plugin keeps what it makes for itself (Projects without a customer, Reviews, Time Log, `Todo.md`, the pin board, Bridges). Every location can also be set on its own. Nothing is created until a feature needs it. |
| **Projects, not tickets** | Notes tagged `project` are the projects. Your own status values in four groups (not started, active, on hold, closed); customer from the `customer` property or the customer folder; `stage`, `note`, `started`, `due` shown. Status changes write properties only (`completed` / `cancelled` dates). New projects go in `<customer>/Projects/` from your template. All upstream ticket features (ticket view, templates, PDF export, screenshots, priority, Jira, filing) are removed. |
| **Tasks as in the Tasks plugin** | Any checkbox line with `#task` is a task; `[/]` counts as open; grouped by 📅 due or ⏳ scheduled. A **Tasks tab** in the sidebar list shows them full size next to the Todo card. The Todo card is your Todo note: new tasks go at its head as `- [ ] #task … ➕ date`. |
| **Timelines** | Mermaid Gantt charts: the Projects tab can show a timeline by customer instead of the list, and the Tasks tab has a timeline card of dated tasks. Both can be copied as a Mermaid block. Nothing is written to the vault. |
| **Daily and weekly notes** | Folder, format and template come from the core Daily notes plugin while it is on (the plugin's own settings, copied from it, otherwise). Formats with folders (`YYYY/YYYY-ww`) work. |
| **Research, not Study** | Sections are folders you choose (a `*` pattern such as `1.Customers/*/Research` gathers every customer's folder); notes grouped by their `status` property; new notes from a template. Quizzes and flashcards are removed. |
| **Customers are the categories** | Colours, card explorer chips and time tracking use the folders in the customers folder. |
| **New note by customer and kind** | Note, meeting, person (`@Name` with aliases), project or research, filed under `<customer>/<Meetings, People, Research>/` from a template per kind. |
| **Claude card** | Dashboard card listing notes by their `claude` property: waiting for Claude (`process`, `refine`) and to review (`updated`). Read only. |
| **Weekly review template** | *Create / open this week's review* starts from a template note you choose (`{{weekLine}}`, `{{weekNotes}}`, `{{date:…}}`, `{{weekEnd:…}}`). |
| **Inbox capture** | Quick capture can save a thought as a new note in your inbox folder, from your inbox template. Templater's `tp.file.title` and `tp.date.now()` are filled in. |
| **Trimmed** | Write keeps the table picker, styled tables, dividers, locked callouts and the note pattern; the slash menu, selection toolbar and image moving are gone. The Revisit feature for "school" notes is gone. Time has no Jira field or column. Templates folders and top-level archive folders are left out of stats, tasks and projects. The lifted writing window is full width when *Readable line length* is off. "Fix properties" and the automatic category rename are removed (they deleted empty template properties). |
| **Naming** | The UI names the plugin by its manifest name and the parts by their section (Dashboard, Tasks, Projects, Research, Time, Write); commands read "Neon Deck (fork) – Tasks: …". Module ids and folders keep upstream's names, so saved data carries on. |

## How the read-only guard works

`src/shared/guard.js`. The kernel gives every module a stand-in for Obsidian's `app` whose `vault`, `fileManager` and `vault.adapter` refuse write calls while read-only is on. `writeNote` (which can edit an open note through the editor) and Write's automatic edits check it too. Obsidian's real `app` is untouched, so other plugins are unaffected. `test/guard.test.mjs` checks every write path.

## Build and install

```bash
node tools/build.mjs              # → dist/neon-deck-fork/{main.js,manifest.json,styles.css}
node --test test/*.test.mjs       # unit tests
node tools/check.mjs dist         # project checks
```

Copy the three files from `dist/neon-deck-fork/` into `<vault>/.obsidian/plugins/neon-deck-fork/`, then enable **Neon Deck (fork)** in Community plugins (or reload it). Before turning read-only off, commit the vault so `git status` shows exactly what changed.

## Settings for the E2I vault

| Section | Setting | Value |
|---|---|---|
| Overview | Base folder | `2.Resources` |
| Dashboard | Inbox folder / Inbox template | `2.Resources/Inbox` / `2.Resources/templates/inbox_template.md` |
| Dashboard | Weekly review template | `2.Resources/templates/weekly_review_template.md` |
| Tasks | Folder for notes without a customer | `2.Resources` |
| Tasks | Note / Meeting / Person / Research template | `2.Resources/templates/note_template.md` / `meeting_template.md` / `person_template.md` / `research_template.md` |
| Projects | Project template | `2.Resources/templates/project_template.md` |
| Research | Sections | `2.Resources/Research` and `1.Customers/*/Research` |
| Research | Template note | `2.Resources/templates/research_template.md` |

With the base folder set to `2.Resources`, the Todo note is `2.Resources/Todo.md` without further settings. The project tag, status values, customers folder, `#task` and the daily-notes settings already match by default.
