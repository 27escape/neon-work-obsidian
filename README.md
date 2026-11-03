# ✦ Neon Deck

Four small Obsidian plugins that work together as a personal command centre: a dashboard, tasks, tickets and automatic time tracking, in a neon look with live background patterns.

Everything runs **100% locally**: no network calls, no telemetry, no remote fonts or code, no `eval`. Files are only written when you do something that writes.

![Dashboard](docs/screenshots/dashboard.png)

| Plugin | What it does |
|---|---|
| **Neon Deck** | Dashboard, themes, live patterns, focus timer, quick capture, card explorer, concept graph, weekly review |
| **Neon Tasks** | Tasks widget, Global tasks, the New note card, Fix properties |
| **Neon Tickets** | Ticket view and pop-up, New ticket form, tracker, reminders, self-writing log, monthly counter |
| **Neon Time** | Active time per category, manual entries, overtime, daily Time Log notes for an AI agent |

Neon Deck is the core. The other three plug their cards, capture targets and facts into its dashboard. Turn any of them off and the rest keeps working; the dashboard gives the free space to the neighbours.

## Features

### Dashboard (Neon Deck)
- Focus timer, Vault pulse, Quick capture, Recently touched, Activity board, Tasks, Global tasks, Tickets and Time today on one page.
- The grid fills the window on any screen size; lists scroll inside their card, and narrow panes stack the cards.
- Themes (Marathon, Cyberpunk, Brutal, Calm, Paper, Night shift, Phosphor, Blueprint), each in light and dark.
- A live background pattern (Damascus, Meteorite, Topo, Circuit, Hex mesh, Datastream, Radar) that pauses when Obsidian isn't focused, during a focus session or with *Reduce motion* on.
- A ticker with live facts, and a totals strip: time worked, days worked, tasks and tickets done, notes created, focus sessions.
- Quick capture from anywhere with `Ctrl+Shift+Space`: send to Task, Global task, Ticket or Time entry.
- Card explorer with category chips and a *Revisit* reminder for notes you haven't opened in a while, plus a local concept graph.

### Tasks (Neon Tasks)
- Open tasks from notes tagged `tasks`, today's daily note and a Quick tasks note, grouped Overdue · Today · Later.
- Global tasks for the big things that aren't tied to a note, with a daily read-only backup.
- A New note card that asks for name, kind and category, and *Fix properties* to tidy frontmatter.

### Tickets (Neon Tickets)
- A ticket is a normal note with `type: ticket`. It opens as a pop-up with steps, a log that writes itself, due dates, reminders and a Waiting state with follow-ups.
- Done tickets file themselves into `Done/YYYY-MM/`; a counter reads like *14 done in November · 11 in October*.

### Time (Neon Time)

<img src="docs/screenshots/time-widget.png" alt="Time today widget" width="370" align="right">

- Counts active time only while a note is the focused tab and you type, scroll or click. It stops after a configurable idle time.
- Category comes from checkbox properties (`projects`, `school`, `admin`, `operations`) or tags. `untracked: true` notes are never logged.
- A donut against your workday target, overtime as an accent slice, weekly and monthly balance, and entries you can add, edit or delete (with Undo).
- **Wrap up** at the end of the day, and one Time Log note per day (`Core/Time Log/YYYY-MM-DD.md`) with totals, a Done today list and an entries table, written for an AI agent to send on to Jira. Neon Time itself never connects to Jira or the network.

<br clear="right">

![Time tab](docs/screenshots/time-tab.png)

## Install

These plugins aren't in the Community plugins list. Install them by hand:

1. Close Obsidian, or be ready to reload it.
2. Copy the `neon-deck`, `neon-tasks`, `neon-tickets` and `neon-time` folders into your vault's `.obsidian/plugins/` folder.
3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if needed, and enable the four plugins. Enable **Neon Deck** first, since the others add to its dashboard.
4. Open the dashboard from the ribbon `▦` icon or `Ctrl+P → Neon Deck: Open dashboard`.

Requires Obsidian 1.5.0 or later.

## For developers

- **No build step.** Each plugin's `main.js` is the source; edit it and reload Obsidian (`Ctrl+R`).
- **Shared helpers.** Lines 1–402 of every `main.js` are the same shared helper block (DOM helpers, modals, categories, daily notes, cross-plugin glue). Keep the four copies identical; `ND_VERSION` lives there too.
- **Plugins talk through Neon Deck's API** (`registerWidget`, `registerCapture`, `registerFacts`, …) and workspace events such as `neon:time-entry` and `neon:task-done`.
- **Saved data** (`data.json` in each plugin folder) is personal and isn't in this repo.
- To release a new version, bump `ND_VERSION`, the header comment and `manifest.json` in all four plugins.

## Release notes

- [1.4.1](docs/release-notes/1.4.1.md): dashboard fits the window; Neon Time fixes (nothing worked past 8h, untracked notes still tracked, midnight split and more).
- [1.4.0](docs/release-notes/1.4.0.md): totals strip, Cyberpunk theme, sidebar navigator, Ops → Operations, and fixes.

## License

The plugin code is under the [MIT License](LICENSE). The bundled fonts keep their own license (see below).

## Credits

Made by [Yobzs](https://github.com/Yobzs) with Claude.

Bundled fonts (in `neon-deck/fonts/`): JetBrains Mono, Space Grotesk and Unbounded, all under the SIL Open Font License 1.1. See [`neon-deck/fonts/OFL.txt`](neon-deck/fonts/OFL.txt).
