// Fork: tasks in Tasks-plugin style, the Todo note, and weekly notes with folders in their format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const T = load('neon-tasks', ['addTaskAtHead', 'hasTaskTag', 'taskDisplay', 'taskGroup', 'TASK_LINE_RE']);

test('task tag: whole tag only, any case', () => {
  assert.equal(T.hasTaskTag('#task start looking at stuff', '#task'), true);
  assert.equal(T.hasTaskTag('review notes #Task 📅 2026-11-16', '#task'), true);
  assert.equal(T.hasTaskTag('#tasks list', '#task'), false);
  assert.equal(T.hasTaskTag('no tag', '#task'), false);
  assert.equal(T.hasTaskTag('#task x', ''), false);
});

test('in-progress [/] lines are open tasks; display drops the tag and dates', () => {
  assert.equal(T.TASK_LINE_RE.test('- [/] #task have 121 meeting ➕ 2026-11-10'), true);
  assert.equal(T.TASK_LINE_RE.test('- [x] #task done'), false);
  assert.equal(T.taskDisplay('#task have 121 meeting with [[@Sam]] ➕ 2026-11-10 🛫 2026-11-10 📅 2026-11-16', '#task'), 'have 121 meeting with @Sam');
});

test('grouping: due first, then scheduled', () => {
  const g = (raw) => ({ ...T.taskGroup(raw, null, '2026-11-13') });
  assert.deepEqual(g('a 📅 2026-11-12'), { due: '2026-11-12', group: 'overdue' });
  assert.deepEqual(g('a ⏳ 2026-11-12 📅 2026-11-16'), { due: '2026-11-16', group: 'later' });
  assert.deepEqual(g('a ⏳ 2026-11-12'), { due: '2026-11-12', group: 'today' });
  assert.deepEqual(g('a ⏳ 2026-11-20'), { due: '2026-11-20', group: 'later' });
  assert.deepEqual(g('a 🛫 2026-11-11'), { due: null, group: 'later' });
});

test('new Todo tasks go at the head of the note', () => {
  const line = '- [ ] #task new ➕ 2026-11-13';
  const todo = '---\ntitle: Todo\n---\n\n## initial 121s\n\n- [ ] #task old\n';
  assert.equal(T.addTaskAtHead(todo, line), '---\ntitle: Todo\n---\n\n- [ ] #task new ➕ 2026-11-13\n\n## initial 121s\n\n- [ ] #task old\n');
  // already a task at the head: no extra blank line, newest first
  const again = T.addTaskAtHead(T.addTaskAtHead(todo, line), '- [ ] #task newer');
  assert.ok(again.startsWith('---\ntitle: Todo\n---\n\n- [ ] #task newer\n- [ ] #task new ➕ 2026-11-13\n\n## initial'));
  assert.equal(T.addTaskAtHead('', line), line + '\n');
  assert.equal(T.addTaskAtHead('# Todo\n', line), line + '\n\n# Todo\n');
});

test('weekly notes: a format with folders matches the path inside the notes folder', async () => {
  // noteDateOf from the real source, with a moment stand-in that records what it was asked to parse
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../src/shared/shared.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function noteDateOf('), src.indexOf('\n}\n', src.indexOf('function noteDateOf(')) + 2);
  const asked = [];
  const ctx = { normalizePath: (p) => p, moment: (name, fmt, strict) => (asked.push([name, fmt, strict]), { isValid: () => name === '2026/2026-46' || name === '2026-11-13' }) };
  const noteDateOf = vm.runInNewContext(`${fn}; noteDateOf`, ctx);
  const weekly = { folder: '2.Resources/Dailynotes', format: 'YYYY/YYYY-ww' };
  assert.ok(noteDateOf(weekly, '2.Resources/Dailynotes/2026/2026-46.md'));
  assert.deepEqual(asked.pop(), ['2026/2026-46', 'YYYY/YYYY-ww', true]);
  assert.equal(noteDateOf(weekly, 'Elsewhere/2026/2026-46.md'), null);
  assert.equal(noteDateOf(weekly, '2.Resources/Dailynotes/2026/2026-46.png'), null);
  // a plain format still matches the file name, also in sub-folders
  assert.ok(noteDateOf({ folder: 'Daily', format: 'YYYY-MM-DD' }, 'Daily/2026/11/2026-11-13.md'));
  assert.deepEqual(asked.pop(), ['2026-11-13', 'YYYY-MM-DD', true]);
  assert.ok(noteDateOf({ folder: '', format: 'YYYY-MM-DD' }, '2026-11-13.md'));
});
