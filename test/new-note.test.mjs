// Fork: New note files notes by customer and kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const N = load('neon-tasks', ['newNotePath', 'newNoteFrontmatter', 'TASKS_DEFAULTS']);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('folders by customer and kind', () => {
  const s = { ...N.TASKS_DEFAULTS, noCustomerFolder: '2.Resources' };
  assert.deepEqual(plain(N.newNotePath(s, '1.Customers', 'SYMCA', 'meeting', '2026-11-13 Kick-off')), { folder: '1.Customers/SYMCA/Meetings', file: '2026-11-13 Kick-off' });
  assert.deepEqual(plain(N.newNotePath(s, '1.Customers', 'E2I', 'person', 'Andrew Rogers')), { folder: '1.Customers/E2I/People', file: '@Andrew Rogers' });
  assert.deepEqual(plain(N.newNotePath(s, '1.Customers', 'E2I', 'note', 'Idea')), { folder: '1.Customers/E2I', file: 'Idea' });
  assert.deepEqual(plain(N.newNotePath(s, '1.Customers', '', 'research', 'TOGAF')), { folder: '2.Resources', file: 'TOGAF' });
  assert.deepEqual(plain(N.newNotePath({ ...s, noCustomerFolder: '' }, '1.Customers', '', 'note', 'x')), { folder: '/', file: 'x' });
});

test('standard properties: person aliases, customer, kind tag', () => {
  assert.equal(
    N.newNoteFrontmatter('person', '@Andrew Rogers', '2026-11-13', 'E2I'),
    '---\ntitle: "@Andrew Rogers"\ncreated: 2026-11-13\nmodified: 2026-11-13\naliases:\n  - "Andrew Rogers"\n  - "Andrew"\ncustomer: "e2i"\ntags:\n  - person\n---\n',
  );
  assert.equal(N.newNoteFrontmatter('note', 'Idea', '2026-11-13', ''), '---\ntitle: "Idea"\ncreated: 2026-11-13\nmodified: 2026-11-13\n---\n');
});
