# ✦ Neon Deck (fork)

A command centre for an Obsidian vault: a dashboard, projects, tasks, time tracking, research notes and a few writing touches, in a neon look with live background patterns. Fork by {{CO_AUTHOR}} ({{REPO_URL}}) of [Neon Deck](https://github.com/Yobzs/neon-deck-obsidian) by Yobzs.

The fork is built to sit on top of a vault you already have: **read-only by default**, it never moves your files, and it reads your own properties and folders instead of asking you to adopt its own. See [FORK.md](FORK.md) for everything that differs from the original.

Everything runs **100% locally**: no network calls, no telemetry, no remote fonts or code, no `eval`.

| Section | What it does |
|---|---|
| **Dashboard** | Totals, vault pulse, recently done, activity calendar, a Claude card, quick capture (to your inbox), the card explorer, a note graph, themes and patterns |
| **Tasks** | Open `#task` lines from across the vault grouped by due date, and a Todo card for your Todo note; New note by customer and kind |
| **Projects** | Notes tagged `project`, by customer and status, with your own status values; New project from your template |
| **Research** | Research folders as topic trees (one pattern can cover every customer), notes by their `status` property, link suggestions |
| **Time** | Active time per customer, manual entries, overtime, an optional daily time log note |
| **Write** | Table picker, styled tables, dividers, locked callouts, a faint pattern behind notes |

All settings are on one page (*Settings → Neon Deck (fork)*), with a section per part. Switch any part off in *Overview* and the rest keeps working.

## Install

1. Build it (`node tools/build.mjs`) or take the three files from a release: `main.js`, `manifest.json`, `styles.css`.
2. Put them in `<your vault>/.obsidian/plugins/neon-deck-fork/` (create the folder if needed).
3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if needed, and enable **Neon Deck (fork)**.
4. On first start it asks for a **base folder**: where it may keep what it makes for itself (e.g. `2.Resources`). Nothing is created until you use a feature that needs it, and read-only is on until you switch it off.

**Updating:** copy the three files over the ones in `.obsidian/plugins/neon-deck-fork/` and reload the plugin. Don't delete the folder: it also holds your settings.

**Safe mode:** if the plugin ever fails while starting, the next start keeps all parts off; turn them back on in *Overview*.

## For developers

- **Sources** are in `src/` (one job per file); `MAP.md` lists every file with its functions, `CLAUDE.md` has the rules.
- **Build:** `node tools/build.mjs` → `dist/neon-deck-fork/` (no dependencies). Each part is a module: a child `Plugin` run by `src/kernel/mother.js`.
- **Check:** `node --test test/*.test.mjs` (unit tests) and `node tools/check.mjs dist` (local-only, cleanup, timers, writes, CSS…).
- **Saved data** (`data.json`, `modules.json`) is personal and isn't in this repo.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), as the original: you may use, share and fork it with credit, but not sell it or use it commercially, and forks keep the same license. See [LICENSE](LICENSE). The bundled fonts keep their own license.

## Credits

Original Neon Deck made by [Yobzs](https://github.com/Yobzs) with Claude. Fork changes by {{CO_AUTHOR}} with Claude.

Bundled fonts (in `src/deck/fonts/`, embedded in `styles.css`): JetBrains Mono, Space Grotesk and Unbounded, all under the SIL Open Font License 1.1. See [`src/deck/fonts/OFL.txt`](src/deck/fonts/OFL.txt).
