// Fork: settings for a PARA vault — several task tags, ignored tags, a renameable group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const T = load('neon-tasks', ['taskTags', 'hasTaskTag', 'taskDisplay', 'groupWord', 'NEON_CATS', 'setIgnoredTags', 'isIgnoredNote']);
const P = load('neon-tickets', ['projectCustomer', 'projectGroups', 'NEON_CATS']);

test('several task tags; new tasks use the first', () => {
  assert.deepEqual([...T.taskTags('#task, todo')], ['#task', '#todo']);
  assert.equal(T.hasTaskTag('pay the bill #todo 📅 2026-12-01', '#task, #todo'), true);
  assert.equal(T.hasTaskTag('pay the bill #todos', '#task, #todo'), false);
  assert.equal(T.hasTaskTag('pack the camera', '#task, #todo'), false);
  assert.equal(T.taskDisplay('#todo bank biz account ✅ 2026-11-03', '#task, #todo'), 'bank biz account');
  assert.equal(T.taskDisplay('#task call Bob', '#task'), 'call Bob');
});

test('group word follows the label', () => {
  assert.equal(T.groupWord(), 'Customer');
  T.NEON_CATS.label = 'Area';
  assert.equal(T.groupWord(true), 'Areas');
  assert.equal(T.groupWord(false, true), 'area');
  T.NEON_CATS.label = 'Category';
  assert.equal(T.groupWord(true), 'Categories');
  T.NEON_CATS.label = 'Customer';
});

test('ignored tags: index notes are left out', () => {
  const cache = { 'a/0.Index.md': { frontmatter: { tags: ['vault_index'] } }, 'a/Note.md': { frontmatter: { tags: ['journal'] } } };
  const app = { metadataCache: { getFileCache: (f) => cache[f.path] } };
  T.setIgnoredTags('vault_index, #Drafts');
  assert.equal(T.isIgnoredNote(app, { path: 'a/0.Index.md', extension: 'md' }), true);
  assert.equal(T.isIgnoredNote(app, { path: 'a/Note.md', extension: 'md' }), false);
  T.setIgnoredTags('');
  assert.equal(T.isIgnoredNote(app, { path: 'a/0.Index.md', extension: 'md' }), false);
});

test('a project\'s group: the group property, else its folder under the groups folder', () => {
  P.NEON_CATS.prop = 'area';
  assert.equal(P.projectCustomer('1.Projects/Oven Pro.md', { area: 'Business' }, '1.Projects'), 'Business');
  assert.equal(P.projectCustomer('1.Projects/Photographer/Competitions/2025 Wilder.md', {}, '1.Projects'), 'Photographer');
  assert.equal(P.projectCustomer('1.Projects/Oven Pro.md', { customer: 'acme' }, '1.Projects'), '');
  P.NEON_CATS.prop = 'customer';
  P.NEON_CATS.label = 'Area';
  const groups = P.projectGroups([{ title: 'Oven Pro', customer: '', status: 'open', created: { valueOf: () => 0 }, file: { stat: { mtime: 0 } } }], 'customer');
  assert.equal(groups[0][1], 'No area');
  P.NEON_CATS.label = 'Customer';
});
