import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planHasTag', 'planIndex', 'planState', 'planSchedule', 'planWorkdays', 'planCounts', 'planSummaryText', 'planFolderOf', 'planScopeOf', 'NEON_PLAN', 'NEON_PROJECTS', 'planWorkdaysBetween', 'planBlockers']);
const T = (line, at) => P.planTask(line, at);

test('plan task: status, id, dependencies, duration and dates', () => {
  const t = T('- [ ] Select the GPU provider [duration:: 1d] 🆔 gp4 ⛔ gp2,gp3, sc5 📅 2026-12-01 #task');
  assert.equal(t.status, 'todo');
  assert.equal(t.id, 'gp4');
  assert.deepEqual([...t.deps], ['gp2', 'gp3', 'sc5']);
  assert.equal(t.days, 1);
  assert.equal(t.due, '2026-12-01');
  assert.equal(T('- [/] a [duration:: 2w]').days, 10);
  assert.equal(T('- [/] a [duration:: 3 days]').days, 3);
  assert.equal(T('- [/] a').status, 'doing');
  assert.equal(T('- [x] a ✅ 2026-11-01').status, 'done');
  assert.equal(T('- [-] a').status, 'cancelled');
  assert.equal(T('- [!] a').status, 'todo');
  assert.equal(T('- [n] a note-style box'), null);
  assert.equal(T('- ( ) not a task'), null);
  assert.equal(T('plain text'), null);
  assert.equal(T('- [ ] a ⛔️ x1').deps[0], 'x1');
  assert.equal(T('- [ ] a', { phase: 'Scope' }).phase, 'Scope');
});

test('plan tags: whole tags from the comma list', () => {
  assert.equal(P.planHasTag('do it #task', '#task, #todo'), true);
  assert.equal(P.planHasTag('do it #TODO', 'task, todo'), true);
  assert.equal(P.planHasTag('do it #tasks', '#task'), false);
  assert.equal(P.planHasTag('do it #task', ''), false);
});

test('plan state: ready, waiting, doing, done; unknown ids do not hold a task up', () => {
  const a = T('- [ ] a 🆔 a');
  const b = T('- [ ] b 🆔 b ⛔ a');
  const c = T('- [/] c 🆔 c ⛔ a');
  const d = T('- [ ] d ⛔ nowhere');
  const { byId } = P.planIndex([a, b, c, d]);
  assert.equal(P.planState(a, byId), 'ready');
  assert.equal(P.planState(b, byId), 'waiting');
  assert.equal(P.planState(c, byId), 'doing');
  assert.equal(P.planState(d, byId), 'ready');
  a.status = 'cancelled';
  assert.equal(P.planState(b, byId), 'ready');
});

test('blocked: an overdue or #blocked task upstream, passed down the chain; waiting when upstream is on time', () => {
  const a = T('- [ ] a 🆔 a 📅 2026-11-10');
  const b = T('- [ ] b 🆔 b ⛔ a');
  const c = T('- [ ] c 🆔 c ⛔ b');
  const s = T('- [ ] supplier 🆔 s #blocked');
  const e = T('- [ ] e 🆔 e ⛔ s');
  const { byId } = P.planIndex([a, b, c, s, e]);
  const today = '2026-11-16';
  assert.equal(P.planState(a, byId, today), 'ready'); // overdue itself, not blocked
  assert.equal(P.planState(b, byId, today), 'blocked');
  assert.equal(P.planState(c, byId, today), 'blocked'); // A's delay reaches C
  assert.equal(P.planBlockers(c, byId, today)[0], a); // the root cause
  assert.equal(P.planState(s, byId, today), 'blocked'); // tagged
  assert.equal(P.planState(e, byId, today), 'blocked');
  assert.equal(P.planState(c, byId, '2026-11-01'), 'waiting'); // before the due date: on time
  assert.equal(P.planState(b, byId), 'waiting'); // no today: nothing is overdue
});

test('schedule: starts after dependencies, critical path, loops and missing ids reported', () => {
  const tasks = [
    T('- [ ] scope [duration:: 2d] 🆔 s'),
    T('- [ ] prices [duration:: 3d] 🆔 p ⛔ s'),
    T('- [ ] files [duration:: 1d] 🆔 f ⛔ s'),
    T('- [ ] select [duration:: 1d] 🆔 g ⛔ p,f'),
    T('- [ ] owner 🆔 o'),
  ];
  const s = P.planSchedule(tasks);
  const r = Object.fromEntries(s.rows.map((x) => [x.task.id, x]));
  assert.equal(s.length, 6);
  assert.deepEqual([r.s.es, r.p.es, r.f.es, r.g.es, r.o.es], [0, 2, 2, 5, 0]);
  assert.deepEqual([r.s.crit, r.p.crit, r.g.crit, r.f.crit, r.o.crit], [true, true, true, false, false]);
  assert.equal(r.f.slack, 2);
  assert.equal(r.o.slack, 5);
  const loop = P.planSchedule([T('- [ ] a 🆔 a ⛔ b'), T('- [ ] b 🆔 b ⛔ a'), T('- [ ] c ⛔ zz')]);
  assert.equal(loop.cycles.length, 1);
  assert.equal(loop.missing[0].id, 'zz');
  const dup = P.planSchedule([T('- [ ] a 🆔 a'), T('- [ ] again 🆔 a')]);
  assert.deepEqual([...dup.dups], ['a']);
});

test('working days skip weekends', () => {
  assert.equal(P.planWorkdays('2026-11-16', 0), '2026-11-16'); // Monday
  assert.equal(P.planWorkdays('2026-11-20', 1), '2026-11-23'); // Friday → Monday
  assert.equal(P.planWorkdays('2026-11-21', 0), '2026-11-23'); // Saturday moves to Monday
  assert.equal(P.planWorkdays('2026-11-16', 10), '2026-11-30');
});

test('counts and summary text leave outside tasks out', () => {
  const tasks = [
    T('- [ ] late 📅 2026-11-10 🆔 l'),
    T('- [ ] soon 📅 2026-11-20 ⛔ l'),
    T('- [/] doing'),
    T('- [x] done'),
    Object.assign(T('- [ ] outside 📅 2026-11-01'), { external: true }),
  ];
  const c = P.planCounts(tasks, '2026-11-16');
  assert.deepEqual({ ...c }, { total: 4, ready: 1, waiting: 0, doing: 1, blocked: 1, done: 1, overdue: 1, week: 1 });
  assert.equal(P.planSummaryText(c), '1 overdue · 1 due this week · 1 blocked · 1 ready · 1 in progress · 1/4 done');
  assert.equal(P.planSummaryText(c, true), '1 overdue · 1 due this week · 1 blocked');
  assert.equal(P.planSummaryText({ total: 0 }), '');
});

test('scope: project folders, project notes, other notes', () => {
  P.NEON_PLAN.folders = '1.Projects';
  assert.equal(P.planFolderOf('1.Projects/Alpha/notes/a.md'), '1.Projects/Alpha');
  assert.equal(P.planFolderOf('1.Projects/loose.md'), null);
  assert.equal(P.planFolderOf('2.Areas/a.md'), null);
  const app = (fm) => ({ metadataCache: { getFileCache: () => ({ frontmatter: fm }) } });
  assert.deepEqual({ ...P.planScopeOf(app({}), { path: '1.Projects/Alpha/a.md' }) }, { kind: 'folder', path: '1.Projects/Alpha' });
  assert.deepEqual({ ...P.planScopeOf(app({ tags: ['project'] }), { path: 'C/Projects/Pilot.md' }) }, { kind: 'note', path: 'C/Projects/Pilot.md' });
  assert.equal(P.planScopeOf(app({ tags: ['meeting'] }), { path: 'C/Meetings/m.md' }), null);
  P.NEON_PLAN.folders = '';
});

test('forecast: tasks not started yet start no earlier than today', () => {
  assert.equal(P.planWorkdaysBetween('2026-11-02', '2026-11-16'), 10);
  assert.equal(P.planWorkdaysBetween('2026-11-16', '2026-11-02'), 0);
  const tasks = [T('- [x] a [duration:: 2d] 🆔 a'), T('- [/] b [duration:: 3d] 🆔 b ⛔ a'), T('- [ ] c [duration:: 1d] 🆔 c ⛔ a'), T('- [ ] d [duration:: 1d] 🆔 d ⛔ c')];
  const r = P.planSchedule(tasks, { notBefore: 10 }).rows.map((x) => x.es);
  assert.deepEqual([...r], [0, 2, 10, 11]);
});
