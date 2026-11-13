# Neon Deck (fork)

**Plugin id:** `neon-deck-fork` · **Name:** Neon Deck (fork) — placeholder, to be renamed before any release
**Fork by:** {{CO_AUTHOR}}, with Claude
**Repository:** {{REPO_URL}}
**Based on:** [Neon Deck](https://github.com/Yobzs/neon-deck-obsidian) by Yobzs, version 2.2.0 (CC BY-NC-SA 4.0). The same licence applies to this fork; the changes are listed below.

The aim is to use Neon Deck with an existing vault without it changing, moving or creating notes.

Work happens on the `claudeai` branch. Each change is its own commit so the general ones can be offered back upstream later.

## Placeholders to fill in

Search the repo for `{{CO_AUTHOR}}` and `{{REPO_URL}}`. They appear in:

- `src/kernel/manifest.json` (`author`, `authorUrl`), copied to `manifest.json` by the build
- `src/kernel/_header.js` (the comment at the top of `main.js`)
- `README.md` and this file

To rename the plugin, change `id` and `name` in `src/kernel/manifest.json`, along with the zip name in `.github/workflows/package-installer.yml`. The build folder and the checks follow the id automatically. The id is also the folder name in `.obsidian/plugins/`, which holds the settings, so renaming it later means moving that folder.

## What is different from upstream

| Change | Why |
|---|---|
| **Own plugin id and name** (`neon-deck-fork`) | Installs next to, not over, the original. If the original Neon Deck is also enabled, the fork refuses to start, because they share views, commands and module ids. |
| **Read-only mode, on by default** (*Settings → Neon Deck modules → Protect my notes*) | Neon Deck only reads the vault. Every create, change, move, rename or delete of a note, folder or image is refused; only its own settings in its plugin folder are saved. Background jobs are refused quietly; a notice appears when a write follows your click or key press. |
| **No move into `Core`** | The automatic first-run "tidy into Core" (which also moved the templates and daily notes folders) and its command are removed. |
| **Every location is a setting** | Deck: reviews, pin board, pinned files (new), bridge notes. Tickets: ticket folder, screenshot folder (new). Write: image folder (new). Time: log folder. Tasks: quick tasks, backup. Defaults sit under `Neon/` and are only created when a feature is used (and only with read-only off). |
| **Gentler defaults** | "Move new images" is off; excluded folders default to empty. |

## How the read-only guard works

`src/shared/guard.js`. The kernel gives every module a stand-in for Obsidian's `app` whose `vault`, `fileManager` and `vault.adapter` refuse write calls while read-only is on. `writeNote` (which can edit an open note through the editor) and the Write module's automatic edits check it too. Obsidian's real `app` is untouched, so other plugins are unaffected. `test/guard.test.mjs` checks every write path.

Editing commands you run yourself in an open note (slash menu, format toolbar, table picker) are ordinary typing and are not blocked. Turn the Write module off if you don't want them.

## Build and install

```bash
node tools/build.mjs              # → dist/neon-deck-fork/{main.js,manifest.json,styles.css}
node --test test/*.test.mjs       # unit tests
node tools/check.mjs dist         # project checks
```

Copy the three files from `dist/neon-deck-fork/` into `<vault>/.obsidian/plugins/neon-deck-fork/`, then enable **Neon Deck (fork)** in Community plugins.

Before turning read-only off, commit the vault so `git status` shows exactly what changed.

## Planned

- Categories from your own property (e.g. `customer`) instead of the fixed projects / school / admin / operations
- Choose which property or tag marks task notes and tickets
- Weekly notes with a folder in the date format (e.g. `YYYY/YYYY-ww`)
