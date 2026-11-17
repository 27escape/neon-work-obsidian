/* ---- Project plans (fork): a plan as Mermaid Gantt text (pure) ----------------------------------------------------
 * Bars come from the schedule (planSchedule): working days, weekends left out. With the project's start date the
 * axis shows dates; without one (or with weeks chosen) it counts weeks from a fixed Monday, so it reads Wk 01, Wk 02…
 * In date mode a task's own 🛫 start / 📅 due dates win over the schedule. One section per phase (the heading the
 * task sits under), in note order; tasks outside the project last. The text keeps Mermaid's own tags (done, active,
 * crit) for when it is pasted into a note; the Plan view colours each bar by its kind (planBarKind). */

const PLAN_OUTSIDE = 'Outside this project';
const PLAN_SOON_DAYS = 7; // due within this many days: "due soon"

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

/** The marker of a task (#risk, #issue, #decision; the first one if several), or null. */
const planMark = (t) => PLAN_MARKS.find(([k]) => (t.marks || []).includes(k)) || null;
// how bad a state is, for a phase's colour (its worst task)
const PLAN_WORST = ['overdue', 'blocked', 'soon', 'doing', 'waiting', 'ready', 'outside', 'done'];

/**
 * { text, sched, bars: [{ id, task, kind, crit, mark, start, end }], end, late }: Mermaid gantt text. base: the
 * project's start date or null. phases: one bar per phase (its first start to its last finish, coloured by its worst
 * task). due: the project's due date; with real dates the plan's forecast finish and the due date are drawn as two
 * milestones, and late says how many working days the forecast is past the due date (0: on time).
 */
function planGanttText(tasks, { base = null, weeks = false, today = null, maxName = 45, show = null, phases = false, due = null } = {}) {
  const relative = weeks || !base;
  const from = relative ? PLAN_WEEK_BASE : planWorkdays(base, 0);
  // with real dates, work not started yet is forecast from today, not from the project's start
  const sched = planSchedule(tasks, { notBefore: !relative && today ? planWorkdaysBetween(from, today) : 0, from: relative ? null : from });
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
  const drawn = []; // what is drawn, in order: { section } headings and { bar, label, milestone, thin } rows
  let end = null;
  for (const [name, rows] of groups) {
    lines.push(`  section ${mermaidSafe(name)}`);
    drawn.push({ section: name });
    const mine = [];
    for (const r of rows) {
      const t = r.task;
      const state = planState(t, byId, today);
      const crit = r.crit && !t.external && state !== 'done';
      const days = planDays(t);
      let start;
      let last; // the bar's last day (inclusive)
      if (t.milestone) start = last = !relative && (t.due || t.start) ? t.due || t.start : planWorkdays(from, r.es);
      else if (!relative && t.start && t.due && t.due >= t.start) [start, last] = [t.start, t.due];
      else {
        // done: where it really started; open: the schedule, which keeps a 🛫 date as "not before"
        start = !relative && t.start && planClosed(t) ? t.start : planWorkdays(from, r.es);
        last = planWorkdays(start, Math.max(0, days - 1));
      }
      const mark = planMark(t);
      const bar = { id: `np${bars.length + 1}`, task: t, kind: planBarKind(t, state, today, relative ? null : last), crit, mark: mark ? mark[0] : null, start, end: last };
      bars.push(bar);
      if (!t.external && !relative && (!end || last > end)) end = last;
      if (show && !show(t)) continue; // filtered out (one person): still in the schedule, not drawn
      mine.push(bar);
      if (phases) continue;
      const who = planOwnerShort(t);
      const sign = mark ? `${mark[1]} ` : '';
      const label = planClip(mermaidSafe(sign + (t.external ? '↗ ' : '') + planText(t.raw)), maxName - (who ? who.length + 3 : 0)) + (who ? ` · ${mermaidSafe(who)}` : '');
      const tags = state === 'done' ? ['done'] : [...(state === 'doing' ? ['active'] : []), ...(crit ? ['crit'] : [])];
      const when = t.milestone ? `${start}, 0d` : !relative && t.start && t.due && t.due >= t.start ? `${start}, ${ymdAdd(t.due, 1)}` : `${start}, ${days ? `${days}d` : '4h'}`; // 0 days: a thin bar
      lines.push(`  ${label} :${[...tags, ...(t.milestone ? ['milestone'] : []), bar.id].join(', ')}, ${when}`);
      const pri = planPrioritySign(t.priority ?? 2);
      drawn.push({ bar, label: (pri ? `${pri} ` : '') + sign + (t.external ? '↗ ' : '') + planText(t.raw), who, milestone: !!t.milestone, thin: !t.milestone && !days });
    }
    if (phases && mine.length) {
      // one bar for the phase: first start to last finish, its worst task's colour
      const first = mine.reduce((a, b) => (b.start < a ? b.start : a), mine[0].start);
      const last = mine.reduce((a, b) => (b.end > a ? b.end : a), mine[0].end);
      const kind = PLAN_WORST.find((k) => mine.some((b) => b.kind === k)) || 'ready';
      const crit = mine.some((b) => b.crit);
      const marks = PLAN_MARKS.filter(([k]) => mine.some((b) => b.mark === k)).map((m) => m[1]).join('');
      const done = mine.filter((b) => b.kind === 'done').length;
      const bar = { id: `np${bars.length + 1}`, task: null, phase: name, kind, crit, mark: null, start: first, end: last };
      bars.push(bar);
      const label = planClip(mermaidSafe(`${marks ? `${marks} ` : ''}${name} (${done}/${mine.length} done)`), maxName + 10);
      lines.push(`  ${label} :${[...(kind === 'done' ? ['done'] : crit ? ['crit'] : []), bar.id].join(', ')}, ${first}, ${ymdAdd(last, 1)}`);
      drawn.push({ bar, label: `${marks ? `${marks} ` : ''}${name} (${done}/${mine.length} done)`, who: '', milestone: false, thin: false });
    }
  }
  let late = 0;
  if (!relative && end) {
    // the project: its forecast finish, and its due date if it has one
    late = due && end > due ? planWorkdaysBetween(due, end) : 0;
    lines.push('  section Project');
    drawn.push({ section: 'Project' });
    const fin = { id: `np${bars.length + 1}`, task: null, kind: late ? 'overdue' : 'ready', crit: false, mark: null, start: end, end };
    bars.push(fin);
    lines.push(`  Forecast finish ${planShortDate(end)} :milestone, ${fin.id}, ${end}, 0d`);
    drawn.push({ bar: fin, label: `Forecast finish ${planShortDate(end)}`, who: '', milestone: true, thin: false });
    if (due) {
      const d = { id: `np${bars.length + 1}`, task: null, kind: late ? 'overdue' : 'done', crit: false, mark: null, start: due, end: due };
      bars.push(d);
      lines.push(`  Due ${planShortDate(due)}${late ? ` (${late} working days late)` : ''} :milestone, ${d.id}, ${due}, 0d`);
      drawn.push({ bar: d, label: `Due ${planShortDate(due)}${late ? ` (${late} working days late)` : ''}`, who: '', milestone: true, thin: false });
    }
  }
  const kept = lines.filter((l, i) => !(l.startsWith('  section ') && (lines[i + 1] === undefined || lines[i + 1].startsWith('  section '))));
  // headings with nothing under them (a person's filter) go, as in the text
  const shown = drawn.filter((r, i) => !(r.section && (!drawn[i + 1] || drawn[i + 1].section)));
  return { text: kept.some((l) => / :/.test(l)) ? kept.join('\n') : '', sched, bars, rows: shown, end, late, relative }; // task lines hold ' :'
}

/** "Wk 3" (relative) or "Mon 23 Nov" for a working-day offset from the start. */
function planDayLabel(offset, base, weeks) {
  if (weeks || !base) return `Wk ${Math.floor(offset / 5) + 1}`;
  const d = planWorkdays(base, offset);
  return moment(d, 'YYYY-MM-DD').format('ddd D MMM');
}
