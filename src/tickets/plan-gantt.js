/* ---- Project plans (fork): a plan as Mermaid Gantt text (pure) ----------------------------------------------------
 * Bars come from the schedule (planSchedule): working days, weekends left out. With the project's start date the
 * axis shows dates; without one (or with weeks chosen) it counts weeks from a fixed Monday, so it reads Wk 01, Wk 02…
 * In date mode a task's own 🛫 start / 📅 due dates win over the schedule. One section per phase (the heading the
 * task sits under), in note order; tasks outside the project last. The text keeps Mermaid's own tags (done, active,
 * crit) for when it is pasted into a note; the Plan view colours each bar by its kind (planBarKind). */

const PLAN_WEEK_BASE = '2026-01-05'; // a Monday, week 01 of its year: "Wk %W" then counts weeks from the start
const PLAN_OUTSIDE = 'Outside this project';
const PLAN_SOON_DAYS = 7; // due within this many days: "due soon"

// bar kinds in the order the legend shows them: [kind, label, Obsidian colour variable, fallback]
const PLAN_KINDS = [
  ['ready', 'Ready to start', '--color-blue', '#3a7bd5'],
  ['waiting', 'Waiting on earlier tasks', '--color-blue', '#9dbbe8'], // drawn paler (planColour)
  ['blocked', 'Blocked', '--color-purple', '#8e5bd0'],
  ['doing', 'In progress', '--color-cyan', '#1fa8b8'],
  ['soon', 'Due within a week', '--color-orange', '#e8871e'],
  ['overdue', 'Overdue', '--color-red', '#d93b3b'],
  ['done', 'Done', '--color-green', '#2e9e5b'],
  ['outside', 'Outside this project', '--text-faint', '#999999'],
];

const planClip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

/**
 * Kind of a task's bar: outside, done, overdue (its 📅 date has passed, or work in progress was planned to finish
 * before today), soon (📅 within a week), doing, blocked, waiting or ready. finish: the bar's last day (date mode) or null.
 */
function planBarKind(t, state, today, finish = null) {
  if (t.external) return 'outside';
  if (state === 'done') return 'done';
  if (today && ((t.due && t.due < today) || (state === 'doing' && finish && finish < today))) return 'overdue';
  if (today && t.due && t.due <= ymdAdd(today, PLAN_SOON_DAYS)) return 'soon';
  return state === 'doing' || state === 'blocked' || state === 'waiting' ? state : 'ready';
}

/** { text, sched, bars: [{ id, kind, crit }] }: Mermaid gantt text. base: the project's start date or null. */
function planGanttText(tasks, { base = null, weeks = false, today = null, maxName = 45, show = null } = {}) {
  const relative = weeks || !base;
  const from = relative ? PLAN_WEEK_BASE : planWorkdays(base, 0);
  // with real dates, work not started yet is forecast from today, not from the project's start
  const sched = planSchedule(tasks, { notBefore: !relative && today ? planWorkdaysBetween(from, today) : 0 });
  const { byId } = planIndex(tasks);
  const lines = ['gantt', '  dateFormat YYYY-MM-DD', `  axisFormat ${relative ? 'Wk %W' : '%d %b'}`, '  tickInterval 1week', '  weekday monday', '  excludes weekends', `  todayMarker ${!relative && today ? 'on' : 'off'}`];
  const groups = new Map();
  for (const r of sched.rows) {
    const k = r.task.external ? PLAN_OUTSIDE : r.task.phase || 'Tasks';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  if (groups.has(PLAN_OUTSIDE)) {
    const out = groups.get(PLAN_OUTSIDE);
    groups.delete(PLAN_OUTSIDE);
    groups.set(PLAN_OUTSIDE, out);
  }
  const bars = [];
  for (const [name, rows] of groups) {
    lines.push(`  section ${mermaidSafe(name)}`);
    for (const r of rows) {
      const t = r.task;
      const who = planOwnerShort(t);
      const label = planClip(mermaidSafe((t.external ? '↗ ' : '') + planText(t.raw)), maxName - (who ? who.length + 3 : 0)) + (who ? ` · ${mermaidSafe(who)}` : '');
      const state = planState(t, byId, today);
      const crit = r.crit && !t.external && state !== 'done';
      const tags = state === 'done' ? ['done'] : [...(state === 'doing' ? ['active'] : []), ...(crit ? ['crit'] : [])];
      const id = `np${bars.length + 1}`;
      const days = planDays(t);
      let when;
      let finish = null;
      if (t.milestone) {
        // a milestone (#milestone) is a diamond on its 📅 date (with real dates), else where the schedule puts it
        finish = !relative && (t.due || t.start) ? t.due || t.start : relative ? null : planWorkdays(from, r.es);
        when = `${finish || planWorkdays(from, r.es)}, 0d`;
      } else if (!relative && t.start && t.due && t.due >= t.start) {
        when = `${t.start}, ${ymdAdd(t.due, 1)}`;
        finish = t.due;
      } else {
        const start = !relative && t.start ? t.start : planWorkdays(from, r.es);
        when = `${start}, ${days ? `${days}d` : '4h'}`; // a task estimated at 0 days: a thin bar, so it stays visible
        if (!relative) finish = planWorkdays(start, Math.max(0, days - 1));
      }
      bars.push({ id, task: t, kind: planBarKind(t, state, today, finish), crit });
      if (show && !show(t)) continue; // filtered out (one person): still in the schedule, not drawn
      lines.push(`  ${label} :${[...tags, ...(t.milestone ? ['milestone'] : []), id].join(', ')}, ${when}`);
    }
  }
  const kept = lines.filter((l, i) => !(l.startsWith('  section ') && (lines[i + 1] === undefined || lines[i + 1].startsWith('  section '))));
  return { text: kept.some((l) => / :/.test(l)) ? kept.join('\n') : '', sched, bars }; // task lines hold ' :'
}

/** "Wk 3" (relative) or "Mon 23 Nov" for a working-day offset from the start. */
function planDayLabel(offset, base, weeks) {
  if (weeks || !base) return `Wk ${Math.floor(offset / 5) + 1}`;
  const d = planWorkdays(base, offset);
  return moment(d, 'YYYY-MM-DD').format('ddd D MMM');
}
