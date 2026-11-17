/* ---- Project plans (fork): what is wrong with a plan's links -------------------------------------------------
 * Waiting for an id no task has (often a task folded into a holding task, or a typo), one id on several tasks,
 * and dependency loops. Each problem names the task to fix, so the Planning view can open the note at its line;
 * the Report and the project cards list them too, and the editor underlines them as you type
 * (src/tickets/plan-marks.js). Read only: nothing is written. */

/** A task's short name: its id, else the start of its text. */
const planProblemName = (t) => t.id || planClip(planText(t.raw), 40);
/** "1 plan problem", "3 plan problems". */
const planProblemCount = (n) => `${n} plan problem${n === 1 ? '' : 's'}`;
const planAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * [{ kind: 'missing' | 'dup' | 'loop', task, ids, text }]: the plan's own tasks only (another project's tasks,
 * marked external, are shown but their links aren't followed, so theirs aren't checked). sched: planSchedule's
 * result when already made.
 */
function planProblems(tasks, sched) {
  const s = sched || planSchedule(tasks);
  const out = [];
  const missing = new Map(); // task -> [ids]
  for (const m of s.missing) if (!m.task.external) missing.set(m.task, [...(missing.get(m.task) || []), m.id]);
  for (const [task, ids] of missing) {
    const uniq = [...new Set(ids)];
    out.push({ kind: 'missing', task, ids: uniq, text: `${planProblemName(task)} waits for ${planAnd(uniq)}, but no task has ${uniq.length === 1 ? 'that id' : 'those ids'}` });
  }
  for (const id of s.dups) {
    const same = tasks.filter((t) => t.id === id);
    if (same.every((t) => t.external)) continue;
    const task = same.find((t) => !t.external && t !== same[0]) || same.find((t) => !t.external);
    out.push({ kind: 'dup', task, ids: [id], text: `${id} is the id of ${same.length} tasks: ${planAnd(same.map((t) => `“${planClip(planText(t.raw), 30)}”`))}` });
  }
  for (const loop of planLoops(tasks)) {
    if (loop.every((t) => t.external)) continue;
    const names = loop.map(planProblemName);
    out.push({ kind: 'loop', task: loop.find((t) => !t.external), ids: loop.map((t) => t.id).filter(Boolean), text: `Dependency loop: ${names.join(' → ')} → ${names[0]}` });
  }
  return out;
}
/** The dependency loops: each a list of tasks in waiting order (strongly connected parts of the graph, Tarjan). */
function planLoops(tasks) {
  const { byId } = planIndex(tasks);
  const next = (t) => t.deps.map((d) => byId.get(d)).filter(Boolean); // what t waits for
  const index = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const loops = [];
  let n = 0;
  const visit = (t) => {
    index.set(t, n);
    low.set(t, n++);
    stack.push(t);
    on.add(t);
    for (const u of next(t)) {
      if (!index.has(u)) {
        visit(u);
        low.set(t, Math.min(low.get(t), low.get(u)));
      } else if (on.has(u)) low.set(t, Math.min(low.get(t), index.get(u)));
    }
    if (low.get(t) !== index.get(t)) return;
    const part = [];
    let u;
    do {
      u = stack.pop();
      on.delete(u);
      part.push(u);
    } while (u !== t);
    if (part.length > 1 || next(t).includes(t)) loops.push(planLoopOrder(part, next));
  };
  for (const t of tasks) if (!index.has(t)) visit(t);
  return loops;
}
/** A loop's tasks from its first one in the note, each followed by one it waits for. */
function planLoopOrder(part, next) {
  const inPart = new Set(part);
  const start = part.reduce((a, b) => (part.indexOf(a) > part.indexOf(b) ? a : b)); // Tarjan pops the first-visited last
  const order = [start];
  let cur = start;
  for (;;) {
    const u = next(cur).find((x) => inPart.has(x) && !order.includes(x));
    if (!u) break;
    order.push(u);
    cur = u;
  }
  return order.length === part.length ? order : part.slice().reverse();
}
