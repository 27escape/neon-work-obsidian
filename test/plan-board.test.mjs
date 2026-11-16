import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planSetBox', 'planGraphText', 'planSchedule', 'planToHex']);

test('board moves change only the checkbox; done stamps ✅ today, reopening removes it', () => {
  const text = '# Plan\n- [ ] A [duration:: 2d] 🆔 a #task\n- [ ] B 🆔 b ⛔ a #task\n';
  const a = P.planTask('- [ ] A [duration:: 2d] 🆔 a #task', { line: 1 });
  const doing = P.planSetBox(text, a, '/', '2026-11-16');
  assert.equal(doing, '# Plan\n- [/] A [duration:: 2d] 🆔 a #task\n- [ ] B 🆔 b ⛔ a #task\n');
  const done = P.planSetBox(doing, a, 'x', '2026-11-16');
  assert.equal(done.split('\n')[1], '- [x] A [duration:: 2d] 🆔 a #task ✅ 2026-11-16');
  const back = P.planSetBox(done, P.planTask(done.split('\n')[1], { line: 1 }), ' ', '2026-11-17');
  assert.equal(back.split('\n')[1], '- [ ] A [duration:: 2d] 🆔 a #task');
});

test('board moves find a task that moved to another line, keep CRLF, give up when unsure', () => {
  const a = P.planTask('- [ ] A 🆔 a #task', { line: 1 });
  assert.equal(P.planSetBox('new line\n# Plan\n- [ ] A 🆔 a #task\r\n', a, '/', '2026-11-16'), 'new line\n# Plan\n- [/] A 🆔 a #task\r\n');
  assert.equal(P.planSetBox('x\n- [ ] A 🆔 a #task\n- [ ] A 🆔 a #task', Object.assign(a, { line: 0 }), '/', '2026-11-16'), null); // two candidates
  assert.equal(P.planSetBox('nothing here', a, '/', '2026-11-16'), null);
});

test('graph: groups per phase, arrows from dependency to task, thick on the critical path, colours as classes', () => {
  const tasks = [
    P.planTask('- [ ] Scope "A" [duration:: 2d] 🆔 a', { phase: '1. Scope' }),
    P.planTask('- [ ] Prices [duration:: 3d] 🆔 b ⛔ a', { phase: '2. Provider' }),
    P.planTask('- [ ] Files [duration:: 1d] 🆔 c ⛔ a', { phase: '2. Provider' }),
    Object.assign(P.planTask('- [ ] Outside 🆔 x ⛔ b'), { external: true }),
  ];
  const kinds = new Map([[tasks[0], 'ready'], [tasks[1], 'blocked'], [tasks[2], 'blocked'], [tasks[3], 'outside']]);
  const { text, nodes } = P.planGraphText(tasks, P.planSchedule(tasks), { kinds, colours: { ready: '#0000ff', blocked: '#800080', outside: '#999999' }, edge: '#111111', dir: 'LR' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'flowchart LR');
  assert.ok(lines.includes('  subgraph s1["1. Scope"]'));
  assert.ok(lines.includes('    n1["Scope \'A\'"]'));
  assert.ok(lines.includes('  subgraph s3["Outside this project"]'));
  assert.ok(lines.includes('  n1 ==> n2'));
  assert.ok(lines.includes('  n1 --> n3'));
  assert.ok(lines.includes('  n2 --> n4'));
  assert.ok(lines.includes('  classDef blocked fill:#800080,stroke:#800080,color:#ffffff'));
  assert.ok(lines.includes('  class n2,n3 blocked'));
  assert.ok(lines.includes('  class n1,n2 crit'));
  assert.equal(nodes.length, 4);
});

test('theme colours become #rrggbb for Mermaid (rgb() broke the graph: "Expecting SEMI … got PS")', () => {
  assert.equal(P.planToHex('rgb(254, 100, 11)'), '#fe640b');
  assert.equal(P.planToHex('rgba(8, 109, 221, 0.5)'), '#086ddd');
  assert.equal(P.planToHex('rgb(254 100 11)'), '#fe640b');
  assert.equal(P.planToHex('#ABC'), '#aabbcc');
  assert.equal(P.planToHex('#3a7bd5'), '#3a7bd5');
  assert.equal(P.planToHex('hsl(10, 50%, 50%)'), null);
});

test('graph: top to bottom by default, phase groups can be left out', () => {
  const tasks = [P.planTask('- [ ] A 🆔 a', { phase: 'One' }), P.planTask('- [ ] B 🆔 b ⛔ a', { phase: 'Two' })];
  const { text } = P.planGraphText(tasks, P.planSchedule(tasks), { phases: false });
  const lines = text.split('\n');
  assert.equal(lines[0], 'flowchart TB');
  assert.equal(lines.some((l) => l.includes('subgraph')), false);
  assert.ok(lines.includes('  n1["A"]'));
  assert.ok(lines.includes('  n1 ==> n2'));
});
