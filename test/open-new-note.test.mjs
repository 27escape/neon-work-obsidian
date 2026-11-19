import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { openNewNote, openInTab, reusableLeaf } = load('neon-tasks', ['openNewNote', 'openInTab', 'reusableLeaf']);

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

/** A workspace for openInTab: the root tabs, and what happens. */
function tabs(open) {
  const log = [];
  const fresh = { view: {}, openFile: async (f, o) => log.push(`new tab: ${f}${o && o.active ? ' (active)' : ''}`) };
  const ws = {
    iterateRootLeaves: (cb) => open.forEach(cb),
    getLeaf: (how) => (log.push(`getLeaf ${how}`), fresh),
    setActiveLeaf: (leaf, o) => log.push(`active${o && o.focus ? ' + focus' : ''}`),
    revealLeaf: async () => log.push('reveal'),
  };
  return { app: { workspace: ws }, log, fresh };
}

// bug: the Planning report opened in a tab behind the Planning view
test('a report opens in a new tab, in front', async () => {
  const w = tabs([{ view: { file: 'Other.md' } }]);
  assert.equal(await openInTab(w.app, 'Report.md'), w.fresh);
  assert.deepEqual(w.log, ['getLeaf tab', 'new tab: Report.md (active)', 'active + focus', 'reveal']);
});

test('a report already open in a tab is brought to the front, not opened twice', async () => {
  const mine = { view: { file: 'Report.md' } };
  const w = tabs([{ view: { file: 'Other.md' } }, mine]);
  assert.equal(await openInTab(w.app, 'Report.md'), mine);
  assert.deepEqual(w.log, ['active + focus', 'reveal']);
});

// bug: with the Planning tab in front, a note opened from the sidebar replaced it (with a Back button)
test('a note opened from the sidebar never replaces the Planning tab', () => {
  const leaf = (type, nav, activeTime, pinned = false) => ({ pinned, activeTime, view: { navigation: nav, getViewType: () => type } });
  const plan = leaf('neon-plan', false, 30);
  const note = leaf('markdown', true, 20);
  const dash = leaf('neon-deck-dashboard', true, 10, true);
  const ws = (recent, all) => ({ app: { workspace: { getMostRecentLeaf: () => recent, iterateRootLeaves: (cb) => all.forEach(cb), getLeaf: () => 'new tab' } } });
  assert.equal(reusableLeaf(ws(plan, [plan, note, dash]).app), note); // the note's tab takes its turn
  assert.equal(reusableLeaf(ws(plan, [plan, dash]).app), 'new tab'); // nothing else to use: a new tab
  assert.equal(reusableLeaf(ws(note, [plan, note]).app), note);
  const empty = leaf('empty', false, 5);
  assert.equal(reusableLeaf(ws(empty, [plan, empty]).app), empty);
});
