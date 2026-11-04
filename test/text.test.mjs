// Pure text functions: each was a real bug or is easy to break.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const W = load('neon-write', ['toggleMark', 'toggleMergeCell', 'toggleLockMeta']);
const T = load('neon-tickets', ['addToSection']);
const K = load('neon-tasks', ['taskGroup']);
const D = load('neon-deck', ['bangFirst']);

// "a [word] b" -> selection between the brackets
const mark = (x, m) => {
  const s = x.indexOf('['), e = x.indexOf(']') - 1;
  const r = W.toggleMark(x.replace('[', '').replace(']', ''), s, e, m);
  return r.line.slice(0, r.s) + '[' + r.line.slice(r.s, r.e) + ']' + r.line.slice(r.e);
};

test('format bar toggles (items 30, 34)', () => {
  assert.equal(mark('a [w] b', '**'), 'a **[w]** b');
  assert.equal(mark('a **[w]** b', '**'), 'a [w] b');
  assert.equal(mark('a **[w]** b', '*'), 'a ***[w]*** b'); // italic on bold: both, not swapped
  assert.equal(mark('a [**w**] b', '**'), 'a [w] b');
  assert.equal(mark('a [w ]b', '**'), 'a **[w]** b');
  assert.equal(mark('a ~~[w]~~ b', '~~'), 'a [w] b');
});

test('merged table cells (item 36)', () => {
  assert.equal(W.toggleMergeCell('| a | b | c |', 7), '| a | < | c |');
  assert.equal(W.toggleMergeCell('| a | < | c |', 7), '| a |  | c |');
  assert.equal(W.toggleMergeCell('| a | b |', 2), null);
});

test('callout lock metadata (item 31)', () => {
  assert.equal(W.toggleLockMeta('> [!info] Title'), '> [!info|locked] Title');
  assert.equal(W.toggleLockMeta('> [!info|locked] Title'), '> [!info] Title');
  assert.equal(W.toggleLockMeta('> [!tip|wide]- T'), '> [!tip|wide locked]- T');
  assert.equal(W.toggleLockMeta('> plain quote'), null);
});

test('ticket log lines go on top (item 13)', () => {
  assert.equal(T.addToSection('## Log\n- old\n', 'log', '- new'), '## Log\n- new\n- old\n');
  assert.equal(T.addToSection('## Steps\n- [ ] a\n', 'steps', '- [ ] b'), '## Steps\n- [ ] a\n- [ ] b\n');
});

test('task groups by due date', () => {
  assert.deepEqual({ ...K.taskGroup('x 📅 2026-01-01', null, '2026-01-02') }, { due: '2026-01-01', group: 'overdue' });
  assert.deepEqual({ ...K.taskGroup('x', {}, '2026-01-02') }, { due: null, group: 'today' });
});

test('! names sort first (item 24)', () => {
  const by = D.bangFirst((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(['b', '!a', 'a', '!!z'].map((name) => ({ name })).sort(by).map((x) => x.name), ['!!z', '!a', 'a', 'b']);
});
