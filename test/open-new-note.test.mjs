import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { openNewNote } = load('neon-tasks', ['openNewNote']);

/** A workspace with one current tab; records what happens. */
function workspace(cur) {
  const log = [];
  const fresh = { pinned: false, view: { getViewType: () => 'markdown', editor: { focus: () => log.push('focus') } }, openFile: async (f, o) => log.push(`new tab: ${f} (${o.state.mode})`) };
  cur.openFile = async (f) => log.push(`current tab: ${f}`);
  const ws = {
    activeLeaf: null,
    getMostRecentLeaf: () => cur,
    getLeaf: (how) => (log.push(`getLeaf ${how}`), fresh),
    setActiveLeaf: (leaf, o) => ((ws.activeLeaf = leaf), log.push(`active${o && o.focus ? ' + focus' : ''}`)),
  };
  return { app: { workspace: ws }, log, fresh };
}

// bug: New note from the (pinned) dashboard opened elsewhere and focus went to the next tab
test('a new note gets its own tab next to a pinned dashboard, and the focus', async () => {
  const w = workspace({ pinned: true, view: { getViewType: () => 'neon-deck-dashboard' } });
  const leaf = await openNewNote(w.app, 'A.md');
  assert.equal(leaf, w.fresh);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(w.log, ['getLeaf tab', 'new tab: A.md (source)', 'active + focus', 'focus']);
});

test('a new note doesn’t replace the note being read', async () => {
  const w = workspace({ pinned: false, view: { getViewType: () => 'markdown' } });
  assert.equal(await openNewNote(w.app, 'B.md'), w.fresh);
  assert.equal(w.log[0], 'getLeaf tab');
});

test('an empty tab is used for the new note', async () => {
  const cur = { pinned: false, view: { getViewType: () => 'empty' } };
  const w = workspace(cur);
  assert.equal(await openNewNote(w.app, 'C.md'), cur);
  assert.equal(w.log[0], 'current tab: C.md');
});
