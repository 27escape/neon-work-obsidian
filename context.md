# Context for coding agents

Neon Work is one local-only Obsidian desktop plugin: a kernel and six modules (Dashboard, Tasks, Projects, Research, Time, Write). Start with `CLAUDE.md`, `docs/architecture.md`, `FORK.md` and `MAP.md`; those are the canonical project documentation.

## Working setup

- Branch: `claudeai`.
- Build: `node tools/build.mjs` → `dist/neon-work/`.
- Tests: `node --test test/*.test.mjs`.
- Static checks: `node tools/check.mjs dist`.
- After adding a source file, register it in `tools/files.json` and run `node tools/map.mjs`.
- Commit requested work; push or publish a release only when asked.

## Live verification

Install a build by copying `dist/neon-work/{main.js,manifest.json,styles.css}` into a vault's `.obsidian/plugins/neon-work/` and switching the plugin off and on. Prefer a test vault with made-up data. In a real vault keep read-only on, or commit the vault first so every change shows in `git status`.

Keep the plugin offline, dependency-free at runtime, read-only by default, and within the existing module and file conventions.
