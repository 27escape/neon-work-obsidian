---
title: "{{title}}"
tags:
  - project
customer:
plan-prefix: {{prefix}}
started: {{date}}
due:
completed:
status: init
stage: planning
note:
---

# {{title}}

## Goal

What this project is for, and how we will know it is done.

## Plan

> [!info] Planning
> Open the **Planning** button in this note's header for the Gantt chart, board, graph and list. Each task has an id (🆔), the tasks it waits for (⛔) and an estimate in working days (`[duration:: 2d]`, or `1w`). Replace the example tasks; keep the phases you need. Tag a task `#risk`, `#issue` or `#decision` to mark it, `#milestone` for a point in time. If the ids below still read `{{prefix}}`, use **Fill in ids** in the Planning view.

### 1. Scope

- [ ] Agree the goal and what is out of scope [duration:: 2d] 🆔 {{prefix}}-1 #task
- [ ] Agree who is involved and who decides [duration:: 1d] 🆔 {{prefix}}-2 #task
- [ ] Scope agreed 🆔 {{prefix}}-3 ⛔ {{prefix}}-1,{{prefix}}-2 #task #milestone

### 2. Plan and prepare

- [ ] Break the work into tasks and estimate them [duration:: 2d] 🆔 {{prefix}}-4 ⛔ {{prefix}}-3 #task
- [ ] List the risks and how to handle them [duration:: 1d] 🆔 {{prefix}}-5 ⛔ {{prefix}}-3 #task #risk
- [ ] Decide the approach [duration:: 1d] 🆔 {{prefix}}-6 ⛔ {{prefix}}-4,{{prefix}}-5 #task #decision

### 3. Deliver

- [ ] Do the work [duration:: 2w] 🆔 {{prefix}}-7 ⛔ {{prefix}}-6 #task
- [ ] Check the result against the goal [duration:: 2d] 🆔 {{prefix}}-8 ⛔ {{prefix}}-7 #task

### 4. Close

- [ ] Hand over and tell the people involved [duration:: 1d] 🆔 {{prefix}}-9 ⛔ {{prefix}}-8 #task
- [ ] Review what went well and what to change [duration:: 1d] 🆔 {{prefix}}-10 ⛔ {{prefix}}-9 #task
- [ ] Project closed 🆔 {{prefix}}-11 ⛔ {{prefix}}-10 #task #milestone

## Notes
