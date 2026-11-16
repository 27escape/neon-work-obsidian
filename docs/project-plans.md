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
