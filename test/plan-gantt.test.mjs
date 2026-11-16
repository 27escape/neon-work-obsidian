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

const L = load('neon-tickets', ['planTask', 'planGanttText', 'planGanttLayout', 'planDayDiff']);

test('drawn Gantt layout: a day scale with weekends, Monday ticks, bars and milestones placed, today line', () => {
  const tasks = [L.planTask('- [x] A [duration:: 2d] 🆔 a', { phase: 'One' }), L.planTask('- [ ] B [duration:: 3d] 🆔 b ⛔ a', { phase: 'One' }), L.planTask('- [ ] Live 🆔 c ⛔ b #milestone', { phase: 'Two' })];
  const g = L.planGanttText(tasks, { base: '2026-11-16', today: '2026-11-18', due: '2026-11-27' });
  assert.equal(JSON.stringify(g.rows.map((r) => (r.section ? `#${r.section}` : r.label))), JSON.stringify(['#One', 'A', 'B', '#Two', 'Live', '#Project', 'Forecast finish 23 Nov', 'Due 27 Nov']));
  const lay = L.planGanttLayout(g.rows, { today: '2026-11-18', width: 900, labelW: 300 });
  assert.equal(lay.days[0].date, '2026-11-15'); // a day before the first bar
  assert.equal(lay.days.length, L.planDayDiff('2026-11-15', '2026-11-29') + 1); // two days after the last
  assert.ok(lay.days.find((d) => d.date === '2026-11-21').weekend);
  assert.equal(lay.ticks[0].text, '16 Nov');
  const bars = lay.items.filter((i) => i.type === 'bar');
  assert.equal(bars[0].x, lay.dayW); // A starts on day 1 (Mon 16)
  assert.equal(bars[0].w, 2 * lay.dayW);
  assert.equal(bars[1].w, 3 * lay.dayW); // B: Wed 18 to Fri 20
  assert.equal(bars[2].w, 0); // milestone
  assert.equal(lay.today, 3 * lay.dayW + lay.dayW / 2);
  assert.equal(L.planGanttLayout([], {}), null);
});

const PR = load('neon-tickets', ['projectTimelineRows', 'planGanttLayout']);

test('all projects in one view: a bar from start to the plan’s forecast (else due), a due diamond, colour by how it stands', () => {
  const m = (d) => ({ format: () => d });
  const f = (path) => ({ path, basename: path });
  const items = [
    { title: 'Pilot', file: f('a'), customer: 'E2I', status: 'in-progress', bucket: 'later', startedOn: m('2026-11-16'), due: m('2026-12-04') },
    { title: 'Rollout', file: f('b'), customer: 'Globex', status: 'open', bucket: 'later', startedOn: m('2026-11-02'), due: m('2027-01-29') },
    { title: 'Old', file: f('c'), customer: 'Globex', status: 'done', bucket: 'done', startedOn: m('2026-09-01'), completed: m('2026-10-01'), statusRaw: 'completed' },
  ];
  const sums = new Map([['a', { total: 10, overdue: 0, week: 0, blocked: 0, end: '2026-12-11', late: 5 }], ['b', { total: 18, overdue: 1, week: 0, blocked: 2, end: '2026-12-10', late: 0 }]]);
  const rows = PR.projectTimelineRows(items, sums, null);
  const bars = rows.filter((r) => r.bar);
  assert.equal(rows.filter((r) => r.section).length, 2);
  const pilot = bars.find((r) => r.label === 'Pilot');
  assert.equal(JSON.stringify([pilot.bar.start, pilot.bar.end, pilot.bar.due, pilot.bar.kind]), JSON.stringify(['2026-11-16', '2026-12-11', '2026-12-04', 'overdue']));
  assert.equal(pilot.who, '5 working days late');
  assert.equal(bars.find((r) => r.label === 'Rollout').bar.kind, 'soon'); // overdue or blocked tasks
  const old = bars.find((r) => r.label === 'Old');
  assert.equal(JSON.stringify([old.bar.end, old.bar.kind, old.bar.due]), JSON.stringify(['2026-10-01', 'done', null]));
  const win = PR.projectTimelineRows(items, sums, { from: '2026-11-01', to: '2027-01-31' });
  assert.ok(!win.some((r) => r.label === 'Old')); // outside the window
  const lay = PR.planGanttLayout(rows, { width: 900, minDay: 1 });
  assert.ok(lay.items.some((i) => i.dueX != null));
  assert.ok(lay.days[lay.days.length - 1].date >= '2027-01-29'); // the due dates fit
});

test('scale labels never crowd: months when weeks would, the year on the first and January, labels 46 px apart', () => {
  const m = (d) => ({ format: () => d });
  const f = (path) => ({ path, basename: path });
  const items = [{ title: 'Long', file: f('a'), customer: 'X', status: 'in-progress', bucket: 'later', startedOn: m('2026-04-01'), due: m('2027-12-31') }];
  const rows = PR.projectTimelineRows(items, new Map(), null);
  for (const width of [700, 1200, 2000]) {
    const lay = PR.planGanttLayout(rows, { width, labelW: 320, minDay: 0.5 });
    const shown = lay.ticks.filter((t) => t.text);
    for (let i = 1; i < shown.length; i++) assert.ok(shown[i].x - shown[i - 1].x >= 46, `labels ${shown[i - 1].text} and ${shown[i].text} too close at width ${width}`);
    assert.ok(lay.width <= width + 1); // fills the width, no wider
    assert.match(shown[0].text, / \d\d$/); // the first label has the year
    assert.ok(shown.some((t) => / 27$/.test(t.text)), `the year 2027 shows at width ${width}`);
  }
});
