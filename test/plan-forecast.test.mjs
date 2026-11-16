import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planGanttText', 'planGraphText', 'planSchedule', 'planApplyForm', 'planForecastText', 'planSlipDays', 'planMarkText', 'planShortDate', 'planMark']);
const T = (l, at = {}) => P.planTask(l, at);

test('forecast finish against the due date: milestones on the Gantt, working days late', () => {
  const tasks = [T('- [ ] A [duration:: 5d] 🆔 a'), T('- [ ] B [duration:: 5d] 🆔 b ⛔ a')];
  const g = P.planGanttText(tasks, { base: '2026-11-16', today: '2026-11-16', due: '2026-11-25' });
  assert.equal(g.end, '2026-11-27'); // ten working days from Mon 16 Nov
  assert.equal(g.late, 2);
  assert.ok(g.text.includes('  section Project'));
  assert.ok(g.text.includes('  Forecast finish 27 Nov :milestone, np3, 2026-11-27, 0d'));
  assert.ok(g.text.includes('  Due 25 Nov (2 working days late) :milestone, np4, 2026-11-25, 0d'));
  const ok = P.planGanttText(tasks, { base: '2026-11-16', today: '2026-11-16', due: '2026-12-04' });
  assert.equal(ok.late, 0);
  assert.equal(P.planForecastText(ok.end, '2026-12-04', 0), 'forecast finish 27 Nov, 5 working days to spare');
  assert.equal(P.planForecastText(g.end, '2026-11-25', 2), 'forecast finish 27 Nov, 2 working days after the due date');
  assert.equal(P.planForecastText('2026-11-27', null, 0), 'forecast finish 27 Nov');
  assert.ok(!P.planGanttText(tasks, {}).text.includes('section Project')); // weeks: no dates to forecast
});

test('phase bars: first start to last finish, worst colour, done count', () => {
  const tasks = [
    T('- [x] A [duration:: 2d] 🆔 a', { phase: 'One' }),
    T('- [ ] B [duration:: 3d] 🆔 b ⛔ a 📅 2026-01-01', { phase: 'One' }),
    T('- [ ] C [duration:: 1d] 🆔 c ⛔ b #risk', { phase: 'Two' }),
  ];
  const g = P.planGanttText(tasks, { phases: true, today: '2026-11-16' });
  assert.ok(g.text.includes('  One (1/2 done) :crit, np3, 2026-01-05, 2026-01-10'));
  assert.ok(g.text.includes('  ⚠ Two (0/1 done) :crit, np5, 2026-01-12, 2026-01-13'));
  assert.ok(!g.text.includes(' B :'));
  assert.equal(g.bars.find((b) => b.phase === 'One').kind, 'overdue'); // its worst task
});

test('markers: #risk, #issue, #decision on tasks, bars, graph and the editor', () => {
  const t = T('- [ ] Vendor may be late 🆔 v #risk #task');
  assert.equal(t.marks.join(), 'risk');
  assert.equal(P.planMark(t)[1], '⚠');
  const g = P.planGanttText([t], {});
  assert.ok(g.text.includes('  ⚠ Vendor may be late :'));
  assert.equal(g.bars[0].mark, 'risk');
  const gr = P.planGraphText([t], P.planSchedule([t]), {}).text;
  assert.ok(gr.includes('n1["⚠ Vendor may be late"]'));
  assert.ok(gr.includes('  classDef risk stroke:#e8871e,stroke-width:3px,stroke-dasharray:6 3'));
  const f = { desc: 'Vendor may be late', box: ' ', days: null, id: 'v', deps: [], marks: ['issue'] };
  assert.equal(P.planApplyForm(t.raw, ' ', f, 'x').rest, 'Vendor may be late 🆔 v #task #issue');
  assert.equal(P.planMarkText([t, T('- [ ] x #issue'), T('- [ ] y #issue'), T('- [x] z #decision')]), '1 risk · 2 issues');
});

test('slip in working days, either way', () => {
  assert.equal(P.planSlipDays('2026-11-20', '2026-11-24'), 2);
  assert.equal(P.planSlipDays('2026-11-24', '2026-11-20'), -2);
  assert.equal(P.planSlipDays('2026-11-24', '2026-11-24'), 0);
  assert.equal(P.planShortDate('2026-12-04'), '4 Dec');
});
