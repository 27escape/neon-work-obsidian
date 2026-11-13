# Neon Deck — 27escape fork

A personal fork of [yobzs/neon-deck-obsidian](https://github.com/yobzs/neon-deck-obsidian) (CC BY-NC-SA 4.0). The aim is to use Neon Deck with an existing vault without it changing, moving or creating notes.

Work happens on the `claudeai` branch. Each change is its own commit so the general ones can be offered back upstream later.

## What is different from upstream

| Change | Why |
|---|---|
| **Read-only mode, on by default** (*Settings → Neon Deck modules → Protect my notes*) | Neon Deck only reads the vault. Every create, change, move, rename or delete of a note, folder or image is refused; only its own settings in `.obsidian/plugins/neon-deck/` are saved. Background jobs are refused quietly; a notice appears when a write follows your click or key press. |
| **No move into `Core`** | The automatic first-run "tidy into Core" (which also moved the templates and daily notes folders) and its command are removed. |
| **Every location is a setting** | Deck: reviews, pin board, pinned files (new), bridge notes. Tickets: ticket folder, screenshot folder (new). Write: image folder (new). Time: log folder. Tasks: quick tasks, backup. Defaults sit under `Neon/` and are only created when a feature is used (and only with read-only off). |
| **Gentler defaults** | "Move new images" is off; excluded folders default to empty. |

## How the read-only guard works

`src/shared/guard.js`. The kernel gives every module a stand-in for Obsidian's `app` whose `vault`, `fileManager` and `vault.adapter` refuse write calls while read-only is on. `writeNote` (which can edit an open note through the editor) and the Write module's automatic edits check it too. Obsidian's real `app` is untouched, so other plugins are unaffected. `test/guard.test.mjs` checks every write path.

Editing commands you run yourself in an open note (slash menu, format toolbar, table picker) are ordinary typing and are not blocked. Turn the Write module off if you don't want them.

## Build and install

```bash
node tools/build.mjs              # → dist/neon-deck/{main.js,manifest.json,styles.css}
node --test test/*.test.mjs       # unit tests
node tools/check.mjs dist         # project checks
```

Copy the three files from `dist/neon-deck/` into `<vault>/.obsidian/plugins/neon-deck/`, then enable **Neon Deck** in Community plugins.

Before turning read-only off, commit the vault so `git status` shows exactly what changed.

## Planned

- Categories from your own property (e.g. `customer`) instead of the fixed projects / school / admin / operations
- Choose which property or tag marks task notes and tickets
- Weekly notes with a folder in the date format (e.g. `YYYY/YYYY-ww`)
