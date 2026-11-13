// Fork: inbox capture names and bodies; Templater basics in templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const I = load('neon-deck', ['inboxName', 'inboxBody', 'applyTemplate']);
const now = { format: (f) => (f === 'YYYY-MM-DD HHmm' ? '2026-11-13 1015' : '2026-11-13') };

test('inbox note name: first line, cleaned and shortened', () => {
  assert.equal(I.inboxName('\n  # Look at [[Local AI]] costs\nmore detail', now), 'Look at Local AI costs');
  assert.equal(I.inboxName('   ', now), 'Inbox 2026-11-13 1015');
  assert.equal(I.inboxName('x'.repeat(100), now).length, 60);
});

test('inbox body and Templater basics', () => {
  assert.equal(I.inboxBody('Idea', ' text ', '2026-11-13'), '---\ntitle: "Idea"\ntags:\n  - inbox\nstatus: created\ncreated: 2026-11-13\n---\n\ntext\n');
  const m = { format: () => '2026-01-01' };
  assert.equal(I.applyTemplate('# <% tp.file.title %> · <% tp.date.now("YYYY-WW") %> · {{title}}', m, 'Idea'), '# Idea · 2026-01-01 · Idea');
});
