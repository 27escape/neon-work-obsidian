import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planText', 'planOwners', 'planOwnerShort', 'planApplyForm', 'planGanttText', 'planGraphText', 'planSchedule', 'planOverloads', 'planPeople', 'planSplit']);
const TK = load('neon-tasks', ['taskDisplay']);
const T = (l, at = {}) => P.planTask(l, at);
const J = (x) => JSON.parse(JSON.stringify(x));

test('owners: people notes (with or without an alias) and plain names', () => {
  assert.deepEqual(J(P.planOwners('A [owner:: [[@Marcus Hale]], [[People/@Sofia Reyes|Sofia]], Alex] 🆔 a')), [
    { key: 'marcus hale', name: 'Marcus Hale', text: '[[@Marcus Hale]]' },
    { key: 'sofia reyes', name: 'Sofia', text: '[[People/@Sofia Reyes|Sofia]]' },
    { key: 'alex', name: 'Alex', text: 'Alex' },
  ]);
  assert.equal(P.planOwners('no owner').length, 0);
  const t = T('- [ ] Agree levels [duration:: 3d] [owner:: [[@Marcus Hale]]] 🆔 x #task');
  assert.equal(P.planText(t.raw), 'Agree levels');
  assert.equal(P.planOwnerShort(t), 'Marcus');
  assert.equal(TK.taskDisplay('Agree levels [owner:: [[@Marcus Hale]]] 🆔 x #task', '#task'), 'Agree levels'); // Tasks card too
  assert.equal(P.planSplit(t.raw).desc, 'Agree levels');
});

test('the editor sets owners next to the duration, replaces and removes them', () => {
  const f = (o) => Object.assign({ desc: 'A', box: ' ', days: 2, id: 'x', deps: [] }, o);
  assert.equal(P.planApplyForm('A [duration:: 2d] 🆔 x #task', ' ', f({ owners: ['[[@Sam]]'] }), 'd').rest, 'A [duration:: 2d] [owner:: [[@Sam]]] 🆔 x #task');
  assert.equal(P.planApplyForm('A [duration:: 2d] [owner:: [[@Sam]]] 🆔 x #task', ' ', f({ owners: ['[[@Sam]]', 'Alex'] }), 'd').rest, 'A [duration:: 2d] [owner:: [[@Sam]], Alex] 🆔 x #task');
  assert.equal(P.planApplyForm('A [duration:: 2d] [owner:: [[@Sam]]] 🆔 x #task', ' ', f({ owners: [] }), 'd').rest, 'A [duration:: 2d] 🆔 x #task');
});

test('Gantt and graph: owner on the label; one person’s tasks shown, the others left out or greyed', () => {
  const tasks = [T('- [ ] A [duration:: 2d] [owner:: [[@Sam Taylor]]] 🆔 a', { phase: 'P' }), T('- [ ] B [duration:: 1d] 🆔 b ⛔ a', { phase: 'P' }), T('- [ ] C 🆔 c', { phase: 'Q' })];
  const all = P.planGanttText(tasks, {}).text;
  assert.ok(all.includes('  A · Sam :crit, np1, 2026-01-05, 2d'));
  const sam = P.planGanttText(tasks, { show: (t) => t.owners.some((o) => o.key === 'sam taylor') }).text;
  assert.ok(sam.includes('A · Sam'));
  assert.ok(!sam.includes(' B :'));
  assert.ok(!sam.includes('section Q')); // a phase with nobody's tasks left goes
  const g = P.planGraphText(tasks, P.planSchedule(tasks), { show: (t) => t.owners.length > 0 }).text;
  assert.ok(g.includes('n1["A · Sam"]'));
  assert.ok(g.includes('  class n2,n3 dim'));
  assert.equal(J(P.planPeople(tasks)).map((p) => p.name).join(), 'Sam Taylor');
});

test('workload: more than five days in a week for one person is flagged', () => {
  const tasks = [T('- [ ] A [duration:: 4d] [owner:: Sam] 🆔 a'), T('- [ ] B [duration:: 3d] [owner:: Sam]'), T('- [ ] C [duration:: 5d] [owner:: Alex]'), T('- [x] D [duration:: 5d] [owner:: Sam]')];
  const over = J(P.planOverloads(P.planSchedule(tasks).rows));
  assert.equal(over.length, 1);
  assert.deepEqual(over[0], { name: 'Sam', week: 0, days: 7 });
});
