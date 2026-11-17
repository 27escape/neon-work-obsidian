import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const R = load('neon-tickets', ['planReportDetails', 'planReportLine', 'planReportPeople', 'planTask']);

const NOTE = [
  '---', 'title: Pilot', 'claude: refine', '---',
  '> [!refine] do something', '> more instructions', '',
  '## Pilot', '', 'Intro, see [[#Research]] and [[Other note#Part]]. %% private %%', '',
  '## 1. Scope', '',
  '- [ ] Outline scope [duration:: 3d] [owner:: [[@Sam Taylor|Sam]], Alex] 🆔 p-1 🛫 2026-12-01 📅 2026-12-05 #task #decision',
  '\t- [x] A step ✅ 2026-11-20', '\t\t- [?] an assumption', '',
  '```', '## not a heading', '- [ ] code, untouched', '```', '',
  '## 2. Build', '', '%%', 'hidden', '%%',
  '- [ ] Set up the server [duration:: 6d] 🆔 p-2 ⛔ p-1 #task', '\t- (x) a non-task step', '',
  '### Notes on build', 'kept: inside the last task section', '',
  '## Research', '', 'Left out.', '- ( ) for later',
].join('\n');

test('report details: the note up to the end of the last task section, cleaned for readers', () => {
  const out = R.planReportDetails(NOTE, { note: 'Pilot', lastLine: NOTE.split('\n').findIndex((l) => l.includes('p-2 ⛔')), taskTags: '#task' });
  const has = (s) => assert.ok(out.includes(s), `missing: ${s}\n---\n${out}`);
  const not = (s) => assert.ok(!out.includes(s), `should be gone: ${s}\n---\n${out}`);
  has('### Pilot');
  has('Intro, see [[Pilot#Research]] and [[Other note#Part]].');
  has('### 1. Scope');
  has('- ☐ Outline scope 📅 5 Dec #decision (Sam, Alex)');
  has('\t- ☑ A step ✅ 20 Nov');
  has('\t\t- ❓ an assumption');
  has('```\n## not a heading\n- [ ] code, untouched\n```'); // code blocks as written
  has('- ☐ Set up the server');
  has('\t- ☑ a non-task step');
  has('#### Notes on build');
  for (const s of ['title: Pilot', '[!refine]', 'more instructions', 'private', 'hidden', '🆔', '⛔', 'duration::', 'owner::', '🛫', '#task', 'Left out', 'for later', '### Research']) not(s);
});

test('report details: without a task line the whole note is kept', () => {
  const out = R.planReportDetails('---\na: 1\n---\n## One\ntext\n## Two\nmore', { note: 'N', lastLine: -1 });
  assert.equal(out, '### One\ntext\n### Two\nmore');
});

test('report people: owners with open and done tasks, days of open work and phases', () => {
  const t = (raw, phase, extra = {}) => Object.assign(R.planTask(raw, { phase }), extra);
  const tasks = [
    t('- [ ] A [duration:: 3d] [owner:: [[@Sam Taylor|Sam]]] #task', '1. Scope'),
    t('- [x] B [duration:: 2d] [owner:: [[@Sam Taylor|Sam]], Alex] #task', '2. Build'),
    t('- [ ] C [owner:: alex] #task', '2. Build'),
    t('- [ ] D [owner:: Pat] #task', '9. Other', { external: true }),
  ];
  const people = JSON.parse(JSON.stringify(R.planReportPeople(tasks))); // from the sandbox: compare as plain data
  assert.deepEqual(people, [
    { key: 'sam taylor', name: 'Sam', open: 1, done: 1, days: 3, phases: ['1. Scope', '2. Build'] },
    { key: 'alex', name: 'Alex', open: 1, done: 1, days: 1, phases: ['2. Build'] },
  ]);
});
