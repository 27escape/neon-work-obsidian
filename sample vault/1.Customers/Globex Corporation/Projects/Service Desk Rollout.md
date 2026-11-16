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
---

# Service Desk Rollout

Replace Globex's shared inbox with a service desk tool. This note is a sample plan: each task has an id (🆔), the tasks it depends on (⛔) and an estimate in working days (`[duration:: …]`). Open it with the **Gantt**, **Board**, **Graph** or **List** buttons in the note's header.

What it shows:

- done, in progress, cancelled, ready and blocked tasks;
- an overdue task (📅 13 Nov) and one due soon (📅 19 Nov);
- a milestone (0 days), and a duration in weeks (`1w`);
- a dependency on a task outside the project (the licence quote in [[2026-11-10 Portal Discovery Workshop]]) and an outside task that depends on this plan (in the weekly note [[2026-47]]).

### 1. Discovery

- [x] Interview the service desk team [duration:: 2d] 🆔 sdr-d1 #task ✅ 2026-11-04
- [x] Map the current ticket categories [duration:: 2d] 🆔 sdr-d2 ⛔ sdr-d1 #task ✅ 2026-11-06
- [/] Agree service levels with [[@Marcus Hale]] [duration:: 3d] 🆔 sdr-d3 ⛔ sdr-d2 📅 2026-11-13 #task
- [-] Survey all staff (dropped: the interviews were enough) 🆔 sdr-d4 #task

### 2. Tool selection

- [ ] Shortlist three service desk tools [duration:: 2d] 🆔 sdr-t1 ⛔ sdr-d2 📅 2026-11-19 #task
- [ ] Demo the shortlisted tools to the team [duration:: 3d] 🆔 sdr-t2 ⛔ sdr-t1 #task
- [ ] Choose the tool [duration:: 1d] 🆔 sdr-t3 ⛔ sdr-t2,glx-quote #task

### 3. Build

- [ ] Set up the tool and user accounts [duration:: 3d] 🆔 sdr-b1 ⛔ sdr-t3 #task
- [ ] Import the ticket categories [duration:: 1d] 🆔 sdr-b2 ⛔ sdr-b1,sdr-d2 #task
- [ ] Connect the support mailbox [duration:: 2d] 🆔 sdr-b3 ⛔ sdr-b1 #task
- [ ] Write the starter knowledge base articles [duration:: 1w] 🆔 sdr-b4 ⛔ sdr-d3 #task
- [ ] Set up service level alerts [duration:: 1d] 🆔 sdr-b5 ⛔ sdr-b1,sdr-d3 #task

### 4. Training and go-live

- [ ] Draft the communications plan [duration:: 2d] 🆔 sdr-g0 #task
- [ ] Book the training room 📅 2026-11-27 #task
- [ ] Train the service desk team [duration:: 2d] 🆔 sdr-g1 ⛔ sdr-b2,sdr-b3 #task
- [ ] Pilot with the finance department [duration:: 1w] 🆔 sdr-g2 ⛔ sdr-g1,sdr-b4,sdr-b5,sdr-g0 #task
- [ ] Go live for everyone [duration:: 0d] 🆔 sdr-golive ⛔ sdr-g2 #task
- [ ] Review after the first month [duration:: 1d] 🆔 sdr-g3 ⛔ sdr-golive #task
