// Fork: editing on the Gantt (drag lengths and starts, Alt-drag links) and the dependency arrows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['planTask', 'planGanttText', 'planGanttLayout', 'planGanttLinks', 'planEarliest', 'planBarDays', 'planDropDay', 'PlanView', 'planEditLine']);
const T = (l, at = {}) => P.planTask(l, at);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('drag: lengths in working days, landing days, the earliest start', () => {
  assert.equal(P.planDropDay('2026-11-21'), '2026-11-23'); // Saturday → Monday
  assert.equal(P.planBarDays('2026-11-16', '2026-11-20'), 5);
  assert.equal(P.planBarDays('2026-11-16', '2026-11-23'), 6); // over a weekend
  assert.equal(P.planBarDays('2026-11-16', '2026-11-10'), 1); // never under a day
  const a = T('- [ ] A [duration:: 2d] 🆔 a');
  const b = T('- [ ] B 🆔 b ⛔ a');
  const g = P.planGanttText([a, b], { base: '2026-11-16', today: '2026-11-16' });
  assert.equal(P.planEarliest(b, g.bars, '2026-11-16'), '2026-11-18'); // after A's two days
  assert.equal(P.planEarliest(a, g.bars, '2026-11-17'), '2026-11-17'); // not started: not before today
});

test('arrows: from the end of the task waited for to the start of the one waiting', () => {
  const tasks = [T('- [ ] A [duration:: 2d] 🆔 a'), T('- [ ] B [duration:: 1d] 🆔 b ⛔ a'), T('- [ ] C 🆔 c ⛔ zz')];
  const g = P.planGanttText(tasks, { base: '2026-11-16', today: '2026-11-16' });
  const lay = P.planGanttLayout(g.rows, { today: '2026-11-16', width: 900, labelW: 300 });
  const links = P.planGanttLinks(lay);
  assert.equal(links.length, 1); // zz isn't drawn: no arrow
  assert.equal(links[0].from.id, 'a');
  assert.equal(links[0].to.id, 'b');
  assert.match(links[0].d, /^M[\d.]+,[\d.]+ H[\d.]+ V[\d.]+$/); // B starts as A ends: down into B's top
  assert.equal(links[0].end.dir, 'down');
  // with a gap between them: along and into the start of the bar
  const far = P.planGanttText([T('- [ ] A [duration:: 2d] 🆔 a'), T('- [ ] B 🆔 b ⛔ a 🛫 2026-11-25')], { base: '2026-11-16', today: '2026-11-16' });
  const l2 = P.planGanttLinks(P.planGanttLayout(far.rows, { today: '2026-11-16', width: 900, labelW: 300 }));
  assert.equal(l2[0].end.dir, 'right');
  assert.match(l2[0].d, /^M[\d.]+,[\d.]+ H[\d.]+ V[\d.]+ H[\d.]+$/);
  assert.equal(links[0].crit, true);
});

test('drops: what each drag writes', async () => {
  const changes = [];
  const view = Object.assign(Object.create(P.PlanView.prototype), {
    base: '2026-11-16', weeks: false, today: '2026-11-16', plan: { kind: 'note', path: 'P.md' },
    app: { metadataCache: { getFileCache: () => ({ frontmatter: { 'plan-prefix': 'p' } }) } },
    render: () => changes.push('render'),
    changeTasks: (label, edits) => changes.push([label, edits.map(([t, fn]) => fn(t.raw))]),
  });
  const a = T('- [ ] Alpha [duration:: 2d] 🆔 p-1 #task');
  const b = T('- [ ] Beta [duration:: 1d] 🆔 p-2 ⛔ p-1 #task');
  const c = T('- [ ] Gamma #task');
  view.tasks = [a, b, c];
  const g = P.planGanttText(view.tasks, { base: '2026-11-16', today: '2026-11-16' });
  const bar = (t) => g.bars.find((x) => x.task === t);
  // right end of A two days on: 4 days
  view.dropEnd(bar(a), 2);
  assert.match(changes.pop()[1][0], /\[duration:: 4d\]/);
  // B moved a week on: 🛫 a week later
  view.dropMove(bar(b), 7, g.bars);
  assert.match(changes.pop()[1][0], /🛫 2026-11-25/);
  // B moved before A ends: refused, redrawn
  view.dropMove(bar(b), -2, g.bars);
  assert.equal(changes.pop(), 'render');
  // Alt-drag from Gamma (no id) onto Beta: Gamma gets p-3, Beta waits for it
  view.dropLink(c, b);
  const [label, lines] = plain(changes.pop());
  assert.match(lines[0], /🆔 p-3/);
  assert.match(lines[1], /⛔ p-1,p-3/);
  assert.match(label, /link p-3/);
  // a loop is refused: A can't wait for B, which waits for A
  view.dropLink(b, a);
  assert.equal(changes.pop(), 'render');
});
