// Fork: the "no category yet" check must not depend on the removed backupPath setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const T = load('neon-tasks', ['NeonTasks', 'TFile', 'TASKS_DEFAULTS']);

test('needsCategory works without a backupPath setting', () => {
  const f = Object.assign(Object.create(T.TFile.prototype), { path: 'Notes/New.md', extension: 'md', stat: { ctime: Date.now() } });
  const self = Object.create(T.NeonTasks.prototype);
  // a strict normalizePath, like Obsidian's: it fails on undefined
  self.app = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, vault: { getAbstractFileByPath: () => null, configDir: '.obsidian', adapter: { read: () => Promise.reject(new Error('none')) } } };
  self.settings = { ...T.TASKS_DEFAULTS, installedAt: 0 };
  assert.equal('backupPath' in self.settings, false);
  self.isSystemPath = () => false;
  self.quickPath = () => '2.Resources/Todo.md';
  assert.doesNotThrow(() => self.needsCategory(f));
});
