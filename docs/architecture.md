# Neon Deck architecture (2.0)

One Obsidian plugin (`neon-deck`) made of six modules. This page is the current design; `MAP.md` lists every file and function.

## Shape
- **Mother plugin** (`src/kernel/mother.js`): the plugin Obsidian loads. It runs each module as a **child `Plugin`** with its own manifest id, data folder and settings tab, so command ids, view types and saved data stay what they were in 1.x. Obsidian's own Plugin lifecycle removes everything a module registered when it is switched off.
- **Modules** (`src/<module>/`): `deck` (dashboard, cards, graph, themes, pattern), `tasks`, `time`, `tickets`, `research`, `write`. Each has `plugin.js` (the Plugin class: load, settings, events) and job files that add methods with `Object.assign(Class.prototype, { ... })`.
- **Shared** (`src/shared/shared.js`): helpers every module uses (format, DOM, categories, files, daily notes, `writeNote`, cross-module lookups). One copy.

## Rules the code relies on
- **Modules never import each other.** They meet through the Deck API (`deckApi(app)`: widgets, captures, facts, activity, services such as `timeDay`) and workspace events (`neon:task-done`, `neon:ticket-changed`, `neon:time-entry`). A module that is off is simply absent; every caller handles `null`.
- **One write path:** text changes to notes go through `writeNote(app, file, fn)`: one write at a time per note; when the note is open in an editor the change is applied there as a minimal edit (cursor, focus and undo stay).
- **Isolation:** a module that throws while starting is stopped alone; if the plugin crashed while starting, the next start is safe mode (all modules off). Switches live in *Settings → Neon Deck modules* (`modules.json`).
- **100% local:** no network, no system notifications, no `child_process`, no `eval`. Fonts are embedded in `styles.css`.
- **Keep formats:** settings keys, note formats, command ids and view types don't change without a migration.

## Build and checks
- `node tools/build.mjs` joins `src/` (order in `tools/files.json`) into `dist/neon-deck/{main.js,styles.css,manifest.json}`; each module is wrapped in its own scope.
- `node --test test/*.test.mjs`: unit tests on the real source files with a tiny Obsidian stand-in.
- `node tools/check.mjs dist`: local-only rules, cleanup, timers, writes, CSS, file sizes.
- `node tools/map.mjs` regenerates `MAP.md`.

## Open
- **Shared note index:** one cached scan for tasks, tickets, research and deck instead of each module scanning the vault.
- **Community list:** the license (CC BY-NC-SA 4.0) still needs to be confirmed as acceptable.
- On hold: CSV ticket import.
