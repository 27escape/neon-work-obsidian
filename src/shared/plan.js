/* ---- Project plans (fork): task lines with 🆔 ids, ⛔ dependencies and [duration:: …] (pure) -----------------
 * A plan is the tasks of one project (see plan-scope.js). These functions only read text and work out the plan:
 * which tasks are ready or blocked, a schedule in working days from durations and dependencies, and the critical
 * path (the chain with no slack). Ideas from the Project Planner plugin (Harrison Milburn, MIT); no code taken.
 * Dates are YYYY-MM-DD strings throughout. */

const PLAN_BOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/u;
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
  const du = raw.match(/\[duration::\s*(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)?\s*\]/iu);
  const days = du ? Math.max(0, Math.round(parseFloat(du[1]) * (/^w/i.test(du[2] || '') ? 5 : 1))) : null;
  return { status: PLAN_STATES[m[1]], box: m[1], raw, id, deps, days, due: date('📅'), scheduled: date('⏳'), start: date('🛫'), done: date('✅'), ...at };
}

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

/** done | doing | blocked (a task it depends on is still open) | ready. Unknown ids don't block. */
function planState(t, byId) {
  if (planClosed(t)) return 'done';
  if (t.status === 'doing') return 'doing';
  return t.deps.some((d) => byId.has(d) && !planClosed(byId.get(d))) ? 'blocked' : 'ready';
}

/** Working days a task takes: its duration, else 1 (as Project Planner draws undated tasks); cancelled: 0. */
const planDays = (t) => (t.status === 'cancelled' ? 0 : t.days == null ? 1 : t.days);

/**
 * Schedule in working days from the start (day 0): each task starts when the last task it depends on ends. With
 * notBefore (today, as a working-day offset), a task not started yet ([ ]) starts no earlier than today: a forecast,
 * so only a 📅 date that has passed (or work in progress running late) makes a task overdue.
 * Returns { rows: [{ task, es, ef, slack, crit }] in the tasks' order, length, cycles: [task], missing: [{ task, id }],
 * dups: [id] }. Tasks in a dependency loop are reported and scheduled as if the loop's last link were absent.
 */
function planSchedule(tasks, { notBefore = 0 } = {}) {
  const { byId, dups } = planIndex(tasks);
  const n = tasks.length;
  const pos = new Map(tasks.map((t, i) => [t, i]));
  const preds = tasks.map((t) => t.deps.filter((d) => byId.has(d)).map((d) => pos.get(byId.get(d))));
  const succs = tasks.map(() => []);
  preds.forEach((ps, i) => ps.forEach((p) => succs[p].push(i)));
  const missing = [];
  for (const t of tasks) for (const d of t.deps) if (!byId.has(d)) missing.push({ task: t, id: d });
  const cycles = new Set();
  const es = new Array(n).fill(0);
  const seen = new Array(n).fill(0); // 0 new, 1 on the path, 2 done
  const finish = (i) => {
    if (seen[i] === 2) return es[i] + planDays(tasks[i]);
    if (seen[i] === 1) {
      cycles.add(i);
      return 0;
    }
    seen[i] = 1;
    let s = 0;
    for (const p of preds[i]) s = Math.max(s, finish(p));
    if (tasks[i].status === 'todo') s = Math.max(s, notBefore);
    es[i] = s;
    seen[i] = 2;
    return s + planDays(tasks[i]);
  };
  let length = 0;
  for (let i = 0; i < n; i++) length = Math.max(length, finish(i));
  const lf = new Array(n).fill(null);
  const late = (i, path = new Set()) => {
    if (lf[i] != null) return lf[i] - planDays(tasks[i]);
    if (path.has(i)) return length;
    path.add(i);
    let f = length;
    for (const s of succs[i]) f = Math.min(f, late(s, path));
    path.delete(i);
    lf[i] = f;
    return f - planDays(tasks[i]);
  };
  for (let i = 0; i < n; i++) late(i);
  const rows = tasks.map((task, i) => {
    const ef = es[i] + planDays(task);
    const slack = Math.max(0, lf[i] - ef);
    return { task, es: es[i], ef, slack, crit: slack === 0 && n > 0 };
  });
  return { rows, length, cycles: [...cycles].map((i) => tasks[i]), missing, dups: [...dups] };
}

/** The date `n` working days after a date (a weekend date first moves to the Monday). */
function planWorkdays(ymd, n = 0) {
  const t = new Date(`${ymd}T00:00:00Z`);
  const weekday = () => t.getUTCDay() !== 0 && t.getUTCDay() !== 6;
  while (!weekday()) t.setUTCDate(t.getUTCDate() + 1);
  for (let k = n; k > 0; ) {
    t.setUTCDate(t.getUTCDate() + 1);
    if (weekday()) k--;
  }
  return t.toISOString().slice(0, 10);
}

/** Working days from one date to a later one (0 when b is not after a). */
function planWorkdaysBetween(a, b) {
  let n = 0;
  for (let d = planWorkdays(a, 0); d < b && n < 5000; d = planWorkdays(d, 1)) n++;
  return n;
}

/** Counts for a project's own tasks (outside ones left out): total, ready, doing, blocked, done, overdue, week. */
function planCounts(tasks, today) {
  const { byId } = planIndex(tasks);
  const week = ymdAdd(today, 7);
  const c = { total: 0, ready: 0, doing: 0, blocked: 0, done: 0, overdue: 0, week: 0 };
  for (const t of tasks) {
    if (t.external) continue;
    c.total++;
    const s = planState(t, byId);
    c[s]++;
    if (s === 'done') continue;
    const d = t.due || t.scheduled;
    if (d && d < today) c.overdue++;
    else if (d && d <= week) c.week++;
  }
  return c;
}

/** "2 overdue · 3 due this week · 4 ready · 1 in progress · 12 blocked · 5/49 done"; short: only what needs action. */
function planSummaryText(c, short = false) {
  if (!c || !c.total) return '';
  const parts = [];
  if (c.overdue) parts.push(`${c.overdue} overdue`);
  if (c.week) parts.push(`${c.week} due this week`);
  if (short) return parts.join(' · ');
  if (c.ready) parts.push(`${c.ready} ready`);
  if (c.doing) parts.push(`${c.doing} in progress`);
  if (c.blocked) parts.push(`${c.blocked} blocked`);
  parts.push(`${c.done}/${c.total} done`);
  return parts.join(' · ');
}

/** A task's text for charts and lists: plan fields, dates, priorities, tags and link brackets taken out. */
function planText(raw) {
  return String(raw || '')
    .replace(/🆔\s*[\w-]+/gu, '')
    .replace(/⛔️?\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, '')
    .replace(/\[[\w-]+::[^\]]*\]/gu, '')
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
