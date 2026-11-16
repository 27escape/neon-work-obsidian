// Fork: an empty "log folder" setting means <base folder>/Time Log. The folder must be created there,
// and the README must go there too, never to the vault root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const T = load('neon-time', ['NeonTime', 'NEON_BASE']);

function fakeVault() {
  const files = new Map();
  const folders = new Set();
  const made = [];
  const vault = {
    getAbstractFileByPath: (p) => (files.has(p) ? files.get(p) : folders.has(p) ? { path: p, children: [] } : null),
    createFolder: async (p) => (folders.add(p), made.push(['folder', p])),
    create: async (p, text) => {
      const parent = p.split('/').slice(0, -1).join('/');
      if (parent && !folders.has(parent)) throw new Error(`ENOENT: ${p}`);
      made.push(['file', p]);
      files.set(p, { path: p, text });
    },
  };
  return { vault, made };
}

test('empty log folder: day note and README go in <base folder>/Time Log', async () => {
  T.NEON_BASE.folder = '2.Resources';
  const { vault, made } = fakeVault();
  const t = Object.create(T.NeonTime.prototype);
  t.app = { vault };
  t.settings = { writeNotes: true, logFolder: '', dayHours: 8, idleMin: 3 };
  t.days = { '2026-11-16': { entries: [{ start: Date.parse('2026-11-16T09:00:00Z'), ms: 1800000, cat: 'other', source: 'manual', text: 'x' }], done: [] } };
  t.summary = () => ({ total: 30, untracked: 0, breaks: 0, by: {}, target: 480, over: 0 });
  t.workOf = () => null;
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await t.writeDay('2026-11-16');
    await t.ensureReadme();
  } finally {
    console.error = orig;
  }
  assert.deepEqual(errors, []);
  const paths = made.map(([, p]) => p);
  assert.ok(paths.includes('2.Resources/Time Log'), paths.join(', '));
  assert.ok(paths.includes('2.Resources/Time Log/2026-11-16.md'), paths.join(', '));
  assert.ok(paths.includes('2.Resources/Time Log/README.md'), paths.join(', '));
  assert.ok(!paths.includes('README.md'));
});
