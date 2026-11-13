// Fork: research status comes from a note property; new notes get the vault's usual properties.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const R = load('neon-research', ['statusGroups', 'statusValue', 'statusList', 'statusLine', 'researchFrontmatter']);

test('status values: lists, blanks and odd types', () => {
  assert.equal(R.statusValue(' ongoing '), 'ongoing');
  assert.equal(R.statusValue(['init', 'x']), 'init');
  assert.equal(R.statusValue(null), '');
  assert.equal(R.statusValue({ a: 1 }), '');
  assert.deepEqual([...R.statusList(' Completed, done ,,evergreen')], ['completed', 'done', 'evergreen']);
});

test('notes group by status: open first, then done, then no status', () => {
  const done = R.statusList('completed, evergreen');
  const e = (n, status) => ({ file: { name: n }, status });
  const sum = R.statusGroups([e('a', 'init'), e('b', 'Completed'), e('c', ''), e('d', 'ongoing'), e('f', 'init'), e('g', 'evergreen')], done);
  assert.deepEqual(JSON.parse(JSON.stringify(sum.groups.map((g) => [g.status, g.kind, g.files.length]))), [['init', 'open', 2], ['ongoing', 'open', 1], ['Completed', 'done', 1], ['evergreen', 'done', 1], ['', 'none', 1]]);
  assert.deepEqual([sum.open, sum.done, sum.none], [3, 2, 1]);
  assert.equal(R.statusLine(sum), '3 to research · 2 researched · 1 without status');
  assert.equal(R.statusLine({ open: 0, done: 1, none: 0 }), '0 to research · 1 researched');
});

test('new research note properties follow the settings', () => {
  const s = { statusProperty: 'status', newStatus: 'init', newNoteTags: 'research, #ai', countAsWork: true };
  assert.equal(R.researchFrontmatter('TOGAF', '2026-11-13', s), '---\ntitle: TOGAF\ncreated: 2026-11-13\nmodified: 2026-11-13\nstatus: init\ntags:\n  - research\n  - ai\n---\n');
  const t = R.researchFrontmatter('A: B', '2026-11-13', { ...s, newStatus: '', newNoteTags: '', countAsWork: false });
  assert.equal(t, '---\ntitle: "A: B"\ncreated: 2026-11-13\nmodified: 2026-11-13\nuntracked: true\n---\n');
});

test('pattern sections: * matches one folder name', () => {
  const P = load('neon-research', ['globFolders', 'patternBase', 'patternStar', 'TFolder']);
  const fd = (name, path, children = []) => Object.assign(new P.TFolder(), { name, path, children });
  const sym = fd('Research', '1.Customers/SYMCA/Research');
  const e2i = fd('Research', '1.Customers/E2I/Research');
  const root = fd('', '/', [fd('1.Customers', '1.Customers', [fd('SYMCA', '1.Customers/SYMCA', [sym, fd('Projects', '1.Customers/SYMCA/Projects')]), fd('E2I', '1.Customers/E2I', [e2i])]), fd('2.Resources', '2.Resources')]);
  assert.deepEqual(JSON.parse(JSON.stringify(P.globFolders(root, '1.Customers/*/Research').map((f) => f.path))), ['1.Customers/E2I/Research', '1.Customers/SYMCA/Research']);
  assert.equal(P.patternBase('1.Customers/*/Research', '1.Customers/SYMCA/Research/AI/x.md'), '1.Customers/SYMCA/Research');
  assert.equal(P.patternBase('1.Customers/*/Research', '1.Customers/SYMCA/Projects/x.md'), '');
  assert.equal(P.patternBase('1.Customers/*/Research', '1.Customers/SYMCA/Research'), '');
  assert.equal(P.patternStar('1.Customers/*/Research', '1.Customers/SYMCA/Research'), 'SYMCA');
});
