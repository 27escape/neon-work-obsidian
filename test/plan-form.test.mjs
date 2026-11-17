import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planIndex', 'planInitials', 'planPrefix', 'planNextId', 'planSplit', 'planSetSign', 'planApplyForm', 'planEditFile', 'planDepsRest', 'planHeadings', 'planDownstream', 'planUpstream', 'planPlannedDates']);
const T = (l, at = {}) => P.planTask(l, at);
const form = (o) => Object.assign({ desc: '', box: ' ', days: null, milestone: false, flagged: false, start: null, scheduled: null, due: null, id: null, deps: [] }, o);

test('ids: plan-prefix property, else the title’s initials; the next free number', () => {
  assert.equal(P.planInitials('Pilot - Local AI'), 'pla');
  assert.equal(P.planInitials('Service Desk Rollout'), 'sdr');
  assert.equal(P.planPrefix({ 'plan-prefix': 'pilot' }, 'Pilot - Local AI'), 'pilot');
  assert.equal(P.planPrefix({}, 'Pilot - Local AI'), 'pla');
  assert.equal(P.planNextId(['pla-sc1', 'pla-3', 'pla-12', 'other-40'], 'pla'), 'pla-13');
  assert.equal(P.planNextId([], 'sdr'), 'sdr-1');
});

test('editing a task changes only its own fields, in place; others stay where they are', () => {
  const raw = 'Shortlist tools [duration:: 2d] 🆔 sdr-t1 ⛔ sdr-d2 📅 2026-11-19 ⏫ #task';
  const f = form({ desc: 'Shortlist three tools', days: 3, id: 'sdr-t1', deps: ['sdr-d2', 'sdr-d3'], due: '2026-11-20' });
  const r = P.planApplyForm(raw, ' ', f, '2026-11-16');
  assert.equal(r.rest, 'Shortlist three tools [duration:: 3d] 🆔 sdr-t1 ⛔ sdr-d2,sdr-d3 📅 2026-11-20 ⏫ #task');
  assert.equal(P.planApplyForm(raw, ' ', form({ desc: 'Shortlist tools', days: 2, id: 'sdr-t1' }), 'x').rest, 'Shortlist tools [duration:: 2d] 🆔 sdr-t1 ⏫ #task'); // deps and due cleared
  const lead = P.planApplyForm('#task choose users ➕ 2026-10-01', ' ', form({ desc: 'choose ten users', id: 'a-1' }), 'x');
  assert.equal(lead.rest, '#task choose ten users ➕ 2026-10-01 🆔 a-1');
});

test('status, milestone, #blocked and new tasks', () => {
  const done = P.planApplyForm('A 🆔 a #task', ' ', form({ desc: 'A', id: 'a', box: 'x' }), '2026-11-16');
  assert.deepEqual([done.box, done.rest], ['x', 'A 🆔 a #task ✅ 2026-11-16']);
  const reopened = P.planApplyForm(done.rest, 'x', form({ desc: 'A', id: 'a', box: '/' }), '2026-11-17');
  assert.equal(reopened.rest, 'A 🆔 a #task');
  const cancelled = P.planApplyForm('A ✅ 2026-11-01', 'x', form({ desc: 'A', box: '-' }), '2026-11-16');
  assert.equal(cancelled.rest, 'A ❌ 2026-11-16');
  const ms = P.planApplyForm('Go live [duration:: 0d] 🆔 g #task', ' ', form({ desc: 'Go live', id: 'g', days: 0, milestone: true }), 'x');
  assert.equal(ms.rest, 'Go live 🆔 g #task #milestone');
  const flagged = P.planApplyForm('Wait for supplier 🆔 s #task', ' ', form({ desc: 'Wait for supplier', id: 's', flagged: true }), 'x');
  assert.equal(flagged.rest, 'Wait for supplier 🆔 s #task #blocked');
  const fresh = P.planApplyForm('', ' ', form({ desc: 'New one', days: 2, id: 'p-9', deps: ['p-1'], tag: '#task' }), 'x');
  assert.equal(fresh.rest, 'New one [duration:: 2d] 🆔 p-9 ⛔ p-1 #task');
});

test('dependencies of other tasks: ids added and removed', () => {
  assert.equal(P.planDepsRest('B 🆔 b ⛔ a,c #task', ['n'], ['a']), 'B 🆔 b ⛔ c,n #task');
  assert.equal(P.planDepsRest('B 🆔 b ⛔ a #task', [], ['a']), 'B 🆔 b #task');
  assert.equal(P.planDepsRest('B #task', ['n'], []), 'B ⛔ n #task');
});

const NOTE = ['---', 'title: X', '---', '# X', '', '### 1. Scope', '', '- [ ] A 🆔 a #task', '- [ ] B 🆔 b ⛔ a #task', '', '### 2. Build', '', 'Some words.', '', '### 3. Empty', '', '## Notes', 'text'].join('\n');

test('saving: a new task goes at the end of its phase; a moved task changes section; other tasks edited too', () => {
  const tasks = [T('- [ ] A 🆔 a #task', { line: 7, phase: '1. Scope' }), T('- [ ] B 🆔 b ⛔ a #task', { line: 8, phase: '1. Scope' })];
  assert.equal(P.planHeadings(NOTE.split('\n')).map((h) => h.text).join('|'), 'X|1. Scope|2. Build|3. Empty|Notes');
  const add = P.planEditFile(NOTE, { main: { task: null, form: form({ desc: 'C', id: 'x-3', deps: ['b'], tag: '#task' }), phase: '1. Scope' } }, 'x');
  assert.equal(add.text.split('\n')[9], '- [ ] C 🆔 x-3 ⛔ b #task');
  assert.equal(add.line, 9);
  const empty = P.planEditFile(NOTE, { main: { task: null, form: form({ desc: 'D', id: 'x-4', tag: '#task' }), phase: '3. Empty' } }, 'x');
  assert.deepEqual(empty.text.split('\n').slice(14, 19), ['### 3. Empty', '', '- [ ] D 🆔 x-4 #task', '', '## Notes']);
  const moved = P.planEditFile(NOTE, { main: { task: tasks[1], form: form({ desc: 'B', id: 'b', deps: ['a'] }), phase: '2. Build' } }, 'x');
  const ml = moved.text.split('\n');
  assert.equal(ml[moved.line], '- [ ] B 🆔 b ⛔ a #task');
  assert.ok(ml.indexOf('### 2. Build') < moved.line);
  const others = P.planEditFile(NOTE, { others: [{ task: tasks[0], fn: (rest, box) => ({ rest: P.planDepsRest(rest, ['z'], []), box }) }] }, 'x');
  assert.equal(others.text.split('\n')[7], '- [ ] A 🆔 a ⛔ z #task');
  const crlf = P.planEditFile(NOTE.replace(/\n/g, '\r\n'), { main: { task: null, form: form({ desc: 'E', tag: '#task' }), phase: '1. Scope' } }, 'x');
  assert.equal(crlf.text.split('\n')[9], '- [ ] E #task\r');
});

test('loops: what a task can and can’t depend on', () => {
  const a = T('- [ ] a 🆔 a');
  const b = T('- [ ] b 🆔 b ⛔ a');
  const c = T('- [ ] c 🆔 c ⛔ b');
  const tasks = [a, b, c];
  const down = P.planDownstream(tasks, a);
  assert.ok(down.has(b) && down.has(c) && !down.has(a));
  const up = P.planUpstream(P.planIndex(tasks).byId, c);
  assert.ok(up.has(a) && up.has(b));
});

test('planned dates follow the Gantt: from the project’s start, work not started from today', () => {
  const a = T('- [x] a [duration:: 2d] 🆔 a');
  const b = T('- [ ] b [duration:: 3d] 🆔 b ⛔ a');
  const d = P.planPlannedDates([a, b], '2026-11-02', '2026-11-16');
  assert.equal(JSON.stringify(d.get(b)), JSON.stringify({ start: '2026-11-16', due: '2026-11-18' }));
  assert.equal(P.planPlannedDates([a], null, 'x').size, 0);
});

const Q = load('neon-tickets', ['planTask', 'planEditFile', 'planFillPrefix', 'planWeekend', 'planWeekendDates', 'planPrefix', 'applyTemplate']);

test('a new task after another goes straight after its line and depends on it', () => {
  const note = '### 1. Scope\n- [ ] A 🆔 a #task\n- [ ] B 🆔 b ⛔ a #task\n';
  const a = Q.planTask('- [ ] A 🆔 a #task', { line: 1, phase: '1. Scope' });
  const f = { desc: 'A2', box: ' ', days: 1, id: 'p-3', deps: ['a'], tag: '#task' };
  const r = Q.planEditFile(note, { main: { task: null, form: f, phase: '1. Scope', after: a } }, 'x');
  assert.equal(r.text, '### 1. Scope\n- [ ] A 🆔 a #task\n- [ ] A2 [duration:: 1d] 🆔 p-3 ⛔ a #task\n- [ ] B 🆔 b ⛔ a #task\n');
  assert.equal(r.line, 2);
});

test('template ids: {{prefix}} filled by New project, or later from the Planning view', () => {
  assert.equal(Q.planFillPrefix('plan-prefix: {{prefix}}\n- [ ] A 🆔 {{prefix}}-1\n- [ ] B 🆔 {{ prefix }}-2 ⛔ {{prefix}}-1', 'sdr'), 'plan-prefix: sdr\n- [ ] A 🆔 sdr-1\n- [ ] B 🆔 sdr-2 ⛔ sdr-1');
  assert.equal(Q.planPrefix({ 'plan-prefix': '{{prefix}}' }, 'Office Move'), 'om'); // not filled in yet: the initials
  assert.equal(Q.applyTemplate('🆔 {{prefix}}-1 {{title}}', { format: () => '2026-11-16' }, 'Service Desk Rollout'), '🆔 sdr-1 Service Desk Rollout');
});

test('weekend dates are found', () => {
  assert.equal(Q.planWeekend('2026-11-21'), 'Saturday');
  assert.equal(Q.planWeekend('2026-11-22'), 'Sunday');
  assert.equal(Q.planWeekend('2026-11-23'), '');
  assert.equal(Q.planWeekend(null), '');
  const w = Q.planWeekendDates([Q.planTask('- [ ] A 📅 2026-11-21 🆔 a'), Q.planTask('- [x] B 📅 2026-11-22'), Q.planTask('- [ ] C 🛫 2026-11-23')]);
  assert.equal(w.length, 1);
  assert.equal(w[0].sign, '📅');
});

const D = load('neon-tickets', ['planTask', 'planDatesEdit']);

test('durations to dates: 🛫 and 📅 set or replaced in place, others untouched, missing tasks reported', () => {
  const note = '- [ ] A [duration:: 2d] 🆔 a #task\n- [ ] B 🆔 b ⛔ a 📅 2026-12-01 #task\n- [ ] C #task';
  const a = D.planTask('- [ ] A [duration:: 2d] 🆔 a #task', { line: 0 });
  const b = D.planTask('- [ ] B 🆔 b ⛔ a 📅 2026-12-01 #task', { line: 1 });
  const gone = D.planTask('- [ ] Gone 🆔 g', { line: 9 });
  const r = D.planDatesEdit(note, [{ task: a, start: '2026-11-16', due: '2026-11-17' }, { task: b, start: null, due: '2026-11-18' }, { task: gone, start: '2026-11-16', due: null }]);
  assert.equal(r.text, '- [ ] A [duration:: 2d] 🆔 a 🛫 2026-11-16 📅 2026-11-17 #task\n- [ ] B 🆔 b ⛔ a 📅 2026-11-18 #task\n- [ ] C #task');
  assert.equal(r.missing.length, 1);
});

// Kevin: the right-click Planning items as commands, so they can have hotkeys
test('Planning editor commands: edit this task / new task here / new task after this', () => {
  const Q = load('neon-tickets', ['NeonProjects', 'NEON_PLAN', 'NEON_PROJECTS', 'TFile']);
  Q.NEON_PROJECTS.tag = 'project';
  Q.NEON_PLAN.taskTag = '#task';
  Q.NEON_PLAN.folders = '';
  const cmds = {};
  const opened = [];
  const noop = () => {};
  const self = Object.assign(Object.create(Q.NeonProjects.prototype), {
    app: { workspace: { on: noop, onLayoutReady: noop }, metadataCache: { on: noop, getFileCache: (f) => ({ frontmatter: f.path === 'P.md' ? { tags: ['project'] } : {} }) } },
    registerView: noop, registerEvent: noop, register: noop,
    addCommand: (c) => (cmds[c.id] = c),
    openTaskEditor: (o) => opened.push(o),
  });
  self.hookPlans();
  const lines = ['## Build', '- [ ] Write the code [duration:: 2d] 🆔 p-1 #task', 'Some text'];
  const editor = (n) => ({ getCursor: () => ({ line: n }), getLine: (i) => lines[i] });
  const project = { path: 'P.md' };
  const other = { path: 'Other.md' };
  const can = (id, n, file) => cmds[id].editorCheckCallback(true, editor(n), { file });
  assert.equal(can('plan-edit-task', 1, project), true);
  assert.equal(can('plan-edit-task', 2, project), false); // not a task line
  assert.equal(can('plan-new-task-after', 1, project), true);
  assert.equal(can('plan-new-task-after', 0, project), false);
  assert.equal(can('plan-new-task', 2, project), true);
  assert.equal(can('plan-new-task', 1, other), false); // not a project note
  assert.equal(can('plan-edit-task', 1, other), false);
  cmds['plan-edit-task'].editorCheckCallback(false, editor(1), { file: project });
  cmds['plan-new-task-after'].editorCheckCallback(false, editor(1), { file: project });
  cmds['plan-new-task'].editorCheckCallback(false, editor(2), { file: project });
  assert.deepEqual(opened.map((o) => [o.line, o.at, o.afterLine]), [[1, 1, undefined], [undefined, undefined, 1], [null, 2, undefined]]);
  assert.ok(Object.values(cmds).every((c) => !c.hotkeys)); // no default hotkeys (community rule)
});

// bug (Kevin, 17 Nov): "new task here" went to the end of the whole "## 1. Scope" section, after the last task of
// "### 8. Close-down"; it now goes below the cursor's line, and "after this" below the task's sub-items
test('new tasks: at the cursor, after a task below its sub-items, and a phase stops at the next heading', () => {
  const Q = load('neon-tickets', ['planEditFile', 'planTask', 'planInsertAt']);
  const text = [
    '## 1. Scope', // 0
    '', // 1
    '- [ ] Outline scope 🆔 p-1 #task', // 2
    '\t- [ ] Decide the users', // 3
    '\t\t- [?] three users', // 4
    '- [ ] Budget 🆔 p-2 ⛔ p-1 #task', // 5
    '', // 6
    'Some notes about scope.', // 7
    '### 2. Provider', // 8
    '- [ ] Prices 🆔 p-3 #task', // 9
    '### 8. Close', // 10
    '- [ ] Wipe 🆔 p-9 #task', // 11
  ].join('\n');
  const form = { desc: 'Scope agreed', id: 'p-4', milestone: true, deps: [], owners: [] };
  const put = (main) => {
    const r = Q.planEditFile(text, { main: { task: null, form, ...main } }, '2026-11-17');
    return { at: r.line, lines: r.text.split('\n') };
  };
  // cursor on the holding task: below it and its sub-items, at its indent
  let r = put({ phase: '1. Scope', anchor: { line: 2, text: text.split('\n')[2] } });
  assert.equal(r.at, 5);
  assert.match(r.lines[5], /^- \[ \] Scope agreed/);
  assert.match(r.lines[6], /Budget/);
  // cursor on a sub-item: below it, at its indent
  r = put({ phase: '1. Scope', anchor: { line: 3, text: '\t- [ ] Decide the users' } });
  assert.equal(r.at, 5);
  assert.match(r.lines[5], /^\t- \[ \] Scope agreed/);
  // cursor on a blank line: there; on a paragraph: the line after it
  assert.equal(put({ phase: '1. Scope', anchor: { line: 6, text: '' } }).at, 6);
  assert.equal(put({ phase: '1. Scope', anchor: { line: 7, text: 'Some notes about scope.' } }).at, 8);
  // the note changed since: the cursor's line is found again by its text
  assert.equal(put({ phase: '1. Scope', anchor: { line: 0, text: '- [ ] Budget 🆔 p-2 ⛔ p-1 #task' } }).at, 6);
  // after a task: below its sub-items
  r = put({ phase: '1. Scope', after: Q.planTask('- [ ] Outline scope 🆔 p-1 #task') });
  assert.equal(r.at, 5);
  // no cursor: the phase's own tasks, not the end of its sub-sections
  r = put({ phase: '1. Scope' });
  assert.equal(r.at, 6);
  assert.match(r.lines[6], /Scope agreed/);
  assert.ok(r.lines.indexOf('- [ ] Wipe 🆔 p-9 #task') < r.lines.length - 1 || !/Scope agreed/.test(r.lines[r.lines.length - 1]));
});
