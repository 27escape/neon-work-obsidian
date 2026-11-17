// Fork: a task's steps (the checkboxes under it) and tasks inside tasks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planListTree', 'planStepState', 'planAddSteps', 'planStepsDone', 'planProblems', 'planTextTasks', 'planLineMarks', 'NEON_PLAN']);
P.NEON_PLAN.taskTag = '#task';
const plain = (x) => JSON.parse(JSON.stringify(x));

const note = [
  '## 1. Scope', // 0
  '- [ ] Outline scope 🆔 p-1 #task', // 1
  '\t- [x] Decide the users', // 2
  '\t\t- [?] three users', // 3  a note under a step: not counted
  '\t- ( ) Decide the duration', // 4
  '\t- (x) Agree success', // 5
  '\t- [-] Dropped idea', // 6  cancelled: not counted
  '\t- (-) Another dropped one', // 7
  '\t- [ ] Write the tasks 🆔 p-9 #task', // 8  a task inside a task
  '- [ ] Budget 🆔 p-2 ⛔ p-1 #task', // 9
  '\t- [x] Ask Steve', // 10
  '\t- (x) Ask Andrew', // 11
  'Some text', // 12
  '- [x] Done already 🆔 p-3 #task', // 13
  '\t- [x] the only step', // 14
];

test('steps: the checkboxes directly under a task; cancelled and notes left out', () => {
  assert.equal(P.planStepState('\t- ( ) x'), 'open');
  assert.equal(P.planStepState('- (x) x'), 'done');
  assert.equal(P.planStepState('- [/] x'), 'open');
  assert.equal(P.planStepState('- [-] x'), null);
  assert.equal(P.planStepState('- (-) x'), null);
  assert.equal(P.planStepState('- [?] x'), null);
  assert.equal(P.planStepState('- plain item'), null);
  const tasks = P.planTextTasks(note, { path: 'P.md' });
  const by = (id) => tasks.find((t) => t.id === id);
  assert.deepEqual(plain(by('p-1').steps), { done: 2, total: 4 }); // decide users ✓, duration, success ✓, write the tasks
  assert.deepEqual(plain(by('p-2').steps), { done: 2, total: 2 });
  assert.equal(P.planStepsDone(by('p-2')), true); // every step done, the task still open: offer to tick it
  assert.equal(P.planStepsDone(by('p-3')), false); // already done
  assert.equal(P.planStepsDone(by('p-1')), false);
});

test('a task inside a task is a plan problem, underlined at its task tag', () => {
  const tasks = P.planTextTasks(note, { path: 'P.md' });
  const inner = tasks.find((t) => t.id === 'p-9');
  assert.equal(inner.nestedIn, 1);
  const probs = P.planProblems(tasks).filter((p) => p.kind === 'nested');
  assert.equal(probs.length, 1);
  assert.match(probs[0].text, /^p-9 is a task inside “Outline scope.*”: make it a plain checkbox/);
  const m = P.planLineMarks(note[8], probs);
  assert.equal(note[8].slice(m[0].from, m[0].to), '#task');
  assert.equal(P.planListTree(note).get(10), 9); // a new top-level item starts its own list
  assert.equal(P.planListTree(note).get(14), 13); // after a paragraph, a new list
});
