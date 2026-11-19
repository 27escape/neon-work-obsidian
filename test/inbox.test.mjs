// Fork: inbox capture names and bodies; Templater basics in templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const I = load('neon-deck', ['inboxName', 'inboxHeadline', 'inboxLabel', 'inboxBody', 'inboxProps', 'applyTemplate']);
const now = { format: (f) => (f === 'YYYYMMDD_HHmmss' ? '20261113_101503' : '2026-11-13') };

test('inbox note name: the time it was captured; the text goes in the note', () => {
  assert.equal(I.inboxName(now), '20261113_101503');
  assert.equal(I.inboxHeadline('\n  # Look at [[Local AI|local AI]] costs\nmore detail'), 'Look at local AI costs');
  assert.equal(I.inboxHeadline('- [ ] ring [Steve](https://x.y)\n'), 'ring Steve');
  assert.equal(I.inboxHeadline('   '), '');
});

test('Inbox card label: title property, else the first line after the properties, else the file name', () => {
  const note = '---\ntags:\n  - inbox\nstatus: waiting\n---\n\n# Ideas for the pilot\nmore\n';
  assert.equal(I.inboxLabel(note, 'Given title', '20261113_101503'), 'Given title');
  assert.equal(I.inboxLabel(note, null, '20261113_101503'), 'Ideas for the pilot');
  assert.equal(I.inboxLabel('---\nstatus: waiting\n---\n', '', '20261113_101503'), '20261113_101503');
  assert.equal(I.inboxLabel('Just a line', undefined, 'x'), 'Just a line');
});

test('inbox body and Templater basics', () => {
  // the tag and status are added afterwards by inboxProps (so a template gets them too)
  assert.equal(I.inboxBody('Idea', ' text ', '2026-11-13'), '---\ntitle: "Idea"\ncreated: 2026-11-13\n---\n\ntext\n');
  const m = { format: () => '2026-01-01' };
  assert.equal(I.applyTemplate('# <% tp.file.title %> · <% tp.date.now("YYYY-WW") %> · {{title}}', m, 'Idea'), '# Idea · 2026-01-01 · Idea');
});

test('every inbox note gets the inbox tag and status, keeping its other tags', () => {
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(I.inboxProps({}, 'inbox', 'waiting')), { tags: ['inbox'], status: 'waiting' });
  assert.deepEqual(plain(I.inboxProps({ tags: ['idea'], status: 'created' }, '#inbox', 'waiting')), { tags: ['idea', 'inbox'], status: 'waiting' });
  assert.deepEqual(plain(I.inboxProps({ tags: 'idea, Inbox' }, 'inbox', 'waiting')), { tags: ['idea', 'Inbox'], status: 'waiting' });
  assert.deepEqual(plain(I.inboxProps({ tags: ['x'] }, '', '')), { tags: ['x'] });
});

test('inbox card: notes without a status, or with one not in the done list, are still open', () => {
  const J = load('neon-deck', ['inboxOpen', 'inboxList']);
  const done = J.inboxList('completed, Cancelled, stopped');
  assert.equal(J.inboxOpen(undefined, done), true);
  assert.equal(J.inboxOpen('waiting', done), true);
  assert.equal(J.inboxOpen('cancelled', done), false);
  assert.equal(J.inboxOpen(['Completed'], done), false);
  assert.equal(J.inboxOpen('', done), true);
});

test('dashboard grid: every card is one rectangle, whichever cards are missing', () => {
  const G = load('neon-deck', ['dashAreas']);
  const all = ['inbox', 'tasks', 'global', 'tickets', 'claude', 'activity', 'time', 'recent', 'pulse'];
  const combos = [all, all.filter((x) => x !== 'time'), all.filter((x) => x !== 'inbox'), all.filter((x) => !['inbox', 'tasks'].includes(x)), all.filter((x) => !['claude', 'time', 'tickets'].includes(x))];
  for (const present of combos) {
    const { areas } = G.dashAreas(new Set(present));
    const rows = areas.match(/"([^"]+)"/g).map((r) => r.slice(1, -1).split(' '));
    for (const name of new Set(rows.flat())) {
      const cells = [];
      rows.forEach((r, y) => r.forEach((n, x) => n === name && cells.push([x, y])));
      const xs = cells.map((c) => c[0]);
      const ys = cells.map((c) => c[1]);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      assert.equal(cells.length, w * h, `${name} is not a rectangle in ${areas}`);
    }
    assert.ok(rows.flat().every(Boolean), `empty cell in ${areas}`);
  }
  assert.match(G.dashAreas(new Set(all)).areas, /^"inbox tasks global tickets" "inbox tasks global tickets" "recent activity activity time" "claude pulse pulse time"$/);
});
