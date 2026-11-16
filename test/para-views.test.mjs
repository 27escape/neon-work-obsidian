// Fork: PARA — groups from links, project folders, the Areas card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const S = load('neon-tickets', ['groupFromValue', 'groupFromProps', 'refreshCategories', 'NEON_CATS', 'CATS', 'projectFolderNote', 'projectCustomer', 'TFolder', 'TFile']);
const D = load('neon-deck', ['areaRows']);

// a tiny vault: 2.Areas/{Photography, Recipes, Dailynotes}; the stand-in folder/file classes come from the sandbox
function vault() {
  const folder = (path, children = []) => Object.assign(Object.create(S.TFolder.prototype), { path, name: path.split('/').pop(), children });
  const file = (path) => Object.assign(Object.create(S.TFile.prototype), { path, name: path.split('/').pop(), basename: path.split('/').pop().replace(/\.md$/, ''), extension: 'md' });
  const photo = folder('2.Areas/Photography', [file('2.Areas/Photography/Cameras.md')]);
  const root = folder('2.Areas', [photo, folder('2.Areas/Recipes'), folder('2.Areas/Dailynotes')]);
  const all = new Map([[root.path, root], [photo.path, photo], ['2.Areas/Photography/Cameras.md', photo.children[0]]]);
  const app = {
    vault: { getAbstractFileByPath: (p) => all.get(p) || null },
    metadataCache: { getFirstLinkpathDest: (link) => [...all.values()].find((f) => f.basename === link || f.path === `${link}.md`) || null },
  };
  return { app, folder, file };
}

test('groups from names, links, paths and lists; "Not groups" folders skipped', () => {
  const { app } = vault();
  S.NEON_CATS.skip = ['Dailynotes'];
  S.refreshCategories(app, '2.Areas');
  assert.deepEqual([...S.CATS], ['photography', 'recipes']);
  assert.equal(S.groupFromValue('Photography', '', app), 'photography');
  assert.equal(S.groupFromValue('[[Photography]]', '', app), 'photography');
  assert.equal(S.groupFromValue('[[Cameras|my cameras]]', '', app), 'photography'); // a note inside the area
  assert.equal(S.groupFromValue('/2.Areas/Recipes/0.Index.md', '', app), 'recipes');
  assert.equal(S.groupFromValue('[[Projects Kanban.base]]', '', app), null);
  assert.equal(S.groupFromValue('2.Areas/Dailynotes/2026-11-16.md', '', app), null);
  S.NEON_CATS.prop = 'area, parent';
  assert.equal(S.groupFromProps({ parent: ['[[Projects Kanban.base]]', '[[Photography]]'] }, '', app), 'photography');
  assert.equal(S.projectCustomer('1.Projects/Oven Pro.md', { parent: '[[Photography]]' }, '2.Areas'), 'Photography');
  S.NEON_CATS.prop = 'customer';
  S.NEON_CATS.skip = [];
});

test('a project folder is represented by a note named like it, a note with a status, or its index', () => {
  const { app, folder, file } = vault();
  const fm = new Map();
  app.metadataCache.getFileCache = (f) => ({ frontmatter: fm.get(f.path) || {} });
  const a = folder('1.Projects/Oven Cleaning', [file('1.Projects/Oven Cleaning/0.Index.md'), file('1.Projects/Oven Cleaning/Oven Pro - Van.md')]);
  assert.equal(S.projectFolderNote(app, a).basename, '0.Index');
  fm.set('1.Projects/Oven Cleaning/Oven Pro - Van.md', { status: 'paused' });
  assert.equal(S.projectFolderNote(app, a).basename, 'Oven Pro - Van');
  a.children.push(file('1.Projects/Oven Cleaning/Oven Cleaning.md'));
  assert.equal(S.projectFolderNote(app, a).basename, 'Oven Cleaning');
  assert.equal(S.projectFolderNote(app, folder('1.Projects/Empty')), null);
});

test('areas: counts, quiet areas, quietest first', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const day = 86400000;
  const rows = D.areaRows(
    [['photography', 'Photography'], ['recipes', 'Recipes'], ['walking', 'Walking']],
    [{ group: 'photography', mtime: now - 2 * day }, { group: 'photography', mtime: now - 60 * day }, { group: 'recipes', mtime: now - 90 * day }, { group: null, mtime: now }],
    [{ group: 'photography' }, { group: 'other' }],
    [{ group: 'photography' }, { group: 'photography' }, { group: 'recipes' }],
    now,
  );
  const plain = JSON.parse(JSON.stringify(rows));
  assert.deepEqual(plain.map((r) => r.label), ['Walking', 'Recipes', 'Photography']);
  assert.deepEqual(plain.map((r) => r.quiet), [true, true, false]);
  assert.deepEqual(plain[2], { key: 'photography', label: 'Photography', projects: 1, tasks: 2, notes: 2, recent: 1, last: now - 2 * day, quiet: false });
});
