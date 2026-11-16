import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planText', 'planGanttText', 'planDayLabel', 'planBarKind', 'PlanView']);
const T = (line, at) => P.planTask(line, at);

test('plan text: fields, dates, tags and link brackets taken out', () => {
  assert.equal(P.planText('Select the GPU provider [duration:: 1d] 🆔 pla-gp4 ⛔ pla-gp2,pla-gp3 📅 2026-12-01 ⏫ #task'), 'Select the GPU provider');
  assert.equal(P.planText('Check [[Local AI#OneDrive|OneDrive findings]] and [docs](https://x.y) #task'), 'Check OneDrive findings and docs');
  assert.equal(P.planText('Update [[Local AI]] #task'), 'Update Local AI');
});

test('gantt: phases as sections, weeks from a fixed Monday, critical path, done, milestones, outside last', () => {
  const tasks = [
    T('- [x] Scope [duration:: 2d] 🆔 a #task', { phase: '1. Scope' }),
    T('- [ ] Prices: UK [duration:: 3d] 🆔 b ⛔ a #task', { phase: '2. Provider' }),
    T('- [/] Files [duration:: 1d] 🆔 c ⛔ a #task', { phase: '2. Provider' }),
    T('- [ ] Decide 🆔 d ⛔ b,c,x #milestone #task', { phase: '2. Provider' }),
    Object.assign(T('- [ ] Outside task 🆔 x'), { external: true }),
  ];
  const { text, sched } = P.planGanttText(tasks, {});
  const lines = text.split('\n');
  assert.ok(lines.includes('  axisFormat Wk %W'));
  assert.ok(lines.includes('  excludes weekends'));
  assert.ok(lines.includes('  todayMarker off'));
  assert.deepEqual(lines.filter((l) => l.startsWith('  section')), ['  section 1. Scope', '  section 2. Provider', '  section Outside this project']);
  assert.ok(lines.includes('  Scope :done, np1, 2026-01-05, 2d'));
  assert.ok(lines.includes('  Prices UK :crit, np2, 2026-01-07, 3d'));
  assert.ok(lines.includes('  Files :active, np3, 2026-01-07, 1d'));
  assert.ok(lines.includes('  Decide :crit, milestone, np4, 2026-01-12, 0d'));
  assert.ok(lines.includes('  ↗ Outside task :np5, 2026-01-05, 1d'));
  assert.equal(sched.length, 5);
});

test('gantt: with a start date, dates on the axis and a task’s own dates win', () => {
  const tasks = [T('- [ ] A [duration:: 2d] 🆔 a'), T('- [ ] B 🆔 b ⛔ a 🛫 2026-12-01 📅 2026-12-03')];
  const { text } = P.planGanttText(tasks, { base: '2026-11-14', today: '2026-11-16' });
  assert.ok(text.includes('axisFormat %d %b'));
  assert.ok(text.includes('todayMarker on'));
  assert.ok(text.includes('  A :crit, np1, 2026-11-16, 2d'));
  assert.ok(text.includes('  B :crit, np2, 2026-12-01, 2026-12-04'));
  assert.equal(P.planGanttText([], {}).text, '');
});

test('day labels in weeks', () => {
  assert.equal(P.planDayLabel(0, null, true), 'Wk 1');
  assert.equal(P.planDayLabel(4, null, true), 'Wk 1');
  assert.equal(P.planDayLabel(5, '2026-11-16', true), 'Wk 2');
});

test('bar kinds: done, overdue, due soon, in progress, blocked, ready, outside', () => {
  const k = (line, state, finish = null, extra = {}) => P.planBarKind(Object.assign(T(line), extra), state, '2026-11-16', finish);
  assert.equal(k('- [x] a', 'done'), 'done');
  assert.equal(k('- [ ] a 📅 2026-11-13', 'ready'), 'overdue');
  assert.equal(k('- [/] a', 'doing', '2026-11-13'), 'overdue'); // in progress, planned to finish before today
  assert.equal(k('- [ ] a', 'ready', '2026-11-18'), 'ready'); // a forecast finish alone is not a due date
  assert.equal(k('- [/] a 📅 2026-11-20', 'doing'), 'soon');
  assert.equal(k('- [/] a', 'doing', '2026-12-20'), 'doing');
  assert.equal(k('- [ ] a', 'blocked'), 'blocked');
  assert.equal(k('- [ ] a', 'ready'), 'ready');
  assert.equal(k('- [ ] a 📅 2026-11-01', 'ready', null, { external: true }), 'outside');
  const { bars } = P.planGanttText([T('- [x] A 🆔 a'), T('- [ ] B 🆔 b ⛔ a 📅 2026-11-10')], { today: '2026-11-16' });
  assert.equal(JSON.stringify(bars.map((b) => [b.id, b.kind, b.crit])), JSON.stringify([['np1', 'done', false], ['np2', 'overdue', true]]));
});

test('the Plan view keeps its plan off View.scope (Obsidian keeps the key scope there: handleKey errors)', () => {
  const v = new P.PlanView({}, {});
  assert.equal(v.scope, undefined);
  assert.equal(v.plan, null);
});

test('milestones are tagged #milestone; a 0-day task is a thin bar', () => {
  const tasks = [T('- [ ] A [duration:: 2d] 🆔 a'), T('- [ ] Announce [duration:: 0d] 🆔 b ⛔ a'), T('- [ ] Go live 🆔 c ⛔ a #milestone'), T('- [ ] Plain 🆔 d ⛔ a')];
  const { text, sched } = P.planGanttText(tasks, {});
  assert.ok(text.includes('  Announce :np2, 2026-01-07, 4h'));
  assert.ok(text.includes('  Go live :milestone, np3, 2026-01-07, 0d')); // not on the critical path: Plain ends later
  assert.ok(text.includes('  Plain :crit, np4, 2026-01-07, 1d')); // no estimate: 1 day
  assert.equal(sched.length, 3);
  const dated = P.planGanttText([T('- [ ] Go live #milestone 📅 2026-12-04')], { base: '2026-11-16', today: '2026-11-16' });
  assert.ok(dated.text.includes('  Go live :crit, milestone, np1, 2026-12-04, 0d'));
});
