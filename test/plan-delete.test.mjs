// Fork: cancel or delete a task from the task editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planDeleteText', 'planUnlinkRest', 'planCancelRest', 'planDeleteImpact', 'planTextTasks', 'NEON_PLAN']);
P.NEON_PLAN.taskTag = '#task';

const note = [
  '## Scope',
  '- [ ] Outline scope [duration:: 2d] 🆔 p-1 #task',
  '\t- [x] Decide the users',
  '\t\t- [?] three users',
  '\t- ( ) Decide the duration',
  '- [ ] Budget 🆔 p-2 ⛔ p-1,p-3 #task',
  '- [ ] Survey [starts-with:: p-1+1d] [ends-with:: p-1] 🆔 p-4 #task',
  '',
  'Notes after the list.',
].join('\n');

test('delete: the line and everything under it; the rest stays', () => {
  const tasks = P.planTextTasks(note.split('\n'), { path: 'P.md' });
  const t = tasks.find((x) => x.id === 'p-1');
  const r = P.planDeleteText(note, t);
  assert.equal(r.at, 1);
  assert.equal(r.removed.length, 4); // the task, its two steps and the note under a step
  assert.equal(r.text.split('\n')[1], '- [ ] Budget 🆔 p-2 ⛔ p-1,p-3 #task');
  assert.ok(r.text.endsWith('Notes after the list.'));
});

test('delete: who depends on it, and its id taken out of every kind of link', () => {
  const tasks = P.planTextTasks(note.split('\n'), { path: 'P.md' });
  const t = tasks.find((x) => x.id === 'p-1');
  const imp = P.planDeleteImpact(t, tasks);
  assert.equal(JSON.stringify(imp.dependants.map((x) => x.id)), '["p-2","p-4"]');
  assert.equal(JSON.stringify(imp.steps), '{"done":1,"total":2}');
  assert.equal(P.planUnlinkRest('Budget 🆔 p-2 ⛔ p-1,p-3 #task', 'p-1'), 'Budget 🆔 p-2 ⛔ p-3 #task');
  assert.equal(P.planUnlinkRest('Survey [starts-with:: p-1+1d] [ends-with:: p-1] 🆔 p-4 #task', 'p-1').replace(/\s{2,}/g, ' '), 'Survey 🆔 p-4 #task');
  assert.equal(P.planUnlinkRest('Only 🆔 p-5 ⛔ p-1 #task', 'p-1'), 'Only 🆔 p-5 #task');
});

test('cancel: ❌ today, no ✅', () => {
  assert.equal(P.planCancelRest('Budget 🆔 p-2 ✅ 2026-11-10 #task', '2026-11-17'), 'Budget 🆔 p-2 #task ❌ 2026-11-17');
  assert.equal(P.planCancelRest('Budget ❌ 2026-11-01', '2026-11-17'), 'Budget ❌ 2026-11-17');
});
