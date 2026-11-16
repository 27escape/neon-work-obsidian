import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planSetBox', 'planGraphText', 'planSchedule', 'planToHex', 'planSetDuration', 'planSetMilestone', 'planDaysText', 'planDays']);

test('board moves change only the checkbox; done stamps ✅ today, reopening removes it', () => {
  const text = '# Plan\n- [ ] A [duration:: 2d] 🆔 a #task\n- [ ] B 🆔 b ⛔ a #task\n';
  const a = P.planTask('- [ ] A [duration:: 2d] 🆔 a #task', { line: 1 });
  const doing = P.planSetBox(text, a, '/', '2026-11-16');
  assert.equal(doing.text, '# Plan\n- [/] A [duration:: 2d] 🆔 a #task\n- [ ] B 🆔 b ⛔ a #task\n');
  assert.equal(doing.line, 1);
  const done = P.planSetBox(doing.text, a, 'x', '2026-11-16');
  assert.equal(done.text.split('\n')[1], '- [x] A [duration:: 2d] 🆔 a #task ✅ 2026-11-16');
  assert.equal(done.raw, 'A [duration:: 2d] 🆔 a #task ✅ 2026-11-16');
  const back = P.planSetBox(done.text, P.planTask(done.text.split('\n')[1], { line: 1 }), ' ', '2026-11-17');
  assert.equal(back.text.split('\n')[1], '- [ ] A [duration:: 2d] 🆔 a #task');
  assert.equal(P.planSetBox(back.text, a, ' ', '2026-11-17').text, back.text); // already there: unchanged
});

test('a quick second move: the view still holds the old text, the task is found by its 🆔 id', () => {
  // moved to done (✅ added), then dragged back before the view re-read the note: t.raw is the old text
  const note = 'x\n- [x] Agree service levels 🆔 sdr-d3 #task ✅ 2026-11-16\n';
  const stale = P.planTask('- [/] Agree service levels 🆔 sdr-d3 #task', { line: 1 });
  const back = P.planSetBox(note, stale, '/', '2026-11-16');
  assert.equal(back.text, 'x\n- [/] Agree service levels 🆔 sdr-d3 #task\n');
  const moved = P.planSetBox('new\n' + note, stale, '/', '2026-11-16'); // and on another line
  assert.equal(moved.line, 2);
  assert.equal(P.planSetBox(note, P.planTask('- [ ] Other 🆔 sdr-d33', { line: 5 }), '/', '2026-11-16'), null); // no partial id match
});

test('board moves find a task that moved to another line, keep CRLF, give up when unsure', () => {
  const a = P.planTask('- [ ] A 🆔 a #task', { line: 1 });
  assert.equal(P.planSetBox('new line\n# Plan\n- [ ] A 🆔 a #task\r\n', a, '/', '2026-11-16').text, 'new line\n# Plan\n- [/] A 🆔 a #task\r\n');
  const noId = P.planTask('- [ ] A #task', { line: 0 });
  assert.equal(P.planSetBox('x\n- [ ] A #task\n- [ ] A #task', noId, '/', '2026-11-16'), null); // two candidates
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

test('duration: set in place, added before the fields, removed; weeks shown as weeks', () => {
  const t = (l) => P.planTask(l, { line: 0 });
  assert.equal(P.planSetDuration('- [ ] A [duration:: 2d] 🆔 a #task', t('- [ ] A [duration:: 2d] 🆔 a #task'), 3).text, '- [ ] A [duration:: 3d] 🆔 a #task');
  assert.equal(P.planSetDuration('- [ ] A 🆔 a ⛔ b #task', t('- [ ] A 🆔 a ⛔ b #task'), 2).text, '- [ ] A [duration:: 2d] 🆔 a ⛔ b #task');
  assert.equal(P.planSetDuration('- [ ] Plain words', t('- [ ] Plain words'), 1).text, '- [ ] Plain words [duration:: 1d]');
  assert.equal(P.planSetDuration('- [ ] A [duration:: 2d] #task', t('- [ ] A [duration:: 2d] #task'), null).text, '- [ ] A #task');
  assert.equal(P.planSetDuration('- [/] A [duration:: 1w] 🆔 a', t('- [/] A [duration:: 1w] 🆔 a'), 0).raw, 'A [duration:: 0d] 🆔 a');
  assert.equal(P.planDaysText({ days: 5 }), '1 week');
  assert.equal(P.planDaysText({ days: 10 }), '2 weeks');
  assert.equal(P.planDaysText({ days: 3 }), '3 days');
  assert.equal(P.planDaysText({ days: null }), '1 day (no estimate)');
});

test('milestone: #milestone tag on (duration dropped) and off; milestones take 0 days', () => {
  const t = (l) => P.planTask(l, { line: 0 });
  const on = P.planSetMilestone('- [ ] Go live [duration:: 0d] 🆔 g ⛔ p #task', t('- [ ] Go live [duration:: 0d] 🆔 g ⛔ p #task'), true);
  assert.equal(on.text, '- [ ] Go live #milestone 🆔 g ⛔ p #task');
  const ms = t(on.text);
  assert.equal(ms.milestone, true);
  assert.equal(P.planDays(ms), 0);
  assert.equal(P.planSetMilestone(on.text, ms, false).text, '- [ ] Go live 🆔 g ⛔ p #task');
  assert.equal(t('- [ ] A #milestones').milestone, false);
});
