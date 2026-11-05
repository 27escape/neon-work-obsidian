# Neon Deck — notes for Claude Code

Obsidian plugin by Yobzs (one plugin, six modules). Plain JavaScript, no runtime dependencies, no bundler: `tools/build.mjs` joins `src/` files in the order listed in `tools/files.json`.

## Knowledge graph first (saves tokens)
If `~/.claude/graphify/neon-deck/` exists, ask it before reading code: `cd ~/.claude/graphify/neon-deck && graphify query "<question>"` (also `graphify explain "<name>"`, `graphify path "A" "B"`), then open only the files it names. After changing code: `~/.claude/graphify/neon-deck/sync.sh && graphify update` from that folder. Hand simple reading/writing to cheaper subagents (haiku/sonnet).

## Where things are
- `docs/architecture.md` is the current design (modules, rules, build). `MAP.md` lists every source file and every function/class/method in it (regenerate: `node tools/map.mjs`). Find code there first, then open only that file.
- `src/shared/shared.js`: helpers used by every module (format, dom, categories, files, cross-module glue). One copy.
- `src/<module>/`: deck, tasks, time, tickets, research, write. `plugin.js` = the module's Plugin class (lifecycle, settings); other files add methods with `Object.assign(Class.prototype, { ... })`, one job per file.
- `src/kernel/mother.js`: Neon Deck 2 (one plugin): runs each module as a child Plugin; switches, safe mode, data adoption.
- Styles: `src/<module>/styles*.css` (listed per module in `tools/files.json`); the build concatenates them and embeds the fonts from `src/deck/fonts/`.

## Build and test
- `node tools/build.mjs` → `dist/neon-deck/{main.js,styles.css,manifest.json}` (and copies the manifest to the repo root).
- `node --test test/*.test.mjs` runs the unit tests (real source files, tiny Obsidian stand-in).
- Real Obsidian: test vault `~/Documents/neon-test-vault` (made-up data), opened as a second window; drive it over CDP (`obsidian --remote-debugging-port=9222`), pick the window by title ` - neon-test-vault - `. Never open an unregistered vault with an `obsidian://open?path=` link (native dialog blocks Obsidian); use `require('electron').ipcRenderer.sendSync('vault-open', path, false)`.
- Bug catcher: `node tools/check.mjs dist` (or a vault path).

## Rules
- 100% local: no network, no system notifications (`new Notification` froze Obsidian on Linux), no child_process, no eval, no `innerHTML` with data.
- Never rewrite the note the user is typing in; writes through `vault.process`.
- Keep file formats, settings keys, command ids and view types.
- Files: one job each, target under 400 lines (soft cap 500). New feature = new file + entry in `tools/files.json` + `node tools/map.mjs`.
- Every bug fixed gets a unit test or a check.
