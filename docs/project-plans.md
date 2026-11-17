# Project plans: durations, dependencies, Gantt and kanban (design, not built)

Status: agreed 16 Nov 2026; step 1 built. First used on the E2I note *Pilot - Local AI*.

## Decisions (16 Nov 2026)

- **Tasks in projects are not on the Tasks card.** A task in a project note, or in any note of a project folder, belongs to the project. The Tasks card and tab leave it out (setting *Tasks in projects*: `none`, default, or `all`). Each project's row shows its counts instead (overdue, due this week, ready, in progress, blocked, done), so nothing dated is lost.
- **Scope of a plan:** a project folder (under *Project folders*) covers every note in it; a project note outside one covers only itself. Outside tasks appear only when linked by a dependency in either direction, greyed out in an "Outside this project" group, without their own chains.
- **Ids:** looked up inside the project first, then the vault; duplicates are warned about. Ids carry a project prefix by convention (`pla-sc1`).
- **Views:** a project note gets header buttons (Board, Gantt, Graph, Report) that open one Plan view in a new tab, nothing added to the note. Gantt and Graph are Mermaid (Obsidian's own renderer, no libraries); the board is our own, dragging changes only the checkbox through `writeNote`.
- **Printing:** views export SVG (and copy as Mermaid); PNG was dropped, as Obsidian would not load the chart as an image. *Report* writes a snapshot note (summary, Gantt, critical path, status by phase, task list) to a reports folder, printed with Obsidian's Export to PDF. A write the user asks for, so only with read-only off.
- **Project Planner:** ideas only (MIT, credited in `FORK.md`); no code, since Neon Work has no dependencies.

## Build steps

1. ✅ `src/shared/plan.js` (parse, state, schedule, critical path, working days, counts) and `src/shared/plan-scope.js` (which tasks belong to a project, outside neighbours); Tasks card leaves project tasks out; counts on the project rows (`src/tickets/plan-summary.js`). Tests: `test/plan.test.mjs`.
2. ✅ Plan view (`src/tickets/plan-view.js`: Gantt and List, Dates or Weeks), header buttons and commands on project notes (`plan-actions.js`), Gantt text (`plan-gantt.js`), SVG export and Copy as Mermaid (`plan-export.js`). Tests: `test/plan-gantt.test.mjs`.
3. ✅ Board (`plan-board.js`: columns Ready / Blocked / In progress / Done, rows by phase; drag or the card menu changes the checkbox through `writeNote`, ✅ date added or removed) and Graph (`plan-graph.js`: Mermaid flowchart, groups per phase, colours by kind, thick arrows on the critical path, boxes open their task). Header buttons Gantt, Board, Graph, List. Tests: `test/plan-board.test.mjs`.
- Priority (16 Nov): the Tasks plugin's emoji (`planPriority`, levels 5 highest … 2 normal … 0 lowest) on cards, Gantt rows, a List column and order (by priority within each phase), highest first in board cells; set in the editor (`planSetPriority`); overload warnings name the easiest task to move (lowest priority, most slack, latest start); the Tasks card orders same-date tasks by it. Not used in scheduling (no levelling).
- Report (16 Nov, `plan-report.js`): **Report** writes `<title> – plan <date>.md` and `.svg` into the reports folder (setting; empty `<base>/Reports`): front matter (`tags: plan-report`, `project: [[note]]`), summary and forecast, the Gantt (all tasks, drawn off screen, colours written in), phases, needs attention (overdue, blocked with cause, schedule warnings, late), risks / issues / decisions, critical path, workload, all tasks. Same day: replaced. `planReportText` is pure and tested. Printed with Export to PDF.
- Durations to dates (16 Nov, `plan-dates.js`): **Dates…** in the Planning view lists each open task's planned 🛫 / 📅 beside its current ones; tasks without dates are ticked, tasks with dates are not; one write per note (`planDatesEdit`, tested). Milestones get a 📅 only.
- Schedule warnings (16 Nov, `planWarnings` in `plan-forecast.js`): planned to finish after its 📅 date, due before a task it waits for, in progress past its planned finish; five shown above the chart, all as ⏰ on the List's rows.
- All projects in one view (16 Nov, `src/tickets/timeline.js`): the Projects tab's timeline is drawn with the same Gantt drawer: one row per project grouped by customer, a bar from its start to its plan's forecast finish (else its due date; closed: its closing date), a hollow diamond on the due date, coloured late / needs attention / in progress / not started / on hold / closed; the label adds what needs action. Zoom 3 months / 12 months / everything; a click opens the project's Planning view (Ctrl/Cmd-click, or no plan: its note). No default hotkey (community plugin guidelines): give *Project: open Planning* one in Settings › Hotkeys.
- Own Gantt drawing (16 Nov, `plan-gantt-draw.js`): Obsidian now draws ```mermaid blocks with Pele, which takes no per-bar styles and gives bars no ids, so colouring Mermaid's bars stopped working. The Planning view draws its Gantt as SVG itself from the rows `planGanttText` lays out (`planGanttLayout` is pure and tested): names on the left, a day scale with weekends and Monday ticks, kind colours, dashed marker outlines, critical path outline, milestone diamonds, today line; it fits the tab's width and redraws on resize. Copy as Mermaid still gives the text for notes; SVG saves the drawing. Graph boxes are found by Pele's `data-id` as well as Mermaid's ids.
- Smaller additions (16 Nov): dates on a weekend are flagged (in the editor, and in the view's warnings). The task last opened or right-clicked is selected (outlined); **New task** then follows it: it depends on it and goes straight after its line, and the new task becomes the selection, so a chain is quick to build (also *New task after this* in the task menu and the note's right-click menu). Risks and issues are bold on the Gantt and in the list; the list can show only risks, issues or decisions. Plan template: `2.Resources/templates/project_plan.md` (sample vault) with four phases of example tasks; ids are `{{prefix}}-1…`, filled in by New project (`applyTemplate`: the title's initials) or later by **Fill in ids** in the Planning view.
- ⏳ in step (17 Nov, `plan-scheduled.js`): writing computed 🛫/📅 automatically would freeze the plan (🛫 = not before, 📅 = deadline), so Dates… stays a snapshot (renamed Write dates…) and an opt-in per project (`plan-scheduled: true`) keeps ⏳ = planned start for open tasks, written on the view's refresh, one write per note, not while that note's editor has focus. planCounts: overdue only from 📅.
- Run alongside (17 Nov): `[starts-with:: id+lag]` (ss) and `[ends-with:: id+lag]` (ff) as inline fields, so ⛔ stays the Tasks plugin's finish-to-start (Kevin agreed the names). `t.links` [{ id, type, lag }]; planSchedule's forward pass: ss = pred es + lag, ff = pred ef + lag − own days; backward pass to match, so slack and the critical path follow. planLinkIds for loops, neighbours, up/downstream. Editor: link type and lag per dependency chip (Blocks stays ⛔). Gantt: dashed start-to-start / end-to-end arrows; Alt-drag type from the ends (planDropType).
- Steps (17 Nov, `shared/plan-steps.js`): the checkboxes directly under a task (`[ ]`/`[x]`, `( )`/`(x)`; `[/]` open; `[-]`, `(-)`, `[?]` and the like ignored) give `t.steps` { done, total }, read from the note's list outline (planListTree, not the metadata cache, so the editor's live text works too). All done, task open: offered, never ticked automatically (Kevin: the note stays the record). Tasks inside tasks (`t.nestedIn`) are a plan problem (Kevin: too much complexity).
- Gantt editing (17 Nov, `plan-gantt-drag.js`, `planGanttLinks` in `shared/plan-draw.js`): finish-to-start arrows (right-angled; into the top of the bar when it starts as the other ends; around when they overlap), faint unless critical or late, hovered task's own in the accent; drag right end = duration (or 📅 when 🛫 and 📅 fix the task), drag bar = 🛫 (Kevin chose 🛫 over ⏳), Alt-drag = ⛔ link (Kevin chose Alt), click arrow = remove link, Undo = the last change. planSchedule takes `from` so an open task's 🛫 is a "not before" constraint. Off on phones.
- Plan problems (17 Nov, `shared/plan-problems.js`, `tickets/plan-marks.js`): unknown ids (per task, the ids it waits for), ids used twice (the second task to change) and loops (Tarjan, in waiting order), skipping other projects' tasks. Listed in the Planning view (click opens the note at the task's line), the report's Needs attention (first), a dashed pill on cards and rows (the summary reads outside the project only when an id is missing, so links to other projects aren't flagged), and underlined in the editor (a CodeMirror decoration from the live text plus the plan's other notes as saved; setting *Underline plan problems in project notes*).
- Automatic baseline (17 Nov, `plan-baseline.js`): saved the first time a project is in progress or on hold with a started date and plan tasks; provisional (follows each change, no slip shown) while an open task, not a milestone, has no duration, then locked (Kevin chose this over re-baselining on every save, which would always show zero slip); the ⋯ menu can lock it early; the toolbar button became the ⋯ menu's Re-baseline / Remove (a removed one is not saved again automatically); keys follow renames (note or folder) and are pruned on start when the project is gone.
- Forecast, baseline, phases, markers (16 Nov, `plan-forecast.js`, `plan-gantt.js`): with a started date the plan has a forecast finish; against the project's `due` it is on time or N working days late (two milestones in a Project section of the Gantt; the summary line and the Projects rows say so, the dashboard card only when late). **Baseline** saves each task's planned finish (tasks with ids) in the plugin's data, not the note; the list then has a Slip column and the summary the change of the forecast since. The Gantt's **Phases** switch draws one bar per phase (first start to last finish, its worst task's colour, n/m done). `#risk`, `#issue`, `#decision` on a task: a sign before its name (⚠ ‼ ⚖) and a dashed outline in orange, red or green on bars and boxes, a badge on cards, counts in the summary, switches in the editor. Holidays: see below.
- Owners (16 Nov, `plan-people.js`): `[owner:: [[@Sam Taylor]], Alex]` (people notes or plain names), set in the task editor (search over @ notes). Shown on Gantt bars and graph boxes (first names), cards and an Owner column in the list. A person filter in the view (Gantt, board and list leave others out, the graph greys them), board rows by phase or by person, and a warning when someone has more than five days of work in a week (a task with two owners counts in full for both).
- Waiting and blocked (16 Nov): a task whose earlier tasks are open but on time is **waiting** (pale blue), the plan working as meant. **Blocked** (purple) means a task upstream is overdue or tagged `#blocked` (held up outside the plan), passed down the chain; cards and the list say what blocks it. Board columns: Ready, Waiting (blocked cards sit there), In progress, Done. Note: the Tasks plugin's `is blocked` means our *waiting*.
- Task editor (16 Nov, `plan-editor.js`, text work in `plan-form.js`): for tasks of a project note. Description, status, phase (moves the line), duration or milestone, `#blocked`, depends on / blocks (pickers over the note's tasks, loops greyed out), 🛫 ⏳ 📅 dates with the plan's own dates, an id given automatically (`plan-prefix` property, else the title's initials, then the next number), and a preview of exactly what is written. Opened by clicking a task in the Planning view, *Edit…* in the task menu, **New task** in the view, or *Planning: edit this task / new task here* in a project note's right-click menu. Fields it doesn't manage stay where they are.
- Milestones and durations (16 Nov): a milestone is a task tagged `#milestone` (0 days, a diamond); `[duration:: 0d]` without the tag is a task of no length, drawn as a thin bar; no duration counts as 1 day. Durations change from the Planning view: the task menu (right-click a card, row or box, click a Gantt bar: 1, 2, 3 days, 1 or 2 weeks, Duration…, Milestone) and − / + in the List's Days column (`src/tickets/plan-edit.js`, which also holds the board's checkbox moves).
- Planning (16 Nov): one **Planning** button on project notes (and one command, one project-menu item) opens the view, named *Planning: <note>*, on the Gantt chart; Board, Graph and List are switched in the view.
- Forecast (16 Nov): with real dates, work not started yet is scheduled from today, not the project's start; overdue means a passed 📅 date, or work in progress planned to finish before today; due soon means 📅 within a week.
- Sample: `sample vault/1.Customers/Globex Corporation/Projects/Service Desk Rollout.md` (18 tasks, every state, a milestone, an outside dependency each way).

4. Report note, *Durations to dates*, schedule warnings.

## The problem

A project note can hold a plan of many `#task` lines with no dates yet. Today:

- the Tasks module collects every `#task` line, project notes included (`collectTasks` in `src/tasks/collect.js`), so a 49-task plan floods the Tasks card;
- the Tasks timeline (`src/tasks/timeline.js`) only draws tasks with a 📅 or ⏳ date, so an undated plan draws nothing;
- the Projects timeline (`src/tickets/timeline.js`) draws one bar per project, not the plan inside it.

## Task line format (the same as the Tasks plugin, so nothing is locked in)

```
- [ ] Select the GPU provider [duration:: 1d] 🆔 gp4 ⛔ gp2,gp3,sc5 #task
```

| Part | Meaning | Who already reads it |
|---|---|---|
| `[ ]` `[/]` `[x]` `[-]` | to do, in progress, done, cancelled | Tasks plugin, Project Planner, Neon Work |
| `🆔 id` | the task's id (letters, digits, `-`, `_`) | Tasks plugin, Project Planner |
| `⛔ id,id` | depends on (blocked by) these ids | Tasks plugin (`is blocked` / `is not blocked`), Project Planner |
| `[duration:: 3d]` | estimated working days (Dataview inline field) | Dataview; Neon Work (proposed) |
| 📅 ⏳ 🛫 | due, scheduled, start, as now | all three |
| `###` heading above the task | the phase | Neon Work (proposed) |

Project Planner has no duration field. An undated task's bar starts the day after its last blocker and lasts one day; `hours` is worked out from bar length × hours per day, not the other way round. So `[duration:: …]` is ours alone until dates are written (see *Durations to dates* below).

## Who does what

**Tasks module: "what can I do next?"** A task in a project note shows on the Tasks card only when it is actionable:

- in progress (`[/]`), or
- dated (📅 ⏳ 🛫), or
- ready: every `⛔` id it depends on is done or cancelled (the Tasks plugin's `is not blocked`).

New setting *Project tasks on the Tasks card*: `all` / `actionable` (default) / `none`. Tasks outside project notes are unchanged. `taskDisplay` also strips `🆔 …`, `⛔ …` and `[duration:: …]` from the shown text (today it shows them).

**Projects module: "what is the plan?"** Owns the undated plan:

- a summary on each project row, e.g. *3 ready · 2 in progress · 44 planned*, opening the plan;
- a plan view: Gantt and kanban for one project;
- optionally a `neon-plan` code block, so the live chart or board can sit in the project note itself (read-only rendering; writes only from a user action).

## Shared code: `src/shared/plan.js` (pure, unit-tested)

- `planTask(line, heading)` → `{ id, deps[], days, status, dates, phase, text }`.
- `planSchedule(tasks, { start, workdays })` → earliest start and finish per task from dependencies (working days), plus the critical path (tasks with no slack). Cycles and unknown ids are reported, not thrown.
- `planState(task, byId)` → `ready` / `blocked` / `doing` / `done`.
- `planGantt(schedule, opts)` → sections for the existing `ganttText` in `src/shared/gantt.js`:
  - with a `started` date on the project: real dates;
  - without: relative weeks. Start the chart on a fixed Monday (2026-01-05) with `axisFormat Wk %W`, `tickInterval 1week`, `excludes weekends`, so the axis reads Wk 01, Wk 02…;
  - critical path → `crit`, in progress → `active`, done → `done`.

Both modules use it; neither imports the other (architecture rule kept).

## Kanban without moving tasks

The board is a view over the same lines; tasks never leave the project note, so the Tasks plugin, dashboards and Gantt stay in step.

- Columns: To do (ready), Blocked (worked out from `⛔`), In progress `[/]`, Done `[x]`. Rows (swimlanes): the phase headings.
- Dragging a card changes only the checkbox character, through `writeNote` (one write path, minimal edit, guarded by read-only). Moving into Blocked is not allowed; it is derived.

## Project Planner (community plugin) and what to borrow

[Project Planner](https://community.obsidian.md/plugins/project-planner) (Harrison Milburn, MIT, v1.0.1, a fork of Tasks Map; needs Dataview) reads the same lines: checkbox status, 🆔 / ⛔ or `[id::]` / `[dependsOn::]`, dates, priority, and `hours` / `hoursPerDay` / `people` / `costs`. Views: dependency graph, Gantt with working days, milestones and critical path, kanban grouped by status, due date, person, tag, project, priority or note, and a costing dashboard. Undated tasks are placed from their dependencies as dashed suggestions, written to the note only when accepted.

Does it meet the need on its own? Mostly for viewing one plan, not for Neon Work's overlap problem:

| Need | Project Planner | Gap |
|---|---|---|
| Undated plan with dependencies | Yes | — |
| Durations | No; undated tasks are one-day bars | Neon Work (or an upstream contribution) |
| Gantt with critical path | Yes, interactive, PNG export | — |
| Kanban over the same lines | Yes; dragging in the Status grouping writes the checkbox (due date, people, tags groupings write those fields) | — |
| Neon Work Tasks card showing only actionable project tasks | No | Neon Work must do this |
| Plan summary on the Projects list | No | Neon Work |
| Local-only, writes only on user action | README: no Node or Electron APIs; inferred dates never written silently; network use not stated | audit `src/` before use in the E2I vault |
| Embedding in a note | `project-planner` code block, graph view only | — |
| Maturity | 1.0.1, about 1k downloads; React, TypeScript, logic kept in `src/lib/` | young; keep our data format plugin-neutral |

**Suggested route:** the two fit different stages.

- **Planning (no dates yet):** Neon Work's `plan.js` and the Mermaid timeline, because only they use durations.
- **Implementation (dates set):** Project Planner works well as the interactive Gantt, dependency graph and kanban over the same lines, once each task has 🛫 / 📅 dates.
- **The bridge, *Durations to dates*:** a Neon Work command that, given a start date, works out each task's 🛫 start and 📅 due from durations and dependencies (working days), shows them as suggestions and writes them only when accepted. After that every tool (Tasks plugin, Project Planner, Neon Work's dated timelines) sees the same dates.
- Alternatively, offer Project Planner a `duration` field upstream (MIT, logic in `src/lib/`); then it could carry the planning stage too.

Neon Work still builds the thin part: `plan.js`, the actionable filter on the Tasks card, the plan summary on the Projects list, the Mermaid plan timeline and *Durations to dates*. Borrow from Project Planner:

1. **Suggested dates from dependencies**, shown dashed and written only when the user accepts them: fits Neon Work's "never change notes unasked" rule.
2. **Working-day scheduling and critical path** (in `planSchedule`).
3. **Keep the line's own style when writing** (emoji or Dataview field).
4. **Kanban grouping choices** (status by default; also phase, person, note).
5. **Schedule warnings:** overdue, stalled, and a task starting before something it depends on.
6. Not borrowed: the dependency graph and costing (Project Planner does them; no need for two).

Each new job is a new file, listed in `tools/files.json`, then `node tools/map.mjs`.

## Working days, holidays and time off (17 Nov, `src/shared/plan-calendar.js`)

- **Holidays notes:** one setting, the note's name (`planHolidayName`, default Holidays). `planHolidayPaths` lists where a plan looks: `<folder>/Holidays.md` for the project's folder and each folder above it, then the base folder's. `planHolidays` (plan-scope.js) reads those that exist with `planHolidayFile`: an **All** (or Everyone) section with `public holidays: <region>`, `working days: <days>` and dated lines (`planHolidayList`: a date or range, then a name), and everything else as people's time off (`planLeaveParse`). The calendar comes from the nearest note with an All section (so a customer in another country has its own); people's time off is merged from all of them and from each plan note's `## Holidays` / `## Time off` / `## Leave` section.
- **Calendar:** `planCalendar({ region, weekdays })` plus `extra` (the dated days) and `source` (the note's path). `planCollect` returns it as `tasks.calendar`, with `tasks.leave`. `planGanttText` and `planPlannedDates` use `tasks.calendar` directly; the rest (`planWorkdays` without a calendar, the Gantt's shading, editor warnings, workload, the report) use `NEON_PLAN.calendar`, which `planUseCalendar(tasks)` sets from the Planning view's render, the report and the task editor. UK public holidays are computed per year without network: fixed dates, Easter (anonymous Gregorian algorithm), first and last Mondays, and substitute weekdays (weekday-dated holidays placed first, then the weekend ones moved to the next free weekday, which gives gov.uk's labels for Christmas on a Sunday). `planHolidayGap` warns (view issues, report Needs attention) when a plan with no built-in region runs past the last year its All section lists. Weeks mode (no dates) uses `PLAN_PLAIN_CAL`, so "Wk n" stays five days.
- **Time off:** a person per top-level item (`[[@Name]]`, `[[@Name|Alias]]` or a plain name, with or without @), dates under it or after a colon (YYYY-MM-DD, ranges with to / until / - / .. / >, `every Tuesday`). Owners match by key, else by first name.
- **Schedule:** `planSchedule({ span })`: span(task, es, days) gives the working days a task spans from its start; `planLeaveSpan` counts a day only when all its owners work. The Gantt draws an open task's bar from the schedule (es to ef), so the bar covers the time off. Done tasks keep their own 🛫 and duration.
- **Shown:** days off shaded like weekends on the Gantt (dates only); the editor and the issues list say "not a working day (Christmas Day)"; the workload check uses calendar weeks and each person's own working days (`planOverloads(rows, cap(owner, week), { weekOf, works })`); the report has a Holidays line in the summary and a Time off column in People.
- **Not yet:** half days; shading a person's time off on their own rows.
