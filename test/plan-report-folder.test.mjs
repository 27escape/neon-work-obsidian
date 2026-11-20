import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const R = load('neon-tickets', ['planReportFolder', 'planReportSubName', 'NEON_BASE']);
R.NEON_BASE.folder = '2.Resources';
const note = (path) => ({ kind: 'note', path });

test('report folder: the reports folder by default, or when set', () => {
  assert.equal(R.planReportFolder({ scope: note('1.Customers/E2I/Projects/Pilot.md') }), '2.Resources/Reports');
  assert.equal(R.planReportFolder({ where: 'folder', folder: 'Out/Plans', scope: note('1.Customers/E2I/Projects/Pilot.md') }), 'Out/Plans');
});

test('report folder: next to a project note, or inside a project folder', () => {
  assert.equal(R.planReportFolder({ where: 'project', scope: note('1.Customers/E2I/Projects/Pilot - Local AI.md') }), '1.Customers/E2I/Projects/Reports');
  assert.equal(R.planReportFolder({ where: 'project', sub: 'Plan reports', scope: note('1.Customers/SCC/Projects/Portal.md') }), '1.Customers/SCC/Projects/Plan reports');
  assert.equal(R.planReportFolder({ where: 'project', scope: { kind: 'folder', path: '1.Projects/Website' }, projectFolders: '1.Projects' }), '1.Projects/Website/Reports');
});

test('report folder: falls back to the reports folder where next to the project would be wrong', () => {
  assert.equal(R.planReportFolder({ where: 'project', scope: note('Pilot.md') }), '2.Resources/Reports'); // vault root
  // a tagged note directly in the Project folders root: a Reports folder there would count as a project folder
  assert.equal(R.planReportFolder({ where: 'project', scope: note('1.Projects/Loose.md'), projectFolders: '1.Projects' }), '2.Resources/Reports');
  assert.equal(R.planReportFolder({ where: 'project', scope: note('Core/Projects/X.md') }), '2.Resources/Reports'); // never write Core
  assert.equal(R.planReportFolder({ where: 'project', scope: note('Neon/Projects/X.md') }), '2.Resources/Reports'); // nor Neon/
  assert.equal(R.planReportFolder({ where: 'project', scope: null, folder: 'R' }), 'R');
});

test('report folder name next to a project: one plain folder name', () => {
  assert.equal(R.planReportSubName(''), 'Reports');
  assert.equal(R.planReportSubName('  '), 'Reports');
  assert.equal(R.planReportSubName('a/b'), 'a b');
  assert.equal(R.planReportSubName('..'), 'Reports');
  assert.equal(R.planReportSubName('Plan reports'), 'Plan reports');
});
