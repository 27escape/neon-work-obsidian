// Fork: New note files notes by group and type; the older per-kind settings become the types list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const N = load('neon-tasks', ['newNotePath', 'newNoteFrontmatter', 'noteTypesFrom', 'TASKS_DEFAULTS']);
const plain = (x) => JSON.parse(JSON.stringify(x));
const types = (s) => Object.fromEntries(N.noteTypesFrom(s).map((t) => [t.name.toLowerCase(), t]));

test('older settings become types; folders by customer and type are unchanged', () => {
  const s = { ...N.TASKS_DEFAULTS, noCustomerFolder: '2.Resources' };
  const T = types(s);
  assert.deepEqual(Object.keys(T), ['note', 'meeting', 'person', 'research']);
  assert.deepEqual(plain(N.newNotePath(T.meeting, '1.Customers', 'SYMCA', '2026-11-13 Kick-off', s.noCustomerFolder)), { folder: '1.Customers/SYMCA/Meetings', file: '2026-11-13 Kick-off' });
  assert.deepEqual(plain(N.newNotePath(T.person, '1.Customers', 'E2I', 'Andrew Rogers', s.noCustomerFolder)), { folder: '1.Customers/E2I/People', file: '@Andrew Rogers' });
  assert.deepEqual(plain(N.newNotePath(T.note, '1.Customers', 'E2I', 'Idea', s.noCustomerFolder)), { folder: '1.Customers/E2I', file: 'Idea' });
  assert.deepEqual(plain(N.newNotePath(T.research, '1.Customers', '', 'TOGAF', s.noCustomerFolder)), { folder: '2.Resources', file: 'TOGAF' });
  assert.deepEqual(plain(N.newNotePath(T.note, '1.Customers', '', 'x', '')), { folder: '/', file: 'x' });
  const custom = types({ ...s, meetingsFolder: 'Calls', personTemplate: 'tpl/person.md' });
  assert.equal(custom.meeting.folder, '{group}/Calls');
  assert.equal(custom.person.template, 'tpl/person.md');
});

test('PARA types: fixed folders ignore the group; {group} uses it', () => {
  const resource = { name: 'Resource', folder: '3.Resources', tag: 'resource' };
  const area = { name: 'Area note', folder: '{group}', tag: '' };
  assert.deepEqual(plain(N.newNotePath(resource, '2.Areas', 'Photography', 'Lens care', '3.Resources')), { folder: '3.Resources', file: 'Lens care' });
  assert.deepEqual(plain(N.newNotePath(area, '2.Areas', 'Photography', 'Lens care', '3.Resources')), { folder: '2.Areas/Photography', file: 'Lens care' });
  assert.deepEqual(plain(N.newNotePath({ name: 'Recipe', folder: '/2.Areas/Recipes/' }, '2.Areas', '', 'Dal', '')), { folder: '2.Areas/Recipes', file: 'Dal' });
});

test('standard properties: person aliases, group, type tag', () => {
  const T = types(N.TASKS_DEFAULTS);
  assert.equal(
    N.newNoteFrontmatter(T.person, '@Andrew Rogers', '2026-11-13', 'E2I'),
    '---\ntitle: "@Andrew Rogers"\ncreated: 2026-11-13\nmodified: 2026-11-13\naliases:\n  - "Andrew Rogers"\n  - "Andrew"\ncustomer: "e2i"\ntags:\n  - person\n---\n',
  );
  assert.equal(N.newNoteFrontmatter(T.note, 'Idea', '2026-11-13', ''), '---\ntitle: "Idea"\ncreated: 2026-11-13\nmodified: 2026-11-13\n---\n');
});
