# Neon Deck (fork) — notes for Claude

Obsidian plugin: a kernel and six modules (Dashboard, Tasks, Projects, Research, Time, Write), forked from Neon Deck 2.2.0 by Yobzs. Plain JavaScript, no runtime dependencies, no bundler: `tools/build.mjs` joins `src/` files in the order listed in `tools/files.json`. Work on the `claudeai` branch.

## Read first
- `docs/architecture.md`: the design (kernel, modules, shared configuration, what notes the plugin reads, how it writes, rules).
- `FORK.md`: what differs from upstream, and the settings for the E2I vault.
- `MAP.md`: every source file with its functions, classes and methods (regenerate: `node tools/map.mjs`). Find code there first, then open only that file.
- If a Graphify graph exists for this repo, query it before reading code.

## Where things are
- `src/kernel/`: `mother.js` (runs the modules as child plugins; switches, safe mode, read-only, base folder, data adoption) and `settings-page.js` (the one settings page with a section per module; the base folder prompt).
- `src/shared/`: `shared.js` (helpers for every module: format, DOM, categories / customers, daily notes, `writeNote`, templates, base folder paths, path suggestions) and `guard.js` (the read-only guard).
- `src/<module>/`: `deck` (Dashboard), `tasks`, `tickets` (Projects — the folder and module id keep upstream's names), `research`, `time`, `write`. `plugin.js` is the module's Plugin class; other files add methods with `Object.assign(Class.prototype, { ... })`, one job per file.
- Styles: `src/<module>/styles*.css` (listed per module in `tools/files.json`); the build concatenates them and embeds the fonts from `src/deck/fonts/`.

## Build and test
- `node tools/build.mjs` → `dist/neon-deck-fork/{main.js,styles.css,manifest.json}` (and copies the manifest to the repo root).
- `node --test test/*.test.mjs` runs the unit tests (real source files, a small Obsidian stand-in in `test/load.mjs`).
- `node tools/check.mjs dist`: local-only rules, cleanup, timers, writes, CSS, file sizes.
- To try a build, copy the three files into `<vault>/.obsidian/plugins/neon-deck-fork/` and switch the plugin off and on. Keep read-only on in a real vault, and commit the vault before switching it off, so `git status` shows every change.

## Rules
- **Don't change the user's notes unasked.** Read-only is on by default; every module gets the guarded `app`. Write only for an action the user takes, never move or rename notes on your own, and never write a `Core` or `Neon/` folder.
- **Read the user's conventions** rather than imposing the plugin's: settings for tags, properties, status values, folders and templates; empty location settings fall back to the base folder (`locPath`).
- 100% local: no network, no system notifications (`new Notification` froze Obsidian on Linux), no `child_process`, no `eval`, no `innerHTML` with data.
- Never rewrite the note the user is typing in: text changes through `writeNote`, properties through `processFrontMatter`.
- Keep file formats, settings keys, command ids and view types; migrate saved settings on load when a default changes.
- UI text: name the plugin with `appName()` and the parts by their section names; no "Neon Tasks", "tickets" or "Jira".
- Files: one job each, target under 400 lines (soft cap 500). New feature = new file + entry in `tools/files.json` + `node tools/map.mjs`.
- Every bug fixed gets a unit test or a check. Commits end with the attribution lines; the author is Kevin Mulholland <kevin@27escape.com>.
