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

/** "4 Dec" (pure). */
const planShortDate = (ymd) => `${+ymd.slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+ymd.slice(5, 7) - 1]}`;
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

// markers for tasks tagged #risk, #issue or #decision: a sign before the name and a dashed outline on the bar
const PLAN_MARKS = [
  ['risk', '⚠', 'Risk', '--color-orange', '#e8871e'],
  ['issue', '‼', 'Issue', '--color-red', '#d93b3b'],
  ['decision', '⚖', 'Decision', '--color-green', '#2e9e5b'],
];
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
function planGanttText(tasks, { base = null, weeks = false, today = null, maxName = 45, show = null, phases = false, due = null, colours = null } = {}) {
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
  let end = null;
  for (const [name, rows] of groups) {
    lines.push(`  section ${mermaidSafe(name)}`);
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
        start = !relative && t.start ? t.start : planWorkdays(from, r.es);
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
    }
  }
  let late = 0;
  if (!relative && end) {
    // the project: its forecast finish, and its due date if it has one
    late = due && end > due ? planWorkdaysBetween(due, end) : 0;
    lines.push('  section Project');
    const fin = { id: `np${bars.length + 1}`, task: null, kind: late ? 'overdue' : 'ready', crit: false, mark: null, start: end, end };
    bars.push(fin);
    lines.push(`  Forecast finish ${planShortDate(end)} :milestone, ${fin.id}, ${end}, 0d`);
    if (due) {
      const d = { id: `np${bars.length + 1}`, task: null, kind: late ? 'overdue' : 'done', crit: false, mark: null, start: due, end: due };
      bars.push(d);
      lines.push(`  Due ${planShortDate(due)}${late ? ` (${late} working days late)` : ''} :milestone, ${d.id}, ${due}, 0d`);
    }
  }
  const kept = lines.filter((l, i) => !(l.startsWith('  section ') && (lines[i + 1] === undefined || lines[i + 1].startsWith('  section '))));
  if (colours) kept.unshift(planGanttStyle(bars, colours)); // the colours travel with the text (copy, SVG)
  return { text: kept.some((l) => / :/.test(l)) ? kept.join('\n') : '', sched, bars, end, late }; // task lines hold ' :'
}

/**
 * A Mermaid init line whose themeCSS colours each bar by its kind (pure). Mermaid names a bar <svg id>-<task id>, so
 * [id$=-np3] finds it; labels inside a bar (.taskText) get a readable colour, risks and issues bold. Colouring the
 * drawing afterwards didn't hold in Obsidian (its Mermaid styles won), CSS inside the drawing does. colours: { kind:
 * '#hex', edge, 'mark-risk', … }. Values are plain #hex, so the JSON needs no escaping.
 */
function planGanttStyle(bars, colours) {
  const ink = (k) => (k === 'soon' || k === 'outside' || k === 'waiting' ? '#000000' : '#ffffff');
  const css = [];
  for (const b of bars) {
    const c = colours[b.kind] || '#888888';
    const mark = b.mark ? colours[`mark-${b.mark}`] : null;
    const stroke = mark ? `stroke:${mark} !important;stroke-width:3px !important;stroke-dasharray:6 3` : b.crit ? `stroke:${colours.edge || '#222222'} !important;stroke-width:2px !important` : `stroke:${c} !important`;
    css.push(`[id$=-${b.id}]{fill:${c} !important;${stroke}}`);
    css.push(`.taskText[id$=-${b.id}-text]{fill:${ink(b.kind)} !important}`);
    if (b.mark === 'risk' || b.mark === 'issue') css.push(`[id$=-${b.id}-text]{font-weight:700 !important}`);
  }
  return `%%{init: {"themeCSS": "${css.join(' ')}"}}%%`;
}

/** "Wk 3" (relative) or "Mon 23 Nov" for a working-day offset from the start. */
function planDayLabel(offset, base, weeks) {
  if (weeks || !base) return `Wk ${Math.floor(offset / 5) + 1}`;
  const d = planWorkdays(base, offset);
  return moment(d, 'YYYY-MM-DD').format('ddd D MMM');
}
