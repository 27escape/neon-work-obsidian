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
