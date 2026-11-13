// Fork: customers are the categories (folders in the customers folder, or the customer property).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const D = load('neon-deck', ['noteCategory', 'refreshCategories', 'CATS', 'CAT_LABEL', 'NEON_CATS', 'catColor', 'TFolder', 'timeCats']);
const folder = (name, children = []) => Object.assign(new D.TFolder(), { name, children });

test('no customers folder: the upstream four stay', () => {
  D.refreshCategories({ vault: { getAbstractFileByPath: () => null } }, '1.Customers');
  assert.deepEqual([...D.CATS], ['projects', 'school', 'admin', 'operations']);
  assert.equal(D.noteCategory({ frontmatter: { admin: true } }, 'x.md'), 'admin');
});

test('customers folder: one category per customer, from the property or the folder', () => {
  const root = folder('1.Customers', [folder('SYMCA'), folder('E2I'), folder('Sheffield City Council')]);
  D.refreshCategories({ vault: { getAbstractFileByPath: (p) => (p === '1.Customers' ? root : null) } }, '1.Customers');
  assert.deepEqual([...D.CATS], ['e2i', 'sheffield city council', 'symca']);
  assert.equal(D.CAT_LABEL['sheffield city council'], 'Sheffield City Council');
  assert.equal(D.noteCategory({ frontmatter: {} }, '1.Customers/SYMCA/Meetings/m.md'), 'symca');
  assert.equal(D.noteCategory({ frontmatter: { customer: 'E2I' } }, '2.Resources/x.md'), 'e2i');
  assert.equal(D.noteCategory({ frontmatter: {} }, '2.Resources/x.md'), null);
  assert.equal(D.noteCategory({ frontmatter: { untracked: true } }, '1.Customers/SYMCA/x.md'), 'untracked');
  assert.deepEqual([...D.timeCats()], ['e2i', 'sheffield city council', 'symca', 'other']);
  assert.equal(D.catColor('e2i'), 'var(--nd-cat-projects)');
  assert.equal(D.catColor('nobody'), 'var(--nd-cat-other)');
});
