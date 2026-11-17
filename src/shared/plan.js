/* ---- Project plans (fork): task lines with 🆔 ids, ⛔ dependencies and [duration:: …] (pure) -----------------
 * A plan is the tasks of one project (see plan-scope.js). These functions only read text and work out the plan:
 * which tasks are ready or blocked, a schedule in working days from durations and dependencies, and the critical
 * path (the chain with no slack). Ideas from the Project Planner plugin (Harrison Milburn, MIT); no code taken.
 * Dates are YYYY-MM-DD strings throughout. */

const PLAN_BOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/u;
// a Dataview field [key:: value]; the value may hold links: [owner:: [[@Sam Taylor]], [[@Alex]]]
const PLAN_FIELD_RE = /\[[\w-]+::\s*(?:\[\[[^\]]*\]\]|[^\]\[])*\]/gu;
// the Tasks plugin's priorities, highest first: [level, emoji, label]; no emoji is Normal
const PLAN_PRIORITIES = [
  [5, '🔺', 'Highest'],
  [4, '⏫', 'High'],
  [3, '🔼', 'Medium'],
  [2, '', 'Normal'],
  [1, '🔽', 'Low'],
  [0, '⏬', 'Lowest'],
];
/** A task text's priority level (pure): 5 highest … 2 normal … 0 lowest. */
function planPriority(raw) {
  for (const [n, e] of PLAN_PRIORITIES) if (e && String(raw || '').includes(e)) return n;
  return 2;
}
/** The emoji for a level ('' for normal). */
const planPrioritySign = (n) => (PLAN_PRIORITIES.find((p) => p[0] === n) || [])[1] || '';
const PLAN_OWNER_RE = /\[owner::\s*((?:\[\[[^\]]*\]\]|[^\]\[])*)\]/iu;

/**
 * The owners in a task's text ([owner:: [[@Sam Taylor]], Alex]): [{ key, name, text }]. key: for grouping (the note
 * or the plain name, lower case); name: for showing (an alias, else the note name without its @); text: as written.
 */
function planOwners(raw) {
  const m = String(raw || '').match(PLAN_OWNER_RE);
  if (!m) return [];
  const out = [];
  const plain = m[1].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, target, alias) => {
    const base = target.split('#')[0].split('/').pop().trim();
    out.push({ key: base.replace(/^@/, '').toLowerCase(), name: (alias || base).replace(/^@/, '').trim(), text: all });
    return ',';
  });
  for (const p of plain.split(',').map((x) => x.trim()).filter(Boolean)) out.push({ key: p.replace(/^@/, '').toLowerCase(), name: p.replace(/^@/, ''), text: p });
  return out;
}
// checkbox character → plan status; note-style boxes ([n], [i], [*], …) are not tasks
const PLAN_STATES = { ' ': 'todo', '/': 'doing', '!': 'todo', '?': 'todo', '>': 'todo', '<': 'todo', x: 'done', X: 'done', '-': 'cancelled' };

/** A task from one line (the text after the checkbox is `raw`), or null. `at` adds file, line, phase… */
function planTask(line, at = {}) {
  const m = String(line || '').replace(/\r$/, '').match(PLAN_BOX_RE);
  if (!m || !(m[1] in PLAN_STATES) || !m[2].trim()) return null;
  const raw = m[2];
  const date = (sign) => (raw.match(new RegExp(`${sign}\\s*(\\d{4}-\\d{2}-\\d{2})`, 'u')) || [])[1] || null;
  const id = (raw.match(/🆔\s*([\w-]+)/u) || [])[1] || null;
  const dm = raw.match(/⛔️?\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u);
  const deps = dm ? [...new Set(dm[1].split(',').map((x) => x.trim()).filter(Boolean))] : [];
  const links = [...planLinkField(raw, 'starts-with', 'ss'), ...planLinkField(raw, 'ends-with', 'ff')]; // fork: run alongside
  const du = raw.match(/\[duration::\s*(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)?\s*\]/iu);
  const days = du ? Math.max(0, Math.round(parseFloat(du[1]) * (/^w/i.test(du[2] || '') ? 5 : 1))) : null;
  const milestone = /(^|\s)#milestone(?=\s|$)/iu.test(raw); // fork: a milestone is tagged, not just 0 days
  const flagged = /(^|\s)#blocked(?=\s|$)/iu.test(raw); // blocked by something outside the plan (a supplier, an approval)
  const marks = ['risk', 'issue', 'decision'].filter((k) => new RegExp(`(^|\\s)#${k}(?=\\s|$)`, 'iu').test(raw)); // markers
  return { status: PLAN_STATES[m[1]], box: m[1], raw, id, deps, links, days, milestone, flagged, marks, owners: planOwners(raw), priority: planPriority(raw), due: date('📅'), scheduled: date('⏳'), start: date('🛫'), done: date('✅'), ...at };
}

/**
 * Links that let tasks run alongside (fork, 17 Nov): [starts-with:: a, b+2d] starts no earlier than a starts (plus
 * a lag in working days, d or w); [ends-with:: a] finishes no earlier than a finishes. ⛔ stays "starts when that
 * finishes", as the Tasks plugin reads it. [{ id, type: 'ss' | 'ff', lag }].
 */
function planLinkField(raw, name, type) {
  const m = String(raw || '').match(new RegExp(`\\[${name}::\\s*([^\\]]*)\\]`, 'iu'));
  if (!m) return [];
  const out = [];
  for (const part of m[1].split(',')) {
    const x = part.trim().match(/^([\w-]+)\s*(?:\+\s*(\d+)\s*(d|w)?)?$/i);
    if (x) out.push({ id: x[1], type, lag: x[2] ? Number(x[2]) * (/w/i.test(x[3] || '') ? 5 : 1) : 0 });
  }
  return out;
}
/** Every id a task is linked to (⛔ and the run-alongside links). */
const planLinkIds = (t) => [...(t.deps || []), ...(t.links || []).map((l) => l.id)];
/** A link as written in its field: "a" or "a+2d". */
const planLinkText = (l) => `${l.id}${l.lag ? `+${l.lag}d` : ''}`;

/** Does the text carry one of the task tags ("#task, #todo"); whole tags, any case. */
function planHasTag(raw, tags) {
  return String(tags || '')
    .split(',')
    .map((t) => t.trim().replace(/^#?/, '#'))
    .filter((t) => t.length > 1)
    .some((t) => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|\\s)`, 'iu').test(raw));
}

/** id → task (the first one wins, so tasks of the project come before outside ones), and the ids used twice. */
function planIndex(tasks) {
  const byId = new Map();
  const dups = new Set();
  for (const t of tasks) {
    if (!t.id) continue;
    if (byId.has(t.id)) dups.add(t.id);
    else byId.set(t.id, t);
  }
  return { byId, dups };
}

const planClosed = (t) => t.status === 'done' || t.status === 'cancelled';

const planOverdue = (t, today) => !!(today && t.due && t.due < today && !planClosed(t));

/**
 * What blocks a task: the open tasks upstream that are overdue or tagged #blocked, found through tasks that are
 * themselves waiting on them (a delay reaches everything after it). [] when nothing does.
 */
function planBlockers(t, byId, today, seen = new Set()) {
  const out = [];
  for (const d of t.deps) {
    const x = byId.get(d);
    if (!x || planClosed(x) || seen.has(x)) continue;
    seen.add(x);
    if (planOverdue(x, today) || x.flagged) out.push(x);
    else out.push(...planBlockers(x, byId, today, seen));
  }
  return [...new Set(out)];
}

/**
 * done | doing | blocked (tagged #blocked, or a task upstream is overdue or #blocked) | waiting (depends on open tasks
 * that are on time: the plan working as meant) | ready (nothing open before it). Unknown ids don't hold a task up.
 * Without today nothing counts as overdue.
 */
function planState(t, byId, today = null) {
  if (planClosed(t)) return 'done';
  if (t.status === 'doing') return 'doing';
  if (t.flagged || planBlockers(t, byId, today).length) return 'blocked';
  // waiting: something it follows (⛔) is still open, or something it starts with hasn't started
  const open = (d) => byId.has(d) && !planClosed(byId.get(d));
  const unstarted = (l) => l.type === 'ss' && byId.has(l.id) && byId.get(l.id).status === 'todo';
  return t.deps.some(open) || (t.links || []).some(unstarted) ? 'waiting' : 'ready';
}

/** Working days a task takes: its duration, else 1 (as Project Planner draws undated tasks); milestones and cancelled: 0. */
const planDays = (t) => (t.status === 'cancelled' || t.milestone ? 0 : t.days == null ? 1 : t.days);

/**
 * Schedule in working days from the start (day 0): each task starts when the last task it depends on ends. With
 * notBefore (today, as a working-day offset), a task not started yet ([ ]) starts no earlier than today: a forecast,
 * so only a 📅 date that has passed (or work in progress running late) makes a task overdue.
 * Returns { rows: [{ task, es, ef, slack, crit }] in the tasks' order, length, cycles: [task], missing: [{ task, id }],
 * dups: [id] }. Tasks in a dependency loop are reported and scheduled as if the loop's last link were absent.
 * from: the plan's first working day (date mode): an open task's 🛫 start date is then "not before" that date, so
 * moving it moves everything that waits for it (fork, 17 Nov: dragging a bar on the Gantt writes 🛫).
 * span: (task, es, days) → the working days it spans from es, longer when its owners are off (planLeaveSpan).
 */
function planSchedule(tasks, { notBefore = 0, from = null, span = null } = {}) {
  const { byId, dups } = planIndex(tasks);
  const n = tasks.length;
  const pos = new Map(tasks.map((t, i) => [t, i]));
  // what each task is held by: ⛔ (fs: after it finishes), starts-with (ss) and ends-with (ff), with a lag
  const preds = tasks.map((t) => [
    ...t.deps.filter((d) => byId.has(d)).map((d) => ({ p: pos.get(byId.get(d)), type: 'fs', lag: 0 })),
    ...(t.links || []).filter((l) => byId.has(l.id)).map((l) => ({ p: pos.get(byId.get(l.id)), type: l.type, lag: l.lag })),
  ]);
  const succs = tasks.map(() => []);
  preds.forEach((ps, i) => ps.forEach((x) => succs[x.p].push({ s: i, type: x.type, lag: x.lag })));
  const missing = [];
  for (const t of tasks) for (const d of planLinkIds(t)) if (!byId.has(d)) missing.push({ task: t, id: d });
  const cycles = new Set();
  const es = new Array(n).fill(0);
  const len = new Array(n).fill(0); // working days each task spans (its duration, plus its owners' days off)
  const seen = new Array(n).fill(0); // 0 new, 1 on the path, 2 done
  const finish = (i) => {
    if (seen[i] === 2) return es[i] + len[i];
    if (seen[i] === 1) {
      cycles.add(i);
      return 0;
    }
    seen[i] = 1;
    let s = 0;
    const d = planDays(tasks[i]);
    for (const x of preds[i]) {
      const ef = finish(x.p);
      if (x.type === 'fs') s = Math.max(s, ef);
      else if (x.type === 'ss') s = Math.max(s, (seen[x.p] === 2 ? es[x.p] : 0) + x.lag);
      else s = Math.max(s, ef + x.lag - d); // ff: finish no earlier than it finishes
    }
    if (tasks[i].status === 'todo') s = Math.max(s, notBefore);
    const t0 = tasks[i];
    if (from && t0.start && !planClosed(t0)) s = Math.max(s, planWorkdaysBetween(from, t0.start));
    es[i] = s;
    len[i] = span ? Math.max(d, span(t0, s, d)) : d;
    seen[i] = 2;
    return s + len[i];
  };
  let length = 0;
  for (let i = 0; i < n; i++) length = Math.max(length, finish(i));
  const lf = new Array(n).fill(null);
  const late = (i, path = new Set()) => {
    if (lf[i] != null) return lf[i] - len[i];
    if (path.has(i)) return length;
    path.add(i);
    let f = length;
    const d = len[i];
    for (const x of succs[i]) {
      const ls = late(x.s, path); // the latest the next task can start
      if (x.type === 'fs') f = Math.min(f, ls);
      else if (x.type === 'ss') f = Math.min(f, ls - x.lag + d);
      else f = Math.min(f, ls + len[x.s] - x.lag); // ff: its latest finish, less the lag
    }
    path.delete(i);
    lf[i] = f;
    return f - len[i];
  };
  for (let i = 0; i < n; i++) late(i);
  const rows = tasks.map((task, i) => {
    const ef = es[i] + len[i];
    const slack = Math.max(0, lf[i] - ef);
    return { task, es: es[i], ef, slack, crit: slack === 0 && n > 0 };
  });
  return { rows, length, cycles: [...cycles].map((i) => tasks[i]), missing, dups: [...dups] };
}

/**
 * The date `n` working days after a date (a day off first moves to the next working day). Working days follow the
 * calendar in the settings (plan-calendar.js: working week, public holidays, closure days); cal overrides it.
 */
function planWorkdays(ymd, n = 0, cal = planCal()) {
  let d = ymd;
  let guard = 0;
  while (!cal.isWorkday(d) && guard++ < 400) d = planNextDay(d);
  for (let k = n; k > 0 && guard++ < 100000; ) {
    d = planNextDay(d);
    if (cal.isWorkday(d)) k--;
  }
  return d;
}

/** Working days from one date to a later one (0 when b is not after a). */
function planWorkdaysBetween(a, b, cal = planCal()) {
  let n = 0;
  for (let d = planWorkdays(a, 0, cal); d < b && n < 5000; d = planWorkdays(d, 1, cal)) n++;
  return n;
}

/** Counts for a project's own tasks (outside ones left out): total, ready, doing, blocked, done, overdue, week. */
function planCounts(tasks, today) {
  const { byId } = planIndex(tasks);
  const week = ymdAdd(today, 7);
  const c = { total: 0, ready: 0, waiting: 0, doing: 0, blocked: 0, done: 0, overdue: 0, week: 0 };
  for (const t of tasks) {
    if (t.external) continue;
    c.total++;
    const s = planState(t, byId, today);
    c[s]++;
    if (s === 'done') continue;
    // overdue: only a 📅 that has passed (⏳ is when it is planned, which Planning may keep in step); due this week: 📅 or ⏳
    if (t.due && t.due < today) c.overdue++;
    else if ((t.due || t.scheduled) && (t.due || t.scheduled) >= today && (t.due || t.scheduled) <= week) c.week++;
  }
  return c;
}

/** "2 overdue · 3 due this week · 1 blocked · 4 ready · 1 in progress · 12 waiting · 5/49 done"; short: what needs action. */
function planSummaryText(c, short = false) {
  if (!c || !c.total) return '';
  const parts = [];
  if (c.overdue) parts.push(`${c.overdue} overdue`);
  if (c.week) parts.push(`${c.week} due this week`);
  if (c.blocked) parts.push(`${c.blocked} blocked`);
  if (short) return parts.join(' · ');
  if (c.ready) parts.push(`${c.ready} ready`);
  if (c.doing) parts.push(`${c.doing} in progress`);
  if (c.waiting) parts.push(`${c.waiting} waiting`);
  parts.push(`${c.done}/${c.total} done`);
  return parts.join(' · ');
}

/** A task's text for charts and lists: plan fields, dates, priorities, tags and link brackets taken out. */
function planText(raw) {
  return String(raw || '')
    .replace(/🆔\s*[\w-]+/gu, '')
    .replace(/⛔️?\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, '')
    .replace(PLAN_FIELD_RE, '')
    .replace(/(?:📅|⏳|🛫|✅|➕|❌)\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/🔁[^📅⏳🛫✅➕]*/gu, '')
    .replace(/[⏫🔼🔽🔺⏬]/gu, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#[\w/-]+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Marcus" / "Marcus/Sofia": owners' first names, for labels. */
function planOwnerShort(t) {
  return (t.owners || []).map((o) => o.name.split(/\s+/)[0]).join('/');
}

/**
 * Days of work per owner per week (pure): Map key → { name, owner, weeks: Map week → days }, from the schedule (open
 * tasks; a task with two owners counts in full for both). Weeks count from the plan's day 0 in fives, or weekOf(day)
 * names them (the Monday's date); works(owner, day) false: a day off, not counted.
 */
function planLoad(rows, { weekOf = (d) => Math.floor(d / 5), works = null } = {}) {
  const out = new Map();
  for (const r of rows) {
    const t = r.task;
    if (t.external || planClosed(t) || !(t.owners || []).length) continue;
    for (const o of t.owners) {
      const me = out.get(o.key) || out.set(o.key, { name: o.name, owner: o, weeks: new Map(), rows: new Map() }).get(o.key);
      for (let d = r.es; d < r.ef; d++) {
        if (works && !works(o, d)) continue;
        const w = weekOf(d);
        me.weeks.set(w, (me.weeks.get(w) || 0) + 1);
        const list = me.rows.get(w) || me.rows.set(w, []).get(w);
        if (!list.includes(r)) list.push(r);
      }
    }
  }
  return out;
}
/**
 * [{ name, week, days, cap, lowest }] where someone has more than `cap` days of work in a week (cap: a number, or
 * (owner, week) → their working days that week). lowest: their task that week that could move most easily: the
 * lowest priority, then the most slack, then the latest start. opts: as planLoad.
 */
function planOverloads(rows, cap = 5, opts = {}) {
  const out = [];
  for (const { name, owner, weeks, rows: byWeek } of planLoad(rows, opts).values())
    for (const [week, days] of weeks) {
      const avail = typeof cap === 'function' ? cap(owner, week) : cap;
      if (days <= avail) continue;
      const pick = [...byWeek.get(week)].sort((a, b) => (a.task.priority ?? 2) - (b.task.priority ?? 2) || b.slack - a.slack || b.es - a.es)[0];
      out.push({ name, week, days, cap: avail, lowest: pick ? pick.task : null });
    }
  return out.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0) || a.name.localeCompare(b.name));
}
