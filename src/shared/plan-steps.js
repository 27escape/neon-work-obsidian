/* ---- Project plans (fork): a task's steps, and tasks inside tasks -------------------------------------------
 * A plan task's steps are the checkboxes directly under it: `- [ ]` / `- [x]`, and `- ( )` / `- (x)` (Kevin's
 * action format). Cancelled ones (`[-]`, `(-)`) and notes such as `[?]` don't count; an in-progress `[/]` counts as
 * open. Planning shows "2/4" and, when every step is done but the task isn't, offers to tick it: it never ticks it
 * by itself. A task line (#task or 🆔) indented under another task is a plan problem: tasks inside tasks are too
 * much; make it a plain checkbox, or move it out to its own line. Pure. */

const PLAN_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s/;
/** Indent width of a line (a tab counts as four spaces). */
const planIndentWidth = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;

/**
 * The list outline of a note: Map line → parent list line (-1 at the top of a list). A heading, or a line that
 * isn't a list item and isn't indented, ends the list.
 */
function planListTree(lines) {
  const parent = new Map();
  let stack = []; // [{ line, width }]
  lines.forEach((raw, n) => {
    const l = raw.replace(/\r$/, '');
    if (!l.trim()) return;
    if (!PLAN_ITEM_RE.test(l)) {
      if (/^#{1,6}\s/.test(l) || planIndentWidth(l) === 0) stack = [];
      return;
    }
    const w = planIndentWidth(l);
    while (stack.length && stack[stack.length - 1].width >= w) stack.pop();
    parent.set(n, stack.length ? stack[stack.length - 1].line : -1);
    stack.push({ line: n, width: w });
  });
  return parent;
}
/** The checkbox state of a list line: 'open', 'done', or null (not a step: cancelled, a note like [?], or text). */
function planStepState(l) {
  const m = String(l || '').match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[(.)\]|\((.)\))(?=\s|$)/);
  if (!m) return null;
  const c = m[1] != null ? m[1] : m[2];
  if (c === ' ' || c === '/') return 'open';
  if (c === 'x' || c === 'X') return 'done';
  return null;
}
/** { done, total } for the checkboxes directly under line n, or null when it has none. */
function planStepsOf(lines, tree, n) {
  let done = 0;
  let total = 0;
  for (const [line, p] of tree) {
    if (p !== n) continue;
    const s = planStepState(lines[line]);
    if (!s) continue;
    total++;
    if (s === 'done') done++;
  }
  return total ? { done, total } : null;
}
/** The line of the plan task this line sits inside (at any depth), or null. isTask(line) says which lines are tasks. */
function planNestedIn(tree, n, isTask) {
  for (let p = tree.get(n); p != null && p >= 0; p = tree.get(p)) if (isTask(p)) return p;
  return null;
}
/** Steps and nesting for the plan tasks read from one note's lines (sets t.steps and t.nestedIn). */
function planAddSteps(lines, tasks) {
  const tree = planListTree(lines);
  const taskLines = new Set(tasks.map((t) => t.line));
  for (const t of tasks) {
    t.steps = planStepsOf(lines, tree, t.line);
    t.nestedIn = planNestedIn(tree, t.line, (p) => taskLines.has(p));
  }
  return tasks;
}
/** Every step ticked, the task itself still open. */
const planStepsDone = (t) => !!t.steps && t.steps.total > 0 && t.steps.done === t.steps.total && !planClosed(t);
