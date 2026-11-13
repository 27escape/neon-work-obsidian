// Fork: Recently done reads ticked tasks (✅ date) from the notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const T = load('neon-tasks', ['doneTaskOf', 'NoteIndex']);

test('a ticked line with a ✅ date is a finished task', () => {
  assert.equal(T.doneTaskOf('- [x] #task send the report ✅ 2026-11-12').date, '2026-11-12');
  assert.equal(T.doneTaskOf('  * [X] call Bob 📅 2026-11-10 ✅ 2026-11-11\r').date, '2026-11-11');
  assert.equal(T.doneTaskOf('> - [x] in a callout ✅ 2026-11-01').raw, 'in a callout ✅ 2026-11-01');
  assert.equal(T.doneTaskOf('- [x] ticked without a date'), null);
  assert.equal(T.doneTaskOf('- [ ] open ✅ 2026-11-12'), null);
  assert.equal(T.doneTaskOf('- [/] doing ✅ 2026-11-12'), null);
  assert.equal(T.doneTaskOf('plain text ✅ 2026-11-12'), null);
});

test('the note index finds notes with ticked tasks changed since a date', () => {
  const note = (path, mtime, tasks) => ({ path, extension: 'md', stat: { mtime }, tasks });
  const files = [note('a.md', 100, ['x']), note('b.md', 5, ['x']), note('c.md', 100, [' ']), note('d.md', 100, ['X', ' '])];
  const app = { vault: { getMarkdownFiles: () => files }, metadataCache: { getFileCache: (f) => ({ listItems: f.tasks.map((task) => ({ task })) }) } };
  const ix = new T.NoteIndex(app);
  assert.deepEqual([...ix.withDoneTasks(50).map((e) => e.file.path)], ['a.md', 'd.md']);
  assert.equal(ix.withDoneTasks().length, 3);
  assert.equal(ix.withOpenTasks().length, 2);
});
