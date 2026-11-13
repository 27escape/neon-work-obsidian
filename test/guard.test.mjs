// Fork: the read-only guard (src/shared/guard.js) must stop every vault write while it is on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const fakeApp = (log) => {
  const rec = (name) => async (...a) => (log.push([name, a[0] && a[0].path ? a[0].path : a[0]]), 'ok');
  return {
    workspace: { getLeavesOfType: () => [] },
    vault: {
      configDir: '.obsidian',
      getMarkdownFiles: () => ['a.md'],
      create: rec('create'), createBinary: rec('createBinary'), createFolder: rec('createFolder'), modify: rec('modify'),
      process: rec('process'), append: rec('append'), delete: rec('delete'), trash: rec('trash'), rename: rec('rename'), copy: rec('copy'),
      adapter: { write: rec('a.write'), mkdir: rec('a.mkdir'), remove: rec('a.remove'), rename: rec('a.rename'), read: async () => 'text' },
    },
    fileManager: { renameFile: rec('renameFile'), processFrontMatter: rec('processFrontMatter'), trashFile: rec('trashFile') },
  };
};

test('read-only guard blocks every vault, fileManager and adapter write', async () => {
  const { guardApp, NEON_GUARD, writeNote } = load('neon-deck', ['guardApp', 'NEON_GUARD', 'writeNote']);
  NEON_GUARD.readOnly = true;
  NEON_GUARD.allowDir = '.obsidian/plugins/neon-work';
  NEON_GUARD.lastNotice = Date.now(); // no Notice in the sandbox
  const log = [];
  const app = guardApp(fakeApp(log));
  const f = { path: 'Notes/a.md' };
  const writes = [
    () => app.vault.create('x.md', ''), () => app.vault.createBinary('x.png', null), () => app.vault.createFolder('Core'),
    () => app.vault.modify(f, ''), () => app.vault.process(f, (t) => t), () => app.vault.append(f, 'x'),
    () => app.vault.delete(f), () => app.vault.trash(f, true), () => app.vault.rename(f, 'b.md'), () => app.vault.copy(f, 'c.md'),
    () => app.fileManager.renameFile(f, 'Core/a.md'), () => app.fileManager.processFrontMatter(f, () => {}), () => app.fileManager.trashFile(f),
    () => app.vault.adapter.write('Notes/a.md', 'x'), () => app.vault.adapter.mkdir('Core'), () => app.vault.adapter.remove('Notes/a.md'),
    () => app.vault.adapter.rename('.obsidian/plugins/neon-work/data.json', 'Notes/x.md'),
    () => writeNote(app, f, () => 'changed'),
  ];
  for (const w of writes) await assert.rejects(w(), (e) => e.neonReadOnly === true);
  assert.deepEqual(log, [], 'nothing reached the real vault');
  // reads and the plugin's own settings still work
  assert.deepEqual(app.vault.getMarkdownFiles(), ['a.md']);
  assert.equal(await app.vault.adapter.read('Notes/a.md'), 'text');
  await app.vault.adapter.write('.obsidian/plugins/neon-work/tasks/data.json', '{}');
  assert.deepEqual(log, [['a.write', '.obsidian/plugins/neon-work/tasks/data.json']]);
  // a look-alike folder name is not the plugin's folder
  await assert.rejects(app.vault.adapter.write('.obsidian/plugins/neon-work-evil/data.json', '{}'));
});

test('with read-only off, writes go through to the vault', async () => {
  const { guardApp, NEON_GUARD } = load('neon-deck', ['guardApp', 'NEON_GUARD']);
  NEON_GUARD.readOnly = false;
  const log = [];
  const app = guardApp(fakeApp(log));
  await app.vault.create('x.md', '');
  await app.fileManager.processFrontMatter({ path: 'a.md' }, () => {});
  assert.deepEqual(log, [['create', 'x.md'], ['processFrontMatter', 'a.md']]);
});
