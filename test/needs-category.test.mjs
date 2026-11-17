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

// Kevin: not every note needs a category, least of all with customer folders
test('no "No category yet" reminder with customer folders', () => {
  const T2 = load('neon-tasks', ['NeonTasks', 'TFile', 'TASKS_DEFAULTS', 'NEON_CATS']);
  const f = Object.assign(Object.create(T2.TFile.prototype), { path: '2.Resources/Loose.md', extension: 'md', stat: { ctime: Date.now() } });
  const self = Object.create(T2.NeonTasks.prototype);
  self.app = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) }, vault: { getAbstractFileByPath: () => null, configDir: '.obsidian', adapter: { read: () => Promise.reject(new Error('none')) } } };
  self.settings = { ...T2.TASKS_DEFAULTS, installedAt: 0 };
  self.isSystemPath = () => false;
  self.quickPath = () => 'Todo.md';
  T2.NEON_CATS.customers = false;
  assert.equal(self.needsCategory(f), true);
  T2.NEON_CATS.customers = true;
  assert.equal(self.needsCategory(f), false);
  assert.equal(T2.TASKS_DEFAULTS.showNoCategoryBar, false);
});
