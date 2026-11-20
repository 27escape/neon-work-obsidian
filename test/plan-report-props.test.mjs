import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const R = load('neon-tickets', ['planReportProps', 'planYamlScalar', 'planReportText']);
const P = (o) => R.planReportProps({ groupProps: ['customer'], copy: 'cssclasses', ...o });

test('report properties: the group from the folder, written like the vault (customer: e2i)', () => {
  assert.deepEqual([...P({ fm: { title: 'Pilot', tags: ['project'], status: 'inprogress' }, groupKey: 'e2i' })], ['customer: e2i']);
  assert.deepEqual([...P({ fm: {}, groupKey: 'sheffield city council' })], ['customer: sheffield city council']);
  assert.deepEqual([...P({ fm: {}, groupKey: '' })], []);
});

test('report properties: the group as the note writes it wins, under its own property name', () => {
  assert.deepEqual([...P({ fm: { customer: '[[SYMCA]]' }, groupKey: 'e2i' })], ['customer: "[[SYMCA]]"']);
  assert.deepEqual([...R.planReportProps({ groupProps: ['area', 'parent'], fm: { parent: ['[[Work]]', 'x'] }, groupKey: 'work' })], ['parent:', '  - "[[Work]]"', '  - x']);
  assert.deepEqual([...R.planReportProps({ groupProps: ['area'], fm: {}, groupKey: 'work' })], ['area: work']);
});

test('report properties: listed properties are copied; tags, aliases, status and dates never are', () => {
  const fm = { cssclasses: ['wideTable'], Owner: 'Kevin', tags: ['project'], aliases: ['Pilot'], status: 'inprogress', started: '2026-11-16', due: '2027-02-17', completed: null, claude: 'refine', 'plan-scheduled': true };
  const out = [...P({ fm, groupKey: 'e2i', copy: 'cssclasses, owner, tags, aliases, status, started, due, claude, plan-scheduled, missing, customer' })];
  assert.deepEqual(out, ['customer: e2i', 'cssclasses:', '  - wideTable', 'Owner: Kevin']);
});

test('report properties: values that need quoting are quoted', () => {
  assert.equal(R.planYamlScalar('e2i'), 'e2i');
  assert.equal(R.planYamlScalar('a: b'), '"a: b"');
  assert.equal(R.planYamlScalar('yes'), '"yes"');
  assert.equal(R.planYamlScalar('#tag'), '"#tag"');
  assert.equal(R.planYamlScalar(3), '3');
});

test('report text: the extra properties sit inside the front matter', () => {
  const md = R.planReportText({ title: 'Pilot', note: 'Pilot', today: '2026-11-19', props: ['customer: e2i'], phases: [], attention: [], marks: [], crit: [], load: [], people: [], details: '' });
  const fm = md.split('\n---\n')[0];
  assert.ok(fm.includes('\ncustomer: e2i'), md);
  assert.ok(fm.includes('  - plan-report'), md);
});
