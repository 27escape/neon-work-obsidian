# Contributing to Neon Work

Thanks for your interest. Neon Work is a personal project, re-engineered from [Neon Deck](https://github.com/Yobzs/neon-deck-obsidian) by Yobzs, so contributions are welcome but kept small and careful.

## Reporting a problem or an idea

Open an issue on GitHub with:

- what you did, what you expected and what happened instead;
- your Obsidian version, the plugin version (Settings → Community plugins) and whether it was on the desktop, a phone or a tablet;
- a screenshot if it helps, and anything from the developer console (Ctrl+Shift+I) that mentions Neon Work.

Please don't include private notes: the [sample vault](sample%20vault) is a good place to reproduce a problem.

## Changing the code

- Read `CLAUDE.md` (the rules the code keeps), `docs/architecture.md` (the design) and `MAP.md` (where everything is).
- Plain JavaScript, no runtime dependencies and no bundler: `node tools/build.mjs` builds `dist/neon-work/`.
- Before a pull request: `node --test test/*.test.mjs` and `node tools/check.mjs dist` must pass. Every bug fixed gets a unit test or a check.
- The plugin stays 100% local (no network, no telemetry) and read-only by default: it never changes a note unless the user acts.
- Keep file formats, settings keys, command ids and view types, so existing vaults and layouts keep working.
- UI text in plain British English.

## Licence

By contributing you agree that your changes are released under the same licence as the project (see `LICENSE`).
