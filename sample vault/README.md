---
title: Welcome to the sample vault
created: 2026-11-13
modified: 2026-11-13
tags:
  - readme
---

# Welcome to the sample vault

This vault is made-up data for trying **Neon Work** without touching your own notes. The plugin is already installed and set up, with **read-only switched off**, so you can tick tasks, change project statuses and create notes freely.

## How it is organised

```text
1.Customers
    Acme Widgets        (a manufacturer)
    Contoso             (our own company, an internal customer)
    Globex Corporation  (a retailer)
        Meetings
        People
        Projects
        Research
2.Resources             (the plugin's base folder)
    Dailynotes          (weekly notes, YYYY/YYYY-ww)
    Inbox
    Projects            (projects without a customer)
    Research
    templates
    Todo.md
4.Archive
```

## Things to try

- Open the **dashboard** from the ribbon or the list at the top of the left sidebar.
- **Projects**: change a status from a row's menu, group by customer or status.
- **Tasks**: tick a task, or add one to Todo; it goes to the head of [[Todo]].
- **Research**: the Research tab has two sections, *Research* and *Customers* (every customer's Research folder).
- **New note** (the dashboard's *New note* button): pick a customer and a type (note, meeting, person, research, inbox or project).
- **Inbox**: the Inbox card lists inbox notes still waiting; add one with its *Add to Inbox* box, New note's **Inbox** button or Quick capture. They land in `2.Resources/Inbox` with `tags: inbox` and `status: waiting`; set a note's status to `completed` and it leaves the card.
- **Timelines**: the Projects tab and the Tasks tab show Gantt charts; *Copy as Mermaid* pastes one into a note.
- **Stats** (bottom of the dashboard): time and tasks done, then the vault's notes, links and orphans.
- The **Claude card** lists the notes whose `claude` property is `process`, `refine` or `updated`.

## Conventions

- People notes start with `@` and have `aliases`.
- Projects have `project` in their tags and a `status`: `init`, `inprogress`, `ongoing`, `paused`, `blocked`, `completed` or `cancelled`.
- Research and inbox notes also have a `status`.
- Tasks are `- [ ] #task …` lines with Tasks-plugin dates: ➕ created, 🛫 start, ⏳ scheduled, 📅 due, ✅ done.
