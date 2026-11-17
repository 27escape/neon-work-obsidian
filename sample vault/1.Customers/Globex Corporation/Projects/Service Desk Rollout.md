---
title: "Service Desk Rollout"
tags:
  - project
customer: globex corporation
started: 2026-11-02
due: 2027-01-29
completed: 
status: inprogress
stage: tool selection
note: Sample plan for the Gantt, Board, Graph and List views
plan-prefix: sdr
---

# Service Desk Rollout

Replace Globex's shared inbox with a service desk tool. This note is a sample plan: each task has an id (🆔), the tasks it depends on (⛔) and an estimate in working days (`[duration:: …]`). Open it with the **Planning** button in the note's header. In the Planning view, click a task (card, row or box) to edit it, use **New task** to add one, or right-click for quick moves, durations and the milestone switch; the List view's Days column has − and + buttons. In this note, right-click in the editor for *Planning: edit this task* or *Planning: new task here*. New task ids use the `plan-prefix` property (sdr-1, sdr-2…).

What it shows:

- done, in progress, cancelled, ready, waiting and blocked tasks (blocked: waiting on an overdue task, here the service levels);
- an overdue task (📅 13 Nov) and one due soon (📅 19 Nov);
- a milestone (tagged `#milestone`), a task estimated at 0 days and a duration in weeks (`1w`);
- priorities as the Tasks plugin writes them (⏫ high, 🔽 low): shown on cards, bars and in the List, highest first on the board;
- owners (`[owner:: [[@Sofia Reyes]]]`): filter the view by person, group the board by person, and see a warning when someone has more than five days of work in a week;
- markers: an issue (service levels), a decision (choosing the tool) and a risk (the mailbox), tagged `#issue`, `#decision`, `#risk`;
- a forecast finish against the `due` property, and a baseline saved automatically once the project is in progress, to see slippage later (re-baseline from the Planning tab's ⋯ menu);
- a dependency on a task outside the project (the licence quote in [[2026-11-10 Portal Discovery Workshop]]) and an outside task that depends on this plan (in the weekly note [[2026-47]]).

### 1. Discovery

- [x] Interview the service desk team [duration:: 2d] [owner:: [[@Marcus Hale]]] 🆔 sdr-d1 #task ✅ 2026-11-04
- [x] Map the current ticket categories [duration:: 2d] [owner:: [[@Marcus Hale]]] 🆔 sdr-d2 ⛔ sdr-d1 #task ✅ 2026-11-06
- [/] Agree service levels with [[@Marcus Hale]] [duration:: 3d] [owner:: [[@Marcus Hale]], [[@Sofia Reyes]]] 🆔 sdr-d3 ⛔ sdr-d2 📅 2026-11-13 #task #issue
- [-] Survey all staff (dropped: the interviews were enough) 🆔 sdr-d4 #task

### 2. Tool selection

- [ ] Shortlist three service desk tools [duration:: 2d] [owner:: [[@Sofia Reyes]]] 🆔 sdr-t1 ⛔ sdr-d2 📅 2026-11-19 ⏫ #task
- [ ] Demo the shortlisted tools to the team [duration:: 3d] [owner:: [[@Sofia Reyes]]] 🆔 sdr-t2 ⛔ sdr-t1 #task
- [ ] Choose the tool [duration:: 1d] 🆔 sdr-t3 ⛔ sdr-t2,glx-quote #task #decision

### 3. Build

- [ ] Set up the tool and user accounts [duration:: 3d] [owner:: [[@Marcus Hale]]] 🆔 sdr-b1 ⛔ sdr-t3 #task
- [ ] Import the ticket categories [duration:: 1d] 🆔 sdr-b2 ⛔ sdr-b1,sdr-d2 #task
- [ ] Connect the support mailbox [duration:: 2d] [owner:: [[@Marcus Hale]]] 🆔 sdr-b3 ⛔ sdr-b1 #task #risk
- [ ] Write the starter knowledge base articles [duration:: 1w] [owner:: [[@Sofia Reyes]]] 🆔 sdr-b4 ⛔ sdr-d3 🔽 #task
- [ ] Set up service level alerts [duration:: 1d] 🆔 sdr-b5 ⛔ sdr-b1,sdr-d3 #task

### 4. Training and go-live

- [ ] Draft the communications plan [duration:: 2d] [owner:: [[@Sofia Reyes]]] 🆔 sdr-g0 🔽 #task
- [ ] Book the training room 📅 2026-11-27 #task
- [ ] Train the service desk team [duration:: 2d] [owner:: [[@Sofia Reyes]]] 🆔 sdr-g1 ⛔ sdr-b2,sdr-b3 #task
- [ ] Pilot with the finance department [duration:: 1w] 🆔 sdr-g2 ⛔ sdr-g1,sdr-b4,sdr-b5,sdr-g0 #task
- [ ] Announce the go-live date to staff [duration:: 0d] 🆔 sdr-g4 ⛔ sdr-g1 #task
- [ ] Go live for everyone 🆔 sdr-golive ⛔ sdr-g2,sdr-g4 #milestone #task
- [ ] Review after the first month [duration:: 1d] 🆔 sdr-g3 ⛔ sdr-golive #task
