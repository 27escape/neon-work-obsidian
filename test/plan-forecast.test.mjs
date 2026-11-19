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


const W = load('neon-tickets', ['planTask', 'planWarnings', 'planGanttText']);

test('schedule warnings: will miss its date, due before what it waits for, in progress past its planned finish', () => {
  const a = W.planTask('- [ ] A [duration:: 5d] 🆔 a 📅 2026-11-30');
  const b = W.planTask('- [ ] B [duration:: 5d] 🆔 b ⛔ a 📅 2026-11-27');
  const c = W.planTask('- [/] C [duration:: 2d] 🆔 c');
  const tasks = [a, b, c];
  const ends = new Map([[a, '2026-11-20'], [b, '2026-12-04'], [c, '2026-11-13']]);
  const w = W.planWarnings(tasks, ends, '2026-11-16').map((x) => x.text);
  assert.ok(w.includes('b: planned to finish 4 Dec, 5 working days after its 📅 27 Nov'));
  assert.ok(w.includes("b: 📅 27 Nov is before a's 📅 30 Nov, which it waits for"));
  assert.ok(w.includes('c: in progress, planned to finish 13 Nov'));
  assert.equal(w.length, 3);
  assert.equal(W.planWarnings(tasks, null, '2026-11-16').length, 1); // without dates only the order of due dates
});

const R = load('neon-tickets', ['planReportText']);

test('report note: summary first (chart, phases, people, attention, markers, workload), then the project details', () => {
  const md = R.planReportText({
    title: 'Pilot - Local AI', note: 'Pilot - Local AI', today: '2026-11-16',
    summary: '1 overdue · 3 ready · 0/5 done', forecast: 'forecast finish 27 Nov, 2 working days after the due date', baseline: '(+2 since the baseline of 10 Nov)',
    svg: 'Pilot - Local AI – plan 2026-11-16.svg',
    phases: [{ name: '1. Scope', total: 2, done: 1, start: '2026-11-16', end: '2026-11-18', state: 'Overdue' }],
    attention: ['**Overdue:** A (📅 13 Nov)'],
    marks: [{ sign: '⚠', label: 'Risk', text: 'Vendor | late', owner: 'Sam', state: 'Ready' }],
    crit: [{ id: 'a', text: 'A', start: '2026-11-16', end: '2026-11-17' }, { id: 'b', text: 'B', start: '2026-11-18', end: '2026-11-27' }],
    load: ['Sam has 7 days of work in the week of Mon 16 Nov (5 available)'],
    people: [{ name: 'Sam', open: 2, done: 1, days: 5, phases: ['1. Scope', '2. Build'] }],
    details: '### 1. Scope\n\n- ☐ A (Sam)',
  });
  const has = (s) => assert.ok(md.includes(s), s);
  has('title: "Plan report: Pilot - Local AI"');
  has('project: "[[Pilot - Local AI]]"');
  has('- **Forecast:** forecast finish 27 Nov, 2 working days after the due date (+2 since the baseline of 10 Nov)');
  has('- **Critical path:** 2 tasks, 16 Nov to 27 Nov');
  has('![[Pilot - Local AI – plan 2026-11-16.svg]]');
  has('| 1. Scope | 1/2 | 16 Nov | 18 Nov | Overdue |');
  has('| Sam | 2 | 1 | 5 | 1. Scope, 2. Build |');
  has('- **Overdue:** A (📅 13 Nov)');
  has('- ⚠ **Risk:** Vendor | late (Sam) · Ready');
  has('- Sam has 7 days of work');
  has('## Project details');
  has('### 1. Scope\n\n- ☐ A (Sam)');
  for (const gone of ['## Critical path', '## All tasks', 'Waits for']) assert.ok(!md.includes(gone), gone);
  // the summary comes before the details
  assert.ok(md.indexOf('## People') < md.indexOf('## Needs attention') && md.indexOf('## Workload') < md.indexOf('## Project details'));
  has('up to the end of the plan');
});

test('report note, full: the details say the whole note is there', () => {
  const md = R.planReportText({ title: 'P', note: 'P', today: '2026-11-19', phases: [], attention: [], marks: [], crit: [], load: [], people: [], details: '### Research\n\nNotes', full: true });
  assert.ok(md.includes('as it stood on 19 Nov: the whole note.'));
  assert.ok(md.includes('### Research\n\nNotes'));
  assert.ok(!md.includes('left out'));
});

// bug: the report's SVG would not open: a font list with double quotes was put inside style="…"
test('SVG export: inlined theme values keep the attributes valid', () => {
  const { planInlineVars } = load('neon-tickets', ['planInlineVars']);
  const vars = { '--font-interface': '"??", "Inter", ui-sans-serif', '--bar': '#3366cc', '--odd': 'a<b & c>d' };
  const svg = '<svg style="font-family: var(--font-interface); fill: var(--bar)"><rect style="fill: var(--none, #fff)"/><text style="x: var(--odd)"/></svg>';
  const out = planInlineVars(svg, (n) => vars[n] || '');
  assert.equal(out, `<svg style="font-family: '??', 'Inter', ui-sans-serif; fill: #3366cc"><rect style="fill: #fff"/><text style="x: a&lt;b &amp; c&gt;d"/></svg>`);
  assert.equal(planInlineVars('<rect style="fill: var(--missing)"/>', () => ''), '<rect style="fill: var(--missing)"/>');
  // a variable whose fallback is another variable (the Gantt's arrows): resolved from the inside out
  assert.equal(planInlineVars('<path style="stroke: var(--np-link-c, var(--bar))"/>', (n) => vars[n] || ''), '<path style="stroke: #3366cc"/>');
});

test('baselines: made from the dated plan, follow renames, dropped when the project is gone', () => {
  const B = load('neon-tickets', ['planBaselineOf', 'planBaselineMove', 'planBaselinePrune', 'planIsStarted']);
  const t1 = { id: 'a-1' }, t2 = { id: 'a-2', external: true }, t3 = {};
  const b = B.planBaselineOf({ end: '2026-12-04', bars: [{ task: t1, end: '2026-11-20' }, { task: t2, end: '2026-11-25' }, { task: t3, end: '2026-11-26' }, { phase: 'x', end: '2026-12-04' }] }, '2026-11-17');
  assert.equal(JSON.stringify(b), JSON.stringify({ saved: '2026-11-17', end: '2026-12-04', tasks: { 'a-1': '2026-11-20' }, provisional: false }));
  const all = { 'P/Alpha.md': b, 'Folders/Beta': { tasks: {} }, 'Folders/Beta2': { tasks: {} } };
  assert.equal(B.planBaselineMove(all, 'P/Alpha.md', 'P/Alpha renamed.md'), true);
  assert.equal(B.planBaselineMove(all, 'Folders', 'Projects'), true); // a moved parent folder takes its projects along
  assert.deepEqual(Object.keys(all).sort(), ['P/Alpha renamed.md', 'Projects/Beta', 'Projects/Beta2']);
  assert.equal(B.planBaselineMove(all, 'Other.md', 'Else.md'), false);
  assert.equal(B.planBaselinePrune(all, (p) => p !== 'Projects/Beta2'), true);
  assert.deepEqual(Object.keys(all).sort(), ['P/Alpha renamed.md', 'Projects/Beta']);
  assert.equal(B.planIsStarted({ status: 'in-progress' }), true);
  assert.equal(B.planIsStarted({ status: 'waiting' }), true);
  assert.equal(B.planIsStarted({ status: 'open' }), false);
  assert.equal(B.planIsStarted({ status: 'done' }), false);
});

test('baselines: provisional while an open task has no duration, locked once all have one', () => {
  const B = load('neon-tickets', ['planIncomplete', 'planBaselineOf', 'planBaselineSame', 'planTask']);
  const task = (line) => B.planTask(line);
  const plan = [task('- [ ] Scope [duration:: 2d] 🆔 a-1 #task'), task('- [ ] Agreed 🆔 a-2 #task #milestone'), task('- [x] Kick-off 🆔 a-3 #task'), task('- [-] Dropped 🆔 a-4 #task')];
  assert.equal(B.planIncomplete(plan), false); // milestones, done and cancelled tasks need no duration
  assert.equal(B.planIncomplete([...plan, task('- [ ] Build 🆔 a-5 #task')]), true);
  assert.equal(B.planIncomplete([...plan, { ...task('- [ ] Theirs 🆔 b-1 #task'), external: true }]), false); // another project's task
  const dated = { end: '2026-12-04', bars: [{ task: { id: 'a-1' }, end: '2026-11-20' }] };
  const p1 = B.planBaselineOf(dated, '2026-11-17', true);
  assert.equal(p1.provisional, true);
  assert.equal(B.planBaselineSame(p1, B.planBaselineOf(dated, '2026-11-18', true)), true); // only the day differs: not saved again
  assert.equal(B.planBaselineSame(p1, B.planBaselineOf(dated, '2026-11-18', false)), false); // locking is a change
  assert.equal(B.planBaselineSame(p1, B.planBaselineOf({ ...dated, end: '2026-12-08' }, '2026-11-18', true)), false);
  assert.equal(B.planBaselineSame(null, p1), false);
  assert.equal(B.planBaselineOf(dated, '2026-11-17').provisional, false); // by hand: locked
});
