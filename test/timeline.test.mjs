// Fork: Mermaid Gantt timelines for projects and tasks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const G = load('neon-tickets', ['ganttText', 'ganttWindow', 'ymdAdd', 'mermaidSafe', 'projectGanttText']);
const T = load('neon-tasks', ['taskGanttText']);
const day = (s) => ({ format: () => s, valueOf: () => Date.parse(s) });

test('dates, windows and safe names', () => {
  assert.equal(G.ymdAdd('2026-11-13', 0, 3), '2027-02-13');
  assert.equal(G.ymdAdd('2026-11-13', -14), '2026-10-30');
  assert.deepEqual(JSON.parse(JSON.stringify(G.ganttWindow('12m', '2026-11-13'))), { from: '2026-10-13', to: '2027-10-13' });
  assert.equal(G.ganttWindow('all', '2026-11-13'), null);
  assert.equal(G.mermaidSafe('Project : Plan #1; draft'), 'Project Plan 1 draft');
});

test('gantt text: sections, bars, milestones, clipping and windows', () => {
  const src = G.ganttText({
    today: '2026-11-13',
    window: { from: '2026-10-13', to: '2027-10-13' },
    sections: [
      { name: 'Acme Widgets', items: [{ name: 'ERP Migration', start: '2026-09-15', end: '2028-01-31', tags: ['active'] }, { name: 'Old', start: '2025-01-01', end: '2025-06-01', tags: ['done'] }] },
      { name: 'Empty', items: [{ name: 'Far', start: '2029-01-01' }] },
      { name: 'No customer', items: [{ name: 'Plan', start: '2026-11-20' }] },
    ],
  });
  assert.equal(src, ['gantt', '  dateFormat YYYY-MM-DD', '  axisFormat %b %Y', '  todayMarker on', '  section Acme Widgets', '  ERP Migration :active, t1, 2026-10-13, 2027-10-13', '  section No customer', '  Plan :milestone, t2, 2026-11-20, 0d'].join('\n'));
  assert.equal(G.ganttText({ sections: [{ name: 'x', items: [] }] }), '');
});

test('projects: customer sections, status tags, closed bars end when closed', () => {
  const p = (title, customer, status, bucket, started, due, completed, statusRaw) => ({ title, customer, status, bucket, startedOn: started && day(started), created: day('2026-01-01'), due: due && day(due), completed: completed && day(completed), statusRaw, file: { stat: { mtime: 0 } } });
  const src = G.projectGanttText([
    p('ERP Migration', 'Acme Widgets', 'in-progress', 'later', '2026-09-15', '2027-09-30', null, 'inprogress'),
    p('Wi-Fi', 'Acme Widgets', 'done', 'done', '2026-06-01', '2026-10-31', '2026-10-20', 'completed'),
    p('Late one', 'Globex', 'open', 'overdue', '2026-08-01', '2026-11-01', null, 'init'),
  ], 'all', '2026-11-13');
  assert.match(src, /section Acme Widgets\n {2}ERP Migration \(inprogress\) :active, t\d, 2026-09-15, 2027-09-30/);
  assert.match(src, /Wi-Fi \(completed\) :done, t\d, 2026-06-01, 2026-10-20/);
  assert.match(src, /section Globex\n {2}Late one \(init\) :crit, t\d, 2026-08-01, 2026-11-01/);
});

test('tasks: dated only, by note, bars from a start date, overdue and in progress', () => {
  const t = (note, raw, due, group, doing) => ({ file: { basename: note }, raw, display: raw.replace(/ [🛫📅].*$/u, ''), due, group, doing });
  const src = T.taskGanttText([
    t('Todo', 'book the day 📅 2027-01-15', '2027-01-15', 'later'),
    t('ERP Migration', 'design accounts 🛫 2026-10-20 📅 2027-01-29', '2027-01-29', 'later', true),
    t('Todo', 'no date', null, 'later'),
    t('Old', 'missed 📅 2026-11-01', '2026-11-01', 'overdue'),
  ], 'all', '2026-11-13');
  assert.match(src, /section Old\n {2}missed :crit, milestone, t1, 2026-11-01, 0d/);
  assert.match(src, /section Todo\n {2}book the day :milestone, t2, 2027-01-15, 0d/);
  assert.match(src, /section ERP Migration\n {2}design accounts :active, t3, 2026-10-20, 2027-01-29/);
  assert.doesNotMatch(src, /no date/);
});
