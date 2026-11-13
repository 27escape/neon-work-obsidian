# ✦ Neon Work

A command centre for an Obsidian vault: a dashboard, projects, tasks, time tracking, research notes and a few writing touches, in a neon look with live background patterns. Fork by {{CO_AUTHOR}} ({{REPO_URL}}) of [Neon Deck](https://github.com/Yobzs/neon-deck-obsidian) by Yobzs.

The fork sits on top of a vault you already have:

- **Read-only by default.** It reads your notes and changes nothing until you switch read-only off, and even then only when you act (tick a task, set a status, create a note).
- **It never moves your files**, and creates nothing until a feature needs it.
- **It reads your own conventions**: notes tagged `project`, `#task` lines, a `status` property, customer folders (`1.Customers/<customer>/…`), your templates and your daily (or weekly) note settings.

Everything runs **100% locally**: no network calls, no telemetry, no remote fonts or code, no `eval`. [FORK.md](FORK.md) lists everything that differs from the original plugin; [docs/architecture.md](docs/architecture.md) describes how it is built.

## What it does

The plugin has six parts. Each can be switched off in the settings, and the others keep working. A list at the top of the left sidebar (Dashboard, Cards, Tasks, Projects, Time, Research, Graph) switches what the main pane shows; notes open in the same pane, and Back / Forward move between them.

### Dashboard

- **Cards** on one page: Totals, Vault pulse, Recently done, Activity (a month calendar, and this week with two weeks either side), Tasks, Todo, Projects, Time today and the **Claude card** (notes whose `claude` property asks for Claude's work, and notes Claude changed for you to review).
- **Recently done:** the last 14 days of finished work, read from your notes: tasks ticked with a ✅ date (in the editor, the Tasks plugin or these cards) and projects with a `completed` or `cancelled` date. Works in read-only mode.
- **Ticker and pin board:** a live line of facts at the top that opens into a pin board. Drop a note, a file or some text on it to pin it; pins live in one note, one line each.
- **Quick capture:** type a thought and send it to an **Inbox note** (a new note in your inbox folder, from your inbox template), the **Todo** note, a new **Project**, a **Time entry** or the pin board.
- **Card explorer** (sidebar or tab): your folders and notes as cards, coloured by customer, with filter chips per customer.
- **Note graph** with suggested "bridge" notes between clusters.
- **Weekly review** (*Create / open this week's review*): a note from your review template with the week in numbers and the notes you created or edited.
- **Themes and patterns:** nine themes, each in light and dark, with a live pattern behind the dashboard; chosen in *Settings → Dashboard*.

### Tasks

- **Tasks tab and card:** every open `#task` line across the vault (`[ ]` and `[/]`), grouped Overdue · Today · Later by 📅 due or ⏳ scheduled date. Tick, edit or open each one in place; the date and note sit on a small line under the task text. Notes tagged `tasks` and recent daily or weekly notes count every checkbox.
- **Todo card:** the open tasks of your Todo note in file order. New tasks go at the head of that note as `- [ ] #task … ➕ date`; ticking writes `[x] … ✅ date`, as the Tasks plugin does.
- **Timeline:** a card on the Tasks tab draws dated tasks as a Mermaid Gantt chart, one section per note: a bar from 🛫 start to 📅 due, otherwise a milestone on the due date; overdue tasks in red, `[/]` tasks as active. Zoom (3 months, 12 months, all) and *Copy as Mermaid*. Can be switched off in settings.
- **New note:** pick a customer and a kind (note, meeting, person, project, research); the note goes in `<customer>/<Meetings | People | Research>/` from that kind's template. People notes are named `@Name` with an `aliases` property.

### Projects

- **Projects tab and card:** notes with `project` in their tags, grouped by customer (or status, due date and more). The customer is the `customer` property, else the customer folder the note is in.
- **Your status values** in four groups: not started (`init`), active (`inprogress`, `ongoing`), on hold (`paused`, `blocked`) and closed (`completed`, `cancelled`). Changing a status only updates properties: `status`, plus today's date in `completed` (or `cancelled`).
- Each row shows the status, customer, `stage`, start date, `note` and a due-date bar. Postpone, set the due date or a reminder, or edit the note property from the row's menu.
- **Timeline:** a Mermaid Gantt chart above the list on the Projects tab (the *Timeline* button or a setting hides it), one section per customer: a bar from `started` to `due` (or to `completed` once closed), coloured by status group, with a marker for today. Zoom (3 months, 12 months, all) and *Copy as Mermaid* to paste the chart into a note.
- **New project:** a name and a customer; the note goes in `<customer>/Projects/` from your project template.
- **Reminders** appear inside Obsidian, once a day per project, when a project is overdue, due soon or past its remind date.

### Research

- **Research tab:** each section is a folder shown as a topic tree. A pattern such as `1.Customers/*/Research` gathers every customer's research folder into one section, labelled by customer.
- **By status:** the section's notes grouped by their `status` property, with "N to research · N researched" in the header.
- **Link suggestions:** the status bar offers to link words that match the titles of other research notes.
- New research notes start from your research template.

### Time

- **Automatic time** per customer while you work in a note, plus manual entries, breaks, a workday timer and overtime.
- **Time tab** and a **Time today** card; *Wrap up the day* at the end.
- An optional **daily time log note** with totals per customer and a table of entries, for you or an AI agent to read. Nothing is sent anywhere.

### Write

- **Table picker** (`Insert table…`), merged table cells, styled tables, lime dividers, sub-titles and page breaks for PDF export.
- **Locked callouts and maths blocks:** lock one so it can't be edited by accident.
- **Lifted writing window:** the note sits on a raised card over the dashboard pattern (full width when Obsidian's *Readable line length* is off).

## Settings

Everything is on one page, *Settings → Neon Work*, with a section per part:

- **Overview:** read-only, the base folder, the switches for each part, and safe mode.
- **Dashboard, Tasks, Projects, Research, Time, Write:** that part's options. Folder and file fields suggest matching vault paths as you type.

The **base folder** (asked on first start) is where the plugin keeps what it makes for itself when a location is left empty: Projects without a customer, Reviews, Time Log, `Todo.md`, the pin board and graph bridges.

## Install

1. Build it (`node tools/build.mjs`) or take the three files from a release: `main.js`, `manifest.json`, `styles.css`.
2. Put them in `<your vault>/.obsidian/plugins/neon-work/` (create the folder if needed).
3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if needed, and enable **Neon Work**.
4. On first start it asks for a **base folder** (for example `2.Resources`). Read-only stays on until you switch it off in *Overview*; commit or back up your vault first, so you can see exactly what changes.

**Updating:** copy the three files over the ones in `.obsidian/plugins/neon-work/` and switch the plugin off and on. Keep the folder: it also holds your settings.

**Safe mode:** if the plugin fails while starting, the next start keeps every part off; switch them back on in *Overview*.

**Hotkeys:** none by default (community plugin rule); set them in *Settings → Hotkeys*. Commands are listed as "Neon Work – Tasks: …", "… – Projects: …" and so on.

## For developers

- **Sources** are in `src/` (one job per file); `MAP.md` lists every file with its functions, `docs/architecture.md` explains the design and `CLAUDE.md` has the working rules.
- **Build:** `node tools/build.mjs` → `dist/neon-work/` (no dependencies).
- **Check:** `node --test test/*.test.mjs` (unit tests) and `node tools/check.mjs dist` (local-only rules, cleanup, timers, writes, CSS…).
- **Saved data** (`data.json`, `modules.json`) is personal and isn't in this repo.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), as the original: you may use, share and fork it with credit, but not sell it or use it commercially, and forks keep the same licence. See [LICENSE](LICENSE). The bundled fonts keep their own licence.

## Credits

Original Neon Deck made by [Yobzs](https://github.com/Yobzs) with Claude. Fork changes by {{CO_AUTHOR}} with Claude.

Bundled fonts (in `src/deck/fonts/`, embedded in `styles.css`): JetBrains Mono, Space Grotesk and Unbounded, all under the SIL Open Font License 1.1. See [`src/deck/fonts/OFL.txt`](src/deck/fonts/OFL.txt).
