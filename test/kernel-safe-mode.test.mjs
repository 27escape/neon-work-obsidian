// Fork: safe mode and the start-up check are per device (local storage), never in the synced modules.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const o = JSON.parse(fs.readFileSync(new URL('../tools/files.json', import.meta.url), 'utf8'));
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const notices = [];
class Component {
  register() {}
  registerEvent() {}
  registerDomEvent() {}
  addChild() {}
}
class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  addSettingTab() {}
  addCommand() {}
  registerObsidianProtocolHandler() {}
}
class Stub {}
const obsidian = new Proxy(
  { Plugin, Component, Notice: class { constructor(m) { notices.push(m); } }, moment: () => ({ format: () => '16 Nov 10:00' }), normalizePath: (p) => p, debounce: (f) => f, getAllTags: () => [], Platform: {} },
  { get: (t, k) => (k in t ? t[k] : Stub) },
);
const code = [...o.shared, ...o.kernel].map(src).join('\n') + '\n;const NEON_MODULES = [];\n;({ NeonMother })';
const { NeonMother } = vm.runInNewContext(code, { require: (r) => (r === 'obsidian' ? obsidian : {}), module: {}, window: { setTimeout: () => 0, clearTimeout() {} }, document: {}, console });

function device(files) {
  const local = new Map();
  const timers = [];
  const app = {
    vault: { adapter: { read: async (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); }, write: async (p, t) => files.set(p, t), exists: async (p) => files.has(p), mkdir: async () => {} }, configDir: '.obsidian', getName: () => 'V', on() {}, getMarkdownFiles: () => [] },
    metadataCache: { on() {}, offref() {} },
    fileManager: {},
    workspace: { onLayoutReady: (f) => timers.push(f) },
    loadLocalStorage: (k) => (local.has(k) ? local.get(k) : null),
    saveLocalStorage: (k, v) => (v == null ? local.delete(k) : local.set(k, v)),
  };
  files.set('.obsidian/community-plugins.json', '["neon-work"]');
  return { app, local, start: async (finish) => {
    const p = new NeonMother(app, { id: 'neon-work', name: 'Neon Work', dir: '.obsidian/plugins/neon-work' });
    await p.onload();
    if (finish) p.startDone();
    return p;
  } };
}

test('a normal start leaves no flag and does not write modules.json', async () => {
  const files = new Map([['.obsidian/plugins/neon-work/modules.json', JSON.stringify({ off: {}, readOnly: false, baseFolder: 'x' })]]);
  const before = files.get('.obsidian/plugins/neon-work/modules.json');
  const d = device(files);
  const p = await d.start(true);
  assert.equal(p.safeMode(), false);
  assert.equal(d.local.get('neon-work-unfinished-starts'), 0);
  assert.equal(files.get('.obsidian/plugins/neon-work/modules.json'), before);
});

test('a synced starting:true / safe:true from another device is ignored', async () => {
  const files = new Map([['.obsidian/plugins/neon-work/modules.json', JSON.stringify({ off: {}, starting: true, safe: true, readOnly: false, baseFolder: 'x' })]]);
  const d = device(files);
  const p = await d.start(true);
  assert.equal(p.safeMode(), false);
  await p.writeState();
  const saved = JSON.parse(files.get('.obsidian/plugins/neon-work/modules.json'));
  assert.equal('starting' in saved, false);
  assert.equal('safe' in saved, false);
});

test('one unfinished start is forgiven; two in a row turn on safe mode on this device only', async () => {
  const files = new Map([['.obsidian/plugins/neon-work/modules.json', JSON.stringify({ off: {}, baseFolder: 'x' })]]);
  const phone = device(files);
  await phone.start(false); // app closed before the start finished
  const second = await phone.start(false);
  assert.equal(second.safeMode(), false);
  assert.match(String(second.local('stoppedAt')), /^starting \(/); // where the unfinished start got to
  notices.length = 0;
  const third = await phone.start(false);
  assert.equal(third.safeMode(), true);
  assert.match(notices.join(' '), /twice in a row on this device/);
  assert.match(notices.join(' '), /It stopped during: starting/);
  const laptop = device(files); // same synced files, its own local storage
  assert.equal((await laptop.start(true)).safeMode(), false);
  await third.setSafe(false);
  assert.equal(third.safeMode(), false);
  assert.equal(phone.local.get('neon-work-unfinished-starts'), 0);
});

// bug: after switching the plugin off and on, tabs stayed as Obsidian's placeholder ("neon-deck-cards", ghost icon)
test('views: placeholder tabs of a module are rebuilt once it has started; deferred ones saved under a placeholder title are loaded', () => {
  const p = Object.create(NeonMother.prototype);
  const registered = [];
  const child = { registerView(type, make) { registered.push([type, make]); } };
  const types = new Set();
  p.hookViews(child, types);
  child.registerView('neon-deck-cards', () => ({ kind: 'cards' }));
  assert.deepEqual([...types], ['neon-deck-cards']);
  assert.equal(registered[0][1]({}).neonView, true); // views it builds are marked
  const rebuilt = [];
  const loaded = [];
  const leaf = (type, view, deferred) => ({ isDeferred: deferred, view, getViewState: () => ({ type }), rebuildView: async () => rebuilt.push(type), loadIfDeferred: async () => loaded.push(`${type} ${view.getDisplayText()}`) });
  const saved = (title, icon = 'briefcase') => ({ getDisplayText: () => title, getIcon: () => icon });
  const leaves = [
    leaf('neon-deck-cards', { placeholder: true }), // loaded, but Obsidian's placeholder: rebuilt
    leaf('neon-deck-cards', { neonView: true }), // already ours
    leaf('neon-deck-cards', saved('Cards'), true), // deferred with its real name: left deferred
    leaf('neon-deck-cards', saved('neon-deck-cards', 'lucide-ghost'), true), // deferred, saved as the placeholder: loaded
    leaf('neon-deck-cards', saved(''), true), // deferred without a title: loaded
    leaf('markdown', {}),
  ];
  p.app = { workspace: { iterateAllLeaves: (f) => leaves.forEach(f) } };
  assert.equal(p.reviveViews(types), 3);
  assert.deepEqual(rebuilt, ['neon-deck-cards']);
  assert.deepEqual(loaded, ['neon-deck-cards neon-deck-cards', 'neon-deck-cards ']);
  assert.equal(p.reviveViews(new Set()), 0);
});
