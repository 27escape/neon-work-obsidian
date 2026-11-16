// Fork: inbox capture names and bodies; Templater basics in templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const I = load('neon-deck', ['inboxName', 'inboxBody', 'inboxProps', 'applyTemplate']);
const now = { format: (f) => (f === 'YYYY-MM-DD HHmm' ? '2026-11-13 1015' : '2026-11-13') };

test('inbox note name: first line, cleaned and shortened', () => {
  assert.equal(I.inboxName('\n  # Look at [[Local AI]] costs\nmore detail', now), 'Look at Local AI costs');
  assert.equal(I.inboxName('   ', now), 'Inbox 2026-11-13 1015');
  assert.equal(I.inboxName('x'.repeat(100), now).length, 60);
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
