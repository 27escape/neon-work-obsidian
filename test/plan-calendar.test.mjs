import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const C = load('neon-tickets', [
  'planPublicHolidays', 'planEaster', 'planCalendar', 'planWeekdays', 'planParseDays', 'planLeaveParse', 'planHolidaySection',
  'planLeaveMerge', 'planLeaveFor', 'planLeaveSpan', 'planLeaveText', 'planWorkdays', 'planWorkdaysBetween', 'planDaysOff',
  'planTask', 'planGanttText', 'planOverloads', 'planSchedule', 'planWeekend', 'NEON_PLAN', 'PLAN_PLAIN_CAL',
]);
const days = (region, y) => [...C.planPublicHolidays(region, y).keys()].sort();
const plain = (m) => JSON.parse(JSON.stringify([...m].map(([k, e]) => [k, e.name, [...e.dates].sort(), [...e.weekdays].sort()])));

test('Easter', () => {
  assert.equal(C.planEaster(2026), '2026-04-05');
  assert.equal(C.planEaster(2027), '2027-03-28');
  assert.equal(C.planEaster(2019), '2019-04-21');
});

// checked against gov.uk/bank-holidays
test('public holidays: England and Wales, with substitute days', () => {
  assert.deepEqual(days('england-wales', 2026), ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
  assert.deepEqual(days('england-wales', 2027), ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28']);
  // Christmas on a Sunday: Boxing Day stays on the Monday, Christmas moves to the Tuesday
  assert.equal(C.planPublicHolidays('england-wales', 2022).get('2022-12-27'), 'Christmas Day (substitute day)');
  assert.equal(C.planPublicHolidays('england-wales', 2022).get('2022-12-26'), 'Boxing Day');
});
test('public holidays: Scotland and Northern Ireland', () => {
  assert.deepEqual(days('scotland', 2027), ['2027-01-01', '2027-01-04', '2027-03-26', '2027-05-03', '2027-05-31', '2027-08-02', '2027-11-30', '2027-12-27', '2027-12-28']);
  assert.deepEqual(days('scotland', 2022).slice(0, 2), ['2022-01-03', '2022-01-04']); // 1 and 2 Jan on a weekend
  const ni = C.planPublicHolidays('northern-ireland', 2026);
  assert.equal(ni.get('2026-03-17'), 'St Patrick’s Day');
  assert.equal(ni.get('2026-07-13'), 'Battle of the Boyne (substitute day)');
  assert.equal(days('', 2026).length, 0);
});

test('working week and days in text', () => {
  assert.deepEqual([...C.planWeekdays('')].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([...C.planWeekdays('Mon-Thu')].sort(), [1, 2, 3, 4]);
  assert.deepEqual([...C.planWeekdays('Tuesday, Wed and fri')].sort(), [2, 3, 5]);
  const d = C.planParseDays('2026-12-30 to 2027-01-02, 2027-02-15; every Tue and Fridays');
  assert.deepEqual([...d.dates].sort(), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-02-15']);
  assert.deepEqual([...d.weekdays].sort(), [2, 5]);
  assert.equal(C.planParseDays('2026-12-24 > 2026-12-26').dates.size, 3); // Kevin's ">" works too
});

test('calendar: working days skip public holidays and closure days', () => {
  const cal = C.planCalendar({ region: 'england-wales', closures: '2026-12-29 to 2026-12-31' });
  assert.equal(cal.off('2026-12-28'), 'Boxing Day (substitute day)');
  assert.equal(cal.off('2026-12-26'), 'Saturday');
  assert.equal(cal.off('2026-12-30'), 'a closure day');
  assert.equal(cal.off('2027-01-04'), '');
  assert.equal(C.planWorkdays('2026-12-24', 1, cal), '2027-01-04'); // 25, 28 holidays; 29–31 closed; 1 Jan holiday
  assert.equal(C.planWorkdaysBetween('2026-12-21', '2027-01-04', cal), 4);
  assert.equal(C.planWorkdays('2026-12-24', 1), '2026-12-25'); // without settings: plain Monday to Friday
  assert.deepEqual(JSON.parse(JSON.stringify(C.planDaysOff('2026-12-21', '2027-01-08', cal))).map((x) => x.date), ['2026-12-25', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);
});

const NOTE = `# Pilot

## Holidays

- [[@Kevin Mulholland]]
    - 2026-12-24 to 2027-01-02
    - every Tuesday
- @kieran: 2027-02-15
- not a person line with 2027-03-01

## Next section
- [[@Andrew Rogers]]
    - 2027-01-04
`;

test('time off: a Holidays section, people by link or name, ranges, weekly days', () => {
  const sec = C.planHolidaySection(NOTE);
  assert.ok(sec.includes('@kieran') && !sec.includes('Andrew'));
  const leave = C.planLeaveParse(sec);
  const p = plain(leave);
  assert.equal(p[0][0], 'kevin mulholland');
  assert.equal(p[0][2].length, 10);
  assert.deepEqual(p[0][3], [2]);
  assert.deepEqual(p[1].slice(0, 3), ['kieran', 'kieran', ['2027-02-15']]);
  assert.equal(p.length, 3); // "not a person line …" is read as a person named "not a person line with"; harmless
  const both = C.planLeaveMerge(leave, C.planLeaveParse('- Kieran\n    - 2027-02-16'));
  assert.equal(both.get('kieran').dates.size, 2);
  // matching owners: the same name, or by first name
  assert.ok(C.planLeaveFor(leave, { key: 'kevin mulholland' }));
  assert.ok(C.planLeaveFor(leave, { key: 'kieran demonte' }));
  assert.ok(C.planLeaveFor(leave, { key: 'kevin' }));
  assert.equal(C.planLeaveFor(leave, { key: 'steve cotton' }), null);
  assert.equal(C.planLeaveText(leave.get('kevin mulholland'), '2026-12-14', '2027-01-15', C.planCalendar({ region: 'england-wales' })), '24 Dec to 31 Dec; every Tuesday');
});

test('schedule: a task stretches over its owner’s time off; others are unaffected', () => {
  const tasks = [
    C.planTask('- [ ] A [duration:: 3d] [owner:: [[@Kevin Mulholland]]] 🆔 a #task'),
    C.planTask('- [ ] B [duration:: 2d] 🆔 b ⛔ a #task'),
    C.planTask('- [ ] C [duration:: 3d] [owner:: Steve] 🆔 c #task'),
  ];
  tasks.leave = C.planLeaveParse('- [[@Kevin Mulholland]]\n    - 2026-11-24\n    - 2026-11-26');
  const g = C.planGanttText(tasks, { base: '2026-11-23' });
  const bar = (k) => JSON.parse(JSON.stringify(g.bars.find((b) => b.task && b.task.id === k)));
  assert.deepEqual([bar('a').start, bar('a').end], ['2026-11-23', '2026-11-27']); // 3 days of work over 5 (off Tue and Thu)
  assert.deepEqual([bar('b').start, bar('b').end], ['2026-11-30', '2026-12-01']);
  assert.deepEqual([bar('c').start, bar('c').end], ['2026-11-23', '2026-11-25']);
  // counted in weeks: no dates, so no time off
  const w = C.planGanttText(tasks, { base: '2026-11-23', weeks: true });
  assert.equal(w.sched.rows[0].ef, 3);
});

test('schedule: public holidays move dates once the settings set a region', () => {
  C.NEON_PLAN.calendar = C.planCalendar({ region: 'england-wales' });
  try {
    const tasks = [C.planTask('- [ ] A [duration:: 3d] 🆔 a #task')];
    const g = C.planGanttText(tasks, { base: '2026-12-23' });
    assert.deepEqual([g.bars[0].start, g.bars[0].end], ['2026-12-23', '2026-12-29']); // 23, 24, (25, 28 off) 29
    assert.equal(C.planWeekend('2026-12-25'), 'Christmas Day');
    // weeks mode stays plain Monday to Friday
    assert.equal(C.planGanttText(tasks, { base: '2026-12-23', weeks: true }).sched.rows[0].ef, 3);
  } finally {
    C.NEON_PLAN.calendar = null;
  }
});

test('workload: a person’s week has fewer days available when they are off', () => {
  const tasks = [C.planTask('- [ ] A [duration:: 4d] [owner:: Kevin] 🆔 a #task')];
  const rows = C.planSchedule(tasks).rows;
  assert.equal(C.planOverloads(rows).length, 0);
  // 3 days available that week: 4 days of work is too much
  const over = C.planOverloads(rows, () => 3, { weekOf: () => '2026-11-23' });
  assert.equal(over.length, 1);
  assert.equal(over[0].cap, 3);
  assert.equal(over[0].week, '2026-11-23');
});

test('dated days off: dates and ranges with names, used by the calendar; a warning past the last year listed', () => {
  const H = load('neon-tickets', ['planHolidayList', 'planCalendar', 'planHolidayGap', 'planWorkdays']);
  const list = H.planHolidayList(['# US holidays 2027', '', '- 2027-01-01 New Year’s Day', '- 2027-11-25 to 2027-11-26: Thanksgiving', '* 2027-07-05', 'Some notes, no date here', '```', '- 2027-03-01 in a code block', '```'].join('\n'));
  assert.deepEqual(JSON.parse(JSON.stringify([...list])), [['2027-01-01', 'New Year’s Day'], ['2027-11-25', 'Thanksgiving'], ['2027-11-26', 'Thanksgiving'], ['2027-07-05', 'a day off']]);
  const cal = H.planCalendar();
  cal.extra = list;
  assert.equal(cal.off('2027-11-25'), 'Thanksgiving');
  assert.equal(H.planWorkdays('2027-11-24', 1, cal), '2027-11-29');
  assert.equal(H.planHolidayGap('2027-12-20', cal), '');
  assert.match(H.planHolidayGap('2028-02-01', cal), /no dates after 2027, but the plan runs into 2028/);
  assert.equal(H.planHolidayGap('2028-02-01', H.planCalendar()), ''); // no note: no warning
});

test('Holidays note: an All section (region, working days, dated days) and people', () => {
  const H = load('neon-tickets', ['planHolidayFile', 'planHolidayGap', 'planCalendar']);
  const note = H.planHolidayFile(['# Holidays', '', '## All', '- public holidays: England and Wales', '- working days: Mon-Thu', '- 2026-12-29 to 2026-12-31 Office closed', '', '## People', '- [[@Kevin Mulholland]]', '    - 2026-12-24 to 2027-01-02', '- @kieran: every Friday'].join('\n'));
  assert.equal(note.all, true);
  assert.equal(note.region, 'england-wales');
  assert.equal(note.weekdays, 'Mon-Thu');
  assert.deepEqual(JSON.parse(JSON.stringify([...note.days.keys()])), ['2026-12-29', '2026-12-30', '2026-12-31']);
  assert.equal(note.days.get('2026-12-30'), 'Office closed');
  assert.deepEqual(JSON.parse(JSON.stringify([...note.people.keys()])), ['kevin mulholland', 'kieran']);
  // a calendar from it
  const cal = H.planCalendar({ region: note.region, weekdays: note.weekdays });
  cal.extra = note.days;
  assert.equal(cal.off('2026-12-28'), 'Boxing Day (substitute day)');
  assert.equal(cal.off('2026-12-24'), ''); // a Thursday
  assert.equal(cal.off('2026-12-18'), 'Friday'); // not in the working week
  assert.equal(cal.off('2026-12-30'), 'Office closed');
  assert.equal(H.planHolidayGap('2028-03-01', cal), ''); // built-in public holidays: no yearly list to run out
  // people only (no All section)
  const p = H.planHolidayFile('- Sam\n    - 2027-01-04');
  assert.equal(p.all, false);
  assert.equal(p.people.size, 1);
  // other regions and countries
  assert.equal(H.planHolidayFile('### Everyone\n- Bank holidays: Scotland').region, 'scotland');
  assert.equal(H.planHolidayFile('## All\n- public holidays: none\n- 2027-07-05 Independence Day (observed)').region, '');
});

test('Holidays notes: the project folder, each folder above it, then the base folder', () => {
  const H = load('neon-tickets', ['planHolidayPaths']);
  assert.deepEqual(JSON.parse(JSON.stringify(H.planHolidayPaths('1.Customers/Acme/Projects/Pilot.md', 'note', 'Holidays', '2.Resources'))), [
    '1.Customers/Acme/Projects/Holidays.md', '1.Customers/Acme/Holidays.md', '1.Customers/Holidays.md', 'Holidays.md', '2.Resources/Holidays.md',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(H.planHolidayPaths('1.Projects/Website', 'folder', 'Time off.md', ''))), ['1.Projects/Website/Time off.md', '1.Projects/Time off.md', 'Time off.md']);
  // PARA: a project in 1.Projects whose Area is named by a property (area: [[Work]]) also looks in the Area's folder
  assert.deepEqual(JSON.parse(JSON.stringify(H.planHolidayPaths('1.Projects/Website.md', 'note', 'Holidays', '3.Resources', '2.Areas/Work'))), [
    '1.Projects/Holidays.md', 'Holidays.md', '2.Areas/Work/Holidays.md', '3.Resources/Holidays.md',
  ]);
  // E2I: the customer folder is already on the way up, so it isn't listed twice
  assert.deepEqual(JSON.parse(JSON.stringify(H.planHolidayPaths('1.Customers/Acme/Projects/Pilot.md', 'note', 'Holidays', '2.Resources', '1.Customers/Acme'))), [
    '1.Customers/Acme/Projects/Holidays.md', '1.Customers/Acme/Holidays.md', '1.Customers/Holidays.md', 'Holidays.md', '2.Resources/Holidays.md',
  ]);
});

test('"1 working day", not "1 working days"', () => {
  const W = load('neon-tickets', ['planWorkingDays', 'planTask', 'planWarnings']);
  assert.equal(W.planWorkingDays(1), '1 working day');
  assert.equal(W.planWorkingDays(3), '3 working days');
  const t = W.planTask('- [ ] A 📅 2026-11-19 🆔 a #task');
  const w = JSON.parse(JSON.stringify(W.planWarnings([t], new Map([[t, '2026-11-20']]), '2026-11-17')));
  assert.ok(w.some((x) => x.text.includes('1 working day after its')), JSON.stringify(w));
});

test('report Holidays line: days in a row with the same name are one range', () => {
  const T = load('neon-tickets', ['planCalendar', 'planDaysOff', 'planDaysOffText']);
  const cal = T.planCalendar({ region: 'england-wales' });
  cal.extra.set('2026-12-29', 'E2I closed').set('2026-12-30', 'E2I closed').set('2026-12-31', 'E2I closed');
  const off = T.planDaysOff('2026-12-01', '2027-01-08', cal);
  assert.equal(T.planDaysOffText(off, cal), '25 Dec Christmas Day, 28 Dec Boxing Day (substitute day), 29 Dec – 31 Dec E2I closed, 1 Jan New Year’s Day');
  // a run over a weekend stays one range
  const fri = [{ date: '2027-02-05', name: 'Office move' }, { date: '2027-02-08', name: 'Office move' }];
  assert.equal(T.planDaysOffText(fri, cal), '5 Feb – 8 Feb Office move');
});
