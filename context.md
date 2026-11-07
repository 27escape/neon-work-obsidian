# Kimi context

Neon Deck is one local-only Obsidian desktop plugin with six modules. Start with `CLAUDE.md`, `docs/architecture.md`, and `MAP.md`; those remain the canonical project documentation.

## Working setup

- Repository: `~/Documents/neon-deck`.
- Use `graphify query "..."` in `~/.claude/graphify/neon-deck` before reading implementation code. After code changes run `./sync.sh && graphify update` there.
- Build: `node tools/build.mjs`.
- Tests: `node --test test/*.test.mjs`.
- Static checks: `node tools/check.mjs dist`.
- After adding a source file, register it in `tools/files.json` and run `node tools/map.mjs`.
- Commit and push requested work. Do not publish a release unless explicitly requested.

## Live verification

Use only `~/Documents/neon-test-vault` with made-up data. Install a build by copying `dist/neon-deck/{main.js,manifest.json,styles.css}` into its `.obsidian/plugins/neon-deck/` directory. The CDP helpers are in `~/Documents/Projects/Core/Neon/Dev/cdp`; select the test vault with `VAULT=neon-test-vault`. Exercise the actual controls, clean up fixtures, close dialogs, and restore test settings.

Keep the plugin offline, dependency-free at runtime, and within the existing module/file conventions. Do not use the real Projects vault for testing.
