import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planText', 'planGanttText', 'planDayLabel']);
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
    T('- [ ] Decide [duration:: 0d] 🆔 d ⛔ b,c,x #task', { phase: '2. Provider' }),
    Object.assign(T('- [ ] Outside task 🆔 x'), { external: true }),
  ];
  const { text, sched } = P.planGanttText(tasks, {});
  const lines = text.split('\n');
  assert.ok(lines.includes('  axisFormat Wk %W'));
  assert.ok(lines.includes('  excludes weekends'));
  assert.ok(lines.includes('  todayMarker off'));
  assert.deepEqual(lines.filter((l) => l.startsWith('  section')), ['  section 1. Scope', '  section 2. Provider', '  section Outside this project']);
  assert.ok(lines.includes('  Scope :done, t1, 2026-01-05, 2d'));
  assert.ok(lines.includes('  Prices UK :crit, t2, 2026-01-07, 3d'));
  assert.ok(lines.includes('  Files :active, t3, 2026-01-07, 1d'));
  assert.ok(lines.includes('  Decide :crit, milestone, t4, 2026-01-12, 0d'));
  assert.ok(lines.includes('  ↗ Outside task :t5, 2026-01-05, 1d'));
  assert.equal(sched.length, 5);
});

test('gantt: with a start date, dates on the axis and a task’s own dates win', () => {
  const tasks = [T('- [ ] A [duration:: 2d] 🆔 a'), T('- [ ] B 🆔 b ⛔ a 🛫 2026-12-01 📅 2026-12-03')];
  const { text } = P.planGanttText(tasks, { base: '2026-11-14', today: '2026-11-16' });
  assert.ok(text.includes('axisFormat %d %b'));
  assert.ok(text.includes('todayMarker on'));
  assert.ok(text.includes('  A :crit, t1, 2026-11-16, 2d'));
  assert.ok(text.includes('  B :crit, t2, 2026-12-01, 2026-12-04'));
  assert.equal(P.planGanttText([], {}).text, '');
});

test('day labels in weeks', () => {
  assert.equal(P.planDayLabel(0, null, true), 'Wk 1');
  assert.equal(P.planDayLabel(4, null, true), 'Wk 1');
  assert.equal(P.planDayLabel(5, '2026-11-16', true), 'Wk 2');
});
