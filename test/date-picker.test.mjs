import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { datePickerMonth, dpMonth, dpLabel } = load('neon-tickets', ['datePickerMonth', 'dpMonth', 'dpLabel']);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('calendar month: six weeks from Monday, other months’ days marked', () => {
  const m = plain(datePickerMonth('2026-12', { today: '2026-12-18', value: '2026-12-24' }));
  assert.equal(m.title, 'December 2026');
  assert.equal(m.weeks.length, 6);
  assert.ok(m.weeks.every((w) => w.length === 7));
  assert.equal(m.weeks[0][0].date, '2026-11-30'); // the Monday before 1 Dec (a Tuesday)
  assert.equal(m.weeks[0][0].inMonth, false);
  assert.equal(m.weeks[0][1].date, '2026-12-01');
  const day = (d) => m.weeks.flat().find((c) => c.date === d);
  assert.equal(day('2026-12-18').today, true);
  assert.equal(day('2026-12-24').selected, true);
  assert.equal(m.weeks[5][6].date, '2027-01-10');
});

test('calendar month: days off greyed with their reason, the owners’ time off and the plan’s dates marked', () => {
  const info = (d) => (d === '2026-12-25' ? { off: true, text: 'Christmas Day' } : d === '2026-12-23' ? { away: true, text: 'Kevin off' } : d === '2026-12-21' ? { mark: true, text: 'planned start' } : null);
  const m = plain(datePickerMonth('2026-12', { dayInfo: info }));
  const day = (d) => m.weeks.flat().find((c) => c.date === d);
  assert.deepEqual([day('2026-12-25').off, day('2026-12-25').text], [true, 'Christmas Day']);
  assert.deepEqual([day('2026-12-23').away, day('2026-12-23').off], [true, false]);
  assert.equal(day('2026-12-21').mark, true);
  assert.equal(day('2026-12-22').text, '');
});

test('calendar: moving between months, and labels', () => {
  assert.equal(dpMonth('2026-12', 1), '2027-01');
  assert.equal(dpMonth('2027-01', -1), '2026-12');
  assert.equal(dpMonth('2026-03', -14), '2025-01');
  assert.equal(dpLabel('2026-12-28'), 'Mon 28 Dec 2026');
});

test('task editor calendar: holidays, owners’ time off and planned dates', () => {
  const T = load('neon-tickets', ['planDayInfo', 'planCalendar', 'planLeaveParse']);
  const tasks = [];
  tasks.calendar = T.planCalendar({ region: 'england-wales' });
  tasks.leave = T.planLeaveParse('- [[@Kevin Mulholland]]\n    - 2026-12-23');
  const owners = ['[[@Kevin Mulholland]]'];
  const planned = { start: '2026-12-21', due: '2026-12-29' };
  const d = (ymd) => JSON.parse(JSON.stringify(T.planDayInfo(tasks, owners, planned, ymd)));
  assert.deepEqual(d('2026-12-25'), { off: true, away: false, mark: false, text: 'Christmas Day' });
  assert.deepEqual(d('2026-12-23'), { off: false, away: true, mark: false, text: 'Kevin Mulholland off' });
  assert.deepEqual(d('2026-12-21'), { off: false, away: false, mark: true, text: 'planned start' });
  assert.deepEqual(d('2026-12-22'), { off: false, away: false, mark: false, text: '' });
  assert.equal(T.planDayInfo(null, [], null, '2026-12-26').text, 'Saturday'); // no plan yet: weekends still greyed
  // no owner yet: everyone's time off, so dates can be chosen before people are given tasks
  tasks.leave = T.planLeaveParse('- [[@Kevin Mulholland]]\n    - 2027-02-08 to 2027-02-12\n- [[@Kieran DeMonte|Kieran]]\n    - 2027-02-10');
  assert.deepEqual(JSON.parse(JSON.stringify(T.planDayInfo(tasks, [], null, '2027-02-10'))), { off: false, away: true, mark: false, text: 'Kevin Mulholland off · Kieran off' });
  // with an owner: only theirs
  assert.equal(T.planDayInfo(tasks, ['[[@Kieran DeMonte|Kieran]]'], null, '2027-02-09').text, '');
  assert.equal(T.planDayInfo(tasks, ['[[@Kieran DeMonte|Kieran]]'], null, '2027-02-10').text, 'Kieran off');
});
