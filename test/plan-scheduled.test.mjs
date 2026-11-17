// Fork: keep ⏳ scheduled dates in step with the plan (a per-project choice).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planGanttText', 'planScheduledChanges', 'planScheduledText', 'planKeepsScheduled', 'planCounts']);
const T = (l) => P.planTask(l);

test('⏳: only open tasks of the plan whose planned start differs; then written in their lines', () => {
  const a = T('- [ ] A [duration:: 2d] 🆔 a ⏳ 2026-11-16');
  const b = T('- [ ] B [duration:: 1d] 🆔 b ⛔ a');
  const c = T('- [x] C 🆔 c ✅ 2026-11-10');
  const g = P.planGanttText([a, b, c], { base: '2026-11-16', today: '2026-11-16' });
  const ch = P.planScheduledChanges([a, b, c], g.bars);
  assert.equal(JSON.stringify(ch.map((x) => [x.task.id, x.date])), '[["b","2026-11-18"]]'); // A is right already; C is done
  const text = ['- [ ] A [duration:: 2d] 🆔 a ⏳ 2026-11-16', '- [ ] B [duration:: 1d] 🆔 b ⛔ a', '- [x] C 🆔 c ✅ 2026-11-10'].join('\n');
  const out = P.planScheduledText(text, ch).split('\n');
  assert.match(out[1], /⏳ 2026-11-18/);
  assert.doesNotMatch(out[1], /🛫|📅/); // only ⏳
  assert.equal(out[0], '- [ ] A [duration:: 2d] 🆔 a ⏳ 2026-11-16');
  assert.equal(P.planKeepsScheduled({ 'plan-scheduled': true }), true);
  assert.equal(P.planKeepsScheduled({ 'plan-scheduled': 'true' }), true);
  assert.equal(P.planKeepsScheduled({}), false);
});

test('counts: a ⏳ in the past is not overdue; only a passed 📅 is', () => {
  const c = P.planCounts([T('- [/] Doing ⏳ 2026-11-10'), T('- [ ] Late 📅 2026-11-10'), T('- [ ] Soon ⏳ 2026-11-19')], '2026-11-17');
  assert.equal(c.overdue, 1);
  assert.equal(c.week, 1);
});
