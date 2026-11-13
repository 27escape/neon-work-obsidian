// Fork: tickets are projects — your status values, customers from folders, properties-only status changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const P = load('neon-tickets', ['projectConfig', 'projectCustomer', 'projectTitle', 'projectStatusPatch', 'TICKETS_DEFAULTS', 'ticketGroups', 'normTicketStatus', 'NEON_PROJECTS', 'isTicketCache', 'isProjectCache']);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('status groups from the settings', () => {
  const cfg = P.projectConfig(P.TICKETS_DEFAULTS);
  assert.equal(cfg.tag, 'project');
  assert.deepEqual(plain(cfg.order), ['init', 'created', 'inprogress', 'ongoing', 'paused', 'blocked', 'completed', 'cancelled']);
  assert.equal(cfg.kinds.paused, 'waiting');
  assert.equal(cfg.kinds.cancelled, 'done');
  Object.assign(P.NEON_PROJECTS, cfg);
  assert.equal(P.normTicketStatus('Ongoing'), 'in-progress');
  assert.equal(P.normTicketStatus('blocked'), 'waiting');
  assert.equal(P.normTicketStatus('init'), 'open');
});

test('project notes are found by their tags property', () => {
  Object.assign(P.NEON_PROJECTS, P.projectConfig(P.TICKETS_DEFAULTS));
  assert.equal(P.isTicketCache({ frontmatter: { tags: ['project'] } }), true);
  assert.equal(P.isTicketCache({ frontmatter: { tags: 'research, project' } }), true);
  assert.equal(P.isProjectCache({ frontmatter: { tags: ['projects'] } }), false); // (isTicketCache would go on to #ticket tags)
  assert.equal(P.isTicketCache({ frontmatter: { type: 'ticket' } }), true);
});

test('customer: property first, else the customer folder', () => {
  assert.equal(P.projectCustomer('1.Customers/SYMCA/Projects/X.md', {}, '1.Customers'), 'SYMCA');
  assert.equal(P.projectCustomer('1.Customers/E2I/Projects/X.md', { customer: 'e2i' }, '1.Customers'), 'e2i');
  assert.equal(P.projectCustomer('2.Resources/X.md', {}, '1.Customers'), '');
  assert.equal(P.projectCustomer('1.Customers/loose.md', {}, '1.Customers'), '');
  assert.equal(P.projectTitle('Project : E2I as code factory'), 'E2I as code factory');
});

test('status changes write only the right properties', () => {
  const cfg = P.projectConfig(P.TICKETS_DEFAULTS);
  const done = P.projectStatusPatch('completed', 'in-progress', '2026-11-13', cfg);
  assert.equal(done.kind, 'done');
  assert.equal(done.patch.completed, '2026-11-13');
  assert.equal(done.patch.cancelled, null);
  const cancel = P.projectStatusPatch('cancelled', 'open', '2026-11-13', cfg);
  assert.equal(cancel.patch.cancelled, '2026-11-13');
  assert.equal(cancel.patch.completed, null);
  const reopen = P.projectStatusPatch('inprogress', 'done', '2026-11-13', cfg);
  assert.equal(reopen.kind, 'in-progress');
  assert.equal(reopen.patch.status, 'inprogress');
  assert.equal(reopen.patch.completed, null);
  const hold = P.projectStatusPatch('paused', 'in-progress', '2026-11-13', cfg);
  assert.equal('completed' in hold.patch, false);
});

test('group by customer: A–Z, no customer last, open before closed', () => {
  const tk = (title, customer, status) => ({ title, customer, status, started: true, priority: 'normal', bucket: 'nodate', due: null, created: { valueOf: () => 0 }, file: { stat: { mtime: 0 } } });
  const g = P.ticketGroups([tk('a', 'SYMCA', 'done'), tk('b', 'E2I', 'open'), tk('c', '', 'open'), tk('d', 'SYMCA', 'open')], 'customer');
  assert.deepEqual(plain(g.map(([k, l, items]) => [l, items.map((t) => t.title).join('')])), [['E2I', 'b'], ['SYMCA', 'da'], ['No customer', 'c']]);
});
