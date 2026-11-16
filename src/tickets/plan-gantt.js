/* ---- Project plans (fork): a plan as Mermaid Gantt text (pure) ----------------------------------------------------
 * Bars come from the schedule (planSchedule): working days, weekends left out. With the project's start date the
 * axis shows dates; without one (or with weeks chosen) it counts weeks from a fixed Monday, so it reads Wk 01, Wk 02…
 * In date mode a task's own 🛫 start / 📅 due dates win over the schedule. One section per phase (the heading the
 * task sits under), in note order; tasks outside the project last. Critical path → crit, in progress → active. */

const PLAN_WEEK_BASE = '2026-01-05'; // a Monday, week 01 of its year: "Wk %W" then counts weeks from the start
const PLAN_OUTSIDE = 'Outside this project';

const planClip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

/** { text, sched }: Mermaid gantt text for the tasks. base: the project's start date (YYYY-MM-DD) or null. */
function planGanttText(tasks, { base = null, weeks = false, today = null, maxName = 45 } = {}) {
  const sched = planSchedule(tasks);
  const relative = weeks || !base;
  const from = relative ? PLAN_WEEK_BASE : planWorkdays(base, 0);
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
  let n = 0;
  for (const [name, rows] of groups) {
    lines.push(`  section ${mermaidSafe(name)}`);
    for (const r of rows) {
      const t = r.task;
      const label = planClip(mermaidSafe((t.external ? '↗ ' : '') + planText(t.raw)), maxName);
      const done = planClosed(t);
      const tags = done ? ['done'] : [...(t.status === 'doing' ? ['active'] : []), ...(r.crit && !t.external ? ['crit'] : [])];
      const id = `t${++n}`;
      let when;
      if (!relative && t.start && t.due && t.due >= t.start) when = `${t.start}, ${ymdAdd(t.due, 1)}`;
      else {
        const days = planDays(t);
        const start = !relative && t.start ? t.start : planWorkdays(from, r.es);
        if (!days) {
          lines.push(`  ${label} :${[...tags, 'milestone', id].join(', ')}, ${start}, 0d`);
          continue;
        }
        when = `${start}, ${days}d`;
      }
      lines.push(`  ${label} :${[...tags, id].join(', ')}, ${when}`);
    }
  }
  return { text: n ? lines.join('\n') : '', sched };
}

/** "Wk 3" (relative) or "Mon 23 Nov" for a working-day offset from the start. */
function planDayLabel(offset, base, weeks) {
  if (weeks || !base) return `Wk ${Math.floor(offset / 5) + 1}`;
  const d = planWorkdays(base, offset);
  return moment(d, 'YYYY-MM-DD').format('ddd D MMM');
}
