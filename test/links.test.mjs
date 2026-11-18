import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { load } from './load.mjs';

// the kernel's link helpers (src/kernel/links.js), loaded with the shared files as the kernel test does
const o = JSON.parse(fs.readFileSync(new URL('../tools/files.json', import.meta.url), 'utf8'));
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
class Stub {}
const obsidian = new Proxy({ moment: () => ({}), normalizePath: (p) => p, debounce: (f) => f, getAllTags: () => [], Platform: {} }, { get: (t, k) => (k in t ? t[k] : Stub) });
const code = [...o.shared, ...o.kernel].map(src).join('\n') + '\n;({ neonLinkFor, neonLinkParams })';
const L = vm.runInNewContext(code, { require: (r) => (r === 'obsidian' ? obsidian : {}), module: {}, window: { setTimeout: () => 0, clearTimeout() {} }, document: {}, console });

test('links to tabs: from a tab, and what a link asks for', () => {
  assert.equal(L.neonLinkFor('neon-deck-tickets'), 'obsidian://neon-work?open=projects');
  assert.equal(L.neonLinkFor('neon-research'), 'obsidian://neon-work?open=research');
  assert.equal(L.neonLinkFor('neon-plan', { path: '1.Customers/E2I/Projects/Pilot - Local AI.md', mode: 'board' }), 'obsidian://neon-work?open=planning&project=1.Customers%2FE2I%2FProjects%2FPilot%20-%20Local%20AI.md&mode=board');
  assert.equal(L.neonLinkFor('neon-plan', { path: 'P.md', mode: 'gantt' }), 'obsidian://neon-work?open=planning&project=P.md');
  assert.equal(L.neonLinkFor('neon-plan', {}), ''); // a Planning tab without a project
  assert.equal(L.neonLinkFor('markdown'), '');
  const p = (x) => JSON.parse(JSON.stringify(L.neonLinkParams(x)));
  assert.deepEqual(p({ open: 'Projects' }), { name: 'projects', tab: ['neon-tickets', 'neon-deck-tickets'], project: '', mode: 'gantt' });
  assert.deepEqual(p({ open: 'planning', project: 'Pilot - Local AI', mode: 'list' }), { name: 'planning', tab: ['neon-tickets', 'neon-plan'], project: 'Pilot - Local AI', mode: 'list' });
  assert.equal(p({}).name, 'dashboard');
  assert.equal(p({ open: 'nothing' }).tab, null);
  assert.equal(p({ open: 'planning', mode: 'x' }).mode, 'gantt');
});

test('page preview on hover: the row’s tab is the source', () => {
  const { hoverPreview } = load('neon-tickets', ['hoverPreview']);
  const handlers = {};
  const el = { addEventListener: (k, f) => (handlers[k] = f) };
  const view = { containerEl: { contains: (x) => x === el }, getViewType: () => 'neon-deck-tickets' };
  const fired = [];
  const app = { workspace: { iterateAllLeaves: (f) => [{ view: { containerEl: { contains: () => false } } }, { view }].forEach(f), trigger: (name, info) => fired.push([name, info]) } };
  hoverPreview(app, el, { path: 'P.md' }, 12);
  handlers.mouseover({ type: 'mouseover' });
  assert.equal(fired.length, 1);
  assert.equal(fired[0][0], 'hover-link');
  assert.equal(fired[0][1].source, 'neon-deck-tickets');
  assert.equal(fired[0][1].hoverParent, view);
  assert.equal(fired[0][1].linktext, 'P.md');
  assert.equal(fired[0][1].state.scroll, 12);
});

test('note graph: folders starting with "_" are left out', () => {
  const { graphHiddenPath } = load('neon-deck', ['graphHiddenPath']);
  assert.equal(graphHiddenPath('2.Resources/ToolPages/_claude/scripts/notes.md', false), true);
  assert.equal(graphHiddenPath('_claude/x.md', false), true);
  assert.equal(graphHiddenPath('1.Customers/E2I/Pilot.md', false), false);
  assert.equal(graphHiddenPath('Notes/_draft.md', false), false); // a note's own name doesn't count, only folders
  assert.equal(graphHiddenPath('2.Resources/_claude', true), true);
  assert.equal(graphHiddenPath('2.Resources', true), false);
});
