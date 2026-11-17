// Fork: Mermaid Gantt timelines for projects and tasks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const G = load('neon-tickets', ['ganttWindow', 'ymdAdd', 'mermaidSafe']);
const day = (s) => ({ format: () => s, valueOf: () => Date.parse(s) });

test('dates, windows and safe names', () => {
  assert.equal(G.ymdAdd('2026-11-13', 0, 3), '2027-02-13');
  assert.equal(G.ymdAdd('2026-11-13', -14), '2026-10-30');
  assert.deepEqual(JSON.parse(JSON.stringify(G.ganttWindow('12m', '2026-11-13'))), { from: '2026-10-13', to: '2027-10-13' });
  assert.equal(G.ganttWindow('all', '2026-11-13'), null);
  assert.equal(G.mermaidSafe('Project : Plan #1; draft'), 'Project Plan 1 draft');
});

test('tasks timeline rows: by note, a bar from start to due, else a diamond; colours by urgency', async () => {
  const { load } = await import('./load.mjs');
  const TT = load('neon-tasks', ['taskTimelineRows', 'planGanttLayout']);
  const f = (b) => ({ basename: b, path: `${b}.md` });
  const tasks = [
    { file: f('A'), line: 1, raw: 'x 🛫 2026-11-10 📅 2026-11-20', due: '2026-11-20', group: 'later', doing: true, display: 'x' },
    { file: f('A'), line: 2, raw: 'y 📅 2026-11-12', due: '2026-11-12', group: 'overdue', doing: false, display: 'y' },
    { file: f('B'), line: 3, raw: 'z 📅 2027-03-01', due: '2027-03-01', group: 'later', doing: false, display: 'z' },
    { file: f('B'), line: 4, raw: 'w 📅 2026-11-19', due: '2026-11-19', group: 'later', doing: false, display: 'w' },
  ];
  const rows = TT.taskTimelineRows(tasks, null, '2026-11-16');
  const s = (r) => (r.section ? `#${r.section}` : `${r.label}:${r.bar.kind}:${r.milestone ? 'ms' : `${r.bar.start}>${r.bar.end}`}`);
  assert.equal(rows.map(s).join(' '), '#A y:overdue:ms x:doing:2026-11-10>2026-11-20 #B w:soon:ms z:ready:ms');
});
