// Fork: plan problems name the task to fix (missing ids, duplicate ids, loops).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planProblems', 'planLoops']);
const T = (line, at = {}) => P.planTask(line, at);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('problems: a task waiting for ids no task has (folded into a holding task)', () => {
  const tasks = [T('- [ ] Outline scope #task', { line: 1 }), T('- [ ] Budget 🆔 p-5 ⛔ p-1,p-2 #task', { line: 5 }), T('- [ ] Prices 🆔 p-6 ⛔ p-1 #task', { line: 6 }), T('- [ ] Theirs 🆔 x-1 ⛔ gone #task', { external: true })];
  const p = P.planProblems(tasks);
  assert.deepEqual(plain(p.map((x) => x.text)), ['p-5 waits for p-1 and p-2, but no task has those ids', 'p-6 waits for p-1, but no task has that id']);
  assert.equal(p[0].task.line, 5); // the task to open
  assert.equal(p[0].kind, 'missing');
});

test('problems: one id on two tasks, and loops named in order', () => {
  const dup = P.planProblems([T('- [ ] One 🆔 a #task'), T('- [ ] Two 🆔 a #task')]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].text, 'a is the id of 2 tasks: “One” and “Two”');
  assert.equal(dup[0].task.raw.includes('Two'), true); // the second one is the one to change
  const loop = P.planProblems([T('- [ ] A 🆔 a ⛔ c #task'), T('- [ ] B 🆔 b ⛔ a #task'), T('- [ ] C 🆔 c ⛔ b #task'), T('- [ ] D 🆔 d ⛔ c #task')]);
  assert.deepEqual(plain(loop.map((x) => x.text)), ['Dependency loop: a → c → b → a']);
  assert.deepEqual(plain(P.planProblems([T('- [ ] Self 🆔 s ⛔ s #task')]).map((x) => x.kind)), ['loop']);
  assert.equal(P.planProblems([T('- [ ] A 🆔 a #task'), T('- [ ] B 🆔 b ⛔ a #task')]).length, 0);
});

test('editor marks: where each problem is underlined in its line', () => {
  const Q = load('neon-tickets', ['planLineMarks', 'planTextTasks', 'planProblems', 'NEON_PLAN']);
  Q.NEON_PLAN.taskTag = '#task';
  const lines = ['## Scope', '- [ ] Outline scope #task', '\t- [ ] a plain step', '- [ ] Budget 🆔 p-5 ⛔ p-1,p-6 #task', '- [ ] Prices 🆔 p-6 #task', '- [ ] Copy 🆔 p-6 #task'];
  const own = Q.planTextTasks(lines, { path: 'P.md' });
  assert.deepEqual(plain(own.map((t) => t.line)), [1, 3, 4, 5]); // the plain step isn't a plan task
  const probs = Q.planProblems(own);
  const budget = Q.planLineMarks(lines[3], probs.filter((p) => p.task === own[1]));
  assert.equal(budget.length, 1);
  assert.equal(lines[3].slice(budget[0].from, budget[0].to), 'p-1'); // only the unknown id, not p-6
  const dup = probs.find((p) => p.kind === 'dup');
  const m = Q.planLineMarks(lines[5], [dup]);
  assert.equal(lines[5].slice(m[0].from, m[0].to), 'p-6');
  const loopLine = '- [ ] A 🆔 a ⛔ b, c #task';
  const l = Q.planLineMarks(loopLine, [{ kind: 'loop', ids: ['a', 'b'], text: 'loop' }]);
  assert.equal(loopLine.slice(l[0].from, l[0].to), 'b, c');
});
