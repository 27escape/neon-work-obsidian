// Fork: tasks that run alongside: [starts-with:: id+lag] and [ends-with:: id].
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planSchedule', 'planState', 'planIndex', 'planProblems', 'planLinkRest', 'planSetLinks', 'planApplyForm', 'planDropType', 'planGanttText', 'planGanttLayout', 'planGanttLinks', 'planEarliest', 'planLineMarks', 'planDownstream']);
const T = (l) => P.planTask(l);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('links: read from the fields, with a lag in working days', () => {
  const t = T('- [ ] B [duration:: 3d] [starts-with:: a, c+2d] [ends-with:: d+1w] 🆔 b #task');
  assert.deepEqual(plain(t.links), [{ id: 'a', type: 'ss', lag: 0 }, { id: 'c', type: 'ss', lag: 2 }, { id: 'd', type: 'ff', lag: 5 }]);
  assert.deepEqual(plain(t.deps), []);
});

test('schedule: starts with, ends with, lags, and the critical path through them', () => {
  const a = T('- [ ] A [duration:: 5d] 🆔 a');
  const b = T('- [ ] B [duration:: 2d] [starts-with:: a+1d] 🆔 b');
  const c = T('- [ ] C [duration:: 2d] [ends-with:: a] 🆔 c');
  const d = T('- [ ] D [duration:: 1d] 🆔 d ⛔ b,c');
  const s = P.planSchedule([a, b, c, d]);
  const row = (t) => s.rows.find((r) => r.task === t);
  assert.equal(row(b).es, 1); // a day after A starts
  assert.equal(row(c).es, 3); // finishes with A (day 5): starts on day 3
  assert.equal(row(c).ef, 5);
  assert.equal(row(d).es, 5);
  assert.equal(row(a).crit, true); // A → (C ends with A) → D
  assert.equal(row(c).crit, true);
  assert.equal(row(b).crit, false); // B has slack: it ends on day 3, D starts on day 5
  assert.equal(row(b).slack, 2);
});

test('state: a task that starts with another waits until that one has started', () => {
  const a = T('- [ ] A 🆔 a');
  const b = T('- [ ] B [starts-with:: a] 🆔 b');
  const c = T('- [ ] C [ends-with:: a] 🆔 c');
  const { byId } = P.planIndex([a, b, c]);
  assert.equal(P.planState(b, byId), 'waiting');
  assert.equal(P.planState(c, byId), 'ready'); // ends with: nothing holds its start
  const a2 = T('- [/] A 🆔 a');
  assert.equal(P.planState(b, P.planIndex([a2, b]).byId), 'ready');
});

test('problems: unknown ids and loops through any kind of link', () => {
  const tasks = [T('- [ ] A 🆔 a [starts-with:: b]'), T('- [ ] B 🆔 b ⛔ a'), T('- [ ] C 🆔 c [ends-with:: zz]')];
  const texts = P.planProblems(tasks).map((p) => p.text);
  assert.ok(texts.some((x) => /c waits for zz, but no task has that id/.test(x)));
  assert.ok(texts.some((x) => /^Dependency loop/.test(x)));
  const line = '- [ ] C 🆔 c [ends-with:: zz+2d] #task';
  const m = P.planLineMarks(line, P.planProblems([T(line)]));
  assert.equal(line.slice(m[0].from, m[0].to), 'zz');
  assert.ok(P.planDownstream(tasks.slice(1), tasks[0]).size >= 0);
});

test('writing links: add, change the lag, remove, and through the editor form', () => {
  let r = 'Write the guide [duration:: 2d] 🆔 b #task';
  r = P.planLinkRest(r, 'ss', [{ id: 'a', lag: 0 }]);
  assert.equal(r, 'Write the guide [duration:: 2d] [starts-with:: a] 🆔 b #task');
  r = P.planLinkRest(r, 'ss', [{ id: 'a', lag: 2 }, { id: 'c', lag: 0 }]);
  assert.equal(r, 'Write the guide [duration:: 2d] [starts-with:: a+2d, c] 🆔 b #task');
  r = P.planLinkRest(r, 'ss', [], ['a', 'c']);
  assert.equal(r, 'Write the guide [duration:: 2d] 🆔 b #task');
  const out = P.planApplyForm('Write the guide [duration:: 2d] [starts-with:: a] 🆔 b #task', ' ', { desc: 'Write the guide', days: 2, owners: [], marks: [], id: 'b', deps: ['x'], links: { ss: [], ff: [{ id: 'a', lag: 1 }] } }, '2026-11-17');
  assert.match(out.rest, /\[ends-with:: a\+1d\]/);
  assert.doesNotMatch(out.rest, /starts-with/);
  assert.match(out.rest, /⛔ x/);
});

test('Gantt: arrows for each kind, and what an Alt-drag makes', () => {
  const tasks = [T('- [ ] A [duration:: 5d] 🆔 a'), T('- [ ] B [duration:: 2d] [starts-with:: a] 🆔 b'), T('- [ ] C [duration:: 2d] [ends-with:: a] 🆔 c')];
  const g = P.planGanttText(tasks, { base: '2026-11-16', today: '2026-11-16' });
  const links = P.planGanttLinks(P.planGanttLayout(g.rows, { today: '2026-11-16', width: 900, labelW: 300 }));
  assert.deepEqual(plain(links.map((l) => [l.from.id, l.to.id, l.type, l.end.dir])), [['a', 'b', 'ss', 'right'], ['a', 'c', 'ff', 'left']]);
  const ends = { x0: 100, x1: 200 };
  assert.equal(P.planDropType(false, 120, ends, false), 'fs'); // end → left of the other: after
  assert.equal(P.planDropType(true, 120, ends, false), 'ss'); // start → left: starts with
  assert.equal(P.planDropType(false, 180, ends, false), 'ff'); // end → right: ends with
  assert.equal(P.planDropType(true, 180, ends, false), null); // start → right: not offered
  // dragging B earlier than A's start isn't allowed
  assert.equal(P.planEarliest(tasks[1], g.bars, '2026-11-16'), '2026-11-16');
});
