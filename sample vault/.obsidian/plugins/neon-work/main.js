'use strict';
/*
 * Neon Work — dashboard, tasks, projects, time, research and writing tools in one plugin.
 * Forked from Neon Deck 2.2.0, made by yobzz + Claude. Built from src/ by tools/build.mjs; each part starts with a "@src" line.
 * Neon Work: changes by Kevin Mulholland + Claude, https://github.com/27escape/neon-work-obsidian — see FORK.md.
 *
 * Everything runs locally: no network requests, no telemetry, no eval, no shell access,
 * no system notifications. Files are only written when you do something that writes.
 */
/* @src src/shared/shared.js */
/* ---- shared helpers (same copy in every Neon plugin) ---------------- */
const obsidian = require('obsidian');
const {
  Plugin, ItemView, FileView, Modal, SuggestModal, Notice, Menu, TFile, TFolder,
  PluginSettingTab, Setting, setIcon, normalizePath, moment, debounce, getAllTags,
} = obsidian;

/* fork: phones and tablets. Obsidian decides the platform at start-up (app.emulateMobile(true) restarts the app as
 * a phone). Time tracking and Write stay desktop-only; the Graph and Card explorer are hidden there. */
const NEON_MOBILE = (() => {
  const P = (obsidian && obsidian.Platform) || {};
  return { on: !!P.isMobile, phone: !!P.isPhone, tablet: !!P.isTablet };
})();
const DESKTOP_ONLY_MODULES = new Set(['neon-time', 'neon-write']);
/** A desktop-only view opened on a phone (e.g. restored from an older layout): a line instead of the view. */
function mobileOnlyNote(el, what) {
  el.empty();
  el.createDiv({ cls: 'nd-empty', text: `${what} is only on the desktop. Close this tab.` });
}

const ND_VERSION = '1.5.7'; // set from the manifest by tools/build.mjs
// Categories colour notes and split tracked time. Upstream: four fixed ones (UPSTREAM_CATS).
// fork: your customers instead — one per folder in the customers folder (1.Customers), keyed in lower case;
// a note's category is its customer property, else the customer folder it is in. CATS, CAT_LABEL and
// CAT_SHORT are filled in place by refreshCategories(); with no customers folder the upstream four stay.
const UPSTREAM_CATS = ['projects', 'school', 'admin', 'operations'];
const CATS = UPSTREAM_CATS.slice();
/** Old category names still read from notes and saved data. */
const CAT_ALIAS = { ops: 'operations' };
const normCat = (c) => (c == null ? c : CAT_ALIAS[String(c).toLowerCase()] || String(c).toLowerCase());
const CAT_LABEL = { projects: 'Projects', school: 'School', admin: 'Admin', operations: 'Operations', other: 'Other', untracked: 'Untracked' };
const CAT_SHORT = { projects: 'Proj', school: 'School', admin: 'Admin', operations: 'Operations' };
const CAT_FALLBACK = ['#c6e651', '#e5506a', '#7fb3c9', '#d9c56a', '#e4e6ea', '#b9a0d6', '#5fcf96', '#e08a5a', '#8f86b8', '#8f95a0'];
const NEON_CATS = { customers: false, customersFolder: '1.Customers', label: 'Customer', prop: 'customer', skip: [] }; // skip: folders in the groups folder that aren't groups // fork: label and property can be renamed (e.g. Area / area for a PARA vault)
/** The group's name for the UI: groupWord() "Customer", groupWord(true) "Customers", groupWord(false, true) "customer". */
function groupWord(plural = false, lower = false) {
  let w = String(NEON_CATS.label || 'Customer').trim() || 'Customer';
  if (plural && !/s$/i.test(w)) w = /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`;
  return lower ? w.toLowerCase() : w;
}
/** A category's colour: the theme's four category colours first, then the theme palette. */
function catColor(c) {
  const i = CATS.indexOf(c);
  if (i < 0) return 'var(--nd-cat-other)';
  if (!NEON_CATS.customers) return `var(--nd-cat-${c})`;
  if (i < UPSTREAM_CATS.length) return `var(--nd-cat-${UPSTREAM_CATS[i]})`;
  const k = (i - UPSTREAM_CATS.length) % CAT_FALLBACK.length;
  return `var(--nd-c${k + 1}, ${CAT_FALLBACK[k]})`;
}
/** Time categories: the categories plus "other". */
const timeCats = () => [...CATS, 'other'];
/** An optional folder setting as a path, or '' when empty: Obsidian's normalizePath('') is '/', the vault root. */
function folderSetting(v) {
  const p = normalizePath(String(v == null ? '' : v).trim());
  return p === '/' ? '' : p;
}
/** fork: customers as categories (read from the customers folder; nothing is written). */
function refreshCategories(app, folder) {
  if (folder != null) NEON_CATS.customersFolder = folder;
  const folderPath = folderSetting(NEON_CATS.customersFolder);
  const root = folderPath && app.vault.getAbstractFileByPath(folderPath);
  const skip = new Set((NEON_CATS.skip || []).map((x) => x.toLowerCase())); // fork: e.g. Dailynotes, Tasks in 2.Areas
  const names = root instanceof TFolder ? root.children.filter((c) => c instanceof TFolder && !skip.has(c.name.toLowerCase())).map((c) => c.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) : [];
  NEON_CATS.customers = names.length > 0;
  const keys = names.length ? names.map((n) => n.toLowerCase()) : UPSTREAM_CATS;
  CATS.length = 0;
  CATS.push(...keys);
  for (const n of names) {
    CAT_LABEL[n.toLowerCase()] = n;
    CAT_SHORT[n.toLowerCase()] = n.length > 12 ? n.split(/\s+/).map((w) => w[0]).join('').toUpperCase() : n;
  }
}
/** fork: the customer category of a path: the folder under the customers folder, or null. */
function pathCustomer(path, orFolder = false) {
  const root = folderSetting(NEON_CATS.customersFolder);
  if (!NEON_CATS.customers || !root || !path || !path.startsWith(root + '/')) return null;
  const rest = path.slice(root.length + 1).split('/');
  // a note inside a group folder (at any depth); with orFolder, the group folder itself too
  const key = rest.length > 1 || orFolder ? rest[0].toLowerCase() : null;
  return key && CATS.includes(key) ? key : null;
}
/** fork: the properties a group is read from, in order ("area, parent"). */
function groupProps() {
  return String(NEON_CATS.prop || 'customer')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
/**
 * fork: the group (lower-case key) named by one property value: a plain name (acme), a link ([[Photography]],
 * [[2.Areas/Photography/Cameras|Cameras]]), or a path (/2.Areas/Photography/0.Index.md). A link or path counts when
 * it points into a group folder, or at a note named like a group.
 */
function groupFromValue(value, sourcePath = '', app = NEON_APP.app) {
  if (value == null || typeof value === 'object') return null;
  const s = String(value).trim();
  if (!s || !NEON_CATS.customers) return null;
  const link = s.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
  const target = (link ? link[1] : s).trim();
  const name = target.replace(/\.md$/i, '').toLowerCase();
  if (CATS.includes(name)) return name;
  const dest = link && app && app.metadataCache ? app.metadataCache.getFirstLinkpathDest(target, sourcePath) : null;
  const path = dest ? dest.path : normalizePath(target.replace(/^\/+/, ''));
  const inFolder = pathCustomer(path, true);
  if (inFolder) return inFolder;
  const base = (dest ? dest.basename : path.split('/').pop().replace(/\.md$/i, '')).toLowerCase();
  return CATS.includes(base) ? base : null;
}
/** fork: a note's group from its group properties (each may be a list), or null. */
function groupFromProps(fm, sourcePath = '', app = NEON_APP.app) {
  if (!fm) return null;
  for (const prop of groupProps()) {
    const raw = fm[prop];
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      const k = groupFromValue(v, sourcePath, app);
      if (k) return k;
    }
  }
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dayKey = (ts) => moment(ts).format('YYYY-MM-DD');
const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** 95 -> "1h 35m", 40 -> "40m", 120 -> "2h" */
function fmtMin(m) {
  m = Math.round(m || 0);
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  const sign = m < 0 ? '−' : '';
  if (!h) return `${sign}${r}m`;
  return `${sign}${h}h${r ? ` ${pad(r)}m` : ''}`;
}
/** Count a number shown in el from `from` to `to` (ease-out). Shows `to` at once when they match or motion is reduced. */
function countUp(el, from, to, fmt, ms = 700) {
  if (from === to || prefersReducedMotion()) return el.setText(fmt(to));
  const t0 = performance.now();
  const step = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - t0) / ms);
    el.setText(fmt(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  el.setText(fmt(from));
  requestAnimationFrame(step);
}
function icon(parent, name, cls = 'nd-ico') {
  const s = parent.createSpan({ cls });
  setIcon(s, name);
  return s;
}
function tip(el, text) {
  if (typeof obsidian.setTooltip === 'function') obsidian.setTooltip(el, text);
  else el.setAttr('aria-label', text);
}
function button(parent, { icon: ic, text, cls = '', title, onClick }) {
  const b = parent.createEl('button', { cls: `nd-btn ${cls}`.trim() });
  if (ic) icon(b, ic);
  if (text) b.createSpan({ cls: 'nd-btn-label', text });
  if (title) tip(b, title);
  else if (text && text.length > 18) tip(b, text);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
/** Pill toggle group. opts: [[value,label]], returns {el, set(v), get()} */
function pills(parent, opts, value, onChange, cls = '') {
  const el = parent.createDiv(`nd-pills ${cls}`.trim());
  const btns = new Map();
  let cur = value;
  const set = (v, fire) => {
    cur = v;
    for (const [k, b] of btns) b.toggleClass('is-on', k === v);
    if (fire && onChange) onChange(v);
  };
  for (const [v, label] of opts) {
    const b = el.createEl('button', { cls: 'nd-pill-btn', text: label, attr: { type: 'button', 'data-value': v } });
    b.addEventListener('click', () => set(cur === v && el.hasClass('can-clear') ? null : v, true));
    btns.set(v, b);
  }
  set(value, false);
  return { el, set: (v) => set(v, false), get: () => cur, btns };
}
/** Dashboard card shell: icon chip, title, badge, actions, body. */
function widget(parent, cls, title, ic, sub) {
  const w = parent.createDiv({ cls: `nd-card ${cls}` });
  const head = w.createDiv('nd-card-head');
  const chip = head.createSpan('nd-card-icon');
  setIcon(chip, ic);
  const tw = head.createDiv('nd-card-titles');
  tw.createSpan({ cls: 'nd-card-title', text: title });
  if (sub) tw.createSpan({ cls: 'nd-card-sub', text: sub });
  const badge = head.createSpan({ cls: 'nd-card-badge' });
  const actions = head.createDiv('nd-card-actions');
  const body = w.createDiv('nd-card-body');
  return { w, head, badge, actions, body };
}
function emptyState(parent, text) {
  return parent.createDiv({ cls: 'nd-empty', text });
}
function safeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
}
function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
function excerptOf(text, max = 160) {
  const t = stripFrontmatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s*\[![^\]]*\][+-]?/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[.\]\s+/gm, '')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~=`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}
function applyTemplate(text, m, title) {
  return text
    // fork: the two most common Templater commands, for templates made for Templater
    .replace(/<%[-_]?\s*tp\.file\.title\s*[-_]?%>/g, () => title)
    .replace(/<%[-_]?\s*tp\.date\.now\(\s*(?:(["'])(.*?)\1)?\s*\)\s*[-_]?%>/g, (_, q, f) => moment().format(f || 'YYYY-MM-DD'))
    .replace(/{{\s*date(?::([^}]+))?\s*}}/g, (_, f) => m.format(f ? f.trim() : 'YYYY-MM-DD'))
    .replace(/{{\s*time(?::([^}]+))?\s*}}/g, (_, f) => moment().format(f ? f.trim() : 'HH:mm'))
    .replace(/{{\s*title\s*}}/g, title)
    // fork: a project plan's id prefix, the initials of the title (Pilot - Local AI → pla)
    .replace(/{{\s*prefix\s*}}/g, () => String(title || '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase().slice(0, 5) || 'task');
}
function parseDay(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return moment(v);
  const m = moment(String(v).trim(), ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm', 'DD.MM.YYYY', 'D.M.YYYY'], true);
  return m.isValid() ? m : null;
}
const isTrue = (v) => v === true || v === 1 || /^(true|yes)$/i.test(v);
function fmTags(fm) {
  if (!fm) return [];
  const raw = fm.tags != null ? fm.tags : fm.tag;
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  return arr.filter(Boolean).map((t) => String(t).replace(/^#/, '').toLowerCase());
}
/**
 * fork: projects (upstream had "tickets"). A project is a note with the project tag in its tags property
 * (default `project`, a Projects setting). Status values and their groups come from the same settings.
 */
const NEON_PROJECTS = {
  tag: 'project',
  // status value (lower case) -> 'open' | 'in-progress' | 'waiting' | 'done'
  kinds: { init: 'open', created: 'open', inprogress: 'in-progress', ongoing: 'in-progress', paused: 'waiting', blocked: 'waiting', completed: 'done', cancelled: 'done' },
  order: ['init', 'inprogress', 'paused', 'blocked', 'cancelled', 'completed'], // the choices offered, in this order
  cancelled: 'cancelled', // closing with this value writes a `cancelled` date instead of `completed`
};
function isProjectCache(cache) {
  const fm = cache && cache.frontmatter;
  return !!fm && !!NEON_PROJECTS.tag && fmTags(fm).includes(NEON_PROJECTS.tag.replace(/^#/, '').toLowerCase());
}
/**
 * Time category of a note: first checked checkbox property (projects, school,
 * admin, operations; old `ops` still counts), else a short tag with the same name.
 * Returns 'untracked' for `untracked: true`, or null when nothing is set.
 */
function noteCategory(cache, path) {
  const fm = (cache && cache.frontmatter) || {};
  const tags = cache ? (getAllTags(cache) || []).map((t) => normCat(t.slice(1).toLowerCase())) : [];
  if (isTrue(fm.untracked) || isTrue(fm.Untracked) || tags.includes('untracked')) return 'untracked';
  if (NEON_CATS.customers) {
    // fork: the group properties (customer; or area, parent… with links), else the group folder
    return groupFromProps(fm, path) || pathCustomer(path);
  }
  for (const c of CATS) if (isTrue(fm[c])) return c;
  for (const [old, c] of Object.entries(CAT_ALIAS)) if (isTrue(fm[old])) return c;
  if (typeof fm.category === 'string') {
    const c = normCat(fm.category.toLowerCase());
    if (CATS.includes(c)) return c;
  }
  for (const c of CATS) if (tags.includes(c)) return c;
  return null;
}
function fileCategory(app, file) {
  return file instanceof TFile && file.extension === 'md' ? noteCategory(app.metadataCache.getFileCache(file), file.path) : null;
}
/* @src src/shared/shared-notes.js */
/* ---- shared note helpers: files and navigation, daily notes, note writes, cross-module glue, base folder,
   notes ignored by tag (split from shared.js) ---- */

/* ---- files & navigation ----------------------------------------------- */
async function ensureFolder(app, path) {
  if (!path || path === '/') return;
  const p = normalizePath(path);
  if (app.vault.getAbstractFileByPath(p)) return;
  const parts = p.split('/');
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(acc)) await app.vault.createFolder(acc);
  }
}
function uniquePath(app, folder, name, ext = 'md') {
  const base = folder && folder !== '/' ? normalizePath(folder) + '/' : '';
  const clean = safeName(name) || 'Untitled';
  let candidate = clean;
  let i = 1;
  while (app.vault.getAbstractFileByPath(normalizePath(`${base}${candidate}.${ext}`))) candidate = `${clean} ${i++}`;
  return normalizePath(`${base}${candidate}.${ext}`);
}
async function createUnique(app, folder, name, content = '') {
  await ensureFolder(app, folder);
  return app.vault.create(uniquePath(app, folder, name), content);
}
/**
 * The main pane: the most recently used tab in the main area, Neon views included, so the
 * dashboard, the other Neon views and notes all take turns in one pane (Back / Forward work).
 * Never a pinned tab, and never a tab whose view isn't for navigating (View.navigation false, Obsidian's default:
 * Planning, which opens in a tab of its own): a note opened from the sidebar then gets the next tab, or a new one.
 */
const leafReusable = (l) => !!l && !l.pinned && (!l.view || l.view.navigation !== false || l.view.getViewType() === 'empty');
function reusableLeaf(app) {
  const ws = app.workspace;
  const recent = ws.getMostRecentLeaf(ws.rootSplit);
  if (leafReusable(recent)) return recent;
  const cands = [];
  ws.iterateRootLeaves((l) => {
    if (leafReusable(l)) cands.push(l);
  });
  cands.sort((a, b) => (b.activeTime || 0) - (a.activeTime || 0));
  return cands[0] || ws.getLeaf('tab');
}
/**
 * fork: a path inside a folder whose name starts with "_" (e.g. _claude: tools, scripts, caches). isFolder: the path is a
 * folder itself. The Dashboard setting "Leave out folders starting with _" (on by default) treats them as excluded.
 */
function inUnderscoreFolder(path, isFolder = false) {
  const parts = String(path || '').split('/');
  return (isFolder ? parts : parts.slice(0, -1)).some((p) => p.startsWith('_'));
}
/**
 * fork: Obsidian's page preview for a note shown in one of the plugin's lists (hover; with Ctrl / Cmd unless Settings →
 * Page preview says otherwise). The tab the row sits in, found when hovered, is the preview's source and parent, so
 * the same rows work in their own tab and in a dashboard card. line: open the preview at that line.
 */
function hoverPreview(app, el, file, line = null) {
  if (!el || !file) return;
  el.addEventListener('mouseover', (e) => {
    let view = null;
    app.workspace.iterateAllLeaves((l) => {
      if (!view && l.view && l.view.containerEl && l.view.containerEl.contains(el)) view = l.view;
    });
    if (!view) return;
    app.workspace.trigger('hover-link', { event: e, source: view.getViewType(), hoverParent: view, targetEl: el, linktext: file.path, state: line != null ? { scroll: line } : undefined });
  });
}
/**
 * fork: open a note just made (New note, an inbox note, a new project or research note) and put the cursor in it. It
 * gets a tab of its own next to the current one, so a pinned tab (the dashboard) and the note being read stay as they
 * are; only an empty tab is used for it. The editor then takes the focus, after the New note window has handed it
 * back to the button that opened it.
 */
async function openNewNote(app, file) {
  const ws = app.workspace;
  const cur = ws.getMostRecentLeaf(ws.rootSplit);
  const empty = !!cur && !cur.pinned && !!cur.view && cur.view.getViewType() === 'empty';
  const leaf = empty ? cur : ws.getLeaf('tab');
  await leaf.openFile(file, { active: true, state: { mode: 'source' } });
  ws.setActiveLeaf(leaf, { focus: true });
  window.setTimeout(() => {
    const ed = leaf.view && leaf.view.editor;
    if (ed && ws.activeLeaf === leaf) ed.focus();
  }, 50);
  return leaf;
}
/**
 * fork: keep a tab the plugin opened for you. With "Preview tabs" on in the Open Tab Settings plugin, every new tab
 * starts as a preview (italic title) that the next note opened takes over, VS Code style, until you type in it or
 * double-click its tab. Planning and reports are tabs you work in, so they are made permanent at once. Nothing
 * happens without that plugin.
 */
function keepTab(app, leaf) {
  const ots = app && app.plugins && app.plugins.getPlugin && app.plugins.getPlugin('open-tab-settings');
  if (!leaf || !ots || typeof ots.setLeafIsPreview !== 'function') return false;
  try {
    ots.setLeafIsPreview(leaf, false);
    return true;
  } catch (e) {
    return false;
  }
}
/**
 * fork: show a note in a tab of its own, in front, with the focus: the tab already showing it if there is one
 * (a report written again is not opened twice), else a new tab. Used for notes the plugin writes for you (reports).
 */
async function openInTab(app, file) {
  const ws = app.workspace;
  let leaf = null;
  ws.iterateRootLeaves((l) => {
    if (!leaf && l.view && l.view.file === file) leaf = l;
  });
  if (!leaf) {
    leaf = ws.getLeaf('tab');
    await leaf.openFile(file, { active: true });
  }
  keepTab(app, leaf);
  ws.setActiveLeaf(leaf, { focus: true });
  if (ws.revealLeaf) await ws.revealLeaf(leaf);
  return leaf;
}
function openFile(app, file, evt, line) {
  const ws = app.workspace;
  let leaf;
  if (evt && (evt.ctrlKey || evt.metaKey || evt.button === 1)) leaf = ws.getLeaf('tab');
  else if (evt && evt.shiftKey) leaf = ws.getLeaf('split');
  else leaf = reusableLeaf(app);
  return leaf.openFile(file, line != null ? { active: true, eState: { line } } : { active: true });
}
/** Show a view: 'tab' puts it in the main pane (no extra tabs); 'left' / 'right' in a sidebar. */
async function activateView(app, type, where = 'tab') {
  const ws = app.workspace;
  let leaf;
  if (where === 'tab') {
    leaf = reusableLeaf(app);
    if (leaf.view.getViewType() !== type) await leaf.setViewState({ type, active: true });
  } else {
    leaf = ws.getLeavesOfType(type).find((l) => l.getRoot() !== ws.rootSplit);
    if (!leaf) {
      leaf = where === 'left' ? ws.getLeftLeaf(false) : ws.getRightLeaf(false);
      await leaf.setViewState({ type, active: true });
    }
  }
  await ws.revealLeaf(leaf);
  return leaf;
}

/* ---- daily notes ------------------------------------------------------ */
// fork: the folder, file name format and template come from Obsidian's core Daily notes plugin
// (<configDir>/daily-notes.json) while that plugin is on. When it is off (core-plugins.json), the plugin's
// own Daily notes settings are used instead (NEON_DAILY_FALLBACK, set by the Deck module).
// Each call refreshes the copies in the background.
let dailyCache = {};
let coreOn = {}; // core plugin id -> on/off, from core-plugins.json
const NEON_DAILY_FALLBACK = { folder: '', format: 'YYYY-MM-DD', template: '' };
function readDailyOpts(app) {
  const dir = app.vault.configDir;
  const json = (name) => app.vault.adapter.read(normalizePath(`${dir}/${name}`)).then((t) => JSON.parse(t), () => null);
  return Promise.all([json('daily-notes.json'), json('core-plugins.json')]).then(([d, c]) => {
    dailyCache = d || {};
    // older Obsidian: a list of the plugins that are on; newer: { id: true/false }
    coreOn = Array.isArray(c) ? Object.fromEntries(c.map((id) => [id, true])) : c && typeof c === 'object' ? c : {};
  });
}
/** Is a core plugin on? The live app knows best; the saved file is the fallback. Unknown counts as on. */
function corePluginOn(app, id) {
  const ip = app.internalPlugins && app.internalPlugins.getPluginById ? app.internalPlugins.getPluginById(id) : null;
  if (ip && typeof ip.enabled === 'boolean') return ip.enabled;
  return coreOn[id] !== false;
}
function dailyOpts(app) {
  readDailyOpts(app);
  const o = corePluginOn(app, 'daily-notes') ? dailyCache : NEON_DAILY_FALLBACK;
  return { folder: (o.folder || '').trim(), format: (o.format || '').trim() || 'YYYY-MM-DD', template: (o.template || '').trim() };
}
function dailyPath(app, m) {
  const o = dailyOpts(app);
  return normalizePath(`${o.folder ? o.folder + '/' : ''}${(m || moment()).format(o.format)}.md`);
}
function dailyFile(app, m) {
  const f = app.vault.getAbstractFileByPath(dailyPath(app, m));
  return f instanceof TFile ? f : null;
}
/**
 * Date of a daily (or weekly) note, or null when the file isn't one. A format with folders in it
 * (e.g. YYYY/YYYY-ww → 2026/2026-46.md) is matched against the path inside the notes folder.
 */
function dailyDateOf(app, file) {
  return noteDateOf(dailyOpts(app), file.path);
}
function noteDateOf(o, path) {
  const folder = o.folder ? normalizePath(o.folder) : '';
  if (folder && !path.startsWith(folder + '/')) return null;
  if (!/\.md$/i.test(path)) return null;
  const rel = path.slice(folder ? folder.length + 1 : 0).replace(/\.md$/i, '');
  const name = o.format.includes('/') ? rel : rel.split('/').pop();
  const m = moment(name, o.format, true);
  return m.isValid() ? m : null;
}
async function ensureToday(app) {
  await readDailyOpts(app); // creating a note: use the settings as they are now
  const existing = dailyFile(app);
  if (existing) return existing;
  const o = dailyOpts(app);
  const path = dailyPath(app);
  let content = '';
  if (o.template) {
    const tf = app.metadataCache.getFirstLinkpathDest(o.template, '');
    if (tf) content = await app.vault.read(tf);
  }
  content = applyTemplate(content, moment(), path.split('/').pop().replace(/\.md$/, ''));
  await ensureFolder(app, o.folder);
  return app.vault.create(path, content);
}

/* ---- note writes ------------------------------------------------------ */
/** The smallest replacement that turns `a` into `b`: { from, to, text } as offsets into `a`. */
function minimalEdit(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { from: s, to: a.length - e, text: b.slice(s, b.length - e) };
}
const noteQueue = new Map(); // path -> last pending write
/**
 * Change a note's text with fn(text) -> text. One write at a time per note. When the note is open
 * in an editor, the change goes through the editor as a minimal edit, so the cursor, focus and undo
 * of someone typing there are kept (a disk write would reload the editor under them).
 */
function writeNote(app, file, fn) {
  const run = () => {
    if (NEON_GUARD.readOnly) throw NEON_GUARD.block('change', file.path); // fork: read-only guard (src/shared/guard.js)
    const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === file && l.view.editor && l.view.getMode() === 'source');
    if (!leaf) return app.vault.process(file, fn);
    const ed = leaf.view.editor;
    const old = ed.getValue();
    const next = fn(old);
    if (typeof next !== 'string' || next === old) return old;
    const c = minimalEdit(old, next);
    ed.replaceRange(c.text, ed.offsetToPos(c.from), ed.offsetToPos(c.to));
    return next;
  };
  const p = (noteQueue.get(file.path) || Promise.resolve()).catch(() => {}).then(run);
  noteQueue.set(file.path, p);
  const done = () => noteQueue.get(file.path) === p && noteQueue.delete(file.path);
  p.then(done, done);
  return p;
}

/* ---- cross-plugin glue ------------------------------------------------ */
/** The Dashboard module's API, or null when it is off. */
let neonMother = null; // set by the kernel while it runs (one bundle, so no plugin registry lookup)
function deckApi(app) {
  return (neonMother && neonMother.api) || null;
}
/** Another module (a child plugin of the kernel; its id keeps the upstream neon-* name), or null. */
function neonPlugin(app, id) {
  return (neonMother && neonMother.modules.get(id)) || null;
}
/** A small "made with Claude" line for settings tabs. */
/** fork: the plugin's display name (from its manifest, set by the kernel), used wherever the UI names it. */
const NEON_APP = { name: 'Neon Work', app: null }; // fork: app is set by the kernel (link lookups in shared helpers)
const appName = () => NEON_APP.name;
function madeWith(el, name) {
  const d = el.createDiv('nd-madewith');
  d.setText(`${name || appName()} ${ND_VERSION} · made with Claude`);
}
/** Settings helper: numeric text field with range check. */
function numSetting(setting, obj, key, min, max, save) {
  return setting.addText((t) => {
    t.inputEl.type = 'number';
    t.inputEl.min = String(min);
    t.inputEl.max = String(max);
    t.setValue(String(obj[key])).onChange((v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n >= min && n <= max) {
        obj[key] = n;
        save();
      }
    });
  });
}
/* ---- base folder (fork) ------------------------------------------------
 * Where the plugin keeps what it makes for itself (reviews, time log, pin board, projects without a
 * customer…). Asked once on first start; '' = the vault root. Each location can still be set on its own;
 * an empty location setting means "<base folder>/<default name>". */
const NEON_BASE = { folder: '' };
/** <base folder>/<name>, or just <name> at the vault root. */
function basePath(name) {
  const b = (NEON_BASE.folder || '').replace(/^\/+|\/+$/g, '');
  return normalizePath(b ? `${b}/${name}` : name);
}
/** A location setting, or its default inside the base folder when the setting is empty. */
const locPath = (value, name) => normalizePath(String(value || '').trim() || basePath(name));
/** Saved settings from earlier versions hold the old default paths (Neon/…): clear those that were never used. */
function dropOldDefaults(app, s, olds) {
  let changed = false;
  for (const [key, old] of Object.entries(olds))
    if (s[key] === old && !app.vault.getAbstractFileByPath(normalizePath(old))) {
      s[key] = '';
      changed = true;
    }
  return changed;
}

/* ---- notes to ignore by tag (fork) -----------------------------------------------------
 * e.g. folder index notes (tags: vault_index): left out of stats, tasks, projects and research.
 * Set from the Dashboard setting "Ignored tags"; matches the note's tags property, case-insensitive. */
const NEON_IGNORE = { tags: [] };
function setIgnoredTags(text) {
  NEON_IGNORE.tags = String(text || '')
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
}
function isIgnoredNote(app, file) {
  if (!NEON_IGNORE.tags.length || !file || file.extension !== 'md') return false;
  const cache = app.metadataCache.getFileCache(file);
  const tags = fmTags(cache && cache.frontmatter);
  return tags.some((t) => NEON_IGNORE.tags.includes(t));
}
/* @src src/shared/shared-ui.js */
/* ---- shared UI helpers: modals, path suggestions, long press (split from shared.js) ---- */

/* ---- modals --------------------------------------------------------- */
class PromptModal extends Modal {
  constructor(app, { title, value = '', placeholder = '', cta = 'OK', onSubmit }) {
    super(app);
    Object.assign(this, { title, value, placeholder, cta, onSubmit });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(this.title);
    const input = this.contentEl.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: this.placeholder } });
    input.value = this.value;
    const submit = () => {
      const v = input.value.trim();
      this.close();
      this.onSubmit(v);
    };
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    button(row, { text: this.cta, cls: 'mod-cta', onClick: submit });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}
class ConfirmModal extends Modal {
  constructor(app, { title, text, cta = 'Confirm', warning = true, onConfirm }) {
    super(app);
    Object.assign(this, { title, text, cta, warning, onConfirm });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.text });
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    button(row, {
      text: this.cta,
      cls: this.warning ? 'mod-warning' : 'mod-cta',
      onClick: () => {
        this.close();
        this.onConfirm();
      },
    });
  }
  onClose() {
    this.contentEl.empty();
  }
}
class DatePromptModal extends Modal {
  constructor(app, { title, value, time = false, onSubmit }) {
    super(app);
    Object.assign(this, { title, value, time, onSubmit });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(this.title);
    const input = this.contentEl.createEl('input', { cls: 'nd-input', attr: { type: this.time ? 'datetime-local' : 'date' } });
    input.value = this.value || '';
    const done = (v) => {
      this.close();
      this.onSubmit(this.time && v ? v.replace('T', ' ') : v);
    };
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Clear', onClick: () => done('') });
    button(row, { text: 'Save', cls: 'mod-cta', onClick: () => done(input.value) });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        done(input.value);
      }
    });
    window.setTimeout(() => input.focus(), 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* ---- path suggestions (fork) ----------------------------------------------
 * As you type in a folder or file setting, matching vault paths drop down (Obsidian's own suggest UI). */
const PathSuggestBase = obsidian.AbstractInputSuggest || null;
class PathSuggest extends (PathSuggestBase || class {}) {
  /** kind: 'folder' | 'file' (markdown notes) */
  constructor(app, inputEl, kind, onPick) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.kind = kind;
    this.onPick = onPick;
  }
  getSuggestions(q) {
    const t = String(q || '').trim().toLowerCase();
    const all = this.kind === 'folder' ? this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== '/') : this.app.vault.getMarkdownFiles();
    return all
      .filter((f) => f.path.toLowerCase().includes(t))
      .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))
      .slice(0, 50);
  }
  renderSuggestion(f, el) {
    el.setText(f.path);
  }
  selectSuggestion(f) {
    this.inputEl.value = f.path;
    this.inputEl.dispatchEvent(new Event('input'));
    if (this.onPick) this.onPick(f.path);
    this.close();
  }
}
/** Attach folder/file suggestions to a Setting text field (no-op on Obsidian versions without the API). */
function suggestPaths(app, text, kind) {
  if (PathSuggestBase && text && text.inputEl) new PathSuggest(app, text.inputEl, kind);
  return text;
}

/* ---- long press = right-click on phones and tablets (fork) ------------------------------
 * Inside Neon Work's own views, holding a finger still for half a second sends the same
 * "contextmenu" event a right-click does, so every row menu works by touch. The tap that
 * ends the press is swallowed, and a native long-press menu (Android) is not shown twice. */
const LONG_PRESS_MS = 500;
function installLongPress(plugin) {
  let timer = null;
  let start = null;
  let firedAt = 0;
  const inNeon = (el) => !!(el && el.closest && el.closest('.workspace-leaf-content[data-type^="neon"], .nd-island'));
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  plugin.registerDomEvent(document, 'pointerdown', (e) => {
    cancel();
    if (e.pointerType !== 'touch' || !inNeon(e.target)) return;
    start = { x: e.clientX, y: e.clientY, target: e.target };
    timer = window.setTimeout(() => {
      timer = null;
      firedAt = Date.now();
      start.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, view: window }));
    }, LONG_PRESS_MS);
  }, true);
  plugin.registerDomEvent(document, 'pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) plugin.registerDomEvent(document, ev, cancel, true);
  const recent = () => Date.now() - firedAt < 800;
  // the tap that ends a long press must not also open the row
  plugin.registerDomEvent(document, 'click', (e) => {
    if (recent() && inNeon(e.target)) (e.preventDefault(), e.stopPropagation());
  }, true);
  // Android also sends its own contextmenu on a long press: one menu is enough
  plugin.registerDomEvent(document, 'contextmenu', (e) => {
    if (e.isTrusted && recent() && inNeon(e.target)) (e.preventDefault(), e.stopPropagation());
  }, true);
  plugin.register(cancel);
}
/* @src src/shared/date-picker.js */
/* ---- Date fields with the plugin's own calendar (fork) --------------------------------------------------------------
 * A date field and a calendar button; the calendar opens as a panel inside the form (no floating pop-up, so it works
 * the same in a modal, on a phone and on a tablet) and is drawn by the plugin, so it follows the theme everywhere,
 * Android included. Days can carry a reason (dayInfo): days off are greyed, your own time off striped, someone else's
 * time off underlined in orange, each with the reason as a tooltip on the desktop and in a line under the calendar
 * when tapped or hovered. Any day can be picked, days off included: picking one that has a reason keeps the calendar
 * open with it shown. On the desktop the field also takes a typed date; on phones and
 * tablets it is read-only and opens the calendar, rather than the system's date dialog. Weeks start on Monday.
 * datePickerMonth is pure (tested). */

const DP_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DP_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const dpYmd = (t) => t.toISOString().slice(0, 10);
const dpAdd = (ymd, n) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return dpYmd(t);
};
/** "2026-12" → "2027-01" (n: months to move). */
function dpMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return dpYmd(t).slice(0, 7);
}
/** "Mon 28 Dec 2026" (English, like the rest of Planning's labels). */
function dpLabel(ymd) {
  const t = new Date(`${ymd}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()]} ${t.getUTCDate()} ${DP_MONTHS[t.getUTCMonth()].slice(0, 3)} ${t.getUTCFullYear()}`;
}

/**
 * One month of the calendar (pure): { ym, title, weeks: [[{ date, day, inMonth, today, selected, off, away, event,
 * mark, text }]] }, six weeks of seven days from Monday. dayInfo(date) → { off, away, event, mark, text } or null: off
 * greys a day (weekend, holiday, closure), away stripes it (your time off), event underlines it (someone else's), mark
 * outlines a date of the plan; text says why.
 */
function datePickerMonth(ym, { dayInfo = null, today = '', value = '' } = {}) {
  const first = `${ym}-01`;
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = dpAdd(first, -((dow + 6) % 7));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const date = dpAdd(start, w * 7 + d);
      const info = (dayInfo && dayInfo(date)) || {};
      row.push({ date, day: +date.slice(8), inMonth: date.slice(0, 7) === ym, today: date === today, selected: date === value, off: !!info.off, away: !!info.away, event: !!info.event, mark: !!info.mark, text: info.text || '' });
    }
    weeks.push(row);
  }
  return { ym, title: `${DP_MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`, weeks };
}

let DP_OPEN = null; // the calendar open now: { el, input }; one at a time

function dpClose(focus = false) {
  if (!DP_OPEN) return;
  const { el, input, btn } = DP_OPEN;
  DP_OPEN = null;
  el.remove();
  if (btn) btn.setAttr('aria-expanded', 'false');
  if (focus && input) input.focus();
}

/** Open the calendar for a field, in `host` (the panel goes at its end). */
function dpOpen(input, host, { label, dayInfo, onPick, btn }) {
  const again = DP_OPEN && DP_OPEN.input === input;
  dpClose();
  if (again) return; // the button again: close it
  const today = moment().format('YYYY-MM-DD');
  let ym = (/^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : today).slice(0, 7);
  const el = host.createDiv({ cls: 'nd-dp', attr: { role: 'dialog', 'aria-label': `Pick the ${label}` } });
  DP_OPEN = { el, input, btn };
  if (btn) btn.setAttr('aria-expanded', 'true');
  const head = el.createDiv('nd-dp-head');
  const prev = head.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': 'Previous month' } });
  setIcon(prev, 'chevron-left');
  const title = head.createDiv('nd-dp-title');
  const next = head.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': 'Next month' } });
  setIcon(next, 'chevron-right');
  const grid = el.createDiv({ cls: 'nd-dp-grid', attr: { role: 'grid' } });
  const info = el.createDiv({ cls: 'nd-dp-info', attr: { 'aria-live': 'polite' } });
  const foot = el.createDiv('nd-dp-foot');
  const say = (c) => info.setText(c ? `${dpLabel(c.date)}${c.text ? `: ${c.text}` : ''}` : '');
  const draw = () => {
    const m = datePickerMonth(ym, { dayInfo, today, value: input.value });
    title.setText(m.title);
    grid.empty();
    for (const d of DP_DAYS) grid.createDiv({ cls: 'nd-dp-dow', text: d });
    for (const c of m.weeks.flat()) {
      const cls = ['nd-dp-day', !c.inMonth && 'is-other', c.today && 'is-today', c.selected && 'is-selected', c.off && 'is-off', c.away && 'is-away', c.event && 'is-event', c.mark && 'is-mark'].filter(Boolean).join(' ');
      const b = grid.createEl('button', { cls, text: String(c.day), attr: { type: 'button', 'aria-label': `${dpLabel(c.date)}${c.text ? `, ${c.text}` : ''}`, 'aria-pressed': c.selected ? 'true' : 'false' } });
      if (c.text) b.setAttr('title', c.text);
      b.addEventListener('mouseenter', () => say(c));
      b.addEventListener('focus', () => say(c));
      b.addEventListener('click', () => {
        input.value = c.date;
        onPick(c.date);
        // a day off stays open, its reason shown (on a phone there is no hover to see it first)
        if (c.off || c.away || c.event) {
          ym = c.date.slice(0, 7);
          draw();
          info.setText(`Picked ${dpLabel(c.date)}: ${c.text || 'not a working day'}`);
        } else dpClose(true);
      });
    }
  };
  prev.addEventListener('click', () => ((ym = dpMonth(ym, -1)), draw()));
  next.addEventListener('click', () => ((ym = dpMonth(ym, 1)), draw()));
  const todayBtn = foot.createEl('button', { text: 'Today', attr: { type: 'button' } });
  todayBtn.addEventListener('click', () => ((ym = today.slice(0, 7)), draw()));
  const clear = foot.createEl('button', { text: 'Clear', attr: { type: 'button' } });
  clear.addEventListener('click', () => {
    input.value = '';
    onPick(null);
    dpClose(true);
  });
  const done = foot.createEl('button', { cls: 'mod-cta', text: 'Close', attr: { type: 'button' } });
  done.addEventListener('click', () => dpClose(true));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // not the modal's Escape
    dpClose(true);
  });
  draw();
  const sel = grid.querySelector('.is-selected') || grid.querySelector('.is-today');
  if (sel && !NEON_MOBILE.on) sel.focus();
}

/**
 * A date field with a calendar button (see the header). Returns the input (its value: YYYY-MM-DD or ''). panelIn:
 * where the calendar opens (default: under the field); dayInfo: as datePickerMonth's.
 */
function dateField(parent, { value = '', label = 'date', onChange = null, dayInfo = null, panelIn = null } = {}) {
  const box = parent.createDiv('nd-date-field');
  const mobile = NEON_MOBILE.on;
  // phones and tablets: a read-only field that opens our calendar, not the system's date dialog
  const input = box.createEl('input', { attr: mobile ? { type: 'text', readonly: 'true', placeholder: 'YYYY-MM-DD' } : { type: 'date' } });
  input.value = value || '';
  const pick = (v) => onChange && onChange(v || null);
  if (!mobile) input.addEventListener('change', () => pick(input.value));
  const btn = box.createEl('button', { cls: 'clickable-icon nd-date-pick', attr: { type: 'button', 'aria-label': `Pick the ${label} from a calendar`, 'aria-expanded': 'false' } });
  setIcon(btn, 'calendar');
  const open = () => dpOpen(input, panelIn || parent, { label, dayInfo, onPick: pick, btn });
  btn.addEventListener('click', open);
  if (mobile) input.addEventListener('click', open);
  return input;
}
/* @src src/shared/help.js */
/* ---- in-app help (fork) ------------------------------------------------------------------------------------
 * A ? button in the header of every Neon Work tab opens the README section for that part, inside Obsidian (works
 * offline, matches the installed version). NEON_HELP is written into main.js by tools/build.mjs (tools/help.mjs):
 * { key: { title, md, url } }. Pictures are links to GitHub, and each section links to the full README there. */

/** The help topics in this build ({} when there are none, e.g. in unit tests). */
const helpTopics = () => (typeof NEON_HELP === 'object' && NEON_HELP) || {};

class HelpModal extends Modal {
  /** key: the topic to open first (dashboard, tasks, projects, planning, research, time, …). */
  constructor(app, key) {
    super(app);
    this.key = key;
  }
  onOpen() {
    this.modalEl.addClass('nd-help-modal');
    this.titleEl.setText(`${appName()} help`);
    this.comp = new obsidian.Component();
    this.comp.load();
    const topics = helpTopics();
    const keys = Object.keys(topics);
    if (!keys.length) return void this.contentEl.createDiv({ cls: 'nd-empty', text: 'There is no help in this build.' });
    this.navEl = this.contentEl.createDiv('nd-help-nav');
    for (const k of keys) this.navEl.createEl('button', { cls: 'nd-pill-btn', text: topics[k].title, attr: { 'data-key': k } }).addEventListener('click', () => this.show(k));
    this.bodyEl = this.contentEl.createDiv('nd-help-body markdown-rendered');
    this.footEl = this.contentEl.createDiv('nd-help-foot');
    this.show(topics[this.key] ? this.key : keys[0]);
  }
  async show(key) {
    const t = helpTopics()[key];
    if (!t) return;
    this.key = key;
    this.navEl.querySelectorAll('button').forEach((b) => b.toggleClass('is-on', b.getAttribute('data-key') === key));
    this.bodyEl.empty();
    this.bodyEl.createEl('h2', { text: t.title });
    const md = this.bodyEl.createDiv();
    const R = obsidian.MarkdownRenderer;
    try {
      if (R && R.render) await R.render(this.app, t.md, md, '', this.comp);
      else if (R && R.renderMarkdown) await R.renderMarkdown(t.md, md, '', this.comp);
    } catch (e) {
      console.error(`${appName()}: help`, e);
      md.setText(t.md);
    }
    this.bodyEl.scrollTop = 0;
    this.footEl.empty();
    this.footEl.createEl('a', { cls: 'external-link', text: 'Read this on GitHub, with pictures', attr: { href: t.url, target: '_blank', rel: 'noopener' } });
  }
  onClose() {
    if (this.comp) this.comp.unload();
    this.contentEl.empty();
  }
}

/** Add the ? button to a view's header (once), opening the help at this topic. */
function addHelpAction(view, key) {
  if (view.neonHelpEl || !view.addAction) return;
  view.neonHelpEl = view.addAction('help-circle', `${appName()} help`, () => new HelpModal(view.app, key).open());
}
/* @src src/shared/guard.js */
/* ---- read-only guard ----------------------------------------------------
 * Fork addition (27escape). While read-only is on (the default), nothing in the plugin can
 * create, change, move, rename or delete anything in the vault. Every module gets a guarded
 * `app` (see guardApp) instead of Obsidian's own: its vault, fileManager and vault.adapter
 * refuse writes. The only writes still allowed are the plugin's own settings files inside its
 * plugin folder (.obsidian/plugins/<plugin id>/...). writeNote checks the guard as well, because
 * it can edit an open note through the editor rather than the vault.
 * Obsidian's real `app` is never changed, so other plugins and Obsidian itself are unaffected. */
const NEON_GUARD = {
  readOnly: true, // set from modules.json by the kernel on start; true until then
  allowDir: '', // the plugin's own folder: settings writes there are always allowed
  lastNotice: 0,
  lastGesture: 0, // last click or key press: a blocked write right after one was asked for by you, so it gets a notice
  /** Refuse a write: a console line and an error for the caller, plus a short notice (at most one every 5 s) when you just
   * clicked or typed. Background writes (startup jobs, timers) are refused quietly. */
  block(op, path) {
    const what = `${op}${path ? ` “${path}”` : ''}`;
    console.info(`${appName()} (read-only): blocked ${what}`);
    if (Date.now() - this.lastGesture < 2000 && Date.now() - this.lastNotice > 5000) {
      this.lastNotice = Date.now();
      new Notice(`${appName()} is read-only, so it did not ${what}. Turn off “Read-only” in the plugin’s settings (Protect my notes) to allow changes to your notes.`, 6000);
    }
    const e = new Error(`${appName()} is read-only: ${what} was blocked`);
    e.neonReadOnly = true;
    return e;
  },
  /** True when a path is inside the plugin's own folder. */
  ownPath(path) {
    const p = normalizePath(String(path || ''));
    return !!this.allowDir && (p === this.allowDir || p.startsWith(this.allowDir + '/'));
  },
};
const pathOf = (x) => (x && typeof x === 'object' ? x.path : x);
const GUARD_VAULT = {
  create: 'create', createBinary: 'create', createFolder: 'create the folder', modify: 'change', modifyBinary: 'change',
  process: 'change', append: 'change', delete: 'delete', trash: 'delete', rename: 'rename', copy: 'copy',
};
const GUARD_FILES = { renameFile: 'move', processFrontMatter: 'change the properties of', trashFile: 'delete', createNewMarkdownFile: 'create' };
const GUARD_ADAPTER = {
  write: 'write', writeBinary: 'write', append: 'write', process: 'write', mkdir: 'create the folder', remove: 'delete',
  rmdir: 'delete', trashSystem: 'delete', trashLocal: 'delete', rename: 'rename', copy: 'copy',
};
/** A stand-in for `obj` whose methods named in `ops` throw while read-only (unless `allowed(args)`); everything else passes through. */
function guardObject(obj, ops, allowed, extra) {
  return new Proxy(obj, {
    get(target, key) {
      if (extra && key in extra) return extra[key];
      const v = Reflect.get(target, key, target);
      if (typeof v !== 'function') return v;
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(ops, key)) {
        return function guarded(...args) {
          if (NEON_GUARD.readOnly && !(allowed && allowed(key, args))) return Promise.reject(NEON_GUARD.block(ops[key], pathOf(args[0])));
          return v.apply(target, args);
        };
      }
      return v.bind(target);
    },
  });
}
/** Obsidian's app with a write-guarded vault, fileManager and adapter: what every Neon module sees. */
function guardApp(app) {
  // the plugin's own settings files may still be written; a rename or copy must stay inside that folder too
  const own = (key, args) => NEON_GUARD.ownPath(args[0]) && (!/^(rename|copy)$/.test(key) || NEON_GUARD.ownPath(args[1]));
  const adapter = guardObject(app.vault.adapter, GUARD_ADAPTER, own);
  const vault = guardObject(app.vault, GUARD_VAULT, null, { adapter });
  const fileManager = guardObject(app.fileManager, GUARD_FILES, null);
  return new Proxy(app, {
    get(target, key) {
      if (key === 'vault') return vault;
      if (key === 'fileManager') return fileManager;
      return Reflect.get(target, key, target);
    },
  });
}
/* @src src/shared/note-index.js */
/* ---- shared note index (fork) ---------------------------------------------------
 * One list of the vault's markdown notes with what the modules ask about each (its metadata, open
 * and ticked tasks, tags), kept current from Obsidian's events by the kernel. Modules ask the index instead of
 * each walking every note: projects(), withOpenTasks(), withDoneTasks(since), withProperty(key). Read only. */
let neonIndex = null; // the kernel's live index; null when the kernel isn't running (tests)

class NoteIndex {
  constructor(app) {
    this.app = app;
    this.map = null; // path -> entry, built on first use
  }
  /** What we keep per note: the file, its metadata, and flags that are cheap to filter on. */
  entry(file) {
    const cache = this.app.metadataCache.getFileCache(file) || null;
    const fm = (cache && cache.frontmatter) || null;
    const lis = (cache && cache.listItems) || [];
    return { file, cache, fm, tags: fmTags(fm), openTasks: lis.some((li) => li.task === ' ' || li.task === '/'), doneTasks: lis.some((li) => li.task === 'x' || li.task === 'X') };
  }
  build() {
    this.map = new Map();
    for (const f of this.app.vault.getMarkdownFiles()) this.map.set(f.path, this.entry(f));
  }
  ensure() {
    if (!this.map) this.build();
    return this.map;
  }
  /* kept current by the kernel */
  changed(file) {
    if (!this.map || !file || file.extension !== 'md') return;
    this.map.set(file.path, this.entry(file));
  }
  deleted(file) {
    if (this.map && file) for (const p of [...this.map.keys()]) if (p === file.path || p.startsWith(file.path + '/')) this.map.delete(p);
  }
  renamed(file, old) {
    if (!this.map) return;
    if (file && file.extension === 'md') {
      this.map.delete(old);
      this.map.set(file.path, this.entry(file));
    } else this.map = null; // a folder moved: rebuild on next use
  }
  /* questions */
  entries() {
    return [...this.ensure().values()];
  }
  /** Notes with the project tag in their tags property. */
  projects() {
    const tag = (NEON_PROJECTS.tag || '').replace(/^#/, '').toLowerCase();
    return tag ? this.entries().filter((e) => e.tags.includes(tag)) : [];
  }
  /** Notes with at least one open checkbox ([ ] or [/]). */
  withOpenTasks() {
    return this.entries().filter((e) => e.openTasks);
  }
  /** Notes with a ticked checkbox ([x]), changed since `since` (ms): ticking a task changes the note. */
  withDoneTasks(since = 0) {
    return this.entries().filter((e) => e.doneTasks && e.file.stat.mtime >= since);
  }
  /** Notes with a property (whatever its value). */
  withProperty(key) {
    return this.entries().filter((e) => e.fm && e.fm[key] != null);
  }
}
/** The shared index: the kernel's live one, or a one-off for this call (tests, kernel not running). */
function noteIndex(app) {
  return neonIndex || new NoteIndex(app);
}
/* @src src/shared/gantt.js */
/* ---- Mermaid Gantt timelines (fork) -------------------------------------------------
 * Builds Mermaid "gantt" text from plain items and draws it with Obsidian's own Markdown renderer, so a
 * timeline looks the same here as when it is pasted into a note ("Copy as Mermaid"). Pure text building
 * is kept apart from drawing so it can be tested. Dates are YYYY-MM-DD strings throughout. */

const GANTT_ZOOMS = [
  ['3m', '3 months'],
  ['12m', '12 months'],
  ['all', 'Everything'],
];

/** A date string n days / months from a date string (UTC, so no daylight-saving drift). */
function ymdAdd(ymd, days = 0, months = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d + days));
  return t.toISOString().slice(0, 10);
}
/** The window a zoom shows around today: { from, to }, or null for everything. */
function ganttWindow(zoom, today) {
  if (zoom === '3m') return { from: ymdAdd(today, -14), to: ymdAdd(today, 0, 3) };
  if (zoom === '12m') return { from: ymdAdd(today, 0, -1), to: ymdAdd(today, 0, 11) };
  return null;
}
/** Text Mermaid accepts in a task or section name (":" and "#" and ";" end or break a line there). */
function mermaidSafe(text) {
  return String(text || '')
    .replace(/[:;#]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}
/** The text as a fenced block, ready to paste into a note. */
const mermaidBlock = (src) => '```mermaid\n' + src + '\n```\n';

/** Draw Mermaid text into an element with Obsidian's renderer (component: the view, for clean-up). */
async function renderMermaid(app, el, src, component) {
  el.empty();
  const R = obsidian.MarkdownRenderer;
  try {
    if (R && R.render) await R.render(app, mermaidBlock(src), el, '', component);
    else if (R && R.renderMarkdown) await R.renderMarkdown(mermaidBlock(src), el, '', component);
  } catch (e) {
    console.error('Timeline: could not draw the chart', e);
    el.createDiv({ cls: 'nd-empty', text: 'The timeline could not be drawn. Details in the console.' });
  }
}
/* @src src/shared/plan.js */
/* ---- Project plans (fork): task lines with 🆔 ids, ⛔ dependencies and [duration:: …] (pure) -----------------
 * A plan is the tasks of one project (see plan-scope.js). These functions only read text and work out the plan:
 * which tasks are ready or blocked, a schedule in working days from durations and dependencies, and the critical
 * path (the chain with no slack). Ideas from the Project Planner plugin (Harrison Milburn, MIT); no code taken.
 * Dates are YYYY-MM-DD strings throughout. */

const PLAN_BOX_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/u;
// a Dataview field [key:: value]; the value may hold links: [owner:: [[@Sam Taylor]], [[@Alex]]]
const PLAN_FIELD_RE = /\[[\w-]+::\s*(?:\[\[[^\]]*\]\]|[^\]\[])*\]/gu;
// the Tasks plugin's priorities, highest first: [level, emoji, label]; no emoji is Normal
const PLAN_PRIORITIES = [
  [5, '🔺', 'Highest'],
  [4, '⏫', 'High'],
  [3, '🔼', 'Medium'],
  [2, '', 'Normal'],
  [1, '🔽', 'Low'],
  [0, '⏬', 'Lowest'],
];
/** A task text's priority level (pure): 5 highest … 2 normal … 0 lowest. */
function planPriority(raw) {
  for (const [n, e] of PLAN_PRIORITIES) if (e && String(raw || '').includes(e)) return n;
  return 2;
}
/** The emoji for a level ('' for normal). */
const planPrioritySign = (n) => (PLAN_PRIORITIES.find((p) => p[0] === n) || [])[1] || '';
const PLAN_OWNER_RE = /\[owner::\s*((?:\[\[[^\]]*\]\]|[^\]\[])*)\]/iu;

/**
 * The owners in a task's text ([owner:: [[@Sam Taylor]], Alex]): [{ key, name, text }]. key: for grouping (the note
 * or the plain name, lower case); name: for showing (an alias, else the note name without its @); text: as written.
 */
function planOwners(raw) {
  const m = String(raw || '').match(PLAN_OWNER_RE);
  if (!m) return [];
  const out = [];
  const plain = m[1].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (all, target, alias) => {
    const base = target.split('#')[0].split('/').pop().trim();
    out.push({ key: base.replace(/^@/, '').toLowerCase(), name: (alias || base).replace(/^@/, '').trim(), text: all });
    return ',';
  });
  for (const p of plain.split(',').map((x) => x.trim()).filter(Boolean)) out.push({ key: p.replace(/^@/, '').toLowerCase(), name: p.replace(/^@/, ''), text: p });
  return out;
}
// checkbox character → plan status; note-style boxes ([n], [i], [*], …) are not tasks
const PLAN_STATES = { ' ': 'todo', '/': 'doing', '!': 'todo', '?': 'todo', '>': 'todo', '<': 'todo', x: 'done', X: 'done', '-': 'cancelled' };

/** A task from one line (the text after the checkbox is `raw`), or null. `at` adds file, line, phase… */
function planTask(line, at = {}) {
  const m = String(line || '').replace(/\r$/, '').match(PLAN_BOX_RE);
  if (!m || !(m[1] in PLAN_STATES) || !m[2].trim()) return null;
  const raw = m[2];
  const date = (sign) => (raw.match(new RegExp(`${sign}\\s*(\\d{4}-\\d{2}-\\d{2})`, 'u')) || [])[1] || null;
  const id = (raw.match(/🆔\s*([\w-]+)/u) || [])[1] || null;
  const dm = raw.match(/⛔️?\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u);
  const deps = dm ? [...new Set(dm[1].split(',').map((x) => x.trim()).filter(Boolean))] : [];
  const links = [...planLinkField(raw, 'starts-with', 'ss'), ...planLinkField(raw, 'ends-with', 'ff')]; // fork: run alongside
  const du = raw.match(/\[duration::\s*(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)?\s*\]/iu);
  const days = du ? Math.max(0, Math.round(parseFloat(du[1]) * (/^w/i.test(du[2] || '') ? 5 : 1))) : null;
  const milestone = /(^|\s)#milestone(?=\s|$)/iu.test(raw); // fork: a milestone is tagged, not just 0 days
  const flagged = /(^|\s)#blocked(?=\s|$)/iu.test(raw); // blocked by something outside the plan (a supplier, an approval)
  const marks = ['risk', 'issue', 'decision'].filter((k) => new RegExp(`(^|\\s)#${k}(?=\\s|$)`, 'iu').test(raw)); // markers
  return { status: PLAN_STATES[m[1]], box: m[1], raw, id, deps, links, days, milestone, flagged, marks, owners: planOwners(raw), priority: planPriority(raw), due: date('📅'), scheduled: date('⏳'), start: date('🛫'), done: date('✅'), ...at };
}

/**
 * Links that let tasks run alongside (fork, 17 Nov): [starts-with:: a, b+2d] starts no earlier than a starts (plus
 * a lag in working days, d or w); [ends-with:: a] finishes no earlier than a finishes. ⛔ stays "starts when that
 * finishes", as the Tasks plugin reads it. [{ id, type: 'ss' | 'ff', lag }].
 */
function planLinkField(raw, name, type) {
  const m = String(raw || '').match(new RegExp(`\\[${name}::\\s*([^\\]]*)\\]`, 'iu'));
  if (!m) return [];
  const out = [];
  for (const part of m[1].split(',')) {
    const x = part.trim().match(/^([\w-]+)\s*(?:\+\s*(\d+)\s*(d|w)?)?$/i);
    if (x) out.push({ id: x[1], type, lag: x[2] ? Number(x[2]) * (/w/i.test(x[3] || '') ? 5 : 1) : 0 });
  }
  return out;
}
/** Every id a task is linked to (⛔ and the run-alongside links). */
const planLinkIds = (t) => [...(t.deps || []), ...(t.links || []).map((l) => l.id)];
/** A link as written in its field: "a" or "a+2d". */
const planLinkText = (l) => `${l.id}${l.lag ? `+${l.lag}d` : ''}`;

/** Does the text carry one of the task tags ("#task, #todo"); whole tags, any case. */
function planHasTag(raw, tags) {
  return String(tags || '')
    .split(',')
    .map((t) => t.trim().replace(/^#?/, '#'))
    .filter((t) => t.length > 1)
    .some((t) => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|\\s)`, 'iu').test(raw));
}

/** id → task (the first one wins, so tasks of the project come before outside ones), and the ids used twice. */
function planIndex(tasks) {
  const byId = new Map();
  const dups = new Set();
  for (const t of tasks) {
    if (!t.id) continue;
    if (byId.has(t.id)) dups.add(t.id);
    else byId.set(t.id, t);
  }
  return { byId, dups };
}

const planClosed = (t) => t.status === 'done' || t.status === 'cancelled';

const planOverdue = (t, today) => !!(today && t.due && t.due < today && !planClosed(t));

/**
 * What blocks a task: the open tasks upstream that are overdue or tagged #blocked, found through tasks that are
 * themselves waiting on them (a delay reaches everything after it). [] when nothing does.
 */
function planBlockers(t, byId, today, seen = new Set()) {
  const out = [];
  for (const d of t.deps) {
    const x = byId.get(d);
    if (!x || planClosed(x) || seen.has(x)) continue;
    seen.add(x);
    if (planOverdue(x, today) || x.flagged) out.push(x);
    else out.push(...planBlockers(x, byId, today, seen));
  }
  return [...new Set(out)];
}

/**
 * done | doing | blocked (tagged #blocked, or a task upstream is overdue or #blocked) | waiting (depends on open tasks
 * that are on time: the plan working as meant) | ready (nothing open before it). Unknown ids don't hold a task up.
 * Without today nothing counts as overdue.
 */
function planState(t, byId, today = null) {
  if (planClosed(t)) return 'done';
  if (t.status === 'doing') return 'doing';
  if (t.flagged || planBlockers(t, byId, today).length) return 'blocked';
  // waiting: something it follows (⛔) is still open, or something it starts with hasn't started
  const open = (d) => byId.has(d) && !planClosed(byId.get(d));
  const unstarted = (l) => l.type === 'ss' && byId.has(l.id) && byId.get(l.id).status === 'todo';
  return t.deps.some(open) || (t.links || []).some(unstarted) ? 'waiting' : 'ready';
}

/** Working days a task takes: its duration, else 1 (as Project Planner draws undated tasks); milestones and cancelled: 0. */
const planDays = (t) => (t.status === 'cancelled' || t.milestone ? 0 : t.days == null ? 1 : t.days);

/**
 * Schedule in working days from the start (day 0): each task starts when the last task it depends on ends. With
 * notBefore (today, as a working-day offset), a task not started yet ([ ]) starts no earlier than today: a forecast,
 * so only a 📅 date that has passed (or work in progress running late) makes a task overdue.
 * Returns { rows: [{ task, es, ef, slack, crit }] in the tasks' order, length, cycles: [task], missing: [{ task, id }],
 * dups: [id] }. Tasks in a dependency loop are reported and scheduled as if the loop's last link were absent.
 * from: the plan's first working day (date mode): an open task's 🛫 start date is then "not before" that date, so
 * moving it moves everything that waits for it (fork, 17 Nov: dragging a bar on the Gantt writes 🛫).
 * span: (task, es, days) → the working days it spans from es, longer when its owners are off (planLeaveSpan).
 */
function planSchedule(tasks, { notBefore = 0, from = null, span = null } = {}) {
  const { byId, dups } = planIndex(tasks);
  const n = tasks.length;
  const pos = new Map(tasks.map((t, i) => [t, i]));
  // what each task is held by: ⛔ (fs: after it finishes), starts-with (ss) and ends-with (ff), with a lag
  const preds = tasks.map((t) => [
    ...t.deps.filter((d) => byId.has(d)).map((d) => ({ p: pos.get(byId.get(d)), type: 'fs', lag: 0 })),
    ...(t.links || []).filter((l) => byId.has(l.id)).map((l) => ({ p: pos.get(byId.get(l.id)), type: l.type, lag: l.lag })),
  ]);
  const succs = tasks.map(() => []);
  preds.forEach((ps, i) => ps.forEach((x) => succs[x.p].push({ s: i, type: x.type, lag: x.lag })));
  const missing = [];
  for (const t of tasks) for (const d of planLinkIds(t)) if (!byId.has(d)) missing.push({ task: t, id: d });
  const cycles = new Set();
  const es = new Array(n).fill(0);
  const len = new Array(n).fill(0); // working days each task spans (its duration, plus its owners' days off)
  const seen = new Array(n).fill(0); // 0 new, 1 on the path, 2 done
  const finish = (i) => {
    if (seen[i] === 2) return es[i] + len[i];
    if (seen[i] === 1) {
      cycles.add(i);
      return 0;
    }
    seen[i] = 1;
    let s = 0;
    const d = planDays(tasks[i]);
    for (const x of preds[i]) {
      const ef = finish(x.p);
      if (x.type === 'fs') s = Math.max(s, ef);
      else if (x.type === 'ss') s = Math.max(s, (seen[x.p] === 2 ? es[x.p] : 0) + x.lag);
      else s = Math.max(s, ef + x.lag - d); // ff: finish no earlier than it finishes
    }
    if (tasks[i].status === 'todo') s = Math.max(s, notBefore);
    const t0 = tasks[i];
    if (from && t0.start && !planClosed(t0)) s = Math.max(s, planWorkdaysBetween(from, t0.start));
    es[i] = s;
    len[i] = span ? Math.max(d, span(t0, s, d)) : d;
    seen[i] = 2;
    return s + len[i];
  };
  let length = 0;
  for (let i = 0; i < n; i++) length = Math.max(length, finish(i));
  const lf = new Array(n).fill(null);
  const late = (i, path = new Set()) => {
    if (lf[i] != null) return lf[i] - len[i];
    if (path.has(i)) return length;
    path.add(i);
    let f = length;
    const d = len[i];
    for (const x of succs[i]) {
      const ls = late(x.s, path); // the latest the next task can start
      if (x.type === 'fs') f = Math.min(f, ls);
      else if (x.type === 'ss') f = Math.min(f, ls - x.lag + d);
      else f = Math.min(f, ls + len[x.s] - x.lag); // ff: its latest finish, less the lag
    }
    path.delete(i);
    lf[i] = f;
    return f - len[i];
  };
  for (let i = 0; i < n; i++) late(i);
  const rows = tasks.map((task, i) => {
    const ef = es[i] + len[i];
    const slack = Math.max(0, lf[i] - ef);
    return { task, es: es[i], ef, slack, crit: slack === 0 && n > 0 };
  });
  return { rows, length, cycles: [...cycles].map((i) => tasks[i]), missing, dups: [...dups] };
}

/**
 * The date `n` working days after a date (a day off first moves to the next working day). Working days follow the
 * calendar in the settings (plan-calendar.js: working week, public holidays, closure days); cal overrides it.
 */
function planWorkdays(ymd, n = 0, cal = planCal()) {
  let d = ymd;
  let guard = 0;
  while (!cal.isWorkday(d) && guard++ < 400) d = planNextDay(d);
  for (let k = n; k > 0 && guard++ < 100000; ) {
    d = planNextDay(d);
    if (cal.isWorkday(d)) k--;
  }
  return d;
}

/** "1 working day" / "3 working days". */
const planWorkingDays = (n) => `${n} working day${n === 1 ? '' : 's'}`;
/** Working days from one date to a later one (0 when b is not after a). */
function planWorkdaysBetween(a, b, cal = planCal()) {
  let n = 0;
  for (let d = planWorkdays(a, 0, cal); d < b && n < 5000; d = planWorkdays(d, 1, cal)) n++;
  return n;
}

/** Counts for a project's own tasks (outside ones left out): total, ready, doing, blocked, done, overdue, week. */
function planCounts(tasks, today) {
  const { byId } = planIndex(tasks);
  const week = ymdAdd(today, 7);
  const c = { total: 0, ready: 0, waiting: 0, doing: 0, blocked: 0, done: 0, overdue: 0, week: 0 };
  for (const t of tasks) {
    if (t.external) continue;
    c.total++;
    const s = planState(t, byId, today);
    c[s]++;
    if (s === 'done') continue;
    // overdue: only a 📅 that has passed (⏳ is when it is planned, which Planning may keep in step); due this week: 📅 or ⏳
    if (t.due && t.due < today) c.overdue++;
    else if ((t.due || t.scheduled) && (t.due || t.scheduled) >= today && (t.due || t.scheduled) <= week) c.week++;
  }
  return c;
}

/** "2 overdue · 3 due this week · 1 blocked · 4 ready · 1 in progress · 12 waiting · 5/49 done"; short: what needs action. */
function planSummaryText(c, short = false) {
  if (!c || !c.total) return '';
  const parts = [];
  if (c.overdue) parts.push(`${c.overdue} overdue`);
  if (c.week) parts.push(`${c.week} due this week`);
  if (c.blocked) parts.push(`${c.blocked} blocked`);
  if (short) return parts.join(' · ');
  if (c.ready) parts.push(`${c.ready} ready`);
  if (c.doing) parts.push(`${c.doing} in progress`);
  if (c.waiting) parts.push(`${c.waiting} waiting`);
  parts.push(`${c.done}/${c.total} done`);
  return parts.join(' · ');
}

/** A task's text for charts and lists: plan fields, dates, priorities, tags and link brackets taken out. */
function planText(raw) {
  return String(raw || '')
    .replace(/🆔\s*[\w-]+/gu, '')
    .replace(/⛔️?\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, '')
    .replace(PLAN_FIELD_RE, '')
    .replace(/(?:📅|⏳|🛫|✅|➕|❌)\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/🔁[^📅⏳🛫✅➕]*/gu, '')
    .replace(/[⏫🔼🔽🔺⏬]/gu, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#[\w/-]+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Marcus" / "Marcus/Sofia": owners' first names, for labels. */
function planOwnerShort(t) {
  return (t.owners || []).map((o) => o.name.split(/\s+/)[0]).join('/');
}

/**
 * Days of work per owner per week (pure): Map key → { name, owner, weeks: Map week → days }, from the schedule (open
 * tasks; a task with two owners counts in full for both). Weeks count from the plan's day 0 in fives, or weekOf(day)
 * names them (the Monday's date); works(owner, day) false: a day off, not counted.
 */
function planLoad(rows, { weekOf = (d) => Math.floor(d / 5), works = null } = {}) {
  const out = new Map();
  for (const r of rows) {
    const t = r.task;
    if (t.external || planClosed(t) || !(t.owners || []).length) continue;
    for (const o of t.owners) {
      const me = out.get(o.key) || out.set(o.key, { name: o.name, owner: o, weeks: new Map(), rows: new Map() }).get(o.key);
      for (let d = r.es; d < r.ef; d++) {
        if (works && !works(o, d)) continue;
        const w = weekOf(d);
        me.weeks.set(w, (me.weeks.get(w) || 0) + 1);
        const list = me.rows.get(w) || me.rows.set(w, []).get(w);
        if (!list.includes(r)) list.push(r);
      }
    }
  }
  return out;
}
/**
 * [{ name, week, days, cap, lowest }] where someone has more than `cap` days of work in a week (cap: a number, or
 * (owner, week) → their working days that week). lowest: their task that week that could move most easily: the
 * lowest priority, then the most slack, then the latest start. opts: as planLoad.
 */
function planOverloads(rows, cap = 5, opts = {}) {
  const out = [];
  for (const { name, owner, weeks, rows: byWeek } of planLoad(rows, opts).values())
    for (const [week, days] of weeks) {
      const avail = typeof cap === 'function' ? cap(owner, week) : cap;
      if (days <= avail) continue;
      const pick = [...byWeek.get(week)].sort((a, b) => (a.task.priority ?? 2) - (b.task.priority ?? 2) || b.slack - a.slack || b.es - a.es)[0];
      out.push({ name, week, days, cap: avail, lowest: pick ? pick.task : null });
    }
  return out.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0) || a.name.localeCompare(b.name));
}
/* @src src/shared/plan-calendar.js */
/* ---- Project plans (fork): working days, public holidays and people's time off (pure) -------------------------------
 * Planning counts working days. Everything about them is kept in a Holidays note (the name is a Projects setting):
 *   ## All
 *   - public holidays: England and Wales      (built in: England and Wales, Scotland, Northern Ireland)
 *   - working days: Mon-Fri
 *   - 2026-12-29 to 2026-12-31 Office closed  (any dated day off for everyone, with its name: closures, one-off bank
 *   - 2027-01-01 New Year's Day                holidays, or another country's public holidays, kept up to date yearly)
 *   ## People (any other heading, or none)
 *   - [[@Kevin Mulholland]]
 *       - 2026-12-24 to 2027-01-02
 *       - every Tuesday
 * Which Holidays note a plan uses (planHolidayPaths): the one in the project's folder, else in each folder above it,
 * then in its group's folder (the customer or PARA Area, also when a property names it: area: [[Work]]), then in the
 * base folder; so a customer or Area can have its own (another country, or Work but not Home) and the base folder
 * holds the shared one. The calendar comes from the nearest note with an All section; people's time off is gathered from
 * all of them, and from a project note's own "Holidays" section. The UK rules are worked out here without any network
 * (fixed dates, Easter, first and last Mondays, a substitute weekday for one on a weekend). A person is matched to
 * task owners by the same name (the people note, or the plain name), or by first name; a task then takes longer when
 * its owners are off (a day counts only when all of them work: planLeaveSpan). planCollect returns the plan's calendar
 * and time off with its tasks (tasks.calendar, tasks.leave). Weeks mode, which has no dates, keeps Monday to Friday. */

const PLAN_REGIONS = [
  ['', 'None'],
  ['england-wales', 'England and Wales'],
  ['scotland', 'Scotland'],
  ['northern-ireland', 'Northern Ireland'],
];
const PLAN_DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const planDow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const planYmd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const planNextDay = (ymd, n = 1) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm). */
function planEaster(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return planYmd(y, Math.floor(n / 31), (n % 31) + 1);
}
/** The nth Monday of a month; n = -1: the last one. */
function planMonday(y, m, n) {
  if (n > 0) {
    const first = planYmd(y, m, 1);
    return planNextDay(first, ((8 - planDow(first)) % 7) + 7 * (n - 1));
  }
  const last = planYmd(y, m + 1, 0);
  return planNextDay(last, -((planDow(last) + 6) % 7));
}

/** A region's public holidays in a year: Map date → name (pure). Weekend ones move to the next free weekday. */
function planPublicHolidays(region, y) {
  const out = new Map();
  if (!PLAN_REGIONS.some(([k]) => k && k === region)) return out;
  const scot = region === 'scotland';
  const ni = region === 'northern-ireland';
  const easter = planEaster(y);
  out.set(planNextDay(easter, -2), 'Good Friday');
  if (!scot) out.set(planNextDay(easter, 1), 'Easter Monday');
  out.set(planMonday(y, 5, 1), 'Early May bank holiday');
  out.set(planMonday(y, 5, -1), 'Spring bank holiday');
  out.set(scot ? planMonday(y, 8, 1) : planMonday(y, 8, -1), 'Summer bank holiday');
  const fixed = [[planYmd(y, 1, 1), 'New Year’s Day']];
  if (scot) fixed.push([planYmd(y, 1, 2), '2nd January']);
  if (ni) fixed.push([planYmd(y, 3, 17), 'St Patrick’s Day'], [planYmd(y, 7, 12), 'Battle of the Boyne']);
  if (scot) fixed.push([planYmd(y, 11, 30), 'St Andrew’s Day']);
  fixed.push([planYmd(y, 12, 25), 'Christmas Day'], [planYmd(y, 12, 26), 'Boxing Day']);
  const weekend = (d) => planDow(d) % 6 === 0;
  for (const [d, name] of fixed) if (!weekend(d)) out.set(d, name);
  for (const [d, name] of fixed) {
    if (!weekend(d)) continue;
    let s = d;
    while (weekend(s) || out.has(s)) s = planNextDay(s);
    out.set(s, `${name} (substitute day)`);
  }
  return out;
}

/** 0–6 (Sunday–Saturday) for a day name: "tue", "Tues", "Tuesday", "Tuesdays"; -1 if it isn't one. */
function planDayIndex(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return -1;
  return PLAN_DOW_FULL.findIndex((f) => f.toLowerCase().startsWith(w) || w.startsWith(f.toLowerCase()));
}
/** The working week from "Mon, Tue, Wed, Thu, Fri" or "Mon-Fri": a Set of 0–6; empty or unreadable: Monday to Friday. */
function planWeekdays(text) {
  const out = new Set();
  for (const part of String(text || '').split(/[,;/]+|\band\b/i)) {
    const r = part.match(/([a-z]+)\s*(?:-|–|to)\s*([a-z]+)/i);
    if (r && planDayIndex(r[1]) >= 0 && planDayIndex(r[2]) >= 0) {
      for (let d = planDayIndex(r[1]), n = 0; n < 7; d = (d + 1) % 7, n++) {
        out.add(d);
        if (d === planDayIndex(r[2])) break;
      }
    } else for (const w of part.split(/\s+/)) if (planDayIndex(w) >= 0) out.add(planDayIndex(w));
  }
  return out.size ? out : new Set([1, 2, 3, 4, 5]);
}
/**
 * Days in a piece of text (pure): { dates: Set, weekdays: Set }. Dates are YYYY-MM-DD; a range is two dates joined by
 * "to", "until", a dash or ".." (both ends included); "every Tuesday" (or "every Mon and Fri") adds weekdays.
 */
function planParseDays(text) {
  const dates = new Set();
  const weekdays = new Set();
  const s = String(text || '').replace(/(\d{4}-\d{2}-\d{2})\s*(?:to|until|till|–|—|-|\.\.|>)\s*(\d{4}-\d{2}-\d{2})/giu, (all, a, b) => {
    for (let d = a, n = 0; d <= b && n < 400; d = planNextDay(d), n++) dates.add(d);
    return ' ';
  });
  for (const m of s.matchAll(/\d{4}-\d{2}-\d{2}/g)) dates.add(m[0]);
  for (const m of s.matchAll(/\b(?:every|nwd)\b([^\n]*)/gi)) for (const w of m[1].split(/[\s,;/&]+/)) if (planDayIndex(w) >= 0) weekdays.add(planDayIndex(w));
  return { dates, weekdays };
}

/**
 * The working calendar (pure): { work: Set of weekdays, off(ymd) → why it isn't a working day ('' when it is: a day
 * name, a holiday's name or "a closure day"), isWorkday(ymd) }. region: a PLAN_REGIONS key; weekdays and closures:
 * the settings' text.
 */
function planCalendar({ region = '', weekdays = '', closures = '' } = {}) {
  const work = planWeekdays(weekdays);
  const closed = planParseDays(closures).dates;
  const years = new Map();
  const cal = { region, work, extra: new Map() }; // extra: the Holidays note's dated days for everyone (planHolidayList)
  cal.off = (ymd) => {
    const dow = planDow(ymd);
    if (!work.has(dow)) return PLAN_DOW_FULL[dow];
    const y = +ymd.slice(0, 4);
    if (!years.has(y)) years.set(y, planPublicHolidays(region, y));
    return years.get(y).get(ymd) || cal.extra.get(ymd) || (closed.has(ymd) ? 'a closure day' : '');
  };
  cal.isWorkday = (ymd) => !cal.off(ymd);
  return cal;
}
/**
 * Dated days off for everyone (pure): Map date → name. Each line with a date (or a range: as planParseDays) is a day
 * off; the rest of the line, if any, is its name ("a day off" otherwise).
 */
function planHolidayList(text) {
  const out = new Map();
  let fence = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !/\d{4}-\d{2}-\d{2}/.test(line)) continue;
    const name =
      line
        .replace(/\d{4}-\d{2}-\d{2}(?:\s*(?:to|until|till|–|—|-|\.\.|>)\s*\d{4}-\d{2}-\d{2})?/giu, ' ')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, '')
        .replace(/^[\s:,–—-]+|[\s:,–—-]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'a day off';
    for (const d of planParseDays(line).dates) out.set(d, name);
  }
  return out;
}
/** The last year a Holidays note lists a day in, or 0 when it lists none. */
const planHolidayLastYear = (cal = planCal()) => [...((cal && cal.extra) || new Map()).keys()].reduce((m, d) => Math.max(m, +d.slice(0, 4)), 0);
/**
 * "The Holidays note has no dates after 2027…" when a plan without built-in public holidays runs past the last year
 * its Holidays note lists (end: the plan's finish), else ''.
 */
function planHolidayGap(end, cal = planCal()) {
  const last = planHolidayLastYear(cal);
  if (!last || !end || (cal && cal.region) || +end.slice(0, 4) <= last) return '';
  return `The Holidays note${cal.source ? ` (${cal.source})` : ''} has no dates after ${last}, but the plan runs into ${end.slice(0, 4)}: add that year’s holidays to its All section`;
}
/** The region key for "England and Wales", "england", "Scotland", "NI"…, '' for none or unknown. */
function planRegionOf(text) {
  const s = String(text || '').toLowerCase();
  if (/scot/.test(s)) return 'scotland';
  if (/northern ireland|\bni\b/.test(s)) return 'northern-ireland';
  if (/england|wales/.test(s)) return 'england-wales';
  return '';
}
/**
 * A Holidays note (pure): { all: has an All section, region, weekdays (text), days: Map date → name, people: Map }.
 * The All section (any heading level, also "Everyone"): "public holidays: …", "working days: …" and dated lines;
 * everything else: people's time off (planLeaveParse).
 */
function planHolidayFile(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const all = [];
  const rest = [];
  let level = 0;
  let fence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h && level && h[1].length <= level) level = 0;
    if (h && !level && /^(all|everyone)$/i.test(h[2])) {
      level = h[1].length;
      continue;
    }
    (level ? all : rest).push(l);
  }
  let region = '';
  let weekdays = '';
  const dated = [];
  for (const l of all) {
    const m = l.match(/^\s*(?:[-*+]\s+)?(public holidays?|bank holidays?|working days?)\s*:\s*(.*)$/i);
    if (m && /working/i.test(m[1])) weekdays = m[2];
    else if (m) region = planRegionOf(m[2]);
    else dated.push(l);
  }
  return { all: level > 0 || all.length > 0, region, weekdays, days: planHolidayList(dated.join('\n')), people: planLeaveParse(rest.join('\n')) };
}
/**
 * The Holidays notes a plan looks at, nearest first (pure): <folder>/<name>.md for the project's folder and each
 * folder above it, then its group's folder (group: the customer or Area folder, or ''), then the base folder's.
 * scopePath: the project note (kind 'note') or project folder (kind 'folder').
 */
function planHolidayPaths(scopePath, kind, name, base = '', group = '') {
  const file = `${String(name || 'Holidays').trim().replace(/\.md$/i, '')}.md`;
  const out = [];
  let dir = kind === 'folder' ? scopePath : String(scopePath || '').split('/').slice(0, -1).join('/');
  for (let n = 0; n < 30; n++) {
    out.push(dir ? `${dir}/${file}` : file);
    if (!dir) break;
    dir = dir.split('/').slice(0, -1).join('/');
  }
  for (const dir of [group, base].map((x) => String(x || '').replace(/^\/+|\/+$/g, ''))) {
    const p = dir ? `${dir}/${file}` : file;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
/** Make a plan's calendar the one planWorkdays and friends use (tasks: from planCollect). */
function planUseCalendar(tasks) {
  if (typeof NEON_PLAN !== 'undefined') NEON_PLAN.calendar = (tasks && tasks.calendar) || null;
}
const PLAN_PLAIN_CAL = planCalendar();
/** The calendar from the settings, else plain Monday to Friday. */
const planCal = () => (typeof NEON_PLAN !== 'undefined' && NEON_PLAN.calendar) || PLAN_PLAIN_CAL;

/** Public holidays and closure days from one date to another (inclusive) that fall in the working week: [{ date, name }]. */
function planDaysOff(from, to, cal = planCal()) {
  const out = [];
  for (let d = from, n = 0; d <= to && n < 2000; d = planNextDay(d), n++) if (cal.work.has(planDow(d)) && cal.off(d)) out.push({ date: d, name: cal.off(d) });
  return out;
}

/**
 * The days off as one line for a report (pure): days in a row with the same name become one range, "29 Dec – 31 Dec
 * office closed"; days outside the working week between them don't break the run (a closure from Friday to Monday).
 */
function planDaysOffText(days, cal = planCal()) {
  const runs = [];
  const nextWorking = (d) => {
    for (let n = 0; n < 14; n++) if (cal.work.has(planDow((d = planNextDay(d))))) return d;
    return d;
  };
  for (const { date, name } of days) {
    const last = runs[runs.length - 1];
    if (last && last.name === name && nextWorking(last.to) === date) last.to = date;
    else runs.push({ from: date, to: date, name });
  }
  return runs.map((r) => `${planShortDate(r.from)}${r.to !== r.from ? ` – ${planShortDate(r.to)}` : ''} ${r.name}`).join(', ');
}

/* ---- people's time off ---- */

/** A person at the start of a list line: { key, name, rest } (rest: dates on the same line), or null. */
function planLeavePerson(body) {
  const link = body.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*:?\s*(.*)$/);
  if (link) {
    const base = link[1].split('#')[0].split('/').pop().trim();
    return { key: base.replace(/^@/, '').toLowerCase(), name: (link[2] || base).replace(/^@/, '').trim(), rest: link[3] };
  }
  const cut = body.search(/\d{4}-\d{2}-\d{2}|\bevery\b|\bnwd\b/i);
  const name = (cut >= 0 ? body.slice(0, cut) : body).replace(/[:\s]+$/, '').replace(/^@/, '').trim();
  if (!name || cut === 0) return null;
  return { key: name.toLowerCase(), name, rest: cut >= 0 ? body.slice(cut) : '' };
}
/** People's time off from a list (pure): Map key → { name, dates: Set, weekdays: Set }. See the header. */
function planLeaveParse(text) {
  const out = new Map();
  let who = null;
  let fence = false;
  const add = (e, s) => {
    const d = planParseDays(s);
    for (const x of d.dates) e.dates.add(x);
    for (const x of d.weekdays) e.weekdays.add(x);
  };
  for (const line of String(text || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^(\s*)[-*+]\s+(?:\[.\]\s+)?(.*)$/);
    if (!m) {
      if (/^#/.test(line)) who = null; // a heading ends a person's list
      continue;
    }
    if (!m[1].length) {
      const p = planLeavePerson(m[2].trim());
      who = null;
      if (!p) continue;
      if (!out.has(p.key)) out.set(p.key, { name: p.name, dates: new Set(), weekdays: new Set() });
      who = out.get(p.key);
      if (p.rest) add(who, p.rest);
    } else if (who) add(who, m[2]);
  }
  return out;
}
/** The text of a note's "Holidays" (or "Time off", "Leave") section, to the next heading at its level or above; '' if none. */
function planHolidaySection(text) {
  const lines = String(text || '').split('\n');
  let fence = false;
  let level = 0;
  const out = [];
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (level) {
      if (h && h[1].length <= level) break;
      out.push(l);
    } else if (h && /^(holidays|time off|leave|annual leave)$/i.test(h[2])) level = h[1].length;
  }
  return out.join('\n');
}
/** Several time-off maps as one (pure). */
function planLeaveMerge(...maps) {
  const out = new Map();
  for (const m of maps)
    for (const [k, e] of m || []) {
      if (!out.has(k)) out.set(k, { name: e.name, dates: new Set(), weekdays: new Set() });
      const o = out.get(k);
      for (const x of e.dates) o.dates.add(x);
      for (const x of e.weekdays) o.weekdays.add(x);
    }
  return out;
}
/** An owner's time off: the same name, else the same first name ("@kevin" for [[@Kevin Mulholland]]); or null. */
function planLeaveFor(leave, owner) {
  if (!leave || !leave.size || !owner) return null;
  if (leave.has(owner.key)) return leave.get(owner.key);
  const first = owner.key.split(/\s+/)[0];
  for (const [k, e] of leave) if ((!k.includes(' ') && k === first) || (!owner.key.includes(' ') && k.split(/\s+/)[0] === owner.key)) return e;
  return null;
}
const planLeaveOff = (e, ymd) => !!e && (e.dates.has(ymd) || e.weekdays.has(planDow(ymd)));

/**
 * For planSchedule's span: (task, es, days) → working days the task spans once its owners' time off is left out (a
 * day counts when all of them work). null when nobody has time off. from: the plan's first working day.
 */
function planLeaveSpan(leave, from, cal = planCal()) {
  if (!leave || !leave.size || !from) return null;
  return (t, es, days) => {
    if (!days || planClosed(t)) return days;
    const who = (t.owners || []).map((o) => planLeaveFor(leave, o)).filter(Boolean);
    if (!who.length) return days;
    let d = planWorkdays(from, es, cal);
    let worked = 0;
    let span = 0;
    while (worked < days && span < 2000) {
      if (!who.some((e) => planLeaveOff(e, d))) worked++;
      span++;
      d = planWorkdays(d, 1, cal);
    }
    return span;
  };
}
/** "24 Dec to 1 Jan; every Tuesday": a person's time off on working days from one date to another (pure). */
function planLeaveText(e, from, to, cal = planCal()) {
  if (!e) return '';
  const parts = [];
  let start = null;
  let prev = null;
  const flush = () => start && parts.push(start === prev ? planShortDate(start) : `${planShortDate(start)} to ${planShortDate(prev)}`);
  for (let d = planWorkdays(from, 0, cal), n = 0; d <= to && n < 2000; d = planWorkdays(d, 1, cal), n++) {
    if (!e.dates.has(d)) continue;
    if (start && planWorkdays(prev, 1, cal) === d) prev = d;
    else {
      flush();
      start = prev = d;
    }
  }
  flush();
  const every = [...e.weekdays].filter((w) => cal.work.has(w)).sort();
  if (every.length) parts.push(`every ${every.map((w) => PLAN_DOW_FULL[w]).join(' and ')}`);
  return parts.join('; ');
}
/* @src src/shared/plan-scope.js */
/* ---- Project plans (fork): which tasks belong to a project ---------------------------------------------------
 * A project's plan is the tasks in its note, or in every note of its folder for a project folder (the Projects
 * section's "Project folders"), plus outside tasks linked to them by a dependency in either direction: those are
 * marked `external` and their own chains are not followed. A task is a checkbox line with a task tag or a 🆔 id. */

// filled by the modules that own the settings: Tasks (task tags) and Projects (project folders, the Holidays notes'
// name: plan-calendar.js). calendar: the working calendar of the plan being drawn (planUseCalendar)
const NEON_PLAN = { taskTag: '#task', folders: '', holidayName: 'Holidays', me: '', calendar: null };

/** The project folder a path sits in (<project folders>/<folder>), or null. */
function planFolderOf(path) {
  const root = folderSetting(NEON_PLAN.folders);
  if (!root || !path || !path.startsWith(root + '/')) return null;
  const rest = path.slice(root.length + 1);
  const i = rest.indexOf('/');
  return i > 0 ? `${root}/${rest.slice(0, i)}` : null;
}
/** The plan a note belongs to: { kind: 'folder' | 'note', path }, or null for a note outside any project. */
function planScopeOf(app, file, cache) {
  if (!file || !file.path) return null;
  const folder = planFolderOf(file.path);
  if (folder) return { kind: 'folder', path: folder };
  const c = cache || app.metadataCache.getFileCache(file);
  return isProjectCache(c) ? { kind: 'note', path: file.path } : null;
}
/** The notes of a plan. */
function planScopeFiles(app, scope) {
  if (scope.kind === 'note') {
    const f = app.vault.getAbstractFileByPath(scope.path);
    return f instanceof TFile ? [f] : [];
  }
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(scope.path + '/'));
}
/** The plan tasks of one note, each with file, line and phase (the nearest heading above it). */
async function planReadFile(app, f) {
  const cache = app.metadataCache.getFileCache(f);
  if (!cache || !cache.listItems || !cache.listItems.some((li) => li.task !== undefined)) return [];
  const lines = (await app.vault.cachedRead(f)).split('\n');
  const heads = (cache.headings || []).map((h) => ({ line: h.position.start.line, text: h.heading }));
  const out = [];
  for (const li of cache.listItems) {
    if (li.task === undefined) continue;
    const n = li.position.start.line;
    const h = heads.filter((x) => x.line < n).pop();
    const t = planTask(lines[n], { file: f, line: n, phase: h ? h.text : '' });
    if (t && (t.id || planHasTag(t.raw, NEON_PLAN.taskTag))) out.push(t);
  }
  return planAddSteps(lines, out); // fork: each task's steps (the checkboxes under it), and tasks inside tasks
}
/**
 * The folder of a plan's group (customer, or PARA Area), whether the folder it sits in or a property (area: [[Work]])
 * names it; '' when it has none. A project folder: the first of its notes that names one.
 */
function planGroupFolder(app, scope) {
  const root = folderSetting(NEON_CATS.customersFolder);
  if (!root || !NEON_CATS.customers) return '';
  const key = pathCustomer(scope.path, scope.kind === 'folder') || planScopeFiles(app, scope).map((f) => fileCategory(app, f)).find((k) => k && k !== 'untracked');
  return key ? `${root}/${CAT_LABEL[key] || key}` : '';
}
/**
 * A plan's Holidays notes (plan-calendar.js), nearest first: { calendar (from the nearest one with an All section),
 * people (time off from all of them), paths }.
 */
async function planHolidays(app, scope) {
  const files = planHolidayPaths(scope.path, scope.kind, NEON_PLAN.holidayName, NEON_BASE.folder, planGroupFolder(app, scope))
    .map((p) => app.vault.getAbstractFileByPath(normalizePath(p)))
    .filter((f) => f instanceof TFile);
  const notes = [];
  for (const f of files) notes.push(planHolidayFile(await app.vault.cachedRead(f)));
  const i = notes.findIndex((n) => n.all);
  const cal = planCalendar(i >= 0 ? { region: notes[i].region, weekdays: notes[i].weekdays } : {});
  if (i >= 0) Object.assign(cal, { extra: notes[i].days, source: files[i].path });
  return { calendar: cal, people: planLeaveMerge(...notes.map((n) => n.people)), paths: files.map((f) => f.path) };
}
/**
 * All tasks of a plan. With neighbours (the default), outside tasks that a plan task depends on, or that depend on
 * one, are added after them, marked external. Excluded folders (archive, templates) are skipped.
 */
async function planCollect(app, scope, { neighbours = true } = {}) {
  const files = planScopeFiles(app, scope);
  const tasks = [];
  const own = []; // the notes' own "Holidays" sections
  for (const f of files) {
    tasks.push(...(await planReadFile(app, f)));
    own.push(planLeaveParse(planHolidaySection(await app.vault.cachedRead(f))));
  }
  // the plan's working calendar and people's time off, from its Holidays notes (plan-calendar.js)
  const hol = await planHolidays(app, scope);
  tasks.calendar = hol.calendar;
  tasks.leave = planLeaveMerge(hol.people, ...own);
  if (!neighbours) return tasks;
  const ids = new Set(tasks.filter((t) => t.id).map((t) => t.id));
  const wanted = new Set(tasks.flatMap(planLinkIds).filter((d) => !ids.has(d)));
  if (!ids.size && !wanted.size) return tasks;
  const inside = new Set(files.map((f) => f.path));
  const deck = neonPlugin(app, 'neon-deck');
  for (const f of app.vault.getMarkdownFiles()) {
    if (inside.has(f.path) || (deck && deck.isExcluded && deck.isExcluded(f))) continue;
    const cache = app.metadataCache.getFileCache(f);
    if (!cache || !cache.listItems || !cache.listItems.some((li) => li.task !== undefined)) continue;
    const text = await app.vault.cachedRead(f);
    if (!text.includes('🆔') && !text.includes('⛔')) continue;
    for (const t of await planReadFile(app, f))
      if ((t.id && wanted.has(t.id)) || planLinkIds(t).some((d) => ids.has(d))) tasks.push(Object.assign(t, { external: true }));
  }
  return tasks;
}
/* @src src/shared/plan-draw.js */
/* ---- Plans and timelines (fork): colours, the date scale and the Gantt drawing, shared by Projects and Tasks -------
 * Obsidian draws ```mermaid blocks with Pele, which takes no per-bar styles, so the Planning view, the Projects
 * timeline and the Tasks timeline draw their Gantt charts here as SVG: names on the left, a day scale with weekends
 * shaded and weeks (or months) marked, bars in the kind colours, dashed outlines for markers, a dark outline on the
 * critical path, diamonds for milestones, hollow diamonds for due dates, a line for today. The layout is pure
 * (planGanttLayout, tested); planDrawGantt only turns it into SVG elements (no HTML strings). Colours come from
 * Obsidian's colour variables as #rrggbb. */

const PLAN_WEEK_BASE = '2026-01-05'; // a Monday, week 01 of its year: "Wk %W" then counts weeks from the start

// bar kinds in the order the legend shows them: [kind, label, Obsidian colour variable, fallback]
const PLAN_KINDS = [
  ['ready', 'Ready to start', '--color-blue', '#3a7bd5'],
  ['waiting', 'Waiting on earlier tasks', '--color-blue', '#9dbbe8'], // drawn paler (planColour)
  ['blocked', 'Blocked', '--color-purple', '#8e5bd0'],
  ['doing', 'In progress', '--color-cyan', '#1fa8b8'],
  ['soon', 'Due within a week', '--color-orange', '#e8871e'],
  ['overdue', 'Overdue', '--color-red', '#d93b3b'],
  ['done', 'Done', '--color-green', '#2e9e5b'],
  ['outside', 'Outside this project', '--text-faint', '#999999'],
];

/** "4 Dec" (pure). */
const planShortDate = (ymd) => `${+ymd.slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+ymd.slice(5, 7) - 1]}`;

const planClip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

// markers for tasks tagged #risk, #issue or #decision: a sign before the name and a dashed outline on the bar
const PLAN_MARKS = [
  ['risk', '⚠', 'Risk', '--color-orange', '#e8871e'],
  ['issue', '‼', 'Issue', '--color-red', '#d93b3b'],
  ['decision', '⚖', 'Decision', '--color-green', '#2e9e5b'],
];

/** A task's key across re-reads of the note: its id, else its place. */
const planKey = (t) => t.id || `${t.file.path}:${t.line}`;

/** #rrggbb from #rgb, #rrggbb, rgb() or rgba() (alpha dropped), else null (pure). */
function planToHex(c) {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).replace(/./g, '$&$&')).toLowerCase();
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!m) return null;
  return '#' + m.slice(1, 4).map((v) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
}

/** A theme colour variable as #rrggbb (Mermaid's classDef can't take rgb() or hsl()); any CSS colour is resolved. */
function planCssHex(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  let hex = planToHex(v);
  if (!hex && v) {
    const probe = document.body.createDiv({ attr: { style: 'display:none' } });
    probe.style.color = v;
    hex = planToHex(getComputedStyle(probe).color);
    probe.remove();
  }
  return hex || fallback;
}

/** Text colour on a filled kind colour: dark on orange and grey, white on the rest. */
const planInk = (kind) => (kind === 'soon' || kind === 'outside' || kind === 'waiting' ? '#000000' : '#ffffff');

/** Fill an element with a kind's colour, as the Gantt bars and graph boxes are. */
function planFill(el, kind) {
  const c = planColour(kind);
  el.style.backgroundColor = c;
  el.style.borderColor = c;
  el.style.color = planInk(kind);
}

/** The colour in use for a bar kind (Obsidian's colour variables, so it follows the theme), as #rrggbb. */
function planColour(kind) {
  const k = PLAN_KINDS.find((x) => x[0] === kind) || PLAN_KINDS[0];
  const c = planCssHex(k[2], k[3]);
  return kind === 'waiting' ? planMix(c, planCssHex('--background-primary', '#ffffff'), 0.55) : c;
}

/** #rrggbb between two colours: share of b (0–1). Pure. */
function planMix(a, b, share) {
  const n = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(n(a, i) * (1 - share) + n(b, i) * share).toString(16).padStart(2, '0')).join('');
}

/** Every colour the charts use, as #rrggbb: the kinds, the critical path's outline (edge) and the markers (mark-risk…). */
function planColourMap() {
  return Object.assign(
    Object.fromEntries(PLAN_KINDS.map(([k]) => [k, planColour(k)])),
    Object.fromEntries(PLAN_MARKS.map(([k, , , v, fb]) => [`mark-${k}`, planCssHex(v, fb)])),
    { edge: planCssHex('--text-normal', '#222222') },
  );
}

const PLAN_DAY = 86400000;
/** Calendar days from a to b (pure). */
const planDayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / PLAN_DAY);

/**
 * Where everything goes (pure). rows: planGanttText's rows. Returns { width, height, labelW, dayW, days: [{ x, date,
 * weekend }], ticks: [{ x, text }], today: x | null, items: [{ type: 'section', y, text } | { type: 'bar', y, x, w,
 * row }] } with x in the chart area (after the label column).
 */
function planGanttLayout(rows, { today = null, relative = false, width = 900, labelW = 300, rowH = 26, headH = 26, minDay = 8, maxDay = 40 } = {}) {
  const dated = rows.filter((r) => r.bar && r.bar.start);
  if (!dated.length) return null;
  let first = dated.reduce((a, r) => (r.bar.start < a ? r.bar.start : a), dated[0].bar.start);
  let last = dated.reduce((a, r) => [r.bar.end, r.bar.due || ''].reduce((m, d) => (d > m ? d : m), a), dated[0].bar.end); // due dates fit too
  if (!relative && today && today < first && planDayDiff(today, first) < 30) first = today;
  if (!relative && today && today > last && planDayDiff(last, today) < 30) last = today;
  const from = ymdAdd(first, -1);
  const n = planDayDiff(from, ymdAdd(last, 2)) + 1;
  // fractional, so a year still fills the width (rounding down to whole pixels left long spans cramped)
  const dayW = Math.floor(Math.max(minDay, Math.min(maxDay, (width - labelW - 8) / n)) * 100) / 100;
  const x = (d) => planDayDiff(from, d) * dayW;
  const days = [];
  const ticks = [];
  for (let i = 0; i < n; i++) {
    const date = ymdAdd(from, i);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    // days off shaded: weekends, and with real dates the settings' holidays and closure days; too narrow: no shading
    days.push({ x: i * dayW, date, weekend: dayW >= 6 && (relative ? wd === 0 || wd === 6 : !planCal().isWorkday(date)) });
    // a line each Monday, or on the 1st of each month when weeks would crowd
    const weekly = dayW * 7 >= 46;
    if (weekly ? wd === 1 : date.endsWith('-01')) {
      const mon = planShortDate(date).split(' ')[1];
      const text = weekly ? (relative ? `Wk ${Math.floor(planDayDiff(PLAN_WEEK_BASE, date) / 7) + 1}` : planShortDate(date)) : ticks.length && !date.endsWith('-01-01') ? mon : `${mon} ${date.slice(2, 4)}`; // the year on the first and on January
      ticks.push({ x: i * dayW, text, date, weekly });
    }
  }
  // a label only where there is room for it (the line stays): about 46 px apart
  // a month label that loses its place takes its year to the next label shown, so the year change still shows
  let lastX = -Infinity;
  let year = false;
  for (const t of ticks) {
    if (t.x - lastX < 46) {
      if (!t.weekly && / \d\d$/.test(t.text)) year = true;
      t.text = '';
    } else {
      if (year && !t.weekly && !/ \d\d$/.test(t.text)) t.text += ` ${t.date.slice(2, 4)}`;
      year = false;
      lastX = t.x;
    }
  }
  const items = [];
  let y = headH;
  for (const r of rows) {
    if (r.section) items.push({ type: 'section', y, text: r.section });
    else {
      const b = r.bar;
      const left = x(b.start);
      const w = r.milestone ? 0 : r.thin ? Math.max(3, Math.round(dayW / 4)) : (planDayDiff(b.start, b.end) + 1) * dayW;
      items.push({ type: 'bar', y, x: left, w, row: r, dueX: b.due ? x(b.due) + dayW / 2 : null });
    }
    y += rowH;
  }
  const t = !relative && today && today >= from && planDayDiff(from, today) < n ? x(today) + dayW / 2 : null;
  return { width: labelW + n * dayW + 8, height: y + 6, labelW, dayW, rowH, headH, days, ticks, today: t, items };
}

/** "b waits for a", "b starts with a (+2d)", "b ends with a". */
function planLinkSentence(l) {
  const to = l.to.id || planClip(planText(l.to.raw), 30);
  const lag = l.lag ? ` (+${l.lag}d)` : '';
  return l.type === 'ss' ? `${to} starts with ${l.from.id}${lag}` : l.type === 'ff' ? `${to} ends with ${l.from.id}${lag}` : `${to} waits for ${l.from.id}`;
}
/** Where a bar starts and ends on the drawn chart (x from the left of the SVG): a milestone is a diamond. */
function planBarEnds(lay, it) {
  const mid = it.y + lay.rowH / 2;
  if (it.row.milestone) {
    const cx = lay.labelW + it.x + lay.dayW / 2;
    const s = Math.min(lay.rowH / 2 - 3, 9);
    return { x0: cx - s, x1: cx + s, y: mid };
  }
  return { x0: lay.labelW + it.x + 1, x1: lay.labelW + it.x + Math.max(2, it.w - 1), y: mid };
}
/**
 * The dependency arrows between drawn task bars (pure): [{ from, to, d, crit, late }], from the end of the task
 * waited for to the start of the task that waits. d: an SVG path with right angles (around the bars when the next one
 * starts before this one ends); crit: both on the critical path; late: the task waited for is overdue.
 */
function planGanttLinks(lay) {
  const byId = new Map();
  for (const it of lay.items) if (it.type === 'bar' && it.row.bar.task && it.row.bar.task.id) byId.set(it.row.bar.task.id, it);
  const out = [];
  for (const it of lay.items) {
    const t = it.type === 'bar' && it.row.bar.task;
    if (!t) continue;
    for (const id of t.deps || []) {
      const p = byId.get(id);
      if (!p || p === it) continue;
      const a = planBarEnds(lay, p);
      const b = planBarEnds(lay, it);
      const gap = 6;
      const half = it.row.milestone ? Math.min(lay.rowH / 2 - 3, 9) : (lay.rowH - 10) / 2; // half the bar's height
      const down = b.y > a.y;
      let d;
      let end;
      if (b.x0 - a.x1 >= gap * 2) {
        // room between them: along, down, and into the start of the bar
        d = `M${a.x1},${a.y} H${a.x1 + gap} V${b.y} H${b.x0}`;
        end = { x: b.x0, y: b.y, dir: 'right' };
      } else if (b.x0 >= a.x1 - 2) {
        // the next starts as this one ends: along a little, then down (or up) into the top of the bar
        const x = Math.max(a.x1 + gap, b.x0 + gap);
        const y = down ? b.y - half : b.y + half;
        d = `M${a.x1},${a.y} H${x} V${y}`;
        end = { x, y, dir: down ? 'down' : 'up' };
      } else {
        // the next bar starts before this one ends: down between the rows, back, then into the bar
        const between = down ? b.y - lay.rowH / 2 : b.y + lay.rowH / 2;
        d = `M${a.x1},${a.y} H${a.x1 + gap} V${between} H${b.x0 - gap * 1.5} V${b.y} H${b.x0}`;
        end = { x: b.x0, y: b.y, dir: 'right' };
      }
      out.push({ from: p.row.bar.task, to: t, type: 'fs', d, end, crit: !!(p.row.bar.crit && it.row.bar.crit), late: p.row.bar.kind === 'overdue' });
    }
    // run alongside: start to start (round the left of both bars), end to end (round the right)
    for (const l of t.links || []) {
      const p = byId.get(l.id);
      if (!p || p === it) continue;
      const a = planBarEnds(lay, p);
      const b = planBarEnds(lay, it);
      const gap = 6;
      let d;
      let end;
      if (l.type === 'ss') {
        const x = Math.min(a.x0, b.x0) - gap;
        d = `M${a.x0},${a.y} H${x} V${b.y} H${b.x0}`;
        end = { x: b.x0, y: b.y, dir: 'right' };
      } else {
        const x = Math.max(a.x1, b.x1) + gap;
        d = `M${a.x1},${a.y} H${x} V${b.y} H${b.x1}`;
        end = { x: b.x1, y: b.y, dir: 'left' };
      }
      out.push({ from: p.row.bar.task, to: t, type: l.type, lag: l.lag, d, end, crit: !!(p.row.bar.crit && it.row.bar.crit), late: false });
    }
  }
  return out;
}

/**
 * Draw a layout into `el` as SVG. colours: planColourMap(); onBar(e, bar) for task rows; selKey: the selected task;
 * links: draw the dependency arrows (planGanttLinks); onLink(e, link) when one is clicked; onMenu(e, bar): right-click.
 */
function planDrawGantt(el, lay, { colours, onBar = null, selKey = null, links = false, onLink = null, onMenu = null }) {
  const { labelW, dayW, rowH, headH } = lay;
  const svg = el.createSvg('svg', { cls: 'np-gantt', attr: { width: lay.width, height: lay.height, viewBox: `0 0 ${lay.width} ${lay.height}`, xmlns: 'http://www.w3.org/2000/svg' } });
  svg.style.fontFamily = 'var(--font-interface)';
  svg.style.fontSize = '12px';
  const add = (tag, attr, style) => {
    const e = svg.createSvg(tag, { attr });
    if (style) e.setAttr('style', style);
    return e;
  };
  const text = (x, y, s, style, anchor = 'start') => {
    const e = add('text', { x, y, 'text-anchor': anchor, 'dominant-baseline': 'middle' }, `fill: var(--text-normal);${style || ''}`);
    e.textContent = s;
    return e;
  };
  // weekends and week lines
  for (const d of lay.days) if (d.weekend) add('rect', { x: labelW + d.x, y: headH, width: dayW, height: lay.height - headH }, 'fill: var(--background-modifier-hover)');
  for (const t of lay.ticks) {
    add('line', { x1: labelW + t.x, y1: headH - 6, x2: labelW + t.x, y2: lay.height }, 'stroke: var(--background-modifier-border); stroke-width: 1');
    if (t.text) text(labelW + t.x + 3, headH / 2, t.text, 'fill: var(--text-muted); font-size: 11px');
  }
  add('line', { x1: labelW, y1: headH, x2: lay.width, y2: headH }, 'stroke: var(--background-modifier-border)');
  // dependency arrows, under the bars; red when the task waited for is late, bold along the critical path
  const arrows = links ? planGanttLinks(lay) : [];
  for (const l of arrows) {
    const c = l.late ? colours.overdue || '#d93b3b' : l.crit ? colours.edge : 'var(--text-faint)';
    // ordinary links faint, so a task feeding many others doesn't drown the chart; hovering a row brings its own up
    const strong = l.crit || l.late;
    // classes as a list: Obsidian adds an SVG element's classes one by one, and a name with a space throws
    const g = svg.createSvg('g', { cls: strong ? ['np-g-link', 'is-strong'] : 'np-g-link', attr: { 'data-from': planKey(l.from), 'data-to': planKey(l.to), opacity: strong ? '0.9' : '0.4' } });
    // run-alongside links (starts with, ends with) dashed, so they read differently from "after"
    // colour and width through --np-link-c / --np-link-w, which a hovered task's links set (styles-plan-extra.css)
    g.createSvg('path', { attr: { d: l.d, fill: 'none' } }).setAttr('style', `stroke: var(--np-link-c, ${c}); stroke-width: var(--np-link-w, ${l.crit || l.late ? 1.6 : 1})${l.type !== 'fs' ? '; stroke-dasharray: 4 3' : ''}`);
    const { x, y, dir } = l.end;
    const head =
      dir === 'down' ? `${x},${y} ${x - 3.5},${y - 5} ${x + 3.5},${y - 5}` : dir === 'up' ? `${x},${y} ${x - 3.5},${y + 5} ${x + 3.5},${y + 5}` : dir === 'left' ? `${x},${y} ${x + 5},${y - 3.5} ${x + 5},${y + 3.5}` : `${x},${y} ${x - 5},${y - 3.5} ${x - 5},${y + 3.5}`;
    g.createSvg('polygon', { attr: { points: head } }).setAttr('style', `fill: var(--np-link-c, ${c})`);
  }
  const maxChars = Math.floor((labelW - 18) / 6.4);
  for (const it of lay.items) {
    const mid = it.y + rowH / 2;
    if (it.type === 'section') {
      add('rect', { x: 0, y: it.y, width: lay.width, height: rowH }, 'fill: var(--background-secondary)');
      text(8, mid, planClip(it.text, maxChars + 4), 'font-weight: 600');
      continue;
    }
    const r = it.row;
    const b = r.bar;
    const key = b.task ? planKey(b.task) : b.project ? b.project.file.path : '';
    const g = svg.createSvg('g', { cls: 'np-g-row', attr: key ? { 'data-key': key } : {} });
    const hit = g.createSvg('rect', { cls: 'np-g-hit', attr: { x: 0, y: it.y, width: lay.width, height: rowH } });
    hit.setAttr('style', `fill: var(--np-hit, transparent)${key && key === selKey ? '; stroke: var(--interactive-accent); stroke-width: 2' : ''}`); // --np-hit: the hover colour
    // steps (the checkboxes under the task): "2/4", and ✓ when all are done but the task isn't ticked yet
    const steps = r.steps ? ` · ${r.steps.done}/${r.steps.total}${r.stepsDone ? ' ✓' : ''}` : '';
    const name = `${r.label}${r.who ? ` · ${r.who}` : ''}${steps}`;
    const strong = b.mark === 'risk' || b.mark === 'issue';
    const label = g.createSvg('text', { attr: { x: 18, y: mid, 'dominant-baseline': 'middle' } });
    label.setAttr('style', `fill: var(--text-normal)${strong ? '; font-weight: 700' : ''}${b.kind === 'done' ? '; fill: var(--text-muted)' : ''}`);
    label.textContent = planClip(name, maxChars);
    g.createSvg('title').textContent = name;
    const fill = colours[b.kind] || '#888888';
    const mark = b.mark ? colours[`mark-${b.mark}`] : null;
    const stroke = mark || (b.crit ? colours.edge : fill);
    const outline = `stroke: ${stroke}; stroke-width: ${mark ? 2.5 : b.crit ? 2 : 1}${mark ? '; stroke-dasharray: 5 3' : ''}`;
    if (r.milestone) {
      const cx = labelW + it.x + dayW / 2;
      const s = Math.min(rowH / 2 - 3, 9);
      g.createSvg('polygon', { attr: { points: `${cx},${mid - s} ${cx + s},${mid} ${cx},${mid + s} ${cx - s},${mid}` } }).setAttr('style', `fill: ${fill}; ${outline}`);
    } else {
      g.createSvg('rect', { cls: 'np-g-bar', attr: { x: labelW + it.x + 1, y: it.y + 5, width: Math.max(2, it.w - 2), height: rowH - 10, rx: 3 } }).setAttr('style', `fill: ${fill}; ${outline}`);
      // how far through its steps: the left part of the bar, darker
      if (r.steps && r.steps.done && b.kind !== 'done' && /^#[0-9a-f]{6}$/i.test(fill)) {
        const pw = Math.max(2, ((it.w - 2) * r.steps.done) / r.steps.total);
        g.createSvg('rect', { cls: 'np-g-progress', attr: { x: labelW + it.x + 1, y: it.y + rowH / 2 - 2, width: pw, height: 4, rx: 2 } }).setAttr('style', `fill: ${planMix(fill, '#000000', 0.45)}; pointer-events: none`);
      }
    }
    if (it.dueX != null) {
      // a project's due date: a hollow diamond
      const s = Math.min(rowH / 2 - 4, 7);
      const c = b.kind === 'overdue' ? colours.overdue : 'var(--text-muted)';
      g.createSvg('polygon', { attr: { points: `${labelW + it.dueX},${mid - s} ${labelW + it.dueX + s},${mid} ${labelW + it.dueX},${mid + s} ${labelW + it.dueX - s},${mid}` } }).setAttr('style', `fill: var(--background-primary); stroke: ${c}; stroke-width: 2`);
    }
    if (arrows.length && b.task) {
      // hovering a task: its own arrows (in and out) stand out
      const mine = () => svg.querySelectorAll(`.np-g-link[data-from="${CSS.escape(key)}"], .np-g-link[data-to="${CSS.escape(key)}"]`);
      g.addEventListener('pointerenter', () => mine().forEach((x) => x.addClass('is-hot')));
      g.addEventListener('pointerleave', () => mine().forEach((x) => x.removeClass('is-hot')));
    }
    if ((b.task || b.project) && onBar) {
      g.addClass('is-task');
      g.addEventListener('click', (e) => onBar(e, b));
      if (onMenu)
        g.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          onMenu(e, b);
        });
    }
  }
  // the arrows' click areas, above the rows (whose own click area spans the whole width): wide and see-through
  if (onLink)
    for (const l of arrows) {
      const hit = svg.createSvg('path', { cls: 'np-g-link-hit', attr: { d: l.d, fill: 'none' } });
      hit.setAttr('style', 'stroke: transparent; stroke-width: 9; cursor: pointer');
      hit.createSvg('title').textContent = `${planLinkSentence(l)}: click to remove the link`;
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        onLink(e, l);
      });
    }
  if (lay.today != null) add('line', { x1: labelW + lay.today, y1: headH - 4, x2: labelW + lay.today, y2: lay.height }, `stroke: ${colours.overdue || '#d93b3b'}; stroke-width: 2`);
  return svg;
}
/* @src src/shared/plan-problems.js */
/* ---- Project plans (fork): what is wrong with a plan's links -------------------------------------------------
 * Waiting for an id no task has (often a task folded into a holding task, or a typo), one id on several tasks,
 * and dependency loops. Each problem names the task to fix, so the Planning view can open the note at its line;
 * the Report and the project cards list them too, and the editor underlines them as you type
 * (src/tickets/plan-marks.js). Read only: nothing is written. */

/** A task's short name: its id, else the start of its text. */
const planProblemName = (t) => t.id || planClip(planText(t.raw), 40);
/** "1 plan problem", "3 plan problems". */
const planProblemCount = (n) => `${n} plan problem${n === 1 ? '' : 's'}`;
const planAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * [{ kind: 'missing' | 'dup' | 'loop', task, ids, text }]: the plan's own tasks only (another project's tasks,
 * marked external, are shown but their links aren't followed, so theirs aren't checked). sched: planSchedule's
 * result when already made.
 */
function planProblems(tasks, sched) {
  const s = sched || planSchedule(tasks);
  const out = [];
  const missing = new Map(); // task -> [ids]
  for (const m of s.missing) if (!m.task.external) missing.set(m.task, [...(missing.get(m.task) || []), m.id]);
  for (const [task, ids] of missing) {
    const uniq = [...new Set(ids)];
    out.push({ kind: 'missing', task, ids: uniq, text: `${planProblemName(task)} waits for ${planAnd(uniq)}, but no task has ${uniq.length === 1 ? 'that id' : 'those ids'}` });
  }
  for (const id of s.dups) {
    const same = tasks.filter((t) => t.id === id);
    if (same.every((t) => t.external)) continue;
    const task = same.find((t) => !t.external && t !== same[0]) || same.find((t) => !t.external);
    out.push({ kind: 'dup', task, ids: [id], text: `${id} is the id of ${same.length} tasks: ${planAnd(same.map((t) => `“${planClip(planText(t.raw), 30)}”`))}` });
  }
  // tasks inside tasks: too much; the inner one should be a plain checkbox (a step) or a task of its own
  for (const t of tasks)
    if (!t.external && t.nestedIn != null) {
      const outer = tasks.find((x) => x.file === t.file && x.line === t.nestedIn);
      out.push({ kind: 'nested', task: t, ids: [], text: `${planProblemName(t)} is a task inside ${outer ? `“${planClip(planText(outer.raw), 30)}”` : 'another task'}: make it a plain checkbox (a step), or move it out to its own line` });
    }
  for (const loop of planLoops(tasks)) {
    if (loop.every((t) => t.external)) continue;
    const names = loop.map(planProblemName);
    out.push({ kind: 'loop', task: loop.find((t) => !t.external), ids: loop.map((t) => t.id).filter(Boolean), text: `Dependency loop: ${names.join(' → ')} → ${names[0]}` });
  }
  return out;
}
/** The dependency loops: each a list of tasks in waiting order (strongly connected parts of the graph, Tarjan). */
function planLoops(tasks) {
  const { byId } = planIndex(tasks);
  const next = (t) => planLinkIds(t).map((d) => byId.get(d)).filter(Boolean); // what t waits for (any link)
  const index = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const loops = [];
  let n = 0;
  const visit = (t) => {
    index.set(t, n);
    low.set(t, n++);
    stack.push(t);
    on.add(t);
    for (const u of next(t)) {
      if (!index.has(u)) {
        visit(u);
        low.set(t, Math.min(low.get(t), low.get(u)));
      } else if (on.has(u)) low.set(t, Math.min(low.get(t), index.get(u)));
    }
    if (low.get(t) !== index.get(t)) return;
    const part = [];
    let u;
    do {
      u = stack.pop();
      on.delete(u);
      part.push(u);
    } while (u !== t);
    if (part.length > 1 || next(t).includes(t)) loops.push(planLoopOrder(part, next));
  };
  for (const t of tasks) if (!index.has(t)) visit(t);
  return loops;
}
/** A loop's tasks from its first one in the note, each followed by one it waits for. */
function planLoopOrder(part, next) {
  const inPart = new Set(part);
  const start = part.reduce((a, b) => (part.indexOf(a) > part.indexOf(b) ? a : b)); // Tarjan pops the first-visited last
  const order = [start];
  let cur = start;
  for (;;) {
    const u = next(cur).find((x) => inPart.has(x) && !order.includes(x));
    if (!u) break;
    order.push(u);
    cur = u;
  }
  return order.length === part.length ? order : part.slice().reverse();
}
/* @src src/shared/plan-steps.js */
/* ---- Project plans (fork): a task's steps, and tasks inside tasks -------------------------------------------
 * A plan task's steps are the checkboxes directly under it: `- [ ]` / `- [x]`, and `- ( )` / `- (x)` (Kevin's
 * action format). Cancelled ones (`[-]`, `(-)`) and notes such as `[?]` don't count; an in-progress `[/]` counts as
 * open. Planning shows "2/4" and, when every step is done but the task isn't, offers to tick it: it never ticks it
 * by itself. A task line (#task or 🆔) indented under another task is a plan problem: tasks inside tasks are too
 * much; make it a plain checkbox, or move it out to its own line. Pure. */

const PLAN_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s/;
/** Indent width of a line (a tab counts as four spaces). */
const planIndentWidth = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;

/**
 * The list outline of a note: Map line → parent list line (-1 at the top of a list). A heading, or a line that
 * isn't a list item and isn't indented, ends the list.
 */
function planListTree(lines) {
  const parent = new Map();
  let stack = []; // [{ line, width }]
  lines.forEach((raw, n) => {
    const l = raw.replace(/\r$/, '');
    if (!l.trim()) return;
    if (!PLAN_ITEM_RE.test(l)) {
      if (/^#{1,6}\s/.test(l) || planIndentWidth(l) === 0) stack = [];
      return;
    }
    const w = planIndentWidth(l);
    while (stack.length && stack[stack.length - 1].width >= w) stack.pop();
    parent.set(n, stack.length ? stack[stack.length - 1].line : -1);
    stack.push({ line: n, width: w });
  });
  return parent;
}
/** The checkbox state of a list line: 'open', 'done', or null (not a step: cancelled, a note like [?], or text). */
function planStepState(l) {
  const m = String(l || '').match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[(.)\]|\((.)\))(?=\s|$)/);
  if (!m) return null;
  const c = m[1] != null ? m[1] : m[2];
  if (c === ' ' || c === '/') return 'open';
  if (c === 'x' || c === 'X') return 'done';
  return null;
}
/** { done, total } for the checkboxes directly under line n, or null when it has none. */
function planStepsOf(lines, tree, n) {
  let done = 0;
  let total = 0;
  for (const [line, p] of tree) {
    if (p !== n) continue;
    const s = planStepState(lines[line]);
    if (!s) continue;
    total++;
    if (s === 'done') done++;
  }
  return total ? { done, total } : null;
}
/** The line of the plan task this line sits inside (at any depth), or null. isTask(line) says which lines are tasks. */
function planNestedIn(tree, n, isTask) {
  for (let p = tree.get(n); p != null && p >= 0; p = tree.get(p)) if (isTask(p)) return p;
  return null;
}
/** Steps and nesting for the plan tasks read from one note's lines (sets t.steps and t.nestedIn). */
function planAddSteps(lines, tasks) {
  const tree = planListTree(lines);
  const taskLines = new Set(tasks.map((t) => t.line));
  for (const t of tasks) {
    t.steps = planStepsOf(lines, tree, t.line);
    t.nestedIn = planNestedIn(tree, t.line, (p) => taskLines.has(p));
  }
  return tasks;
}
/** Every step ticked, the task itself still open. */
const planStepsDone = (t) => !!t.steps && t.steps.total > 0 && t.steps.done === t.steps.total && !planClosed(t);
/* @src README.md (tools/help.mjs) */
const NEON_HELP = {"overview":{"title":"Overview","md":"A command centre for an Obsidian vault: a dashboard, projects, tasks, time tracking, research notes and a few writing touches, in a neon look with live background patterns, now with project planning: Gantt charts, a kanban board and reports.\nBy Kevin Mulholland, built on [Neon Deck](https://github.com/Yobzs/neon-deck-obsidian) by Yobzs.\n\n\nNeon Work sits on top of a vault you already have:\n\n- **Read-only by default.** It reads your notes and changes nothing until you switch read-only off, and even then only when you act (tick a task, set a status, create a note).\n- **It never moves your files**, and creates nothing until a feature needs it.\n- **It reads your own conventions**: notes tagged `project`, `#task` lines, a `status` property, customer folders (`1.Customers/<customer>/…`), your templates and your daily (or weekly) note settings.\n\nEverything runs **100% locally**: no network calls, no telemetry, no remote fonts or code, no `eval`. [FORK.md](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/FORK.md) lists everything that differs from the original plugin; [docs/architecture.md](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/architecture.md) describes how it is built.\n\n[🖼 Picture: The Neon Work dashboard ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/dashboard.png)\n\nThe plugin has six parts (Planning is part of Projects). Each can be switched off in the settings, and the others keep working. A list at the top of the left sidebar (Dashboard, Cards, Inbox, Tasks, Projects, Time, Research, Graph) switches what the main pane shows; notes open in the same pane, and Back / Forward move between them. The **?** button at the top of each tab opens this guide inside Obsidian, at the part you are in, with links to the pictures here.","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md"},"dashboard":{"title":"Dashboard","md":"- **Cards** on one page: Totals, Vault pulse, Recently done, Activity (a month calendar, and this week with two weeks either side), **Inbox** (open inbox notes, by first line, with an Add box), Tasks, Todo, Projects, Time today and the **Claude card** (notes whose `claude` property asks for Claude's work, and notes Claude changed for you to review).\n- **Recently done:** the last 14 days of finished work, read from your notes: tasks ticked with a ✅ date (in the editor, the Tasks plugin or these cards) and projects with a `completed` or `cancelled` date. Works in read-only mode.\n- **Ticker and pin board:** a live line of facts at the top that opens into a pin board. Drop a note, a file or some text on it to pin it; pins live in one note, one line each.\n- **Quick capture:** type a thought and send it to an **Inbox note** (a new note in your inbox folder named by the time, `20261119_093015`, holding what you typed, below your inbox template if you have one), the **Todo** note, a new **Project**, a **Time entry** or the pin board. Enter sends; Shift+Enter starts a new line (on the pin board, each line becomes a pin). The **Inbox card**'s Add box works the same way, and the card lists each inbox note by its first line (or its `title`), as much as fits.\n- **Card explorer** (sidebar or tab): your folders and notes as cards, coloured by customer, with filter chips per customer.\n- **Note graph** (desktop): your notes as clusters of linked topics. Its **Gaps** list shows topics that ought to connect but barely do (\"What connects [[A]] with [[B]]?\"); **Bridge note** makes a note in the *Bridges* folder with that question and links to both sides, to help you think it through. Its **Structure** scale rates how your notes cluster, from *Biased* (one topic dominates) through *Focused* and *Diversified* to *Dispersed* (many loosely linked islands), from how cleanly they split into topics (modularity) and the share of the largest topic; hover over a level for its meaning.\n- **Weekly review** (*Create / open this week's review*): a note from your review template with the week in numbers and the notes you created or edited.\n- **Themes and patterns:** nine themes, each in light and dark, with a live pattern behind the dashboard; chosen in *Settings → Dashboard*.\n\n[🖼 Picture: Quick capture and the pin board ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/quick-capture.png)","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#dashboard"},"tasks":{"title":"Tasks","md":"- **Tasks tab and card:** every open `#task` line across the vault (`[ ]` and `[/]`), grouped Overdue · Today · Later by 📅 due or ⏳ scheduled date. Tasks in project notes belong to their project's plan and stay off this list (setting *Tasks in projects*). Tick, edit or open each one in place; the date and note sit on a small line under the task text. Notes tagged `tasks` and recent daily or weekly notes count every checkbox.\n- **Todo card:** the open tasks of your Todo note in file order. New tasks go at the head of that note as `- [ ] #task … ➕ date`; ticking writes `[x] … ✅ date`, as the Tasks plugin does.\n- **Timeline:** a card on the Tasks tab draws dated tasks as a Gantt chart, one section per note: a bar from 🛫 start to 📅 due, otherwise a diamond on the due date; overdue red, due within a week orange, in progress cyan, the rest blue. A click opens the task. Zoom (3 months, 12 months, all). Can be switched off in settings.\n- **New note:** pick a customer and a kind (note, meeting, person, project, research); the note goes in `<customer>/<Meetings | People | Research>/` from that kind's template. People notes are named `@Name` with an `aliases` property. Tick **Put it in this folder** to keep the note in the folder you opened New note from (the sidebar's folder, or the open note's) instead; the tick is remembered.\n\n[🖼 Picture: The Tasks tab with its timeline ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/tasks-tab.png)\n\n[🖼 Picture: New note by customer and kind ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/new-note.png)","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#tasks"},"projects":{"title":"Projects","md":"- **Projects tab and card:** notes with `project` in their tags, grouped by customer (or status, due date and more). The customer is the `customer` property, else the customer folder the note is in.\n- **Your status values** in four groups: not started (`init`), active (`inprogress`, `ongoing`), on hold (`paused`, `blocked`) and closed (`completed`, `cancelled`). Changing a status only updates properties: `status`, plus today's date in `completed` (or `cancelled`).\n- Each row shows the status, customer, `stage`, start date, `note`, a due-date bar and, for projects with a plan, how its tasks stand and the forecast finish. Postpone, set the due date or a reminder, or edit the note property from the row's menu.\n- **Timeline: all projects in one view** above the list on the Projects tab (the *Timeline* button or a setting hides it), one section per customer: a bar from `started` to the plan's forecast finish (else `due`, or `completed` once closed), a diamond on the due date, coloured late, needs attention, in progress, not started, on hold or closed, and a line for today. A click opens the project's Planning view. Zoom (3 months, 12 months, all).\n- **New project:** a name and a customer; the note goes in `<customer>/Projects/` from your project template.\n- **Reminders** appear inside Obsidian, once a day per project, when a project is overdue, due soon or past its remind date.\n\n[🖼 Picture: The Projects tab with its timeline ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/projects-tab.png)","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#projects"},"planning":{"title":"Planning","md":"A lightweight planner over the tasks already in a project note (or a project folder). Open it with the **Planning** button in the note's header, the project's menu, or *Project: open Planning*.\n\n[🖼 Picture: Planning: the Gantt chart with phases, milestones and the forecast ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/planning-gantt.png)\n\n- **In the task line**, next to what the Tasks plugin uses: an id `🆔 sdr-4`, what it waits for `⛔ sdr-2,sdr-3`, tasks it runs alongside `[starts-with:: sdr-2]` (starts no earlier than that one starts) and `[ends-with:: sdr-3+2d]` (finishes no earlier than that one finishes, here two working days after), an estimate in working days `[duration:: 3d]` (or `1w`), owners `[owner:: [[@Sam Taylor]]]`, and the tags `#milestone`, `#blocked`, `#risk`, `#issue`, `#decision`. The phase is the heading the task sits under.\n- **Gantt, Board, Graph and List** in one tab, in the same colours: ready, waiting (earlier tasks open but on time), blocked (something upstream is overdue or `#blocked`), in progress, due soon, overdue, done. The critical path is outlined; risks and issues are bold with a dashed outline.\n- **Editing on the Gantt** (desktop and tablet): arrows show what waits for what (faint, strong on the critical path or when the task waited for is late; hover a task to pick out its own). Drag a bar's right end to change its length, drag the bar to start it later (writes 🛫, \"not before\": what waits for it moves too; it can't go before what it waits for), and **Alt**-drag from one bar onto another to link them by the ends you use: right end to its left end, it waits; left end to left end, it starts with it; right end to right end, it ends with it (dashed arrows). Click an arrow to remove that link. **Undo** puts the last change back.\n- **Priority** (the Tasks plugin's 🔺 ⏫ 🔼 🔽 ⏬) shows on cards, Gantt rows and in the List, highest first on the board; it doesn't change the schedule.\n- **Board:** drag a card to change its checkbox; rows by phase or by person. **List:** − / + to change a duration, slip against the baseline (saved automatically when the project starts, provisional — following the plan — until every open task has a duration, then locked; lock it early or re-baseline from the tab's ⋯ menu), a filter for risks, issues and decisions.\n[🖼 Picture: Planning: the board, by phase ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/planning-board.png)\n\n[🖼 Picture: Planning: the list, with priority and slip ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/planning-list.png)\n\n- **Task editor:** click any task (or right-click in the note: *Planning: edit this task*; also a command, so it can have a hotkey). Description, status, priority, phase, owners, duration or milestone, markers, depends on / blocks (loops can't be made), dates (type them, or pick from the plugin's calendar with the button beside each: weekends, holidays and closures greyed, your own time off striped on your tasks (set **You** in *Settings → Projects*) and anyone else's underlined in orange, named on tap, the plan's own start and finish outlined, the reason shown on hover or tap; any day can still be picked; on phones and tablets the field opens this calendar too), and an id given automatically; a preview shows exactly what will be written. **New task** follows the selected task. **Cancel task** marks it ❌ (it stays in the note); **Delete task…** removes it and its steps, takes its id out of the tasks that depend on it, and asks first, listing all of that.\n\n  [🖼 Picture: The task editor's calendar: holidays greyed, time off underlined, the planned start and finish outlined ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/planning-editor-calendar.png)\n\n- **Report** saves a printable note of the plan (a summary first: forecast, the Gantt chart, phases, people, what needs attention, risks, workload; then the project note itself up to its last task, without the plan's ids and links, so research kept below the plan is left out) in the reports folder, or next to the project if you choose that in *Settings → Projects → Save Planning reports* (a `Reports` folder beside the project note, or inside a project folder, so a customer's reports stay with that customer). A report keeps the project's customer (or Area) as a property, and any properties listed in *Copy into reports* (`cssclasses` by default); never its tags, status or dates, so it never counts as a project. Its menu has **Report: concise** (that) and **Report: full**, which keeps the whole project note and is saved as `… (full)`; print it with *Export to PDF*. **Write dates…** records today's planned dates in the tasks you tick (🛫 start, 📅 due): a snapshot that then holds the plan. To have the current plan show in the Tasks plugin and calendars instead, turn on **Keep ⏳ scheduled dates in step with the plan** in the tab's ⋯ menu (per project, stored as `plan-scheduled: true` in the project note): Planning then updates each open task's ⏳ whenever the plan moves it, and never touches 🛫 or 📅. **Forecast finish** against the project's `due` date, a **baseline** to see slip, a person filter with a warning when someone has more than five days of work in a week, and weekend dates flagged.\n[🖼 Picture: A Planning report, ready to print ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/planning-report.png)\n\n- **Steps:** the checkboxes directly under a task (`- [ ]` / `- [x]`, or `- ( )` / `- (x)`) are its steps, shown as 2/4 on its bar (with a progress line), in the List and on its card; cancelled ones (`[-]`, `(-)`) and notes such as `[?]` don't count. When every step is done but the task isn't, Planning offers to tick it (it never does so by itself). A task tagged `#task` (or with a 🆔) inside another task is flagged: make it a plain checkbox or its own task.\n- **Holidays and time off:** Planning reads working days, holidays and time off from a **Holidays** note (the name is a setting in *Settings → Projects*). It looks in the project's folder, then each folder above it, then the project's customer or Area folder (also when a property names it, as in a PARA vault: `area: [[Work]]`), then the base folder, so a customer or Area can have its own (say, another country, or Work but not Home) and the base folder holds the shared one:\n\n  ```\n  ## All\n  - public holidays: England and Wales\n  - working days: Mon-Fri\n  - 2026-12-29 to 2026-12-31 Office closed\n\n  ## People\n  - [[@Kevin Mulholland]]\n      - 2026-12-24 to 2027-01-02\n      - every Tuesday\n  ```\n\n  **All** is for everyone: public holidays built in for England and Wales, Scotland or Northern Ireland (worked out each year, substitute days included), the working week, and any dated day off with its name: closures, one-off bank holidays, or another country's public holidays, which you add each year (Planning warns when a plan runs past the last year listed). The calendar comes from the nearest Holidays note with an All section; people's time off is gathered from all of them and from a project note's own `## Holidays` section. Write a person as in `[owner:: …]` (or just their first name). Planning skips days off in every date it works out and shades them on the Gantt; a task takes longer when its owner is off (with several owners, a day counts when all of them work); the workload warning counts each person's own days available that week; the report lists the plan's holidays and each person's time off. Dates are always YYYY-MM-DD. Weeks view has no dates, so it keeps plain Monday to Friday.\n- **Plan problems:** a ⛔ id no task has (say, after folding tasks into a holding task), an id used twice or a dependency loop is listed at the top of the Planning view, naming the task (click to open the note at that line), in the report's *Needs attention*, as a pill on the project's card and row, and underlined in the note itself while you edit it (hover for the reason; nothing is written).\n- **Plan template:** `project_plan.md` (in the sample vault's templates) gives four phases of example tasks with ids filled in by New project.\n\nPlanning writes only when you act (a drag, a save, a menu choice), only the task lines involved, and never with read-only on. The Tasks plugin's `is blocked` means what Planning calls *waiting*.","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#planning"},"research":{"title":"Research","md":"- **Research tab:** each section is a folder shown as a topic tree. A pattern such as `1.Customers/*/Research` gathers every customer's research folder into one section, labelled by customer.\n- **By status:** the section's notes grouped by their `status` property, with \"N to research · N researched\" in the header.\n- **Link suggestions:** the status bar offers to link words that match the titles of other research notes.\n- New research notes start from your research template.\n\n[🖼 Picture: The Research tab ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/research-tab.png)","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#research"},"time":{"title":"Time","md":"- **Automatic time** per customer while you work in a note, plus manual entries, breaks, a workday timer and overtime.\n- **Time tab** and a **Time today** card; *Wrap up the day* at the end.\n- An optional **daily time log note** with totals per customer and a table of entries, for you or an AI agent to read. Nothing is sent anywhere.\n\n[🖼 Picture: The Time tab ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/time-tab.png)","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#time"},"write":{"title":"Write","md":"- **Table picker** (`Insert table…`), merged table cells, styled tables, lime dividers, sub-titles and page breaks for PDF export.\n- **Locked callouts and maths blocks:** lock one so it can't be edited by accident.\n- **Lifted writing window:** the note sits on a raised card over the dashboard pattern (full width when Obsidian's *Readable line length* is off).","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#write"},"layouts":{"title":"Other vault layouts","md":"Neon Work started with a vault organised by customer, but the customer is just a group: rename it (Area, Client, Team…), choose the property it's read from and the folder whose subfolders are the groups, in *Settings → Neon Work → Projects*. For a PARA vault, for example: group name `Area`, group properties `area, parent` (names or links such as `[[Photography]]`), groups folder `2.Areas`, project tag `projects`, project folders `1.Projects` (each folder there is a project too), New note types for area notes and resources, and the **Areas card** on the dashboard (projects, tasks and recent notes per area, quietest first). Several task tags (`#task, #todo`) and ignored tags (e.g. `vault_index` folder index notes) help with vaults that have many checklists or generated notes. Folders whose name starts with `_` (such as `_claude`, for tools and scripts) are left out of stats, Recently touched, the Activity calendar, tasks, projects and the graph, like excluded folders (*Settings → Dashboard → Leave out folders starting with _*).","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#other-vault-layouts"},"mobile":{"title":"On phones and tablets","md":"Dashboard, Tasks, Projects and Research also run on mobile: one column on a phone held upright, two on a phone turned sideways or a tablet, and long press for the menus that right-click opens on the desktop. Time tracking, Write, the card explorer and the note graph are desktop-only. To preview the mobile layouts on the desktop, run `app.emulateMobile(true)` in the developer console.","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#on-phones-and-tablets"},"settings":{"title":"Settings","md":"Everything is on one page, *Settings → Neon Work*, with a section per part:\n\n- **Overview:** read-only, the base folder, the switches for each part, and safe mode.\n- **Dashboard, Tasks, Projects, Research, Time, Write:** that part's options. Folder and file fields suggest matching vault paths as you type.\n\nThe **base folder** (asked on first start) is where the plugin keeps what it makes for itself when a location is left empty: Projects without a customer, Reviews, Time Log, `Todo.md`, the pin board and graph bridges.\n\n[🖼 Picture: Settings, one page with a section per part ↗](https://github.com/27escape/neon-work-obsidian/blob/1.5.7/docs/screenshots/settings.png)","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#settings"},"install":{"title":"Install","md":"1. Build it (`node tools/build.mjs`) or take the three files from a release: `main.js`, `manifest.json`, `styles.css`.\n2. Put them in `<your vault>/.obsidian/plugins/neon-work/` (create the folder if needed).\n3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if needed, and enable **Neon Work**.\n4. On first start it asks for a **base folder** (for example `2.Resources`). Read-only stays on until you switch it off in *Overview*; commit or back up your vault first, so you can see exactly what changes.\n\n**Updating:** copy the three files over the ones in `.obsidian/plugins/neon-work/` and switch the plugin off and on. Keep the folder: it also holds your settings.\n\n**Safe mode:** if the plugin fails while starting, the next start keeps every part off; switch them back on in *Overview*.\n\n**Hotkeys:** none by default (community plugin rule); set them in *Settings → Hotkeys*. *Project: open Planning* is a good one to give a key (for example Ctrl/Cmd+Shift+G), and so are the task editor's *Planning: edit this task*, *Planning: new task here* and *Planning: new task after this* (in a project note, on the line under the cursor). Commands are listed as \"Neon Work – Tasks: …\", \"… – Projects: …\" and so on.","url":"https://github.com/27escape/neon-work-obsidian/blob/1.5.7/README.md#install"}};
/* ==== module neon-deck ==== */
const NeonDeckModule = (() => {
/* @src src/deck/helpers.js */

/** Wrap a comparison so names starting with "!" come first ("!!" before "!"). */
function bangFirst(cmp) {
  const bangs = (f) => (f.name.match(/^!+/) || [''])[0].length;
  return (a, b) => bangs(b) - bangs(a) || cmp(a, b);
}
/** Everything that happened per day in a month: tasks, tickets, time entries, notes. Map 'YYYY-MM-DD' -> lists. */
function actDays(p, d, month, week) {
  // a month's calendar weeks, or one week (fork: week chips may fall outside the month)
  const from = (week ? week.clone().startOf('isoWeek') : month.clone().startOf('month').startOf('isoWeek')).valueOf();
  const to = (week ? week.clone().endOf('isoWeek') : month.clone().endOf('month').endOf('isoWeek')).valueOf();
  const days = new Map();
  const day = (t) => {
    const k = dayKey(t);
    if (!days.has(k)) days.set(k, { tasks: [], tickets: [], time: [], notes: [], worked: null, over: 0 });
    return days.get(k);
  };
  const inRange = (t) => t >= from && t <= to;
  for (const [id, fn] of p.activity) {
    let items = [];
    try {
      items = fn() || [];
    } catch (e) {
      console.error(`${appName()} – Dashboard: activity ${id}`, e);
    }
    for (const x of items) if (x && inRange(x.t)) day(x.t)[x.kind === 'ticket' ? 'tickets' : 'tasks'].push({ ...x, kind: x.kind === 'ticket' ? 'ticket' : 'task', extra: x.status || x.src });
  }
  for (const f of d.md) {
    if (inRange(f.stat.ctime)) day(f.stat.ctime).notes.push({ t: f.stat.ctime, kind: 'note', text: f.basename, extra: 'created', open: (e) => openFile(p.app, f, e) });
    else if (inRange(f.stat.mtime)) day(f.stat.mtime).notes.push({ t: f.stat.mtime, kind: 'note', text: f.basename, extra: 'edited', open: (e) => openFile(p.app, f, e) });
  }
  const timeDay = p.services.get('timeDay');
  if (timeDay)
    for (let m = moment(from); m.valueOf() <= to && !m.isAfter(moment(), 'day'); m.add(1, 'day')) {
      const k = m.format('YYYY-MM-DD');
      const td = timeDay(k);
      if (!td || !td.worked) continue;
      const x = day(m.valueOf());
      x.worked = td.worked;
      x.over = td.over;
      for (const e of td.entries) x.time.push({ t: e.start, kind: 'time', text: e.text, extra: fmtMin(e.min) });
    }
  return days;
}
const actCount = (x) => x.tasks.length + x.tickets.length + x.time.length + x.notes.length;
/**
 * Month stats of the Activity card. Each entry: label, icon, accent, how it's counted, and get(days, month, plugin)
 * returning { v, sub } (or null to hide it). Adding a stat = adding one entry here.
 */
const ACTIVITY_STATS = [
  {
    id: 'workday', label: 'avg workday', accent: 'var(--nd-info)', how: 'Average worked time on days with tracked time; overtime days are past the day target.',
    get(days, month) {
      const xs = [...days.entries()].filter(([k, x]) => x.worked && moment(k).isSame(month, 'month'));
      if (!xs.length) return null;
      const over = xs.filter(([, x]) => x.over > 0).length;
      return { v: fmtMin(Math.round(xs.reduce((n, [, x]) => n + x.worked, 0) / xs.length)), sub: `${over} overtime day${over === 1 ? '' : 's'}` };
    },
  },
  {
    id: 'busiest', label: 'busiest weekday', accent: 'var(--nd-accent)', how: 'Weekday with the most tasks, projects, time entries and notes this month.',
    get(days, month) {
      const by = [0, 0, 0, 0, 0, 0, 0];
      for (const [k, x] of days) if (moment(k).isSame(month, 'month')) by[moment(k).isoWeekday() - 1] += actCount(x);
      const best = Math.max(...by);
      return best ? { v: moment().isoWeekday(by.indexOf(best) + 1).format('dddd'), sub: `${best} things` } : null;
    },
  },
  {
    id: 'streak', label: 'longest streak', accent: 'var(--nd-go)', how: 'Most days in a row with any activity this month.',
    get(days, month) {
      let best = 0;
      let run = 0;
      for (let m = month.clone().startOf('month'); m.isSame(month, 'month'); m.add(1, 'day')) {
        const x = days.get(m.format('YYYY-MM-DD'));
        run = x && actCount(x) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best ? { v: `${best} day${best === 1 ? '' : 's'}` } : null;
    },
  },
  {
    id: 'ontime', label: 'tasks on time', accent: 'var(--nd-go)', how: 'Ticked tasks with a 📅 date: done on or before it vs after it.',
    get(days, month) {
      const xs = [...days.entries()].filter(([k]) => moment(k).isSame(month, 'month')).flatMap(([, x]) => x.tasks.filter((t) => t.due));
      if (!xs.length) return null;
      const late = xs.filter((t) => dayKey(t.t) > t.due).length;
      return { v: `${Math.round((100 * (xs.length - late)) / xs.length)}%`, sub: `${late} late` };
    },
  },
  {
    id: 'tickets', label: 'projects closed / opened', accent: 'var(--nd-warn)', how: 'Project notes with `completed` / `created` in this month; average days from created to completed.',
    get(days, month, p) {
      let opened = 0;
      let closed = 0;
      let span = 0;
      for (const f of p.app.vault.getMarkdownFiles()) {
        const fm = (p.app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!fm || fm.type !== 'ticket') continue;
        const c = fm.created ? moment(String(fm.created)) : null;
        const done = fm.completed ? moment(String(fm.completed)) : null;
        if (c && c.isValid() && c.isSame(month, 'month')) opened++;
        if (done && done.isValid() && done.isSame(month, 'month')) {
          closed++;
          if (c && c.isValid()) span += Math.max(0, done.diff(c, 'days'));
        }
      }
      return opened || closed ? { v: `${closed} / ${opened}`, sub: closed ? `avg ${Math.round((span / closed) * 10) / 10} d to close` : '' } : null;
    },
  },
];
/** A note's `created` property as a time (several spellings, any date moment reads), else the file's creation time. */
function createdOf(app, f) {
  const fm = (f.extension === 'md' && (app.metadataCache.getFileCache(f) || {}).frontmatter) || {};
  const v = fm.created ?? fm.Created ?? fm['date created'] ?? fm.date_created;
  const m = v != null && v !== '' ? moment(String(v), [moment.ISO_8601, 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD.MM.YYYY'], true) : null;
  return m && m.isValid() ? m.valueOf() : f.stat.ctime;
}

/* @src src/deck/constants.js */
/* ------------------------------------------------------------------ */
/* Dashboard: constants                                                */
/* ------------------------------------------------------------------ */
const VIEW_DASH = 'neon-deck-dashboard';
const VIEW_CARDS = 'neon-deck-cards';
const VIEW_GRAPH = 'neon-deck-graph';
const VIEW_INBOX = 'neon-inbox-view'; // fork: the Inbox tab
/** Neon views that live in the main pane (folded into one pane once, see foldNeonTabs). */
const MAIN_VIEWS = [VIEW_DASH, VIEW_CARDS, VIEW_GRAPH, 'neon-deck-tickets', 'neon-time', 'neon-tasks-view', 'neon-research', VIEW_INBOX]; // fork: + Tasks, Research, Inbox

const PALETTE = ['#c6e651', '#e5506a', '#7fb3c9', '#d9c56a', '#e4e6ea', '#b9a0d6', '#5fcf96', '#e08a5a', '#8f86b8', '#8f95a0'];
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Folder icon colours: theme colours first (they follow the theme), then fixed ones; a picker allows any #rrggbb. */
const FOLDER_COLORS = ['var(--nd-accent)', 'var(--nd-go)', 'var(--nd-info)', 'var(--nd-warn)', '#e5506a', '#f59e0b', '#84cc16', '#14b8a6', '#3b82f6', '#a855f7', '#ec4899', '#94a3b8'];
const FOLDER_COLOR_RE = /^(#[0-9a-f]{6}|var\(--nd-[a-z0-9-]+\))$/i;
const THEMES = ['marathon', 'cyberpunk', 'calm', 'paper', 'night', 'phosphor', 'blueprint', 'strawberry', 'blackice'];
const THEME_LABEL = {
  marathon: 'Marathon', cyberpunk: 'Cyberpunk', calm: 'Calm', paper: 'Paper', night: 'Night shift', phosphor: 'Phosphor', blueprint: 'Blueprint', strawberry: 'Strawberry kitten', blackice: 'Black ICE',
};
const THEME_PATTERN = {
  marathon: 'damascus', cyberpunk: 'prism', calm: 'none', paper: 'topo', night: 'prism', phosphor: 'datastream', blueprint: 'hex', strawberry: 'none', blackice: 'blackice',
};

/** Short lines Claude wrote for the ticker; roughly one in ten items. */
const SIGNOFFS = [
  'Signal clean, deck quiet, go',
  'One thing at a time',
  'Breaks are part of the work',
  'Ship it, then polish',
  'Log it and let it go',
  'Fewer tabs, more done',
  'Your future self says thanks',
  'Pattern stable, operator steady',
  'Small steps still move projects',
  'Write it down, clear the cache',
  'Good work today — C.',
  'Drink some water',
];

const DEFAULT_SETTINGS = {
  name: '',
  openDashboardOnStartup: true,
  theme: 'marathon',
  pattern: 'auto',
  patternStrength: 'subtle',
  patternMotion: true,
  settingsVersion: 3,
  pinnedFolders: [],
  folderColors: {}, // folder path -> icon colour chosen by hand (beats the category colour)
  // fork: no Core folder. Every location is its own setting; nothing is created until a feature that needs it is used.
  coreFolder: '', // unused (kept so older data files load)
  coreTidied: true, // unused: the move into Core was removed
  // fork: '' = the default name inside the base folder (Neon Work → Base folder)
  reviewFolder: '',
  reviewTemplate: '', // fork: template note for weekly reviews ({{weekLine}}, {{weekNotes}}, {{weekEnd}})
  inboxPath: '', // unused
  inboxFolder: '', // fork: inbox notes go here ('' = <base folder>/Inbox)
  inboxTag: 'inbox', // fork: tag on every inbox note
  inboxStatus: 'waiting', // fork: status on every inbox note
  inboxCard: true, // fork: Inbox card on the dashboard
  inboxDone: 'completed, cancelled, stopped, done, closed, processed, filed', // fork: inbox notes with these statuses are dealt with
  inboxTemplate: '', // fork: template for those notes
  pinBoardPath: '',
  pinnedFolder: '', // files dropped onto the pin board from outside Obsidian
  bridgeFolder: '',
  excludeFolders: '',
  excludeUnderscore: true, // fork: folders whose name starts with "_" (e.g. _claude) count as excluded
  excludeTags: '', // fork: notes with one of these tags (properties) are ignored, e.g. vault_index
  excludeTemplates: true,
  // fork: the Claude card — notes by their claude property
  claudeCard: true,
  areasCard: false, // fork: an Areas card (groups) in the Claude card's place
  claudeProperty: 'claude',
  claudeWaiting: 'process, refine',
  claudeReview: 'updated',
  excludeArchive: true, // fork: also ignore top-level folders with “archive” in their name (e.g. 4.Archive) // fork: also ignore the templates folder(s) of the core Templates plugin and Templater
  // fork: daily notes when Obsidian's core Daily notes plugin is off (otherwise its own settings are used)
  dailyFolder: '',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',
  dailySeeded: false, // fork: the three above were filled in once from the core Daily notes plugin
  cardsInSidebar: true,
  replaceFileExplorer: true,
  // showCapture (the Quick capture card) was removed in 1.5.5: the quick capture panel does it; an old value is ignored
  cardSort: 'created-prop',
  cardMode: 'cards',
  revisitDays: 14, // unused: Revisit was removed in the fork
  seen: {},
  graphMaxNodes: 120,
  graphWindow: 4,
  extraStopwords: '',
};
/** Upstream 1.2 keys that moved to the Tickets module (now Projects) or were removed; dropped after migration. */
const OLD_KEYS = ['glass', 'intensity', 'styleVersion', 'stampDone'];

const pal = (i) => `var(--nd-c${i + 1}, ${PALETTE[i]})`;
function countWords(text) {
  const m = stripFrontmatter(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
/** Tiny inline sparkline (7 values). */
function sparkline(parent, values) {
  const w = 54;
  const h = 18;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  const svg = parent.createSvg('svg', { cls: 'nd-spark', attr: { viewBox: `0 0 ${w} ${h}`, width: w, height: h } });
  // pathLength 1: the line can be drawn in with CSS (stroke-dashoffset 1 -> 0)
  svg.createSvg('polyline', { attr: { points: pts, pathLength: '1', fill: 'none', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } });
  return svg;
}

/* @src src/deck/text-network.js */
/* ------------------------------------------------------------------ */
/* Text network analysis (InfraNodus-style)                            */
/* ------------------------------------------------------------------ */

const STOPWORDS = (
  // English
  'a about above after again against all almost also although always am among an and another any anybody anyone anything anyway anywhere are aren around as at ' +
  'back be became because become becomes been before being below between both but by can cannot could couldn did didn do does doesn doing don done down during ' +
  'each either else enough even ever every everyone everything few for from further get gets getting give given go goes going gone got had hadn has hasn have haven having he her here hers herself him himself his how however ' +
  'i if in into is isn it its itself just keep know last least less let like likely made make makes many may maybe me might mine more most mostly much must my myself ' +
  'need needs neither never new next no nobody none nor not nothing now of off often oh ok okay on once one only onto or other others otherwise our ours ourselves out over own ' +
  'per perhaps put quite rather really said same say says see seem seemed seems several shall she should shouldn show since so some somebody someone something sometimes somewhat still such sure ' +
  'take than that the their theirs them themselves then there therefore these they thing things think this those though through thus to together too toward towards ' +
  'under until up upon us use used uses using very via want wants was wasn way ways we well were weren what whatever when where whether which while who whoever whole whom whose why will with within without won would wouldn ' +
  'yes yet you your yours yourself yourselves etc vs eg ie also lot lots kind sort bit thing stuff today tomorrow yesterday ' +
  // German
  'aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei bin bis bist da damit dann das dass dein deine dem den denn der des dich die dies diese diesem diesen dieser dir doch dort du durch ' +
  'ein eine einem einen einer eines er es etwas euch euer für gegen hab habe haben hat hatte ich ihm ihn ihr ihre im in ist ja jede jedem jeden jeder jedes jetzt kann kein keine man mehr mein meine mich mir mit muss nach nicht nichts noch nun nur ob oder ohne schon sehr sein seine sich sie sind so solche soll sondern sonst über um und uns unser unter viel vom von vor war waren warum was weil weiter welche wenn wer werden wie wieder will wir wird wo wurde zu zum zur zwar zwischen ' +
  // Markdown / web noise
  'http https www com org net html png jpg jpeg gif pdf md tags tag aliases cssclasses created updated'
).split(/\s+/);

const TOKEN_RE = /⟦[^⟧]+⟧|#[\p{L}\p{N}_\/-]+|[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

function lemma(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.length > 4 && /(xes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
function cleanForConcepts(text) {
  return stripFrontmatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (_, t) => ` ⟦${t.trim().toLowerCase()}⟧ `)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}
function tokenize(line, stop) {
  const out = [];
  const m = line.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (let t of m) {
    if (t[0] === '⟦' || t[0] === '#') {
      if (t.length > 2) out.push(t);
      continue;
    }
    t = t.replace(/['’]s$/, '').replace(/['’_-]+$/, '');
    if (t.length < 3 || /^[\d_-]+$/.test(t) || stop.has(t)) continue;
    t = lemma(t);
    if (!stop.has(t)) out.push(t);
  }
  return out;
}
function conceptLabel(key) {
  return key[0] === '⟦' ? `[[${key.slice(1, -1)}]]` : key;
}
function conceptKind(key) {
  return key[0] === '⟦' ? 'link' : key[0] === '#' ? 'tag' : 'word';
}

function buildConceptNetwork(docs, { window = 4, maxNodes = 120, stopwords }) {
  const freq = new Map();
  const wdeg = new Map();
  const pairs = new Map();
  const where = new Map();
  for (const doc of docs) {
    for (const line of cleanForConcepts(doc.text).split('\n')) {
      const toks = tokenize(line, stopwords);
      for (let i = 0; i < toks.length; i++) {
        const w = toks[i];
        freq.set(w, (freq.get(w) || 0) + 1);
        let s = where.get(w);
        if (!s) where.set(w, (s = new Set()));
        s.add(doc.path);
        for (let d = 1; d < window && i + d < toks.length; d++) {
          const u = toks[i + d];
          if (u === w) continue;
          const key = w < u ? w + '\u0001' + u : u + '\u0001' + w;
          const wt = window - d;
          pairs.set(key, (pairs.get(key) || 0) + wt);
          wdeg.set(w, (wdeg.get(w) || 0) + wt);
          wdeg.set(u, (wdeg.get(u) || 0) + wt);
        }
      }
    }
  }
  const ranked = [...wdeg.keys()]
    .sort((a, b) => wdeg.get(b) - wdeg.get(a) || freq.get(b) - freq.get(a) || (a < b ? -1 : 1))
    .slice(0, maxNodes);
  const index = new Map(ranked.map((w, i) => [w, i]));
  const raw = [];
  for (const [key, w] of pairs) {
    const [a, b] = key.split('\u0001');
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia !== undefined && ib !== undefined) raw.push([ia, ib, w]);
  }
  const has = new Uint8Array(ranked.length);
  for (const [a, b] of raw) has[a] = has[b] = 1;
  const keep = ranked.map((_, i) => i).filter((i) => has[i]);
  const re = new Map(keep.map((old, i) => [old, i]));
  const keys = keep.map((i) => ranked[i]);
  return {
    keys,
    labels: keys.map(conceptLabel),
    kinds: keys.map(conceptKind),
    edges: raw.map(([a, b, w]) => [re.get(a), re.get(b), w]),
    freq: keys.map((k) => freq.get(k)),
    where: keys.map((k) => [...where.get(k)]),
  };
}

function buildNoteNetwork(app, files, maxNodes) {
  const idx = new Map(files.map((f, i) => [f.path, i]));
  const pair = new Map();
  const deg = new Float64Array(files.length);
  const rl = app.metadataCache.resolvedLinks;
  for (const f of files) {
    const out = rl[f.path];
    if (!out) continue;
    const a = idx.get(f.path);
    for (const [dst, c] of Object.entries(out)) {
      const b = idx.get(dst);
      if (b === undefined || b === a) continue;
      const key = Math.min(a, b) * 1e6 + Math.max(a, b);
      pair.set(key, (pair.get(key) || 0) + c);
      deg[a] += c;
      deg[b] += c;
    }
  }
  const order = files.map((_, i) => i).filter((i) => deg[i] > 0).sort((a, b) => deg[b] - deg[a]).slice(0, maxNodes);
  const re = new Map(order.map((old, i) => [old, i]));
  const edges = [];
  for (const [key, w] of pair) {
    const a = re.get(Math.floor(key / 1e6));
    const b = re.get(key % 1e6);
    if (a !== undefined && b !== undefined) edges.push([a, b, w]);
  }
  const picked = order.map((i) => files[i]);
  return {
    keys: picked.map((f) => f.path),
    labels: picked.map((f) => f.basename),
    kinds: picked.map(() => 'note'),
    files: picked,
    edges,
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function louvainLevel(n, edges, rand) {
  const adj = Array.from({ length: n }, () => []);
  const k = new Float64Array(n);
  let m2 = 0;
  for (const [a, b, w] of edges) {
    if (a === b) {
      k[a] += 2 * w;
      m2 += 2 * w;
      continue;
    }
    adj[a].push(b, w);
    adj[b].push(a, w);
    k[a] += w;
    k[b] += w;
    m2 += 2 * w;
  }
  const comm = Int32Array.from({ length: n }, (_, i) => i);
  if (m2 === 0) return { comm, moved: false };
  const tot = Float64Array.from(k);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let movedAny = false;
  const kin = new Map();
  for (let pass = 0; pass < 30; pass++) {
    let moved = 0;
    for (const i of order) {
      const ci = comm[i];
      kin.clear();
      const a = adj[i];
      for (let x = 0; x < a.length; x += 2) {
        const c = comm[a[x]];
        kin.set(c, (kin.get(c) || 0) + a[x + 1]);
      }
      tot[ci] -= k[i];
      let best = ci;
      let bestGain = (kin.get(ci) || 0) - (tot[ci] * k[i]) / m2;
      for (const [c, w] of kin) {
        const g = w - (tot[c] * k[i]) / m2;
        if (g > bestGain + 1e-12) {
          bestGain = g;
          best = c;
        }
      }
      tot[best] += k[i];
      if (best !== ci) {
        comm[i] = best;
        moved++;
      }
    }
    if (!moved) break;
    movedAny = true;
  }
  return { comm, moved: movedAny };
}

function louvain(n, edges, seed = 7) {
  const rand = mulberry32(seed);
  let membership = Array.from({ length: n }, (_, i) => i);
  let curN = n;
  let curEdges = edges;
  for (let level = 0; level < 12; level++) {
    const { comm, moved } = louvainLevel(curN, curEdges, rand);
    if (!moved) break;
    const remap = new Map();
    for (let i = 0; i < curN; i++) if (!remap.has(comm[i])) remap.set(comm[i], remap.size);
    membership = membership.map((c) => remap.get(comm[c]));
    const agg = new Map();
    for (const [a, b, w] of curEdges) {
      let x = remap.get(comm[a]);
      let y = remap.get(comm[b]);
      if (x > y) [x, y] = [y, x];
      const key = x * 1e6 + y;
      agg.set(key, (agg.get(key) || 0) + w);
    }
    curEdges = [...agg].map(([key, w]) => [Math.floor(key / 1e6), key % 1e6, w]);
    curN = remap.size;
  }
  return membership;
}

function modularity(edges, comm) {
  const tot = new Map();
  let m2 = 0;
  let inside = 0;
  for (const [a, b, w] of edges) {
    m2 += 2 * w;
    tot.set(comm[a], (tot.get(comm[a]) || 0) + w);
    tot.set(comm[b], (tot.get(comm[b]) || 0) + w);
    if (comm[a] === comm[b]) inside += 2 * w;
  }
  if (!m2) return 0;
  let q = inside / m2;
  for (const t of tot.values()) q -= (t / m2) ** 2;
  return q;
}

function betweenness(n, adj) {
  const bc = new Float64Array(n);
  const sigma = new Float64Array(n);
  const dist = new Int32Array(n);
  const delta = new Float64Array(n);
  const preds = Array.from({ length: n }, () => []);
  const stack = new Int32Array(n);
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    let sp = 0;
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < n; i++) {
      preds[i].length = 0;
      sigma[i] = 0;
      dist[i] = -1;
      delta[i] = 0;
    }
    sigma[s] = 1;
    dist[s] = 0;
    queue[qt++] = s;
    while (qh < qt) {
      const v = queue[qh++];
      stack[sp++] = v;
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue[qt++] = w;
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }
    while (sp > 0) {
      const w = stack[--sp];
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) bc[w] += delta[w];
    }
  }
  return bc;
}

/** fork: what each level means, for the tooltips on the Structure scale. */
const DIVERSITY_MEANING = {
  Biased: 'Biased: one topic covers more than half your notes and the rest hang off it.',
  Focused: 'Focused: a clear core topic with supporting themes around it.',
  Diversified: 'Diversified: several distinct topics that still link to each other.',
  Dispersed: 'Dispersed: many loosely linked islands of notes; see Gaps below.',
};
const DIVERSITY_HINT = {
  Biased: 'One idea dominates. Great for depth — try adding a contrasting perspective.',
  Focused: 'A clear core with supporting themes. Healthy balance, room to branch out.',
  Diversified: 'Several distinct topics that still connect. Ideal for creative thinking.',
  Dispersed: 'Many loosely linked islands. Look at the gaps and build bridges.',
};

function analyzeNetwork(n, edges) {
  const comm = louvain(n, edges);
  const adj = Array.from({ length: n }, () => []);
  const deg = new Float64Array(n);
  for (const [a, b, w] of edges) {
    if (a === b) continue;
    adj[a].push(b);
    adj[b].push(a);
    deg[a] += w;
    deg[b] += w;
  }
  const bc = betweenness(n, adj);
  let maxBc = 1e-9;
  let maxDeg = 1e-9;
  for (let i = 0; i < n; i++) {
    maxBc = Math.max(maxBc, bc[i]);
    maxDeg = Math.max(maxDeg, deg[i]);
  }
  const score = Array.from({ length: n }, (_, i) => 0.75 * Math.sqrt(bc[i] / maxBc) + 0.25 * Math.sqrt(deg[i] / maxDeg));

  const groups = new Map();
  comm.forEach((c, i) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  });
  const topics = [...groups.values()]
    .map((members) => {
      members.sort((a, b) => score[b] - score[a]);
      return { members, weight: members.reduce((s, i) => s + score[i], 0) };
    })
    .sort((a, b) => b.weight - a.weight);
  const cid = new Int32Array(n);
  topics.forEach((t, k) => {
    t.id = k;
    t.share = t.members.length / n;
    for (const i of t.members) cid[i] = k;
  });
  const Q = modularity(edges, cid);

  const cross = new Map();
  for (const [a, b, w] of edges) {
    const x = cid[a];
    const y = cid[b];
    if (x === y) continue;
    const key = Math.min(x, y) * 1000 + Math.max(x, y);
    cross.set(key, (cross.get(key) || 0) + w);
  }
  const big = topics.filter((t) => t.members.length >= 3).slice(0, 6);
  const gaps = [];
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const A = big[i];
      const B = big[j];
      const w = cross.get(Math.min(A.id, B.id) * 1000 + Math.max(A.id, B.id)) || 0;
      gaps.push({ a: A.id, b: B.id, weight: w, density: w / (A.members.length * B.members.length) });
    }
  }
  gaps.sort((x, y) => x.density - y.density || x.a + x.b - (y.a + y.b));

  const topShare = topics[0] ? topics[0].share : 1;
  let diversity;
  if (Q >= 0.65) diversity = 'Dispersed';
  else if (Q >= 0.4) diversity = 'Diversified';
  else if (Q >= 0.2 && topShare < 0.5) diversity = 'Focused';
  else diversity = 'Biased';

  return { comm: cid, bc, deg, score, adj, topics, gaps: gaps.slice(0, 3), Q, diversity };
}

/* @src src/deck/force-layout.js */
/* ------------------------------------------------------------------ */
/* Force layout                                                        */
/* ------------------------------------------------------------------ */

class ForceSim {
  constructor(nodes, links) {
    this.nodes = nodes;
    this.links = links;
    this.alpha = 1;
    this.charge = 70;
    const cnt = new Float64Array(nodes.length);
    for (const l of links) {
      cnt[l.s.i]++;
      cnt[l.t.i]++;
    }
    for (const l of links) {
      l.bias = cnt[l.s.i] / (cnt[l.s.i] + cnt[l.t.i]);
      l.k = (0.35 + 0.65 * Math.min(1, Math.log2(1 + l.w) / 4)) / Math.min(cnt[l.s.i], cnt[l.t.i]);
      l.len = 34 + (l.s.r + l.t.r) * 1.3;
    }
    this.nc = nodes.reduce((m, n) => Math.max(m, n.c), 0) + 1;
    this.cx = new Float64Array(this.nc);
    this.cy = new Float64Array(this.nc);
    this.cn = new Float64Array(this.nc);
  }
  tick() {
    const ns = this.nodes;
    const n = ns.length;
    const a = this.alpha;
    for (const l of this.links) {
      const s = l.s;
      const t = l.t;
      let dx = t.x + t.vx - s.x - s.vx;
      let dy = t.y + t.vy - s.y - s.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = ((d - l.len) / d) * a * l.k;
      dx *= f;
      dy *= f;
      t.vx -= dx * l.bias;
      t.vy -= dy * l.bias;
      s.vx += dx * (1 - l.bias);
      s.vy += dy * (1 - l.bias);
    }
    for (let i = 0; i < n; i++) {
      const p = ns[i];
      for (let j = i + 1; j < n; j++) {
        const q = ns[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 640000) continue;
        if (d2 < 1) {
          dx = 0.5 + (i % 7) * 0.1;
          dy = 0.5 - (j % 5) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        const f = (this.charge * (1 + (p.r + q.r) / 20) * a) / d2;
        p.vx -= dx * f;
        p.vy -= dy * f;
        q.vx += dx * f;
        q.vy += dy * f;
      }
    }
    const { cx, cy, cn } = this;
    cx.fill(0);
    cy.fill(0);
    cn.fill(0);
    for (const p of ns) {
      cx[p.c] += p.x;
      cy[p.c] += p.y;
      cn[p.c]++;
    }
    for (const p of ns) {
      const c = p.c;
      p.vx += (cx[c] / cn[c] - p.x) * 0.05 * a - p.x * 0.012 * a;
      p.vy += (cy[c] / cn[c] - p.y) * 0.05 * a - p.y * 0.012 * a;
    }
    for (const p of ns) {
      if (p.fixed) {
        p.vx = p.vy = 0;
        continue;
      }
      p.vx *= 0.6;
      p.vy *= 0.6;
      p.x += p.vx;
      p.y += p.vy;
    }
    for (let i = 0; i < n; i++) {
      const p = ns[i];
      for (let j = i + 1; j < n; j++) {
        const q = ns[j];
        const min = p.r + q.r + 6;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        const wp = p.fixed ? 0 : q.fixed ? 1 : 0.5;
        const wq = q.fixed ? 0 : p.fixed ? 1 : 0.5;
        p.x -= dx * push * wp * 2;
        p.y -= dy * push * wp * 2;
        q.x += dx * push * wq * 2;
        q.y += dy * push * wq * 2;
      }
    }
    this.alpha += (0 - this.alpha) * 0.02;
  }
}

/* @src src/deck/pattern-shader.js */
/* Live pattern background: the patterns, their settings labels and the WebGL shaders (used by pattern.js) */

const PATTERNS = ['damascus', 'prism', 'meteorite', 'topo', 'hex', 'datastream', 'blackice', 'none'];
const PATTERN_LABEL = {
  damascus: 'Damascus', meteorite: 'Meteorite', topo: 'Topo', prism: 'Prism', hex: 'Hex mesh',
  datastream: 'Datastream', blackice: 'Black ICE', none: 'None',
};
const PATTERN_MODE = { damascus: 0, meteorite: 1, topo: 2, prism: 3, hex: 4, datastream: 5, blackice: 6 };
const STRENGTHS = ['off', 'subtle', 'bold'];
const STRENGTH_LABEL = { off: 'Off', subtle: 'Subtle', bold: 'Bold' };
// 10% softer than the first 1.3.0 build (Yobz, 2 Nov)
const STRENGTH_ALPHA = { subtle: [0.063, 0.45], bold: [0.117, 0.765] };
const LOOP_MS = 40000;
const MAX_RECTS = 24;

const PAT_VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const PAT_FRAG = `
precision highp float;
uniform vec2 uRes;uniform float uDpr;uniform float uOff;uniform float uT;uniform vec3 uCol;uniform vec3 uMouse;
uniform float uAOut;uniform float uAIn;uniform float uMode;uniform float uRad;
uniform vec4 uRects[${MAX_RECTS}];uniform float uN;uniform vec4 uSeeds[16];uniform vec4 uSeeds2[16];
const float PI=3.14159265;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float sdRR(vec2 p,vec4 r,float rad){vec2 c=r.xy+r.zw*.5;vec2 q=abs(p-c)-r.zw*.5+rad;return length(max(q,0.))+min(max(q.x,q.y),0.)-rad;}
float damascus(vec2 c,float ph){
  // folded: one slow smooth field bends the layers (calm like Topo, no fine noise)
  float f=sin(c.x/240.+.5*sin(ph))+.8*sin(c.y/190.-c.x/430.+.4*cos(ph))+.45*sin((c.x-c.y)/130.+ph);
  // twisted: the layers curl over themselves in slow loops
  float t=sin(c.x/115.+f*1.6)*sin(c.y/145.-f);
  // stacked layers along y; ph/PI drifts exactly 2 layers per loop, so the loop is seamless
  float w=c.y/44.+f*2.6+t*1.3+ph/PI;
  return 1.-smoothstep(.02,.11,abs(fract(w)-.5));
}
float prism(vec2 c,float ph){
  // three layers of isometric cubes, near (big, bright, fast) to far; the first cube hit hides the ones behind
  for(int L=0;L<3;L++){
    float fl=float(L);
    float s=150.-45.*fl;
    // each layer circles once per loop, the near one furthest, so they slide past each other (parallax)
    vec2 p=c+vec2(cos(ph+fl*2.1),sin(ph+fl*2.1))*(26.-8.*fl)+vec2(0.,fl*37.);
    vec2 r=vec2(1.,1.7320508)*s;vec2 h=r*.5;
    vec2 a=mod(p,r)-h;vec2 b=mod(p-h,r)-h;vec2 g=dot(a,a)<dot(b,b)?a:b;vec2 id=floor((p-g)/s*2.+.5);
    float hs=h21(id+fl*17.3);
    if(hs<.5+.12*fl)continue;
    float ir=s*.5*(.55+.4*h21(id+fl*5.1+.7))*(.93+.07*sin(ph+hs*6.2832));
    float hd=max(abs(g.x),abs(g.x)*.5+abs(g.y)*.8660254);
    if(hd>ir)continue;
    // lit top, mid left side, dark right side
    float ang=atan(-g.y,g.x);
    float shade=(ang>.5236&&ang<2.618)?.95:(g.x<0.?.6:.32);
    // thin gaps along the three near edges and the outline give the cube its shape
    float e=1e9;
    if(dot(g,vec2(.866,-.5))>0.)e=min(e,abs(g.x*.5+g.y*.866));
    if(dot(g,vec2(-.866,-.5))>0.)e=min(e,abs(g.x*.5-g.y*.866));
    if(g.y>0.)e=min(e,abs(g.x));
    // about a third are wireframes: only the edges, so the layers behind show through
    if(h21(id+fl*3.7+.2)>.66){
      float line=max(1.-smoothstep(2.,5.,e),1.-smoothstep(2.,5.,ir-hd));
      if(line<.05)continue;
      return line*.9*(1.-.28*fl);
    }
    return shade*smoothstep(1.,3.,e)*smoothstep(1.,3.,ir-hd)*(1.-.28*fl);
  }
  return 0.;
}
float lam(vec2 p,float ang,float per,float wt,float off,float ph){
  float d=p.x*cos(ang)+p.y*sin(ang),q=-p.x*sin(ang)+p.y*cos(ang);
  float wob=sin(q/61.+off)*1.4+sin(d/233.+off*2.)*3.;
  // softer lines (power 4, was 10): wide enough for the dots to show the waves
  return wt*pow(max(0.,sin(d/per+wob+ph)),4.);
}
float meteorite(vec2 c,float ph){
  float bd=1e12,b2=1e12;vec4 G=vec4(0.);vec4 H=vec4(0.);
  for(int i=0;i<16;i++){vec2 s=uSeeds[i].xy;float dd=dot(c-s,c-s);
    if(dd<bd){b2=bd;bd=dd;G=uSeeds[i];H=uSeeds2[i];}else if(dd<b2){b2=dd;}}
  float edge=sqrt(b2)-sqrt(bd);float a=G.z;
  // the lamella lines bend in slow waves that drift through each crystal
  vec2 wv=c+vec2(14.*sin(c.y/90.+ph*.5+H.x*6.2832),14.*sin(c.x/110.-ph*.5+H.y*6.2832));
  float l=max(lam(wv,a,4.6+H.x*3.,1.,H.y*9.,ph),max(lam(wv,a+PI/3.,5.+H.y*4.,.25+H.z*.6,H.x*7.,ph),lam(wv,a+2.*PI/3.,3.8+H.z*3.,.15+H.x*.5,H.z*5.,ph)))*G.w;
  // a gentle swell rolls across the whole surface (no flicker, no flashes)
  l*=.85+.25*sin((c.x*.6+c.y)/260.-ph);
  // a light that follows the mouse
  vec2 dm=c-vec2(uMouse.x,uMouse.y+uOff);
  float mg=uMouse.z*exp(-dot(dm,dm)/(2.*120.*120.));
  l=min(1.,l*(1.+mg*.55));
  // soft seams where crystals meet
  l=max(l,(1.-smoothstep(2.,7.,edge))*(.42+.14*mg));
  return l;
}
float topo(vec2 c,float ph){
  float n=sin(c.x/210.+sin(c.y/170.)*1.3+.4*sin(ph))+sin(c.y/150.-c.x/330.+.3*cos(ph))+.6*sin((c.x+c.y)/95.+ph)+.5*sin(c.x/57.-c.y/83.);
  float d=abs(fract(n*2.2)-.5);
  return 1.-smoothstep(.0,.07,d);
}
float hexmesh(vec2 p,float ph){
  float s=26.;vec2 r=vec2(1.,1.7320508);vec2 h=r*.5*s;
  vec2 a=mod(p,r*s)-h;vec2 b=mod(p-h,r*s)-h;vec2 g=dot(a,a)<dot(b,b)?a:b;vec2 id=p-g;
  vec2 q=abs(g);float e=max(dot(q,normalize(r)),q.x);float edge=1.-smoothstep(s*.40,s*.47,e);
  float rim=smoothstep(s*.36,s*.46,e);
  float fade=.35+.65*smoothstep(-.6,1.,sin(p.x/420.+p.y/360.));
  float hs=h21(floor(id/s*7.)+.5);float lit=step(.94,hs)*(.6+.4*sin(ph+hs*40.));
  return max(rim*edge*fade,lit*.8*(1.-rim));
}
float datastream(vec2 p,float ph){
  float row=floor(p.y/12.);float rh=h21(vec2(row,3.1));float dir=rh>.5?1.:-1.;
  float x=p.x+dir*ph/(2.*PI)*16.*8.*(1.+floor(rh*3.));
  float seg=floor(x/16.);float on=step(.55,h21(vec2(seg,row)));float fy=mod(p.y,12.);
  float glyph=on*step(3.,fy)*step(fy,9.)*step(2.,mod(x,16.))*step(mod(x,16.),13.);
  float bars=0.;float band=step(.86,h21(vec2(floor(p.y/96.),9.)));
  if(band>0.){float bx=floor(p.x/3.);bars=step(.5,h21(vec2(bx,floor(p.y/96.))));}
  float scan=step(mod(p.y,4.),1.)*.25;
  return max(max(glyph*(.5+.5*rh),bars*.6),scan);
}
// Black ICE: a low-poly mesh whose corners drift, so the triangles keep stretching and re-forming.
// Each grid corner moves on its own slow loop; every cell is two triangles sharing its corners.
vec3 iceV(vec2 c,float ph){
  float h1=h21(c+.13),h2=h21(c+7.7),h3=h21(c+3.1);
  // integer speeds keep the whole animation looping with ph; drift stays under .25 of a cell so no triangle flips
  vec2 o=vec2(sin(ph*(1.+floor(h1*2.))+h2*6.2832),cos(ph*(1.+floor(h2*2.))+h3*6.2832))*.24;
  // z: a slowly rising and falling height, for flat shading
  float z=sin(ph+h3*6.2832)*.5+.5;
  return vec3((c+.5+o)*140.,z);
}
float blackice(vec2 p,float ph){
  vec2 c0=floor(p/140.-.5);
  // the 4x4 corners around this pixel, computed once (the 3x3 cells below share them)
  vec3 V[16];
  for(int j=0;j<4;j++)for(int i=0;i<4;i++)V[j*4+i]=iceV(c0+vec2(float(i-1),float(j-1)),ph);
  for(int j=0;j<3;j++)for(int i=0;i<3;i++){
    vec3 A=V[j*4+i],B=V[j*4+i+1],C=V[j*4+i+5],D=V[j*4+i+4];
    for(int k=0;k<2;k++){
      vec3 P0=A,P1=k==0?B:C,P2=k==0?C:D;
      vec2 e0=P1.xy-P0.xy,e1=P2.xy-P1.xy,e2=P0.xy-P2.xy;
      float s0=e0.x*(p.y-P0.y)-e0.y*(p.x-P0.x),s1=e1.x*(p.y-P1.y)-e1.y*(p.x-P1.x),s2=e2.x*(p.y-P2.y)-e2.y*(p.x-P2.x);
      if(!((s0>=0.&&s1>=0.&&s2>=0.)||(s0<=0.&&s1<=0.&&s2<=0.)))continue;
      // pixel distance to the nearest edge and corner
      float de=min(min(abs(s0)/length(e0),abs(s1)/length(e1)),abs(s2)/length(e2));
      float dv=min(min(distance(p,P0.xy),distance(p,P1.xy)),distance(p,P2.xy));
      // flat shading: the facet's tilt (from the corner heights) against a fixed light
      vec3 n=normalize(cross(vec3(e0,(P1.z-P0.z)*60.),vec3(-e2,(P2.z-P0.z)*60.)));
      float shade=.12+.34*clamp(dot(n,normalize(vec3(-.4,-.6,.7)))*.5+.5,0.,1.);
      float line=(1.-smoothstep(.6,1.9,de))*.9;
      float vtx=(1.-smoothstep(1.8,3.4,dv));
      return max(shade,max(line,vtx)); // a pixel lies in one triangle: done
    }
  }
  return 0.;
}
float field(vec2 c,float ph){
  if(uMode<.5)return damascus(c,ph);
  if(uMode<1.5)return meteorite(c,ph);
  if(uMode<2.5)return topo(c,ph);
  return prism(c,ph);
}
void main(){
  vec2 px=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;
  vec2 p=px+vec2(0.,uOff);
  float ph=uT*2.*PI;float a=0.;
  if(uMode<3.5){
    float g=6.;float rowH=g*.866;float r0=floor(p.y/rowH);float best=1e9;vec2 bc=vec2(0.);
    for(int k=0;k<2;k++){float rr=r0+float(k);float off=mod(rr,2.)*g*.5;vec2 cc=vec2(floor((p.x-off)/g+.5)*g+off,rr*rowH);
      float dd=distance(p,cc);if(dd<best){best=dd;bc=cc;}}
    // dots fade in as they grow instead of popping on at a size cutoff (that popping looked like glitches)
    float v=field(bc,ph);float rad=v*g*.44;a=(1.-smoothstep(rad-.6,rad+.6,best))*smoothstep(.15,.7,rad);
  } else if(uMode<4.5) a=hexmesh(p,ph);
  else if(uMode<5.5) a=datastream(p,ph);
  else a=blackice(p,ph);
  float inside=0.;
  for(int i=0;i<${MAX_RECTS};i++){if(float(i)>=uN)break;float d=sdRR(px,uRects[i],uRad);inside=max(inside,1.-smoothstep(-1.,1.,d));}
  // Black ICE is mostly thin lines, so it gets more strength between the cards to stand out
  float al=min(1.,a*mix(uAOut*(uMode>5.5?2.6:1.),uAIn,inside));
  gl_FragColor=vec4(uCol*al,al);
}`;
/* @src src/deck/pattern.js */
/* ------------------------------------------------------------------ */
/* Live pattern background (WebGL)                                     */
/* One canvas behind a view. Cards are solid in the middle, so the     */
/* pattern only shows at card edges and, very faintly, in the gaps.    */
/* ------------------------------------------------------------------ */

class PatternLayer {
  /**
   * host: element that does NOT scroll (position: relative); scroller: the
   * scrolling element inside it; cardSel: selector of the "window" cards.
   */
  constructor(plugin, host, scroller, cardSel) {
    this.plugin = plugin;
    this.host = host;
    this.scroller = scroller;
    this.cardSel = cardSel;
    this.t = 0;
    this.last = 0;
    this.raf = 0;
    this.dirty = true;
    // fork: no WebGL pattern on phones and tablets (a full-pane shader can freeze a phone); plain background
    if (NEON_MOBILE.on) {
      this.canvas = null;
      return;
    }
    this.canvas = host.createEl('canvas', { cls: 'nd-pattern-canvas' });
    host.prepend(this.canvas);
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    this.gl = gl;
    if (!gl || !this.compile()) {
      this.canvas.remove();
      this.canvas = null;
      return;
    }
    this.seedMeteorite();
    this.onResize = () => {
      this.dirty = true;
      this.kick();
    };
    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(host);
    this.onScroll = () => this.kick();
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    // Cards slide in (and lift on hover), and widgets mount after the view: redraw once things settle,
    // or the cut-outs stay where the cards were mid-animation (an offset second outline behind each card
    // whenever the pattern isn't animating, e.g. right after a reload with Obsidian in the background).
    this.onSettle = () => this.kick();
    scroller.addEventListener('animationend', this.onSettle, true);
    scroller.addEventListener('transitionend', this.onSettle, true);
    this.mo = new MutationObserver((recs) => {
      const isCard = (n) => n.nodeType === 1 && (n.matches(this.cardSel) || !!n.querySelector(this.cardSel));
      if (recs.some((r) => [...r.addedNodes].some(isCard) || [...r.removedNodes].some(isCard))) this.kick();
    });
    this.mo.observe(scroller, { childList: true, subtree: true });
    // mouse light (Meteorite): position in host pixels, strength fades in and out
    this.mouse = { x: -9999, y: -9999, s: 0, at: 0 };
    this.onMove = (e) => {
      if (this.plugin.activePattern() !== 'meteorite' || prefersReducedMotion()) return;
      const r = host.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.at = performance.now();
      this.kick();
    };
    this.onLeave = () => {
      this.mouse.at = 0;
      this.kick();
    };
    host.addEventListener('mousemove', this.onMove, { passive: true });
    host.addEventListener('mouseleave', this.onLeave);
    this.onWake = () => this.kick();
    window.addEventListener('focus', this.onWake);
    window.addEventListener('blur', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    this.unsub = plugin.onLook(() => {
      this.dirty = true;
      this.kick();
    });
    this.kick();
  }
  compile() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(`${appName()} – Dashboard: pattern shader`, gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, PAT_VERT);
    const fs = sh(gl.FRAGMENT_SHADER, PAT_FRAG);
    if (!vs || !fs) return false;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uRes', 'uDpr', 'uOff', 'uT', 'uCol', 'uMouse', 'uAOut', 'uAIn', 'uMode', 'uRad', 'uRects', 'uN', 'uSeeds', 'uSeeds2']) this.u[n] = gl.getUniformLocation(pr, n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }
  seedMeteorite() {
    let r = 7;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const a = [];
    const b = [];
    for (let i = 0; i < 16; i++) {
      a.push(rnd() * 1800, rnd() * 1500, rnd() * Math.PI, 0.55 + rnd() * 0.45);
      b.push(rnd(), rnd(), rnd(), 0);
    }
    this.gl.uniform4fv(this.u.uSeeds, new Float32Array(a));
    this.gl.uniform4fv(this.u.uSeeds2, new Float32Array(b));
  }
  look() {
    const s = this.plugin.settings;
    const pattern = this.plugin.activePattern();
    const strength = s.patternStrength;
    return { pattern, strength, on: pattern !== 'none' && strength !== 'off' };
  }
  animating() {
    const s = this.plugin.settings;
    return (
      s.patternMotion &&
      !NEON_MOBILE.on && // fork: a still pattern on phones and tablets (battery)
      !prefersReducedMotion() &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      this.host.isConnected &&
      this.host.offsetParent !== null
    );
  }
  kick() {
    if (!this.canvas || this.raf) return;
    this.raf = window.requestAnimationFrame((now) => this.frame(now));
  }
  frame(now) {
    this.raf = 0;
    if (!this.canvas || !this.host.isConnected) return;
    const anim = this.animating();
    if (anim) {
      if (this.last) this.t = (this.t + (now - this.last) / LOOP_MS) % 1;
      this.last = now;
    } else this.last = 0;
    // ease the mouse light toward on (moved in the last 0.7 s) or off
    const m = this.mouse;
    const target = m && m.at && now - m.at < 700 ? 1 : 0;
    if (m) m.s += (target - m.s) * 0.2;
    const fading = m && Math.abs(target - m.s) > 0.01;
    if (m && !fading) m.s = target;
    this.draw();
    // ~20 fps is plenty for a 40 s loop; idle views draw only on change.
    // Only one timer at a time: extra kicks (scroll, mouse) must not start extra loops.
    if ((anim || fading) && !this.timer) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.kick();
      }, anim ? 50 : 33);
    }
  }
  draw() {
    const lk = this.look();
    // only touch the classes when on/off changes: setting them every frame made the page restyle ~20×/s
    if (this.shownOn !== lk.on) {
      this.shownOn = lk.on;
      this.canvas.toggleClass('is-hidden', !lk.on);
      this.host.toggleClass('nd-has-pattern', lk.on);
    }
    if (!lk.on) return;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    if (!W || !H) return;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    if (this.dirty) {
      const cs = getComputedStyle(this.host);
      this.col = parseColor(cs.getPropertyValue('--nd-pattern').trim() || '#e5506a');
      this.radius = parseFloat(cs.getPropertyValue('--nd-radius')) || 22;
      this.dirty = false;
    }
    const hr = this.host.getBoundingClientRect();
    const rects = [];
    for (const el of this.scroller.querySelectorAll(this.cardSel)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < hr.top || r.top > hr.bottom || !r.width) continue;
      rects.push(r.left - hr.left, r.top - hr.top, r.width, r.height);
      if (rects.length >= MAX_RECTS * 4) break;
    }
    const n = rects.length / 4;
    this.lastRects = rects.slice(); // what the cut-outs were drawn from (handy when checking alignment)
    while (rects.length < MAX_RECTS * 4) rects.push(0, 0, 0, 0);
    const [aOut, aIn] = STRENGTH_ALPHA[lk.strength] || STRENGTH_ALPHA.subtle;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uDpr, dpr);
    gl.uniform1f(this.u.uOff, this.scroller.scrollTop);
    gl.uniform1f(this.u.uT, this.t);
    gl.uniform3f(this.u.uCol, ...this.col);
    gl.uniform3f(this.u.uMouse, this.mouse ? this.mouse.x : -9999, this.mouse ? this.mouse.y : -9999, this.mouse ? this.mouse.s : 0);
    gl.uniform1f(this.u.uAOut, aOut);
    gl.uniform1f(this.u.uAIn, aIn);
    gl.uniform1f(this.u.uMode, PATTERN_MODE[lk.pattern] || 0);
    gl.uniform1f(this.u.uRad, this.radius);
    gl.uniform4fv(this.u.uRects, new Float32Array(rects));
    gl.uniform1f(this.u.uN, n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  destroy() {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (this.ro) this.ro.disconnect();
    if (this.scroller && this.onScroll) this.scroller.removeEventListener('scroll', this.onScroll);
    if (this.scroller && this.onSettle) {
      this.scroller.removeEventListener('animationend', this.onSettle, true);
      this.scroller.removeEventListener('transitionend', this.onSettle, true);
    }
    if (this.mo) this.mo.disconnect();
    if (this.onMove) this.host.removeEventListener('mousemove', this.onMove);
    if (this.onLeave) this.host.removeEventListener('mouseleave', this.onLeave);
    window.removeEventListener('focus', this.onWake);
    window.removeEventListener('blur', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
    if (this.unsub) this.unsub();
    if (this.gl) {
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    if (this.canvas) this.canvas.remove();
    this.canvas = null;
  }
}
/** CSS colour -> [r,g,b] in 0..1 */
function parseColor(str) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = str;
  const v = c.fillStyle;
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const m = v.match(/[\d.]+/g) || [0, 0, 0];
  return m.slice(0, 3).map((x) => Number(x) / 255);
}

/* @src src/deck/modals.js */
/* ------------------------------------------------------------------ */
/* Small modals                                                        */
/* ------------------------------------------------------------------ */

class FileListModal extends SuggestModal {
  constructor(plugin, files, placeholder) {
    super(plugin.app);
    this.plugin = plugin;
    this.files = files;
    this.setPlaceholder(placeholder);
    this.modalEl.addClass('nd-modal');
  }
  getSuggestions(q) {
    q = q.toLowerCase();
    return this.files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 300);
  }
  renderSuggestion(f, el) {
    el.addClass('nd-suggest');
    el.createDiv({ cls: 'nd-suggest-title', text: f.basename });
    const parent = f.parent && f.parent.path !== '/' ? f.parent.path : '';
    el.createDiv({ cls: 'nd-suggest-meta', text: `${parent ? parent + ' · ' : ''}${moment(f.stat.mtime).fromNow()}` });
  }
  onChooseSuggestion(f, evt) {
    openFile(this.app, f, evt);
  }
}

/** Activity: one day in a pop-up — worked time, then tasks, tickets, time entries and notes, each clickable. */
class ActivityDayModal extends Modal {
  constructor(plugin, day, x) {
    super(plugin.app);
    this.plugin = plugin;
    this.day = day;
    this.x = x || { tasks: [], tickets: [], time: [], notes: [], worked: null };
  }
  onOpen() {
    const x = this.x;
    this.modalEl.addClass('nd-modal', 'nd-root', 'nd-act-pop');
    this.titleEl.setText(this.day.format('dddd D MMMM'));
    const c = this.contentEl;
    const facts = c.createDiv('nd-act-pop-facts');
    const fact = (v, l) => {
      const f = facts.createDiv('nd-act-pop-fact');
      f.createDiv({ cls: 'nd-act-pop-v', text: String(v) });
      f.createDiv({ cls: 'nd-act-pop-l', text: l });
    };
    if (x.worked) fact(fmtMin(x.worked), x.over ? `worked · +${fmtMin(x.over)}` : 'worked');
    fact(x.tasks.length, 'tasks');
    fact(x.tickets.length, x.tickets.length === 1 ? 'project' : 'projects');
    fact(x.notes.length, 'notes');
    let i = 0;
    for (const [kind, label, list] of [['task', 'Tasks done', x.tasks], ['ticket', 'Projects', x.tickets], ['time', 'Time', x.time], ['note', 'Notes', x.notes]]) {
      if (!list.length) continue;
      const sec = c.createDiv('nd-act-pop-sec');
      sec.createDiv({ cls: 'nd-act-pop-head', text: `${label} · ${list.length}` });
      for (const r of list.slice().sort((a, b) => a.t - b.t)) {
        const el = sec.createDiv(`nd-act-item is-${kind}` + (r.open ? ' is-clickable' : ''));
        el.style.setProperty('--i', String(Math.min(i++, 20)));
        icon(el, { task: 'check', ticket: 'briefcase', time: 'clock', note: 'file-text' }[kind], 'nd-ico');
        el.createSpan({ cls: 'nd-act-item-text', text: r.text });
        if (r.extra) el.createSpan({ cls: 'nd-act-pop-extra', text: r.extra });
        el.createSpan({ cls: 'nd-act-pop-at', text: moment(r.t).format('HH:mm') });
        if (r.open)
          el.addEventListener('click', (e) => {
            this.close();
            r.open(e);
          });
      }
    }
    if (!i) c.createDiv({ cls: 'nd-act-none', text: 'Nothing on this day.' });
  }
  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Quick capture box (Ctrl+Shift+Space). Type, pick a target with Tab /
 * Shift+Tab or Alt+1…9, Enter saves.
 */
class QuickCaptureModal extends Modal {
  constructor(plugin, initial = '') {
    super(plugin.app);
    this.plugin = plugin;
    this.initial = initial;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nd-qc-modal');
    this.titleEl.setText('Quick capture');
    const targets = this.plugin.captureTargets();
    if (!targets.length) {
      this.contentEl.createDiv({ cls: 'nd-muted', text: 'Turn on Tasks, Projects or Time in the settings to capture into them.' });
      return;
    }
    let idx = Math.max(0, targets.findIndex((t) => t.id === this.plugin.lastCaptureTarget));
    const input = this.contentEl.createEl('textarea', { cls: 'nd-input nd-qc-input', attr: { rows: '2', placeholder: 'Type, pick where it goes, Enter…' } });
    input.value = this.initial;
    const row = this.contentEl.createDiv('nd-qc-targets');
    const btns = targets.map((t, i) => {
      const b = row.createEl('button', { cls: 'nd-pill-btn', attr: { type: 'button' } });
      icon(b, t.icon || 'dot');
      b.createSpan({ text: t.label });
      b.createSpan({ cls: 'nd-kbd', text: String(i + 1) });
      b.addEventListener('click', () => {
        idx = i;
        sync();
        go();
      });
      return b;
    });
    const hint = this.contentEl.createDiv({ cls: 'nd-qc-hint', text: 'Tab picks the target · Alt+1…' + targets.length + ' jumps · Enter saves · Shift+Enter new line' });
    const sync = () => btns.forEach((b, i) => b.toggleClass('is-on', i === idx));
    const go = async () => {
      const v = input.value.trim();
      const t = targets[idx];
      if (!t) return;
      if (!v && !t.allowEmpty) {
        input.focus();
        return;
      }
      this.plugin.lastCaptureTarget = t.id;
      this.close();
      try {
        await t.run(v);
      } catch (e) {
        console.error(`${appName()} – Dashboard: capture`, e);
        new Notice('Capture failed — see console');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        idx = (idx + (e.shiftKey ? targets.length - 1 : 1)) % targets.length;
        sync();
      } else if (e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= targets.length) {
        e.preventDefault();
        idx = Number(e.key) - 1;
        sync();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        go();
      }
    });
    sync();
    hint.toggle(targets.length > 1);
    window.setTimeout(() => input.focus(), 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}


/** Folder colour…: swatches, any colour from the picker, or back to the category colour. */
class FolderColorModal extends Modal {
  constructor(plugin, folder) {
    super(plugin.app);
    this.plugin = plugin;
    this.folder = folder;
    this.modalEl.addClass('nd-modal', 'nd-color-modal');
  }
  onOpen() {
    const { contentEl } = this;
    const cur = this.plugin.settings.folderColors[this.folder.path] || null;
    this.titleEl.setText(`Folder colour · ${this.folder.name}`);
    const set = async (c) => {
      await this.plugin.setFolderColor(this.folder.path, c);
      this.close();
    };
    const grid = contentEl.createDiv('nd-swatches');
    for (const c of FOLDER_COLORS) {
      const b = grid.createEl('button', { cls: 'nd-swatch' + (c === cur ? ' is-on' : ''), attr: { type: 'button', 'aria-label': c } });
      b.style.setProperty('--sw', c);
      b.addEventListener('click', () => set(c));
    }
    const row = contentEl.createDiv('nd-modal-row');
    const pick = row.createEl('input', { cls: 'nd-color-pick', attr: { type: 'color', 'aria-label': 'Any colour' } });
    pick.value = cur && cur.startsWith('#') ? cur : '#a855f7';
    pick.addEventListener('change', () => set(pick.value));
    row.createSpan({ cls: 'nd-color-hint', text: 'Any colour' });
    button(row, { icon: 'rotate-ccw', text: 'Automatic (category)', onClick: () => set(null) });
  }
  onClose() {
    this.contentEl.empty();
  }
}
/* @src src/deck/dashboard.js */
/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/** Default 4×4 layout; satellite slots fall back to their neighbours. */
// fork: Inbox, Tasks and Todo on top; status cards (Vault pulse, Totals) on the bottom row
const DASH_LAYOUT = [
  ['inbox', 'tasks', 'global', 'tickets'],
  ['inbox', 'tasks', 'global', 'tickets'],
  ['recent', 'activity', 'activity', 'time'],
  ['claude', 'pulse', 'pulse', 'time'], // fork: one Stats card (Vault pulse and Totals merged); Time today full height // fork: the Claude (or Areas) card
];
/** Smallest grid height: the row minimums in styles-dashboard.css (150 + 150 + 290 + 140) plus 3 gaps of 14. */
const DASH_GRID_MIN = 772; // Activity needs 290 for six full weeks
const SLOT_FALLBACK = { inbox: 'tasks', tasks: 'global', global: 'tasks', tickets: 'time', time: 'tickets', claude: 'recent' }; // claude falls back to Recently done above it // fork: + inbox; the Quick capture card is gone (the quick capture panel does it)

function dashAreas(present) {
  const resolve = (name) => {
    const seen = new Set();
    let n = name;
    while (n && !present.has(n) && !seen.has(n)) {
      seen.add(n);
      n = SLOT_FALLBACK[n] || null;
    }
    if (n && present.has(n)) return n;
    // fork: last resorts that keep every card a rectangle: the top middle falls back to Activity, the right column to Totals
    return { tasks: 'activity', global: 'activity' }[name] || null; // a right column with neither Projects nor Time is dropped
  };
  let rows = DASH_LAYOUT.map((r) => r.map(resolve));
  const cols = rows[0].map((_, c) => rows.some((r) => r[c] !== null));
  rows = rows.map((r) => r.filter((_, c) => cols[c]));
  return { areas: rows.map((r) => `"${r.join(' ')}"`).join(' '), cols: rows[0].length };
}

class DashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.dataToken = 0;
    this.slotCards = new Map();
    // last numbers shown, so tiles count from there when a value changes
    this.prevNums = new Map();
  }
  getViewType() {
    return VIEW_DASH;
  }
  getDisplayText() {
    return 'Dashboard';
  }
  getIcon() {
    return 'layout-dashboard';
  }

  async onOpen() {
    addHelpAction(this, 'dashboard'); // fork: the ? button in the header (src/shared/help.js)
    if (neonMother) neonMother.step('opening the dashboard'); // fork: start-up trace
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-dash', 'nd-pattern-host');
    this.scroller = root.createDiv('nd-dash-scroll');
    const inner = this.scroller.createDiv('nd-dash-inner');
    this.buildHero(inner);
    // the ticker is the pin board's resting form: it swells into the Dynamic Island
    this.tickerEl = inner.createDiv({ cls: 'nd-ticker', attr: { role: 'button', tabindex: '0', 'aria-label': 'Open pin board' } });
    this.tickerEl.addEventListener('click', () => this.plugin.toggleIsland());
    this.tickerEl.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.plugin.toggleIsland()));
    this.grid = inner.createDiv('nd-dash-grid is-entering');
    window.setTimeout(() => this.grid && this.grid.removeClass('is-entering'), 900);
    // fork: Vault pulse and Totals are one Stats card: the work figures, then the vault's, in one grid of tiles
    this.stats = this.place(widget(this.grid, 'nd-w-stats', 'Stats', 'activity', 'your work and your vault'), 'pulse');
    const statsGrid = this.stats.body.createDiv('nd-stats');
    this.totals = { body: statsGrid.createDiv('nd-tiles nd-stats-part') };
    this.pulseEl = statsGrid.createDiv('nd-tiles nd-stats-part');
    this.recent = this.place(widget(this.grid, 'nd-w-recent', 'Recently done', 'history'), 'recent');
    button(this.recent.actions, { icon: 'files', cls: 'nd-icon-btn', title: 'Recently touched files', onClick: () => new FileListModal(this.plugin, (this.lastData?.md || []).slice().sort((a, b) => b.stat.mtime - a.stat.mtime), 'Recently touched files').open() });
    this.heat = this.place(widget(this.grid, 'nd-w-heat', 'Activity', 'flame'), 'activity');
    this.heat.body.addClass('nd-act');
    this.footEl = inner.createDiv('nd-dash-foot');
    this.mountSlots();

    this.pattern = new PatternLayer(this.plugin, root, this.scroller, '.nd-card, .nd-hero');
    this.register(() => this.pattern && this.pattern.destroy());
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(root);
    ro.observe(this.heroEl); // the hero wraps to more lines on narrow widths
    this.register(() => ro.disconnect());

    // Vault changes re-render only while the dashboard is visible; a hidden tab catches up when shown.
    const refresh = debounce(() => {
      if (this.contentEl.offsetParent) this.renderData();
      else this.stale = true;
    }, 1200, true);
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf && this.stale) {
          this.stale = false;
          this.renderData();
        }
      }),
    );
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.registerEvent(this.app.workspace.on('neon-deck:slots-changed', () => this.mountSlots()));
    // Task, Ticket, Time… buttons arrive as the other Neon plugins load
    // a module offered new activity (ticks, ticket changes) or started late: the log and the Activity calendar both follow
    this.registerEvent(this.app.workspace.on('neon-deck:activity-changed', debounce(() => this.lastData && (this.renderRecent(this.lastData), this.renderHeat(this.lastData)), 200, true)));
    this.registerEvent(
      this.app.workspace.on(
        'neon-deck:facts-changed',
        debounce(() => (this.renderTicker(), this.renderTotals()), 500, true),
      ),
    );
    // the ticker stands still and swaps to the next few facts every 10 s
    this.registerInterval(window.setInterval(() => this.nextTicker(), 10000));
    this.register(this.plugin.onLook(() => this.syncLook()));
    this.renderData();
    this.syncLook();
  }
  async onClose() {
    for (const inst of this.slotCards.values()) this.destroySlot(inst);
    this.slotCards.clear();
  }

  /** Show a number in el, counting from what this tile showed last (0 the first time). */
  countTo(el, key, n, fmt) {
    const from = this.prevNums.has(key) ? this.prevNums.get(key) : 0;
    this.prevNums.set(key, n);
    countUp(el, from, n, fmt || ((x) => Math.round(x).toLocaleString()), from ? 500 : 900);
  }
  place(card, area) {
    card.w.addClass(`nd-area-${area}`);
    card.w.dataset.area = area;
    return card;
  }
  onResize() {
    const w = this.contentEl.clientWidth;
    // fork: phones and tablets: one column below 600px (phone portrait), two up to 1100px (phone landscape,
    // tablet portrait), the desktop grid above. Desktop is unchanged: one column below 880px.
    const one = NEON_MOBILE.on ? w < 600 : w < 880;
    const two = NEON_MOBILE.on && !one && w < 1100;
    this.grid.toggleClass('is-narrow', one || two);
    this.grid.toggleClass('is-two', two);
    this.fitGrid();
  }

  /** Grid height = the visible space under the hero, so the dashboard fills any screen. Never below the row minimums (then the page scrolls). */
  fitGrid() {
    if (!this.grid || this.grid.hasClass('is-narrow')) return;
    const sc = this.scroller;
    const top = this.grid.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const pad = parseFloat(getComputedStyle(this.grid.parentElement).paddingBottom) || 0;
    const h = Math.max(DASH_GRID_MIN, Math.floor(sc.clientHeight - top - pad));
    if (h !== this.gridH) {
      this.gridH = h;
      this.grid.style.setProperty('--nd-grid-h', `${h}px`);
    }
  }

  /* satellite widgets ------------------------------------------------ */
  destroySlot(inst) {
    try {
      if (inst.handle && inst.handle.destroy) inst.handle.destroy();
    } catch (e) {
      console.error(`${appName()} – Dashboard: widget`, e);
    }
    inst.card.w.remove();
  }
  mountSlots() {
    const defs = this.plugin.widgets;
    for (const [id, inst] of this.slotCards) {
      if (defs.get(id) !== inst.def) {
        this.destroySlot(inst);
        this.slotCards.delete(id);
      }
    }
    for (const def of defs.values()) {
      if (this.slotCards.has(def.id)) continue;
      const card = this.place(widget(this.grid, `nd-w-${def.id}`, def.title, def.icon, def.sub), def.slot);
      if (def.open) {
        // fork: the card's title opens its large view (the tab), instead of an icon on the right
        const t = card.head.querySelector('.nd-card-title');
        t.addClass('is-link');
        tip(t, def.openTitle || `Open ${def.title} in a tab`);
        t.addEventListener('click', (e) => def.open(e));
      }
      let handle = null;
      try {
        handle = def.mount(card, this) || null;
      } catch (e) {
        console.error(`${appName()} – Dashboard: widget ${def.id}`, e);
        emptyState(card.body, 'This widget failed to load — see console');
      }
      this.slotCards.set(def.id, { def, card, handle });
    }
    const present = new Set(['pulse', 'recent', 'activity', ...[...defs.values()].map((d) => d.slot)]);
    const { areas, cols } = dashAreas(present);
    // as variables (styles-dashboard.css), so the narrow layouts can replace them
    this.grid.style.setProperty('--nd-areas', areas);
    this.grid.style.setProperty('--nd-cols', `repeat(${cols}, minmax(0, 1fr))`);
    this.renderHeroActions();
    this.renderTicker();
  }

  /* hero ------------------------------------------------------------- */
  buildHero(parent) {
    const hero = (this.heroEl = parent.createDiv('nd-hero'));
    this.greetEl = hero.createDiv('nd-hero-greet');
    this.dateEl = hero.createDiv('nd-hero-date');
    this.clockEl = hero.createDiv('nd-hero-clock');
    this.actionsEl = hero.createDiv('nd-hero-actions');
    // fork: theme, pattern and strength live in settings only (the selectors here took too much room)
    this.registerEvent(this.app.workspace.on('css-change', () => this.syncLook()));
    this.updateClock();
    this.registerInterval(window.setInterval(() => this.updateClock(), 1000));
  }
  renderHeroActions() {
    const el = this.actionsEl;
    el.empty();
    const p = this.plugin;
    const acts = [
      { icon: 'file-plus', label: 'New note', run: () => p.newNote('/') },
      { icon: 'calendar-days', label: 'Today', run: () => p.openToday() },
      ...[...p.actions.values()].filter((a) => a.hero !== false).sort((a, b) => (a.order ?? 50) - (b.order ?? 50)), // fork: hero: false = sidebar only
      ...(NEON_MOBILE.on
        ? [] // fork: the card explorer and graph are desktop-only
        : [
            { icon: 'layout-grid', label: 'Cards', run: () => p.activate(VIEW_CARDS, 'tab') },
            { icon: 'waypoints', label: 'Graph', run: () => p.activate(VIEW_GRAPH, 'tab') },
          ]),
      // fork: no Search button: it only opened Obsidian's own search, which is a key press away
    ];
    for (const a of acts) button(el, { icon: a.icon, text: a.label, cls: 'nd-action', onClick: () => a.run() });
  }
  syncLook() {
    const s = this.plugin.settings;
    if (this.themeSel) this.themeSel.value = s.theme;
    if (this.patSel) this.patSel.value = s.pattern;
    if (this.strSel) this.strSel.value = s.patternStrength;
    if (this.footEl) {
      this.footEl.empty();
      const pat = this.plugin.activePattern();
      this.footEl.createSpan({ text: `${appName()} ${ND_VERSION} · ${THEME_LABEL[s.theme]}${pat !== 'none' && s.patternStrength !== 'off' ? ' · ' + PATTERN_LABEL[pat] : ''}` });
      this.footEl.createSpan({ cls: 'nd-madewith', text: 'Made with Claude' });
    }
  }
  updateClock() {
    const m = moment();
    const key = m.format('YYYY-MM-DD');
    if (this.clockDay && this.clockDay !== key) {
      // a new day while the dashboard stays open: Activity, the done log and day counts follow (issue 31)
      if (this.actMonth && this.actMonth.isSame(moment(this.clockDay, 'YYYY-MM-DD'), 'month')) this.actMonth = null;
      if (this.contentEl.offsetParent) this.renderData();
      else this.stale = true;
    }
    this.clockDay = key;
    const h = m.hour();
    const g = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const name = this.plugin.settings.name;
    this.greetEl.setText(`${g}${name ? ', ' + name : ''} ✦`);
    this.dateEl.setText(m.format('dddd D MMM'));
    this.clockEl.setText(m.format('HH:mm:ss') + ` · week ${m.isoWeek()}`);
  }

  /* data widgets -------------------------------------------------------- */
  async renderData() {
    const token = ++this.dataToken;
    const d = this.plugin.collectVaultData();
    this.lastData = d;
    this.renderStats(d);
    this.renderRecent(d);
    this.renderHeat(d);
    this.renderTicker(d);
    this.renderTotals(d);
    const words = await this.plugin.totalWords(d.md);
    if (token === this.dataToken && this.wordsEl) this.countTo(this.wordsEl, 'pulse:words', words);
  }
  perDay(list, key) {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const k = moment().subtract(i, 'days').format('YYYY-MM-DD');
      out.push(list.filter((x) => dayKey(key(x)) === k).length);
    }
    return out;
  }
  renderStats(d) {
    const tiles = this.pulseEl; // fork: part of the Stats card
    tiles.empty();
    // first paint: sparklines draw in and tiles rise one after another
    tiles.toggleClass('is-intro', !this.statsShown);
    this.statsShown = true;
    let i = 0;
    const tile = (value, label, accent, onClick, hint, spark) => {
      const t = tiles.createDiv('nd-tile' + (onClick ? ' is-clickable' : ''));
      t.style.setProperty('--tile-accent', accent);
      t.style.setProperty('--i', String(i++));
      const v = t.createDiv({ cls: 'nd-tile-value' });
      if (typeof value === 'number') this.countTo(v, `pulse:${label}`, value);
      else v.setText(value);
      t.createDiv({ cls: 'nd-tile-label', text: label });
      if (spark) sparkline(t, spark);
      if (onClick) t.addEventListener('click', onClick);
      if (hint) tip(t, hint);
      return v;
    };
    const desk = !NEON_MOBILE.on; // fork: the card explorer and graph are desktop-only
    const made = d.md.filter((f) => f.stat.ctime >= moment().startOf('month').valueOf()).length; // fork: from the old Totals tile
    const madeLine = `${made} created in ${moment().format('MMM')}`;
    tile(d.md.length, 'notes', 'var(--nd-text)', desk ? () => this.plugin.activate(VIEW_CARDS, 'tab') : null, desk ? `${madeLine} · open the card explorer · line: notes created per day` : `${madeLine} · line: notes created per day`, this.perDay(d.md, (f) => f.stat.ctime));
    this.wordsEl = tile('…', 'words', 'var(--nd-text)');
    tile(d.links, 'links', 'var(--nd-info)', desk ? () => this.plugin.openGraph('notes') : null, desk ? 'Open the note graph' : null);
    tile(d.orphans.length, 'orphans', 'var(--nd-accent)', () => new FileListModal(this.plugin, d.orphans, 'Orphan notes — no links in or out').open(), 'Notes with no links in or out');
    tile(d.editedToday.length, 'edited today', 'var(--nd-go)', () => new FileListModal(this.plugin, d.editedToday, 'Edited today').open(), 'Line: notes edited per day', this.perDay(d.md, (f) => f.stat.mtime));
  }
  renderRecent() {
    const b = this.recent.body;
    b.empty();
    this.renderDoneLog(b);
    if (!this.plugin.activity.size) emptyState(b, 'Nothing done yet — completed work appears here');
  }
}

/* @src src/deck/dash-ticker.js */
Object.assign(DashboardView.prototype, {
  renderTicker(d) {
    d = d || this.lastData || this.plugin.collectVaultData();
    const p = this.plugin;
    const items = [];
    for (const fn of p.facts.values()) {
      try {
        items.push(...(fn() || []));
      } catch (e) {
        console.error(`${appName()} – Dashboard: facts`, e);
      }
    }
    items.push({ v: d.md.length, l: 'notes' }, { v: d.editedToday.length, l: 'edited today' });
    // about one line in ten is a sign-off
    const n = Math.max(1, Math.round(items.length / 9));
    for (let i = 0; i < n; i++) {
      const pos = Math.floor(((i + 1) * items.length) / (n + 1)) + i;
      items.splice(pos, 0, { me: SIGNOFFS[Math.floor(Math.random() * SIGNOFFS.length)] });
    }
    // group into lines of three facts (a sign-off gets its own line)
    const lines = [];
    let cur = [];
    for (const it of items) {
      if (it.me) {
        if (cur.length) lines.push(cur);
        lines.push([it]);
        cur = [];
        continue;
      }
      cur.push(it);
      if (cur.length === 3) (lines.push(cur), (cur = []));
    }
    if (cur.length) lines.push(cur);
    const first = !this.tickerLines;
    this.tickerLines = lines;
    if (first || this.tickerIdx >= lines.length) this.tickerIdx = 0;
    this.showTicker(false);
  },
  nextTicker() {
    if (!this.tickerLines || this.tickerLines.length < 2 || !this.tickerEl || !this.tickerEl.isConnected) return;
    if (this.tickerEl.matches(':hover')) return;
    this.tickerIdx = (this.tickerIdx + 1) % this.tickerLines.length;
    this.showTicker(true);
  },
  showTicker(fade) {
    const el = this.tickerEl;
    const line = this.tickerLines && this.tickerLines[this.tickerIdx];
    el.empty();
    if (!line) return;
    const row = el.createDiv('nd-ticker-line' + (fade ? ' is-fresh' : ''));
    line.forEach((it, i) => {
      if (i) row.createSpan({ cls: 'nd-ticker-star', text: '✦' });
      const s = row.createSpan('nd-ticker-item' + (it.me ? ' is-me' : ''));
      if (it.me) s.setText(it.me);
      else {
        s.createEl('b', { text: String(it.v) });
        s.appendText(' ' + it.l);
      }
    });
  },

  /** Totals card: live counts from Time, Projects, Tasks and the vault. The first tile spans the card. */
  renderTotals(d) {
    if (!this.totals) return;
    d = d || this.lastData || this.plugin.collectVaultData();
    const tiles = this.totals.body; // fork: the work half of the Stats card
    tiles.empty();
    tiles.toggleClass('is-intro', !this.totalsShown);
    this.totalsShown = true;
    let i = 0;
    /** value: a number, or [number, format] for minutes and the like; numbers count up when they change */
    const tile = (value, label, accent, sub, hint) => {
      const t = tiles.createDiv('nd-tile');
      t.style.setProperty('--tile-accent', accent);
      t.style.setProperty('--i', String(i++));
      const v = t.createDiv({ cls: 'nd-tile-value' });
      const [n, fmt] = Array.isArray(value) ? value : [value, null];
      if (typeof n === 'number') this.countTo(v, `totals:${label.replace(/s$/, '')}`, n, fmt);
      else v.setText(n);
      t.createDiv({ cls: 'nd-tile-label', text: label });
      // fork: compact tiles (Totals sits in a small corner now): the sub-line goes in the tooltip
      const more = [sub, hint].filter(Boolean).join(' · ');
      if (more) tip(t, more);
    };
    const now = moment();
    const monthStart = now.clone().startOf('month');
    const thisMonth = (ms) => ms >= monthStart.valueOf();
    const month = now.format('MMM');

    // time worked (Time)
    const tm = neonPlugin(this.app, 'neon-time');
    if (tm && tm.days) {
      const todayKey = now.format('YYYY-MM-DD');
      let total = 0;
      let monthMin = 0;
      let worked = 0;
      let tasks = 0;
      let tasksMonth = 0;
      for (const [key, day] of Object.entries(tm.days)) {
        // the day total includes the Start day / End day timer (issue 54), not only logged entries
        const min = tm.summary ? tm.summary(key, key === todayKey).total : (day.entries || []).reduce((s, e) => s + (e.ms || 0), 0) / 60000;
        total += min;
        if (key >= monthStart.format('YYYY-MM-DD')) monthMin += min;
        if (min >= 1) worked++;
        for (const x of day.done || []) {
          if (x.kind !== 'task') continue;
          tasks++;
          if (thisMonth(x.t || 0)) tasksMonth++;
        }
      }
      let bal = null;
      try {
        if (tm.balance) bal = tm.balance(moment(0), now).balance;
      } catch (e) {
        console.error(`${appName()} – Dashboard: totals`, e);
      }
      tile([Math.round(total), (x) => fmtMin(Math.round(x))], 'time worked', 'var(--nd-accent)', `${fmtMin(Math.round(monthMin))} in ${month}${bal ? ` · ${bal > 0 ? '+' : ''}${fmtMin(bal)} balance` : ''}`, 'All time tracked, automatic and manual');
      tile(worked, worked === 1 ? 'day worked' : 'days worked', 'var(--nd-info)', null, 'Days with tracked time');
      tile(tasks, 'tasks done', 'var(--nd-go)', `${tasksMonth} in ${month}`, 'Tasks ticked since time tracking started counting');
    } else {
      const ts = neonPlugin(this.app, 'neon-tasks');
      const done = ts && ts.doneTasks; // fork: ✅ dates in your notes
      if (done) tile(done.length, 'tasks done', 'var(--nd-go)', `${done.filter((x) => thisMonth(moment(x.date, 'YYYY-MM-DD').valueOf())).length} in ${month}`, 'Tasks ticked in the last 6 weeks, by their ✅ date');
    }

    // projects (Projects)
    const tk = neonPlugin(this.app, 'neon-tickets');
    if (tk && tk.collectProjects) {
      const all = tk.collectProjects();
      const done = all.filter((t) => t.status === 'done');
      const doneMonth = done.filter((t) => t.completed && t.completed.isSame(now, 'month')).length;
      tile(done.length, 'projects done', 'var(--nd-warn)', `${doneMonth} in ${month} · ${all.length - done.length} open`, 'Projects closed, by completed or cancelled date');
    }

    // fork: no notes tile here: the vault half of the Stats card has it (with this month's count)
  },
});
/* @src src/deck/dash-activity.js */
Object.assign(DashboardView.prototype, {
  /** Top of Recently done / touched: tasks ticked (✅ date) and projects closed (completed / cancelled date) in your notes, last 14 days, by day. */
  renderDoneLog(b) {
    const cut = moment().startOf('day').subtract(13, 'days').valueOf();
    const items = [];
    for (const [id, fn] of this.plugin.activity) {
      try {
        for (const x of fn() || []) if (x && x.t >= cut) items.push(x);
      } catch (e) {
        console.error(`${appName()} – Dashboard: activity ${id}`, e);
      }
    }
    items.sort((a, b2) => b2.t - a.t);
    const today = items.filter((x) => moment(x.t).isSame(moment(), 'day')).length;
    this.recent.badge.setText(today ? `${today} today` : '');
    if (!this.plugin.activity.size) return; // Tasks and Tickets both off: only the notes list
    const box = b.createDiv('nd-done-log');
    if (!items.length) return void box.createDiv({ cls: 'nd-done-empty', text: 'Nothing finished in the last 14 days' });
    let day = '';
    const seen = this.doneSeen; // rows drawn last time: only new ones slide in
    this.doneSeen = new Set();
    for (const x of items.slice(0, 200)) {
      const m = moment(x.t);
      const k = m.format('YYYY-MM-DD');
      if (k !== day) {
        day = k;
        const label = m.isSame(moment(), 'day') ? 'Today' : m.isSame(moment().subtract(1, 'day'), 'day') ? 'Yesterday' : moment().diff(m.clone().startOf('day'), 'days') < 7 ? m.format('dddd') : m.format('ddd D MMM');
        box.createDiv({ cls: 'nd-done-day', text: label });
      }
      const key = `${x.kind}|${x.t}|${x.text}`;
      this.doneSeen.add(key);
      const r = box.createDiv('nd-done-row' + (x.open ? ' is-clickable' : '') + (seen && !seen.has(key) ? ' is-new' : ''));
      icon(r, x.kind === 'ticket' ? 'briefcase' : 'check', 'nd-ico nd-done-ico');
      r.createSpan({ cls: 'nd-done-text', text: x.text });
      if (x.status) r.createSpan({ cls: `nd-done-chip is-${x.status}`, text: x.label || (x.status === 'done' ? 'Done' : 'Waiting') });
      if (x.src) r.createSpan({ cls: 'nd-done-src', text: x.src });
      if (!x.allDay) r.createSpan({ cls: 'nd-done-at', text: m.format('HH:mm') });
      tip(r, x.text);
      if (x.open) r.addEventListener('click', (e) => x.open(e));
    }
  },
  /** Activity: a Month view (stats + calendar) and five Week views (each day's entries): this week and two either side (fork). */
  renderHeat(d) {
    const b = this.heat.body;
    b.empty();
    const p = this.plugin;
    const month = (this.actMonth = this.actMonth || moment().startOf('month'));
    // header: month switch + Month / week chips
    const acts = this.heat.actions;
    acts.empty();
    button(acts, { icon: 'chevron-left', cls: 'nd-icon-btn', title: 'Previous month', onClick: () => ((this.actMonth = month.clone().subtract(1, 'month')), (this.actView = 'month'), this.renderHeat(d)) });
    acts.createSpan({ cls: 'nd-act-month', text: month.format('MMM YYYY') });
    button(acts, { icon: 'chevron-right', cls: 'nd-icon-btn', title: 'Next month', onClick: () => ((this.actMonth = month.clone().add(1, 'month')), (this.actView = 'month'), this.renderHeat(d)) });
    const weeks = [];
    for (let w = month.clone().startOf('isoWeek'); w.isBefore(month.clone().endOf('month')); w.add(1, 'week')) weeks.push(w.clone());
    // fork: five week chips, centred on this week (on the 15th's week when another month is shown)
    const focus = (month.isSame(moment(), 'month') ? moment() : month.clone().date(15)).startOf('isoWeek');
    const chips = [-2, -1, 0, 1, 2].map((n) => focus.clone().add(n, 'weeks'));
    const view = this.actView == null || (this.actView !== 'month' && !chips[this.actView]) ? 'month' : this.actView;
    // rise-in only when the month or view changes, not on every data refresh
    const animKey = `${month.format('YYYY-MM')}|${view}`;
    b.toggleClass('is-anim', this.actAnimKey !== animKey);
    this.actAnimKey = animKey;
    const tabs = pills(acts, [['month', 'Month'], ...chips.map((w, i) => [i, `W${w.isoWeek()}`])], view, (v) => ((this.actView = v), this.renderHeat(d)), 'nd-act-tabs');
    acts.prepend(tabs.el);
    if (view === 'month') this.renderActMonth(b, month, actDays(p, d, month), weeks);
    else this.renderActWeek(b, chips[view], actDays(p, d, month, chips[view]));
  },
  renderActMonth(b, month, days, weeks) {
    const wrap = b.createDiv('nd-act-monthview');
    const stats = wrap.createDiv('nd-act-stats');
    for (const st of ACTIVITY_STATS) {
      const r = st.get(days, month, this.plugin);
      if (!r) continue;
      const t = stats.createDiv('nd-act-stat');
      t.style.setProperty('--stat-accent', st.accent);
      t.createDiv({ cls: 'nd-act-stat-v', text: r.v });
      t.createDiv({ cls: 'nd-act-stat-l', text: r.sub ? `${st.label} · ${r.sub}` : st.label });
      tip(t, st.how);
    }
    if (!stats.childElementCount) stats.createDiv({ cls: 'nd-act-none', text: 'No stats yet this month' });
    const cal = wrap.createDiv('nd-act-cal');
    cal.style.gridTemplateRows = `auto repeat(${weeks.length}, minmax(30px, 1fr))`;
    for (const n of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) cal.createDiv({ cls: 'nd-act-dow', text: n });
    const todayKey = dayKey(Date.now());
    const max = Math.max(1, ...[...days.values()].map(actCount));
    weeks.forEach((w, wi) => {
      for (let i = 0; i < 7; i++) {
        const m = w.clone().add(i, 'days');
        const k = m.format('YYYY-MM-DD');
        const x = days.get(k);
        const n = x ? actCount(x) : 0;
        const c = cal.createDiv('nd-act-day' + (m.month() !== month.month() ? ' is-out' : '') + (k === todayKey ? ' is-today' : '') + (n ? ' is-clickable' : ''));
        c.style.setProperty('--i', String(wi * 7 + i));
        c.style.setProperty('--lvl', String(n ? 0.15 + (0.85 * n) / max : 0));
        c.createSpan({ cls: 'nd-act-num', text: String(m.date()) });
        const dots = c.createDiv('nd-act-dots');
        if (x) for (const [kind, list] of [['task', x.tasks], ['ticket', x.tickets], ['time', x.time], ['note', x.notes]]) if (list.length) dots.createSpan(`nd-act-dot is-${kind}`);
        tip(c, `${m.format('ddd D MMM')} · ${x ? `${x.tasks.length} tasks · ${x.tickets.length} projects · ${x.time.length} time entries · ${x.notes.length} notes` : 'nothing'}`);
        if (n) c.addEventListener('click', () => new ActivityDayModal(this.plugin, m, x).open());
      }
    });
  },
  renderActWeek(b, w, days) {
    const wk = b.createDiv('nd-act-week');
    const todayKey = dayKey(Date.now());
    for (let i = 0; i < 7; i++) {
      const m = w.clone().add(i, 'days');
      const k = m.format('YYYY-MM-DD');
      const x = days.get(k);
      const col = wk.createDiv('nd-act-col' + (k === todayKey ? ' is-today' : ''));
      col.style.setProperty('--i', String(i));
      const head = col.createDiv({ cls: 'nd-act-col-head is-clickable', text: m.format('ddd D') });
      head.addEventListener('click', () => new ActivityDayModal(this.plugin, m, x).open());
      const list = col.createDiv('nd-act-col-list');
      const rows = x ? [...x.tasks, ...x.tickets, ...x.time, ...x.notes].sort((a, b2) => a.t - b2.t) : [];
      if (!rows.length) list.createDiv({ cls: 'nd-act-none', text: '·' });
      for (const r of rows) {
        const el = list.createDiv(`nd-act-item is-${r.kind}` + (r.open ? ' is-clickable' : ''));
        icon(el, { task: 'check', ticket: 'briefcase', time: 'clock', note: 'file-text' }[r.kind], 'nd-ico');
        el.createSpan({ cls: 'nd-act-item-text', text: r.text });
        tip(el, `${moment(r.t).format('HH:mm')} · ${r.text}${r.extra ? ' · ' + r.extra : ''}`);
        if (r.open) el.addEventListener('click', (e) => r.open(e));
      }
    }
  },

});
/* @src src/deck/cards-view.js */
/* ------------------------------------------------------------------ */
/* Card explorer                                                       */
/* ------------------------------------------------------------------ */

const CARD_CHIPS = [
  ['all', 'All'],
  ['school', 'School'],
  ['projects', 'Projects'],
  ['operations', 'Operations'],
  ['admin', 'Admin'],
  ['untracked', 'Untracked'],
];

class CardsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.path = '/';
    this.backStack = [];
    this.fwdStack = [];
    this.query = '';
    this.chip = 'all';
    this.limit = 240;
    this.excerpts = new Map();
    this.firstPaint = true;
  }
  getViewType() {
    return VIEW_CARDS;
  }
  getDisplayText() {
    return 'Cards';
  }
  getIcon() {
    return 'layout-grid';
  }
  getState() {
    return { path: this.path };
  }
  async setState(state, result) {
    if (state && typeof state.path === 'string' && this.app.vault.getAbstractFileByPath(state.path) instanceof TFolder) {
      if (state.path !== this.path && this.bodyEl) this.backStack.push(this.path);
      this.path = state.path;
    }
    await super.setState(state, result);
    if (this.bodyEl) this.refresh(1);
  }
  isSidebar() {
    const ws = this.app.workspace;
    return this.leaf.getRoot && this.leaf.getRoot() !== ws.rootSplit;
  }

  /** Build the sidebar or tab UI; called again when the view moves between them. */
  build() {
    this.hidePreview(true);
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
    const root = this.contentEl;
    root.empty();
    root.removeClass('nd-pattern-host', 'nd-has-pattern');
    root.addClass('nd-root', 'nd-cards');
    this.sidebar = this.isSidebar();
    this.navigation = !this.sidebar; // in the main pane it joins Back / Forward
    root.toggleClass('is-sidebar', this.sidebar);
    this.sideShown = false;
    this.firstPaint = true;
    if (this.sidebar) this.buildSidebar(root);
    else this.buildTab(root);
  }
  async onOpen() {
    addHelpAction(this, 'dashboard'); // fork: the ? button in the header (src/shared/help.js)
    if (NEON_MOBILE.on) return void mobileOnlyNote(this.contentEl, 'The card explorer'); // fork: desktop-only
    this.build();
    const re = debounce(() => this.refresh(0, true), 250, true);
    this.registerEvent(this.app.vault.on('create', re));
    this.registerEvent(this.app.vault.on('delete', re));
    this.registerEvent(this.app.vault.on('rename', re));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        this.updateCard(f);
        // a shown note's `created` changed: its place in the sort may have changed
        const seen = this.createdSeen && this.createdSeen.get(f.path);
        if (seen != null && seen !== createdOf(this.app, f)) re();
      }),
    );
    this.registerEvent(this.app.workspace.on('file-open', () => this.markActive()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.markNav()));
    this.registerEvent(this.app.workspace.on('neon-deck:slots-changed', () => this.renderNav()));
    this.registerEvent(this.app.workspace.on('neon-deck:pins-changed', () => this.refresh(0, true)));
    this.registerEvent(this.app.workspace.on('neon-deck:seen-changed', debounce(() => this.refresh(0, true), 600, true)));
    // one layout-change handler: rebuild when the view moved between the sidebar and the main area, else just mark the nav
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.isSidebar() !== this.sidebar) {
          this.build();
          this.refresh(0);
        }
        this.markNav();
      }),
    );
    this.registerDomEvent(this.contentEl, 'mouseup', (e) => {
      if (e.button === 3) {
        e.preventDefault();
        this.goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        this.goForward();
      }
    });
    this.refresh(0);
  }
  async onClose() {
    this.hidePreview(true);
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }

  buildTab(root) {
    root.addClass('nd-pattern-host');
    const bar = root.createDiv('nd-cards-bar');
    const nav = bar.createDiv('nd-nav');
    this.backBtn = button(nav, { icon: 'arrow-left', cls: 'nd-icon-btn', title: 'Back (mouse back button)', onClick: () => this.goBack() });
    this.fwdBtn = button(nav, { icon: 'arrow-right', cls: 'nd-icon-btn', title: 'Forward (mouse forward button)', onClick: () => this.goForward() });
    this.upBtn = button(nav, { icon: 'arrow-up', cls: 'nd-icon-btn', title: 'Up a folder — drop cards here to move them up', onClick: () => this.goUp() });
    this.makeDropTarget(this.upBtn, () => this.parentPath());
    this.crumbs = bar.createDiv('nd-crumbs');
    const tools = bar.createDiv('nd-tools');
    this.buildSearch(tools);
    const mode = tools.createDiv('nd-seg nd-mode-seg');
    this.modeBtns = {};
    for (const [k, label, ic] of [['cards', 'Cards', 'layout-grid'], ['list', 'List', 'list']]) {
      const b = button(mode, { icon: ic, text: label, cls: 'nd-seg-btn', onClick: () => this.setMode(k) });
      this.modeBtns[k] = b;
    }
    this.sortBtn = button(tools, { icon: 'arrow-up-down', text: 'Sort', cls: 'nd-sort-btn', onClick: (e) => this.sortMenu(e) });
    button(tools, { icon: 'plus', text: 'Note', cls: 'mod-cta', title: 'New note here', onClick: () => this.plugin.newNote(this.path) });
    button(tools, { icon: 'folder-plus', cls: 'nd-icon-btn', title: 'New folder here', onClick: () => this.plugin.newFolder(this.path) });
    this.chipsEl = root.createDiv('nd-pills nd-cat-chips');
    this.scroller = root.createDiv('nd-cards-scroll');
    this.bodyEl = this.scroller.createDiv('nd-cards-body');
    this.scroller.addEventListener('contextmenu', (e) => {
      if (e.target !== this.scroller && e.target !== this.bodyEl) return;
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) => i.setTitle('New note here').setIcon('file-plus').onClick(() => this.plugin.newNote(this.path)));
      m.addItem((i) => i.setTitle('New folder here').setIcon('folder-plus').onClick(() => this.plugin.newFolder(this.path)));
      m.showAtMouseEvent(e);
    });
    this.makeDropTarget(this.scroller, () => this.path);
    this.pattern = new PatternLayer(this.plugin, root, this.scroller, '.nd-ci');
  }
  buildSidebar(root) {
    this.navEl = root.createDiv('nd-side-nav');
    this.renderNav();
    const top = root.createDiv('nd-side-top');
    this.buildSearch(top);
    this.scroller = root.createDiv('nd-cards-scroll');
    this.bodyEl = this.scroller.createDiv('nd-side-body');
    this.makeDropTarget(this.scroller, () => this.path);
  }
  /** Sidebar nav: each item shows its view in the main pane. Tickets, Time… come from the other plugins' actions. */
  renderNav() {
    const el = this.navEl;
    if (!el || !this.sidebar) return;
    el.empty();
    const p = this.plugin;
    const items = [
      { icon: 'layout-dashboard', label: 'Dashboard', view: VIEW_DASH, run: () => p.activate(VIEW_DASH, 'tab') },
      { icon: 'layout-grid', label: 'Cards', view: VIEW_CARDS, run: () => p.activate(VIEW_CARDS, 'tab') },
      ...[...p.actions.values()].filter((a) => a.view).sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
      { icon: 'waypoints', label: 'Graph', view: VIEW_GRAPH, run: () => p.activate(VIEW_GRAPH, 'tab') },
    ].filter((it) => !(NEON_MOBILE.on && (it.view === VIEW_CARDS || it.view === VIEW_GRAPH))); // fork: desktop-only views
    for (const it of items) {
      const b = el.createEl('button', { cls: 'nd-side-nav-item', attr: { type: 'button', 'data-view': it.view } });
      icon(b, it.icon);
      b.createSpan({ text: it.label });
      b.addEventListener('click', () => it.run());
    }
    this.markNav();
  }
  /** Highlight the nav item for what the main pane shows. */
  markNav() {
    if (!this.navEl) return;
    const ws = this.app.workspace;
    const main = ws.getMostRecentLeaf(ws.rootSplit);
    const type = main ? main.view.getViewType() : '';
    for (const b of this.navEl.querySelectorAll('.nd-side-nav-item')) b.toggleClass('is-active', b.dataset.view === type);
  }
  buildSearch(parent) {
    const search = parent.createDiv('nd-search');
    icon(search, 'search');
    this.searchInput = search.createEl('input', { attr: { type: 'search', placeholder: 'Filter… (#tag works)' } });
    this.searchInput.addEventListener(
      'input',
      debounce(() => {
        this.query = this.searchInput.value.trim().toLowerCase();
        this.refresh(0, true);
      }, 160, true),
    );
  }

  folder() {
    const f = this.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFolder ? f : this.app.vault.getRoot();
  }
  parentPath() {
    const f = this.folder();
    return f.parent ? f.parent.path : null;
  }
  navigate(path, dir) {
    if (path === this.path) return;
    this.backStack.push(this.path);
    this.fwdStack = [];
    this.path = path;
    this.limit = 240;
    this.refresh(dir);
    this.app.workspace.requestSaveLayout();
  }
  goBack() {
    if (!this.backStack.length) return;
    this.fwdStack.push(this.path);
    this.path = this.backStack.pop();
    this.refresh(-1);
  }
  goForward() {
    if (!this.fwdStack.length) return;
    this.backStack.push(this.path);
    this.path = this.fwdStack.pop();
    this.refresh(1);
  }
  goUp() {
    const p = this.parentPath();
    if (p) this.navigate(p, -1);
  }
  setMode(m) {
    this.plugin.settings.cardMode = m;
    this.plugin.saveSettings();
    this.refresh(0);
  }
  /** dir: 1 forward, -1 back, 0 fade · quiet: keep scroll, no entry animation · flip: slide cards into their new places */
  refresh(dir = 0, quiet = false, flip = false) {
    if (!this.bodyEl) return;
    this.hidePreview(true);
    const folder = this.folder();
    this.path = folder.path;
    if (this.sidebar) return this.renderSidebar(folder, dir);
    this.renderCrumbs(folder);
    this.renderChips();
    this.backBtn.toggleClass('is-disabled', !this.backStack.length);
    this.fwdBtn.toggleClass('is-disabled', !this.fwdStack.length);
    this.upBtn.toggleClass('is-disabled', !folder.parent);
    const mode = this.plugin.settings.cardMode;
    for (const [k, b] of Object.entries(this.modeBtns)) b.toggleClass('is-active', k === mode);
    const sortLabel = { 'created-prop': 'Created', modified: 'Recent', created: 'Created (file)', revisit: 'Revisit first', name: 'A → Z', 'name-desc': 'Z → A' }[this.plugin.settings.cardSort] || 'Recent';
    this.sortBtn.querySelector('.nd-btn-label').setText(`Sort: ${sortLabel}`);

    const deep = !!this.query || this.chip !== 'all';
    let folders;
    let files;
    if (this.query) {
      const all = this.app.vault.getAllLoadedFiles();
      folders = all.filter((f) => f instanceof TFolder && f.path !== '/' && this.matchQuery(f));
      files = all.filter((f) => f instanceof TFile && this.matchQuery(f) && this.matchChip(f));
    } else {
      folders = folder.children.filter((c) => c instanceof TFolder);
      files = (this.chip === 'all' ? folder.children.filter((c) => c instanceof TFile) : this.folderInfo(folder).notes).filter((f) => this.matchChip(f));
    }
    const finfo = new Map(folders.map((f) => [f, this.folderInfo(f)]));
    if (CATS.includes(this.chip)) folders = folders.filter((f) => finfo.get(f).cat === this.chip);
    else if (this.chip === 'revisit') folders = folders.filter((f) => finfo.get(f).notes.some((n) => this.needsRevisit(n)));
    else if (this.chip === 'untracked') folders = folders.filter((f) => !finfo.get(f).cat);
    folders.sort(bangFirst((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    files.sort(this.sorter());

    const before = flip ? this.snapshot() : null;
    const scroll = this.scroller.scrollTop;
    const body = this.bodyEl;
    body.empty();
    body.toggleClass('is-list', mode === 'list');
    body.removeClass('nd-in-fwd', 'nd-in-back', 'nd-in-fade');
    if (!quiet || this.firstPaint) {
      void body.offsetWidth;
      body.addClass(dir > 0 ? 'nd-in-fwd' : dir < 0 ? 'nd-in-back' : 'nd-in-fade');
    }
    this.firstPaint = false;
    this.incoming = this.incomingLinks();
    if (!folders.length && !files.length) {
      const e = body.createDiv('nd-cards-empty');
      e.createDiv({ cls: 'nd-cards-empty-art', text: this.query || deep ? '∅' : '✦' });
      e.createDiv({ text: this.query || deep ? 'Nothing matches that filter' : 'This folder is empty' });
      if (!this.query && !deep) button(e, { icon: 'file-plus', text: 'New note here', cls: 'mod-cta', onClick: () => this.plugin.newNote(this.path) });
      return;
    }
    let i = 0;
    if (folders.length) {
      body.createDiv({ cls: 'nd-section-k', text: 'Folders' });
      const g = body.createDiv('nd-ci-grid is-folders');
      for (const f of folders) this.folderCard(g, f, finfo.get(f), i++);
    }
    if (files.length) {
      const where = this.query ? 'matching' : `in ${folder.path === '/' ? this.app.vault.getName() : folder.name}`;
      body.createDiv({ cls: 'nd-section-k', text: `Notes ${where} · ${files.length}` });
      const g = body.createDiv('nd-ci-grid is-notes');
      for (const f of files.slice(0, this.limit)) this.fileCard(g, f, i++, deep);
      if (files.length > this.limit) {
        const more = g.createDiv('nd-ci nd-more');
        more.setText(`Show ${files.length - this.limit} more…`);
        more.addEventListener('click', () => {
          this.limit += 240;
          this.refresh(0, true);
        });
      }
    }
    this.scroller.scrollTop = quiet ? scroll : 0;
    if (before) this.playFlip(before);
    if (this.pattern) this.pattern.kick();
  }
  snapshot() {
    const m = new Map();
    this.bodyEl.querySelectorAll('.nd-ci[data-path]').forEach((el) => m.set(el.dataset.path, el.getBoundingClientRect()));
    return m;
  }
  playFlip(before) {
    if (prefersReducedMotion()) return;
    this.bodyEl.querySelectorAll('.nd-ci[data-path]').forEach((el) => {
      const r0 = before.get(el.dataset.path);
      if (!r0) {
        el.addClass('is-new');
        return;
      }
      const r1 = el.getBoundingClientRect();
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      window.requestAnimationFrame(() => {
        el.style.transition = '';
        el.style.transform = '';
      });
    });
  }
  incomingLinks() {
    const rl = this.app.metadataCache.resolvedLinks;
    const inc = new Map();
    for (const src in rl)
      for (const dst in rl[src]) {
        if (!inc.has(dst)) inc.set(dst, []);
        inc.get(dst).push(src);
      }
    return inc;
  }
  linkCount(f) {
    const out = this.app.metadataCache.resolvedLinks[f.path];
    return (out ? Object.keys(out).length : 0) + ((this.incoming && this.incoming.get(f.path)) || []).length;
  }

}
function shortAgo(t) {
  const m = Math.max(0, (Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 1440 * 60) return `${Math.round(m / 1440)}d`;
  return moment(t).format('MMM YY');
}

/* @src src/deck/cards-filter.js */
Object.assign(CardsView.prototype, {
  sortMenu(e) {
    const m = new Menu();
    const opts = [
      ['created-prop', 'Created property'],
      ['modified', 'Recently modified'],
      ['created', 'Recently created (file)'],
      ['name', 'Name A → Z'],
      ['name-desc', 'Name Z → A'],
    ];
    for (const [k, label] of opts) {
      m.addItem((i) =>
        i.setTitle(label).setChecked(this.plugin.settings.cardSort === k).onClick(async () => {
          this.plugin.settings.cardSort = k;
          await this.plugin.saveSettings();
          this.refresh(0, true, true);
        }),
      );
    }
    m.showAtMouseEvent(e);
  },
  /** Notes in sort order: names starting with "!" first (more "!" higher), then the chosen sort. */
  sorter() {
    const s = this.plugin.settings.cardSort;
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    let cmp = (a, b) => b.stat.mtime - a.stat.mtime;
    if (s === 'name') cmp = byName;
    else if (s === 'name-desc') cmp = (a, b) => byName(b, a);
    else if (s === 'created') cmp = (a, b) => b.stat.ctime - a.stat.ctime;
    else if (s === 'created-prop') {
      const keys = (this.createdSeen = new Map()); // one date per note per sort; also lets 'changed' spot a new date
      const key = (f) => (keys.has(f.path) ? keys.get(f.path) : keys.set(f.path, createdOf(this.app, f)).get(f.path));
      cmp = (a, b) => key(b) - key(a) || byName(a, b);
    }
    return bangFirst(cmp);
  },
  /** fork: the Revisit feature (for upstream "school" notes) is removed; kept as stubs for the callers. */
  revisitAge() {
    return -1;
  },
  needsRevisit() {
    return false;
  },
  matchQuery(f) {
    const q = this.query;
    if (!q) return true;
    const hay = [f.path.toLowerCase()];
    if (f instanceof TFile) {
      const c = this.app.metadataCache.getFileCache(f);
      const tags = c ? getAllTags(c) : null;
      if (tags) hay.push(tags.join(' ').toLowerCase());
    }
    const h = hay.join(' ');
    return q.split(/\s+/).every((t) => h.includes(t));
  },
  matchChip(f) {
    const c = this.chip;
    if (c === 'all') return true;
    if (c === 'revisit') return this.needsRevisit(f);
    const cat = fileCategory(this.app, f);
    if (c === 'untracked') return f.extension === 'md' && (!cat || cat === 'untracked');
    return cat === c;
  },
  /** Notes in a folder (recursive), with category counts and how many other files (images…) it holds. */
  folderInfo(folder) {
    const notes = [];
    let other = 0; // images and other attachments (issue 53)
    const walk = (fd) => {
      for (const c of fd.children) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') notes.push(c);
        else if (c instanceof TFile) other++;
      }
    };
    walk(folder);
    const counts = {};
    for (const f of notes) {
      const c = fileCategory(this.app, f);
      if (c && c !== 'untracked') counts[c] = (counts[c] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const cat = top && top[1] * 2 >= notes.length ? top[0] : null;
    return { notes, other, cat };
  },

  renderChips() {
    const el = this.chipsEl;
    if (!el) return;
    el.empty();
    const folder = this.folder();
    const scope = this.query ? this.app.vault.getMarkdownFiles() : this.folderInfo(folder).notes;
    const revisit = scope.filter((f) => this.needsRevisit(f)).length;
    // fork: the category chips are the current categories (your customers); Revisit only for upstream "school"
    const chips = [['all', 'All'], ...CATS.map((c) => [c, CAT_LABEL[c] || c]), ['untracked', NEON_CATS.customers ? 'No customer' : 'Untracked']];
    if (!chips.some(([k]) => k === this.chip)) this.chip = 'all';
    for (const [k, label] of chips) {
      const b = el.createEl('button', { cls: `nd-pill-btn chip-${k}` + (this.chip === k ? ' is-on' : '') });
      if (k === 'revisit') icon(b, 'rotate-ccw');
      b.createSpan({ text: k === 'revisit' && revisit ? `${label} (${revisit})` : label });
      if (CATS.includes(k)) b.style.setProperty('--pill-accent', catColor(k));
      b.addEventListener('click', () => {
        this.chip = this.chip === k ? 'all' : k;
        this.refresh(0, true, true);
      });
    }
  },

});
/* @src src/deck/cards-sidebar.js */
Object.assign(CardsView.prototype, {
  /* sidebar ------------------------------------------------------------- */
  renderSidebar(folder, dir = 0) {
    const body = this.bodyEl;
    const scroll = this.scroller.scrollTop;
    body.empty();
    // rows slide in when you change folder (and on first open), not on background refreshes
    body.removeClass('nd-side-in-fwd', 'nd-side-in-back', 'nd-side-in-fade');
    const animate = dir !== 0 || !this.sideShown;
    this.sideShown = true;
    const finishAnim = () => {
      if (!animate) return;
      let i = 0;
      for (const el of Array.from(body.children)) el.style.setProperty('--i', String(Math.min(i++, 14)));
      void body.offsetWidth;
      body.addClass(dir > 0 ? 'nd-side-in-fwd' : dir < 0 ? 'nd-side-in-back' : 'nd-side-in-fade');
      window.clearTimeout(this.sideAnimTimer);
      this.sideAnimTimer = window.setTimeout(() => body.removeClass('nd-side-in-fwd', 'nd-side-in-back', 'nd-side-in-fade'), 700);
    };
    const q = this.query;
    if (q) {
      const hits = this.app.vault.getMarkdownFiles().filter((f) => this.matchQuery(f)).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 60);
      body.createDiv({ cls: 'nd-section-k', text: `Matches · ${hits.length}` });
      for (const f of hits) this.sideNote(body, f, true);
      if (!hits.length) emptyState(body, 'Nothing matches');
      this.toneRows(body);
      return finishAnim();
    }
    const pins = this.plugin.settings.pinnedFolders.filter((p) => this.app.vault.getAbstractFileByPath(p) instanceof TFolder);
    if (pins.length) {
      body.createDiv({ cls: 'nd-section-k', text: 'Pinned folders' });
      for (const p of pins) {
        const fd = this.app.vault.getAbstractFileByPath(p);
        const info = this.folderInfo(fd);
        const row = body.createDiv('nd-side-pin' + (p === this.path ? ' is-current' : ''));
        this.folderIcon(row, info.cat, p);
        row.createSpan({ cls: 'nd-side-name', text: fd.name });
        row.createSpan({ cls: 'nd-side-count', text: String(info.notes.length + info.other) });
        tip(row, `${p} · right-click to unpin`);
        row.addEventListener('click', () => this.navigate(p, 1));
        row.addEventListener('auxclick', (e) => e.button === 1 && this.plugin.openCardsAt(p, true));
        row.addEventListener('contextmenu', (e) => this.folderMenu(fd, e));
        this.makeDropTarget(row, () => p);
      }
    }
    // browse: current folder
    const head = body.createDiv('nd-side-browse');
    const up = button(head, { icon: 'arrow-up', cls: 'nd-icon-btn', title: 'Up a folder', onClick: () => this.goUp() });
    up.toggleClass('is-disabled', !folder.parent);
    this.makeDropTarget(up, () => this.parentPath());
    // only the folder you're in, not the whole path (full path on hover)
    const label = head.createSpan({ cls: 'nd-section-k', text: folder.path === '/' ? this.app.vault.getName() : folder.name });
    if (folder.path !== '/') tip(label, folder.path);
    button(head, { icon: 'file-plus', cls: 'nd-icon-btn nd-side-add is-note', title: 'New note here', onClick: () => this.plugin.newNote(this.path) });
    button(head, { icon: 'folder-plus', cls: 'nd-icon-btn nd-side-add is-folder', title: 'New folder here', onClick: () => this.plugin.newFolder(this.path) });
    const kids = folder.children.slice();
    const dirs = kids.filter((c) => c instanceof TFolder).sort(bangFirst((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
    const files = kids.filter((c) => c instanceof TFile).sort(this.sorter());
    for (const d of dirs) {
      const info = this.folderInfo(d);
      const row = body.createDiv('nd-side-row is-folder');
      row.dataset.path = d.path;
      if (info.cat) row.style.setProperty('--row-tint', catColor(info.cat));
      this.folderIcon(row, info.cat, d.path);
      if (d.name.startsWith('!')) icon(row, 'pin', 'nd-ico nd-side-bang');
      row.createSpan({ cls: 'nd-side-name', text: d.name });
      row.createSpan({ cls: 'nd-side-count', text: String(info.notes.length + info.other) });
      row.addEventListener('click', () => this.navigate(d.path, 1));
      row.addEventListener('contextmenu', (e) => this.folderMenu(d, e));
      this.dragFolder(row, d);
      this.makeDropTarget(row, () => d.path);
    }
    for (const f of files.slice(0, this.limit)) this.sideNote(body, f, false);
    if (files.length > this.limit) {
      const more = body.createDiv({ cls: 'nd-side-more', text: `Show ${files.length - this.limit} more…` });
      more.addEventListener('click', () => ((this.limit += 240), this.renderSidebar(this.folder())));
    }
    if (!dirs.length && !files.length) emptyState(body, 'Empty folder');
    // inside a folder, its contents sit a little indented under it
    if (folder.parent) for (let el = head.nextElementSibling; el; el = el.nextElementSibling) el.addClass('is-child');
    this.toneRows(body);
    finishAnim();
    this.scroller.scrollTop = animate && dir !== 0 ? 0 : scroll;
  },
  /** Folders in shades of the accent (red), notes in shades of go (lime); shades alternate per kind. */
  toneRows(body) {
    let dirs = 0;
    let notes = 0;
    for (const el of Array.from(body.children)) {
      if (el.matches('.nd-side-pin, .nd-side-row.is-folder')) el.addClass(dirs++ % 2 ? 'tone-b' : 'tone-a');
      else if (el.matches('.nd-side-row.is-note')) el.addClass(notes++ % 2 ? 'tone-b' : 'tone-a');
      else if (el.matches('.nd-section-k')) dirs = notes = 0;
    }
  },
  sideNote(parent, f, showPath) {
    const row = parent.createDiv('nd-side-row is-note');
    row.dataset.path = f.path;
    if (this.plugin.lastFile && this.plugin.lastFile.path === f.path) row.addClass('is-active');
    const cat = fileCategory(this.app, f);
    if (cat && cat !== 'untracked') row.style.setProperty('--row-accent', catColor(cat));
    if (f.name.startsWith('!')) icon(row, 'pin', 'nd-ico nd-side-bang');
    row.createSpan({ cls: 'nd-side-name', text: f.extension === 'md' ? f.basename : f.name });
    const t = Math.max(f.stat.mtime, this.plugin.settings.seen[f.path] || 0);
    row.createSpan({ cls: 'nd-side-count', text: showPath && f.parent && f.parent.path !== '/' ? f.parent.path : shortAgo(t) });
    if (this.needsRevisit(f)) row.addClass('needs-revisit');
    this.plugin.bindFileMouse(row, f, this);
  },

  canMove(f, dest) {
    if (dest == null) return false;
    const parent = f.parent ? f.parent.path : '/';
    if (parent === dest) return false;
    if (f instanceof TFolder && (dest === f.path || dest.startsWith(f.path + '/'))) return false;
    return true;
  },
  /** What is being dragged over a folder target: vault items to move, or files from the computer to copy in. */
  dropItems(e, dest) {
    if (dest == null) return null;
    // a card or row of ours, else something from Obsidian's file list: its obsidian:// URLs are only readable on drop
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    const own = this.plugin.dragging ? [this.plugin.dragging] : e.type === 'drop' ? this.plugin.droppedItems(e.dataTransfer) : [];
    const items = own.filter((f) => (f instanceof TFile || f instanceof TFolder) && this.canMove(f, dest));
    if (items.length) return { move: items };
    if (own.length) return null; // vault items that are already there
    if (types.includes('Files')) return { copy: true };
    return e.type !== 'drop' && types.includes('text/uri-list') ? { move: [] } : null; // maybe vault items: decided on drop
  },
  makeDropTarget(el, getPath) {
    el.addEventListener('dragover', (e) => {
      const what = this.dropItems(e, getPath());
      if (!what || e.defaultPrevented) return; // an inner target already took it
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = what.copy ? 'copy' : 'move';
      el.addClass('is-drop');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.removeClass('is-drop');
    });
    el.addEventListener('drop', async (e) => {
      el.removeClass('is-drop');
      const dest = getPath();
      const what = this.dropItems(e, dest);
      if (!what) return;
      e.preventDefault();
      e.stopPropagation();
      this.plugin.dragging = null;
      if (what.copy) return this.plugin.importFiles(e.dataTransfer, dest);
      for (const f of what.move) await this.plugin.moveTo(f, dest);
    });
  },
});
/* @src src/deck/cards-render.js */
Object.assign(CardsView.prototype, {
  renderCrumbs(folder) {
    const c = this.crumbs;
    c.empty();
    const mk = (label, path) => {
      const b = c.createEl('button', { cls: 'nd-crumb', text: label });
      b.addEventListener('click', () => this.navigate(path, -1));
      this.makeDropTarget(b, () => path);
      return b;
    };
    const home = mk(this.app.vault.getName(), '/');
    if (folder.path === '/') home.addClass('is-current');
    else {
      // inside a folder the vault name is just a home icon, so the path fits
      home.empty();
      home.addClass('is-home');
      setIcon(home, 'home');
      home.setAttr('aria-label', this.app.vault.getName());
    }
    let acc = '';
    const parts = folder.path === '/' ? [] : folder.path.split('/');
    parts.forEach((p, i) => {
      c.createSpan({ cls: 'nd-crumb-sep', text: '/' });
      acc = acc ? `${acc}/${p}` : p;
      const b = mk(p, acc);
      if (i === parts.length - 1) b.addClass('is-current');
    });
    c.scrollLeft = c.scrollWidth;
    c.toggleClass('is-over', c.scrollWidth > c.clientWidth + 1);
  },

  baseCard(parent, cls, i, path) {
    const card = parent.createDiv(`nd-ci ${cls}`);
    card.style.setProperty('--i', String(Math.min(i, 24)));
    card.dataset.path = path;
    return card;
  },
  catTag(parent, cat) {
    if (!cat || cat === 'untracked') return null;
    const t = parent.createSpan({ cls: 'nd-cat-tag', text: CAT_LABEL[cat] });
    t.style.setProperty('--tag-accent', catColor(cat));
    return t;
  },
  folderIcon(parent, cat, path) {
    const ic = icon(parent, 'folder', 'nd-folder-icon');
    const own = path != null && this.plugin.settings.folderColors[path];
    ic.style.setProperty('--folder-accent', own || (cat ? catColor(cat) : 'var(--nd-muted)'));
    return ic;
  },
  folderCard(parent, folder, info, i) {
    const card = this.baseCard(parent, 'nd-ci-folder', i, folder.path);
    this.folderIcon(card, info.cat, folder.path);
    const main = card.createDiv('nd-ci-main');
    const top = main.createDiv('nd-ci-top');
    top.createDiv({ cls: 'nd-ci-title', text: folder.name });
    this.catTag(top, info.cat);
    const n = info.notes.length;
    const weekAgo = Date.now() - 7 * 864e5;
    const files = info.other ? `${info.other} file${info.other === 1 ? '' : 's'}` : '';
    let meta = n || !files ? `${n} note${n === 1 ? '' : 's'}${files ? ` · ${files}` : ''}` : files;
    if (false) { // fork: Revisit removed
      const fresh = info.notes.filter((f) => !this.needsRevisit(f)).length;
      meta += ` · ${fresh} / ${n} revisited`;
      const bar = main.createDiv('nd-ci-progress');
      bar.createDiv('nd-ci-progress-fill').style.width = `${Math.round((fresh / n) * 100)}%`;
    } else {
      const wk = info.notes.filter((f) => f.stat.mtime >= weekAgo).length;
      if (wk) meta += ` · ${wk} edited this week`;
    }
    main.insertBefore(createDiv({ cls: 'nd-ci-meta', text: meta }), main.querySelector('.nd-ci-progress'));
    card.addEventListener('click', () => this.navigate(folder.path, 1));
    card.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    card.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.plugin.openCardsAt(folder.path, true);
      }
    });
    card.addEventListener('contextmenu', (e) => this.folderMenu(folder, e));
    this.dragFolder(card, folder);
    this.makeDropTarget(card, () => folder.path);
  },
  folderMenu(folder, e) {
    e.preventDefault();
    this.plugin.fileMenu(folder, e, (m) => {
      const pinned = this.plugin.settings.pinnedFolders.includes(folder.path);
      m.addItem((it) => it.setTitle(pinned ? 'Unpin folder' : 'Pin folder').setIcon(pinned ? 'pin-off' : 'pin').onClick(() => this.plugin.togglePin(folder.path)));
      m.addItem((it) => it.setTitle('Folder colour…').setIcon('palette').onClick(() => new FolderColorModal(this.plugin, folder).open()));
      m.addItem((it) => it.setTitle('Open in new cards tab').setIcon('layout-grid').onClick(() => this.plugin.openCardsAt(folder.path, true)));
      m.addItem((it) => it.setTitle('New note here').setIcon('file-plus').onClick(() => this.plugin.newNote(folder.path)));
      m.addItem((it) => it.setTitle('New folder here').setIcon('folder-plus').onClick(() => this.plugin.newFolder(folder.path)));
      m.addItem((it) => it.setTitle('Graph of this folder').setIcon('waypoints').onClick(() => this.plugin.openGraph('notes', `folder:${folder.path}`)));
    });
  },
  dragFolder(el, folder) {
    el.setAttr('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      this.plugin.dragging = folder;
      this.plugin.setDragData(e, folder);
    });
    el.addEventListener('dragend', () => (this.plugin.dragging = null));
  },
  fileCard(parent, file, i, showPath) {
    const ext = file.extension.toLowerCase();
    const isMd = ext === 'md';
    const isImg = IMG_EXT.has(ext);
    const cache = isMd ? this.app.metadataCache.getFileCache(file) : null;
    const cat = isMd ? noteCategory(cache, file.path) : null;
    const card = this.baseCard(parent, 'nd-ci-note' + (isImg ? ' is-image' : '') + (isMd ? '' : ' is-other'), i, file.path);
    if (cat && cat !== 'untracked') card.style.setProperty('--ci-accent', catColor(cat));
    if (this.plugin.lastFile && this.plugin.lastFile.path === file.path) card.addClass('is-active');
    const age = this.revisitAge(file);
    const revisit = age >= this.plugin.settings.revisitDays;
    card.toggleClass('needs-revisit', revisit);
    const cover = isImg ? this.app.vault.getResourcePath(file) : isMd ? this.coverFor(file, cache) : null;
    if (cover) {
      card.addClass('has-cover');
      card.createDiv('nd-ci-cover').createEl('img', { attr: { src: cover, loading: 'lazy', alt: '' } });
    }
    const top = card.createDiv('nd-ci-top');
    if (!this.catTag(top, cat)) {
      if (!isMd) top.createSpan({ cls: 'nd-cat-tag is-ext', text: ext });
      else top.createSpan({ cls: 'nd-cat-tag is-none', text: cat === 'untracked' ? 'Untracked' : 'Note' });
    }
    const when = top.createSpan('nd-ci-when');
    if (revisit) {
      when.addClass('is-revisit');
      when.setText(`Revisit · ${age}d`);
    } else {
      const seen = this.plugin.settings.seen[file.path] || 0;
      when.setText(seen > file.stat.mtime ? `opened ${moment(seen).fromNow()}` : `edited ${moment(file.stat.mtime).fromNow()}`);
    }
    card.createDiv({ cls: 'nd-ci-title', text: file.basename });
    if (showPath && file.parent && file.parent.path !== '/') card.createDiv({ cls: 'nd-ci-path', text: file.parent.path });
    if (isMd) {
      this.fillExcerpt(file, card.createDiv('nd-ci-excerpt'));
      const tags = [...new Set(getAllTags(cache || {}) || [])].filter((t) => !/^#(tasks|ticket|projects|school|admin|operations|ops)$/i.test(t));
      const n = this.linkCount(file);
      // no tags and no links: skip the footer, so the card stays close to a folder card's height
      if (tags.length || n) {
        const foot = card.createDiv('nd-ci-foot');
        const tg = foot.createDiv('nd-ci-tags');
        tags.slice(0, 3).forEach((t) => tg.createSpan({ cls: 'nd-tag', text: t }));
        if (n) foot.createSpan({ cls: 'nd-ci-links', text: `${n} link${n === 1 ? '' : 's'}` });
      }
      this.bindPreview(card, file);
    } else {
      const size = file.stat.size > 1048576 ? `${(file.stat.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.stat.size / 1024))} KB`;
      card.createDiv({ cls: 'nd-ci-meta', text: size });
    }
    this.plugin.bindFileMouse(card, file, this);
  },
  coverFor(file, cache) {
    if (!cache) return null;
    const resolve = (link) => {
      if (typeof link !== 'string') return null;
      const clean = link.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
      if (!clean || /^https?:/i.test(clean)) return null;
      const dest = this.app.metadataCache.getFirstLinkpathDest(clean, file.path);
      return dest && IMG_EXT.has(dest.extension.toLowerCase()) ? this.app.vault.getResourcePath(dest) : null;
    };
    const fm = cache.frontmatter || {};
    for (const k of ['cover', 'banner', 'image']) {
      const r = resolve(fm[k]);
      if (r) return r;
    }
    for (const e of cache.embeds || []) {
      const r = resolve(e.link);
      if (r) return r;
    }
    return null;
  },
  async excerpt(file, max = 180) {
    const key = `${file.path}:${file.stat.mtime}:${max}`;
    let t = this.excerpts.get(key);
    if (t === undefined) {
      t = excerptOf(await this.app.vault.cachedRead(file), max);
      if (this.excerpts.size > 2000) this.excerpts.clear();
      this.excerpts.set(key, t);
    }
    return t;
  },
  async fillExcerpt(file, el) {
    const t = await this.excerpt(file);
    el.setText(t || 'Empty note — click to start writing');
    el.toggleClass('is-empty', !t);
  },
  updateCard(file) {
    if (!this.bodyEl || !(file instanceof TFile)) return;
    const card = this.bodyEl.querySelector(`[data-path="${CSS.escape(file.path)}"]`);
    if (!card) return;
    const ex = card.querySelector('.nd-ci-excerpt');
    if (ex) this.fillExcerpt(file, ex);
  },
  markActive() {
    if (!this.bodyEl) return;
    const p = this.plugin.lastFile && this.plugin.lastFile.path;
    this.bodyEl.querySelectorAll('[data-path]').forEach((c) => c.toggleClass('is-active', c.dataset.path === p));
  },

  /* hover preview ------------------------------------------------------ */
  bindPreview(card, file) {
    card.addEventListener('mouseenter', () => {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => this.showPreview(file, card), 550);
    });
    card.addEventListener('mouseleave', () => {
      window.clearTimeout(this.previewTimer);
      this.hidePreview();
    });
  },
  async showPreview(file, card) {
    if (!card.isConnected) return;
    this.hidePreview(true);
    const pv = this.contentEl.createDiv('nd-preview');
    this.previewEl = pv;
    pv.addEventListener('mouseenter', () => window.clearTimeout(this.hideTimer));
    pv.addEventListener('mouseleave', () => this.hidePreview());
    pv.createDiv({ cls: 'nd-preview-k', text: `Preview · ${file.basename}` });
    const text = pv.createDiv('nd-preview-text');
    const ex = await this.excerpt(file, 320);
    if (this.previewEl !== pv) return;
    text.setText(ex || 'Empty note.');
    const from = ((this.incoming && this.incoming.get(file.path)) || []).map((p) => p.split('/').pop().replace(/\.md$/, ''));
    if (from.length) pv.createDiv({ cls: 'nd-preview-links', text: `Linked from: ${from.slice(0, 5).join(', ')}${from.length > 5 ? ` +${from.length - 5}` : ''}` });
    const row = pv.createDiv('nd-preview-row');
    button(row, { text: 'Open', cls: 'mod-cta', onClick: (e) => (this.hidePreview(true), openFile(this.app, file, e)) });
    const hr = this.contentEl.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const w = 340;
    let left = cr.right - hr.left + 10;
    if (left + w > hr.width - 8) left = Math.max(8, cr.left - hr.left - w - 10);
    pv.style.left = `${left}px`;
    pv.style.top = `${clamp(cr.top - hr.top, 8, Math.max(8, hr.height - pv.offsetHeight - 8))}px`;
  },
  hidePreview(now) {
    window.clearTimeout(this.hideTimer);
    const kill = () => {
      if (this.previewEl) this.previewEl.remove();
      this.previewEl = null;
    };
    if (now) kill();
    else this.hideTimer = window.setTimeout(kill, 220);
  },

});
/* @src src/deck/graph-view.js */
/* ------------------------------------------------------------------ */
/* Concept graph (InfraNodus-style)                                    */
/* ------------------------------------------------------------------ */

class GraphView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true;
    this.plugin = plugin;
    // notes only: the concept graph was taken out of the UI in 1.6 (its code is still below, unused)
    this.mode = 'notes';
    this.scope = 'vault';
    this.showLabels = true;
    this.cam = { x: 0, y: 0, k: 1 };
    this.hover = -1;
    this.selected = -1;
    this.focusTopic = -1;
    this.previewTopic = -1;
    this.gapFocus = null;
    this.nodes = [];
    this.links = [];
    this.buildToken = 0;
    this.dpr = 1;
    this.cw = 0;
    this.ch = 0;
  }
  getViewType() {
    return VIEW_GRAPH;
  }
  getDisplayText() {
    return 'Graph';
  }
  getIcon() {
    return 'waypoints';
  }
  getState() {
    return { mode: this.mode, scope: this.scope };
  }
  async setState(state, result) {
    if (state) {
      // older layouts may still ask for 'concepts'; always show notes
      this.mode = 'notes';
      if (state.scope) this.scope = state.scope;
    }
    await super.setState(state, result);
    if (this.ready) {
      this.syncToolbar();
      this.rebuild();
    }
  }

  async onOpen() {
    addHelpAction(this, 'dashboard'); // fork: the ? button in the header (src/shared/help.js)
    if (NEON_MOBILE.on) return void mobileOnlyNote(this.contentEl, 'The note graph'); // fork: desktop-only
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-graph');
    const bar = root.createDiv('nd-graph-bar');
    this.segBtns = {}; // no Concepts / Notes switch any more
    this.scopeSel = bar.createEl('select', { cls: 'dropdown nd-select' });
    this.scopeSel.addEventListener('focus', () => this.fillScopes());
    this.scopeSel.addEventListener('change', () => {
      this.scope = this.scopeSel.value;
      this.rebuild();
      this.app.workspace.requestSaveLayout();
    });
    this.statEl = bar.createDiv('nd-graph-stat');
    const tools = bar.createDiv('nd-tools');
    button(tools, { icon: 'maximize', cls: 'nd-icon-btn', title: 'Fit to view (or double-click the background)', onClick: () => this.fit(true) });
    button(tools, {
      icon: 'shuffle',
      cls: 'nd-icon-btn',
      title: 'Shake the layout',
      onClick: () => {
        if (!this.sim) return;
        this.seedLayout((Math.random() * 1e9) | 0);
        this.sim.alpha = 1;
        for (let i = 0; i < 60; i++) this.sim.tick();
        this.fit(true);
        this.kick();
      },
    });
    this.labelBtn = button(tools, {
      icon: 'type',
      cls: 'nd-icon-btn is-active',
      title: 'Toggle labels',
      onClick: () => {
        this.showLabels = !this.showLabels;
        this.labelBtn.toggleClass('is-active', this.showLabels);
        this.requestDraw();
      },
    });
    button(tools, { icon: 'refresh-cw', cls: 'nd-icon-btn', title: 'Rebuild from notes', onClick: () => this.rebuild() });
    this.panelBtn = button(tools, {
      icon: 'panel-right',
      cls: 'nd-icon-btn is-active',
      title: 'Toggle insights panel',
      onClick: () => {
        root.toggleClass('nd-panel-hidden', !root.hasClass('nd-panel-hidden'));
        this.panelBtn.toggleClass('is-active', !root.hasClass('nd-panel-hidden'));
      },
    });
    const body = root.createDiv('nd-graph-body');
    this.stage = body.createDiv('nd-graph-stage');
    this.canvas = this.stage.createEl('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.emptyEl = this.stage.createDiv('nd-graph-empty');
    this.stage.createDiv({ cls: 'nd-graph-hint', text: 'drag · scroll zoom · double-click open · right-click more' });
    this.panel = body.createDiv('nd-graph-panel');
    this.bindCanvas();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.stage);
    this.register(() => ro.disconnect());
    this.register(() => {
      // closed for good: no timer or ripple may start drawing again
      this.closed = true;
      cancelAnimationFrame(this.raf);
    });
    const soon = debounce(() => this.rebuild(), 1500, true);
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (f && this.scope === 'note' && (!this.builtFor || this.builtFor !== f.path)) soon();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (this.scope === 'note' && this.builtFor === f.path) soon();
      }),
    );
    this.registerEvent(this.app.workspace.on('css-change', () => this.themeChanged()));
    this.register(this.plugin.onLook(() => this.themeChanged()));
    this.ready = true;
    this.fillScopes();
    this.syncToolbar();
    this.resize();
    await this.rebuild();
  }

  syncToolbar() {
    for (const [m, b] of Object.entries(this.segBtns)) b.toggleClass('is-active', m === this.mode);
    this.fillScopes();
  }
  fillScopes() {
    const sel = this.scopeSel;
    sel.empty();
    sel.createEl('option', { value: 'vault', text: '◎ Whole vault' });
    sel.createEl('option', { value: 'note', text: '✎ Active note' + (this.mode === 'notes' ? ' (2 hops)' : '') });
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f) => f instanceof TFolder && f.path !== '/' && !(this.plugin.settings.excludeUnderscore !== false && inUnderscoreFolder(f.path, true)))
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const f of folders) sel.createEl('option', { value: `folder:${f.path}`, text: `▸ ${f.path}` });
    if (![...sel.options].some((o) => o.value === this.scope)) this.scope = 'vault';
    sel.value = this.scope;
  }

  scopeFiles() {
    const excl = (f) => this.plugin.isExcluded(f);
    let files = this.plugin.includedNotes(); // without excluded folders, nor "_" ones (setting)
    this.builtFor = null;
    if (this.scope === 'note') {
      const f = this.plugin.lastFile;
      if (!f || f.extension !== 'md') return [];
      this.builtFor = f.path;
      if (this.mode === 'concepts') return [f];
      const rl = this.app.metadataCache.resolvedLinks;
      const back = new Map();
      for (const src in rl) for (const dst in rl[src]) {
        if (!back.has(dst)) back.set(dst, []);
        back.get(dst).push(src);
      }
      const seen = new Set([f.path]);
      let frontier = [f.path];
      for (let hop = 0; hop < 2; hop++) {
        const next = [];
        for (const p of frontier) for (const q of [...Object.keys(rl[p] || {}), ...(back.get(p) || [])]) {
          if (!seen.has(q)) {
            seen.add(q);
            next.push(q);
          }
        }
        frontier = next;
      }
      return files.filter((x) => seen.has(x.path));
    }
    if (this.scope.startsWith('folder:')) {
      const p = this.scope.slice(7);
      files = files.filter((f) => f.path.startsWith(p + '/'));
    }
    return files.sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  async rebuild() {
    const token = ++this.buildToken;
    const s = this.plugin.settings;
    const files = this.scopeFiles();
    this.statEl.setText('analysing…');
    let net;
    if (this.mode === 'concepts') {
      const docs = [];
      const some = files.slice(0, 1500);
      const texts = await Promise.all(some.map((f) => this.app.vault.cachedRead(f).catch(() => '')));
      some.forEach((f, i) => docs.push({ path: f.path, text: texts[i] }));
      if (token !== this.buildToken) return;
      net = buildConceptNetwork(docs, { window: s.graphWindow, maxNodes: s.graphMaxNodes, stopwords: this.plugin.stopwords() });
    } else {
      net = buildNoteNetwork(this.app, files, s.graphMaxNodes * 2);
    }
    if (token !== this.buildToken) return;
    this.selected = this.hover = this.focusTopic = this.previewTopic = -1;
    this.gapFocus = null;
    if (net.labels.length < 2) {
      this.net = null;
      this.an = null; // a stale analysis made theme changes crash on an empty graph
      this.nodes = [];
      this.links = [];
      this.sim = null;
      this.statEl.setText('');
      this.emptyEl.empty();
      this.emptyEl.addClass('is-visible');
      this.emptyEl.createDiv({ cls: 'nd-graph-empty-art', text: '◌ ◌ ◌' });
      this.emptyEl.createDiv({
        text:
          this.mode === 'concepts'
            ? this.scope === 'note'
              ? 'Open a note with some text, then come back ✦'
              : 'Not enough text yet — write a few notes and rebuild ✦'
            : 'No linked notes in this scope yet — connect notes with [[links]] ✦',
      });
      this.panel.empty();
      this.requestDraw();
      return;
    }
    this.emptyEl.removeClass('is-visible');
    const an = analyzeNetwork(net.labels.length, net.edges);
    this.net = net;
    this.an = an;
    this.nodes = net.labels.map((label, i) => ({
      i,
      label,
      kind: net.kinds[i],
      r: 4 + 20 * an.score[i],
      c: an.comm[i],
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fixed: false,
    }));
    this.links = net.edges.map(([a, b, w]) => ({ s: this.nodes[a], t: this.nodes[b], w }));
    this.maxW = this.links.reduce((m, l) => Math.max(m, l.w), 1);
    this.neighbors = an.adj.map((a) => new Set(a));
    this.bcRank = this.nodes.map((n) => n.i).sort((a, b) => an.bc[b] - an.bc[a]);
    this.sim = new ForceSim(this.nodes, this.links);
    this.seedLayout(7);
    for (let i = 0; i < 180; i++) this.sim.tick();
    this.statEl.setText(`${this.nodes.length} ${this.mode === 'concepts' ? 'concepts' : 'notes'} · ${this.links.length} links · ${an.topics.length} topics`);
    this.fit(false);
    this.renderPanel();
    this.kick();
  }

  seedLayout(seed) {
    const rand = mulberry32(seed);
    const an = this.an;
    const nT = an.topics.length;
    const R = 40 * Math.sqrt(this.nodes.length);
    an.topics.forEach((t, k) => {
      const ang = (k / Math.max(1, nT)) * Math.PI * 2 + rand();
      const cx = k === 0 ? 0 : Math.cos(ang) * R;
      const cy = k === 0 ? 0 : Math.sin(ang) * R;
      const spread = 20 * Math.sqrt(t.members.length);
      for (const i of t.members) {
        const n = this.nodes[i];
        n.x = cx + (rand() - 0.5) * spread;
        n.y = cy + (rand() - 0.5) * spread;
        n.vx = n.vy = 0;
        n.fixed = false;
      }
    });
  }

  themeChanged() {
    this._col = null;
    if (this.an && this.net) this.renderPanel();
    this.requestDraw();
  }

  resize() {
    if (!this.stage) return;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!w || !h) return;
    const first = !this.cw;
    this.dpr = window.devicePixelRatio || 1;
    this.cw = w;
    this.ch = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (first && this.nodes.length) this.fit(false);
    this.requestDraw();
  }

  bounds(ids) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of ids || this.nodes.map((n) => n.i)) {
      const n = this.nodes[i];
      x0 = Math.min(x0, n.x - n.r - 20);
      x1 = Math.max(x1, n.x + n.r + 20);
      y0 = Math.min(y0, n.y - n.r - 10);
      y1 = Math.max(y1, n.y + n.r + 26);
    }
    return { x0, y0, x1, y1 };
  }
  fit(animate, ids) {
    if (!this.nodes.length || !this.cw) return;
    const b = this.bounds(ids);
    const k = clamp(Math.min(this.cw / (b.x1 - b.x0), this.ch / (b.y1 - b.y0)) * 0.92, 0.08, ids ? 2.2 : 1.6);
    const to = { k, x: this.cw / 2 - ((b.x0 + b.x1) / 2) * k, y: this.ch / 2 - ((b.y0 + b.y1) / 2) * k };
    this.moveCam(to, animate);
  }
  focusNode(n) {
    const k = Math.max(this.cam.k, 1.1);
    this.moveCam({ k, x: this.cw / 2 - n.x * k, y: this.ch / 2 - n.y * k }, true);
  }
  moveCam(to, animate) {
    if (!animate) {
      this.cam = to;
      this.camAnim = null;
      this.requestDraw();
      return;
    }
    this.camAnim = { from: { ...this.cam }, to, t0: performance.now(), dur: 420 };
    this.kick();
  }

  focusSet() {
    const nb = (i) => new Set([i, ...this.neighbors[i]]);
    if (this.hover >= 0) return nb(this.hover);
    if (this.selected >= 0) return nb(this.selected);
    const t = this.previewTopic >= 0 ? this.previewTopic : this.focusTopic;
    if (t >= 0) return new Set(this.an.topics[t].members);
    if (this.gapFocus) return new Set([...this.an.topics[this.gapFocus.a].members, ...this.an.topics[this.gapFocus.b].members]);
    return null;
  }

}

/* @src src/deck/graph-panel.js */
Object.assign(GraphView.prototype, {
  select(i) {
    this.selected = i;
    this.renderSelection();
    this.requestDraw();
  },
  nodeFile(n) {
    if (this.mode === 'notes') return this.net.files[n.i];
    if (n.kind === 'link') return this.app.metadataCache.getFirstLinkpathDest(this.net.keys[n.i].slice(1, -1), '');
    return null;
  },
  activateNode(n, e) {
    const f = this.nodeFile(n);
    if (f) this.plugin.openFile(f, e);
    else this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label);
  },
  nodeMenu(n, e) {
    const f = this.nodeFile(n);
    if (this.mode === 'notes' && f) {
      this.plugin.fileMenu(f, e);
      return;
    }
    const m = new Menu();
    m.addItem((it) => it.setTitle(`Search notes for “${n.label}”`).setIcon('search').onClick(() => this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label)));
    if (f) m.addItem((it) => it.setTitle('Open note').setIcon('file-text').onClick(() => this.plugin.openFile(f)));
    else if (n.kind === 'word')
      m.addItem((it) =>
        it.setTitle(`Create note “${n.label}”`).setIcon('file-plus').onClick(async () => {
          const nf = await createUnique(this.app, '', n.label, `# ${n.label}\n\n`);
          this.plugin.openFile(nf);
        }),
      );
    m.addItem((it) => it.setTitle('Focus its topic').setIcon('shapes').onClick(() => this.toggleTopic(n.c)));
    m.addSeparator();
    m.addItem((it) =>
      it.setTitle(`Hide “${n.label}” (stop-word)`).setIcon('eye-off').onClick(async () => {
        const s = this.plugin.settings;
        s.extraStopwords = [s.extraStopwords, this.net.keys[n.i]].filter(Boolean).join(', ');
        await this.plugin.saveSettings();
        this.rebuild();
      }),
    );
    m.showAtMouseEvent(e);
  },
  toggleTopic(k) {
    this.focusTopic = this.focusTopic === k ? -1 : k;
    this.gapFocus = null;
    this.panel.querySelectorAll('.nd-topic').forEach((r, idx) => r.toggleClass('is-active', idx === this.focusTopic));
    if (this.focusTopic >= 0) this.fit(true, this.an.topics[k].members);
    else this.fit(true);
    this.requestDraw();
  },

  section(title, ic) {
    const s = this.panel.createDiv('nd-panel-sec');
    const h = s.createDiv('nd-panel-head');
    icon(h, ic);
    h.createSpan({ text: title });
    return s;
  },
  topicWords(k, n = 3) {
    return this.an.topics[k].members.slice(0, n).map((i) => this.net.labels[i]);
  },

  renderPanel() {
    const p = this.panel;
    p.empty();
    const an = this.an;
    const pal = this.colors().pal;
    const unit = this.mode === 'concepts' ? 'concepts' : 'notes';

    const st = this.section('Structure', 'gauge');
    const badge = st.createDiv(`nd-diversity is-${an.diversity.toLowerCase()}`);
    badge.createDiv({ cls: 'nd-div-label', text: an.diversity });
    const q = badge.createDiv({ cls: 'nd-div-q', text: `modularity ${an.Q.toFixed(2)} · top topic ${Math.round(an.topics[0].share * 100)}%` });
    tip(q, `Modularity (0 to 1): how cleanly your ${unit} split into separate topics; higher means more self-contained clusters. Top topic: the share of your ${unit} in the largest topic.`);
    // fork: a scale, not buttons: one bar split into the four levels, a marker on yours, plain names below
    const levels = ['Biased', 'Focused', 'Diversified', 'Dispersed'];
    const at = Math.max(0, levels.indexOf(an.diversity));
    const scale = st.createDiv('nd-div-gauge');
    const bar = scale.createDiv('nd-div-bar');
    for (const lvl of levels) tip(bar.createDiv(`nd-div-seg is-${lvl.toLowerCase()}`), DIVERSITY_MEANING[lvl]);
    bar.createDiv('nd-div-marker').style.left = `${(at + 0.5) * 25}%`;
    const names = scale.createDiv('nd-div-names');
    for (const lvl of levels) tip(names.createDiv({ cls: 'nd-div-name' + (lvl === an.diversity ? ' is-on' : ''), text: lvl }), DIVERSITY_MEANING[lvl]);
    st.createDiv({ cls: 'nd-muted', text: DIVERSITY_HINT[an.diversity] });

    const tp = this.section('Main topics', 'shapes');
    an.topics.slice(0, 8).forEach((t, k) => {
      const row = tp.createDiv('nd-topic');
      row.style.setProperty('--topic', pal[k % pal.length]);
      row.createDiv({ cls: 'nd-topic-sw', text: String(k + 1) });
      const txt = row.createDiv('nd-topic-txt');
      txt.createDiv({ cls: 'nd-topic-words', text: this.topicWords(k, 4).join(' · ') });
      const meter = txt.createDiv('nd-topic-meter');
      meter.createDiv('nd-topic-fill').style.setProperty('--w', `${Math.round(t.share * 100)}%`);
      txt.createDiv({ cls: 'nd-topic-share', text: `${Math.round(t.share * 100)}% · ${t.members.length} ${unit}` });
      row.addEventListener('mouseenter', () => {
        this.previewTopic = k;
        this.requestDraw();
      });
      row.addEventListener('mouseleave', () => {
        this.previewTopic = -1;
        this.requestDraw();
      });
      row.addEventListener('click', () => this.toggleTopic(k));
    });

    const inf = this.section('Most influential', 'zap');
    const chips = inf.createDiv('nd-chip-row');
    this.bcRank.slice(0, 14).forEach((i) => {
      const n = this.nodes[i];
      const chip = chips.createEl('button', { cls: 'nd-chip', text: n.label });
      chip.style.setProperty('--card-accent', pal[n.c % pal.length]);
      chip.addEventListener('click', () => {
        this.select(i);
        this.focusNode(n);
      });
      chip.addEventListener('mouseenter', () => {
        this.hover = i;
        this.requestDraw();
      });
      chip.addEventListener('mouseleave', () => {
        this.hover = -1;
        this.requestDraw();
      });
    });

    const gp = this.section('Structural gaps', 'unlink');
    if (!an.gaps.length) gp.createDiv({ cls: 'nd-muted', text: 'Not enough distinct topics to detect gaps yet.' });
    an.gaps.forEach((g) => {
      const card = gp.createDiv('nd-gap');
      const line = card.createDiv('nd-gap-line');
      const wa = this.topicWords(g.a, 2);
      const wb = this.topicWords(g.b, 2);
      const sa = line.createSpan({ cls: 'nd-gap-side', text: wa.join(' · ') });
      sa.style.setProperty('--topic', pal[g.a % pal.length]);
      line.createSpan({ cls: 'nd-gap-x', text: '⟷' });
      const sb = line.createSpan({ cls: 'nd-gap-side', text: wb.join(' · ') });
      sb.style.setProperty('--topic', pal[g.b % pal.length]);
      card.createDiv({
        cls: 'nd-gap-q',
        text: this.mode === 'concepts' ? `How does “${wa[0]}” relate to “${wb[0]}”?` : `What connects [[${wa[0]}]] with [[${wb[0]}]]?`,
      });
      card.createDiv({ cls: 'nd-gap-meta', text: g.weight ? `only ${g.weight} weak link${g.weight === 1 ? '' : 's'} between them` : 'no links between them yet' });
      const row = card.createDiv('nd-gap-actions');
      const hl = button(row, {
        icon: 'scan-eye',
        text: 'Highlight',
        onClick: () => {
          const same = this.gapFocus === g;
          this.gapFocus = same ? null : g;
          this.focusTopic = -1;
          gp.querySelectorAll('.nd-gap').forEach((c) => c.removeClass('is-active'));
          if (!same) card.addClass('is-active');
          if (!same) this.fit(true, [...an.topics[g.a].members, ...an.topics[g.b].members]);
          this.requestDraw();
        },
      });
      hl.addClass('nd-small');
      button(row, { icon: 'git-merge', text: 'Bridge note', cls: 'mod-cta nd-small', onClick: () => this.createBridge(g) });
    });

    this.selEl = this.section('Selection', 'mouse-pointer-click');
    this.renderSelection();
  },

  renderSelection() {
    const s = this.selEl;
    if (!s) return;
    s.querySelectorAll('.nd-sel').forEach((x) => x.remove());
    const box = s.createDiv('nd-sel');
    if (this.selected < 0 || !this.nodes[this.selected]) {
      box.createDiv({ cls: 'nd-muted', text: 'Click a node to inspect it. Double-click opens it.' });
      return;
    }
    const n = this.nodes[this.selected];
    const pal = this.colors().pal;
    const title = box.createDiv({ cls: 'nd-sel-title', text: n.label });
    title.style.setProperty('--topic', pal[n.c % pal.length]);
    const stats = box.createDiv('nd-chip-row');
    const rank = this.bcRank.indexOf(n.i) + 1;
    stats.createSpan({ cls: 'nd-pill', text: `#${rank} influence` });
    stats.createSpan({ cls: 'nd-pill', text: `${this.neighbors[n.i].size} connections` });
    stats.createSpan({ cls: 'nd-pill', text: `topic ${n.c + 1}` });
    if (this.mode === 'concepts') stats.createSpan({ cls: 'nd-pill', text: `×${this.net.freq[n.i]}` });
    const actions = box.createDiv('nd-gap-actions');
    const f = this.nodeFile(n);
    if (f) button(actions, { icon: 'file-text', text: 'Open', cls: 'mod-cta nd-small', onClick: (e) => this.plugin.openFile(f, e) });
    if (this.mode === 'concepts') button(actions, { icon: 'search', text: 'Search', cls: 'nd-small', onClick: () => this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label) });
    const list = box.createDiv('nd-mini-list');
    const files =
      this.mode === 'concepts'
        ? this.net.where[n.i].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((x) => x instanceof TFile)
        : [...this.neighbors[n.i]].map((j) => this.net.files[j]);
    box.createDiv({ cls: 'nd-muted', text: this.mode === 'concepts' ? `Appears in ${files.length} note${files.length === 1 ? '' : 's'}:` : 'Linked notes:' });
    box.appendChild(list);
    files.slice(0, 12).forEach((file, i) => {
      const row = list.createDiv('nd-mini');
      row.style.setProperty('--i', String(i));
      row.style.setProperty('--card-accent', pal[n.c % pal.length]);
      row.createDiv({ cls: 'nd-mini-title', text: file.basename });
      this.plugin.bindFileMouse(row, file, this);
    });
  },

  async createBridge(g) {
    const wa = this.topicWords(g.a, 4);
    const wb = this.topicWords(g.b, 4);
    const notesOf = (k) => {
      const t = this.an.topics[k];
      const out = new Set();
      if (this.mode === 'notes') t.members.slice(0, 4).forEach((i) => out.add(this.net.files[i].basename));
      else
        for (const i of t.members.slice(0, 4))
          for (const p of this.net.where[i].slice(0, 2)) {
            const f = this.app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) out.add(f.basename);
          }
      return [...out].slice(0, 5);
    };
    const strip = (w) => w.replace(/^\[\[|\]\]$/g, '');
    const title = `Bridge – ${strip(wa[0])} × ${strip(wb[0])}`;
    const body = [
      '---',
      'tags: [bridge, idea]',
      `created: ${moment().format('YYYY-MM-DD HH:mm')}`,
      '---',
      `# 🌉 ${strip(wa[0])} × ${strip(wb[0])}`,
      '',
      `> [!question] Structural gap found by ${appName()}`,
      `> How does **${wa.join(', ')}** relate to **${wb.join(', ')}**?`,
      '',
      `## Side A — ${wa.join(' · ')}`,
      ...notesOf(g.a).map((b) => `- [[${b}]]`),
      '',
      `## Side B — ${wb.join(' · ')}`,
      ...notesOf(g.b).map((b) => `- [[${b}]]`),
      '',
      '## Connecting ideas',
      '- ',
      '',
    ].join('\n');
    const f = await createUnique(this.app, this.plugin.bridgeFolder(), title, body);
    new Notice('🌉 Bridge note created');
    this.plugin.openFile(f, { ctrlKey: true });
  },
});
/* @src src/deck/graph-draw.js */
Object.assign(GraphView.prototype, {
  colors() {
    if (this._col) return this._col;
    const cs = getComputedStyle(this.contentEl);
    const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
    const pal = PALETTE.map((c, i) => v(`--nd-c${i + 1}`, c));
    // canvas can't read var() or every CSS colour form: resolve once to rgb and build alpha variants
    const rgb = (str) => parseColor(str).map((x) => Math.round(x * 255)).join(',');
    const palRgb = pal.map(rgb);
    return (this._col = {
      pal,
      a: (i, alpha) => `rgba(${palRgb[i % palRgb.length]},${alpha})`,
      text: v('--nd-text', v('--text-normal', '#e4e6ea')),
      bg: v('--nd-bg', v('--background-primary', '#121418')),
      surface: v('--nd-surface', v('--background-secondary', '#191c21')),
      muted: v('--nd-muted', v('--text-faint', '#8f95a0')),
      hot: v('--nd-accent', '#e5506a'),
      hotA: (alpha) => `rgba(${rgb(v('--nd-accent', '#e5506a'))},${alpha})`,
      font: v('--nd-font-ui', '"Space Grotesk", sans-serif').replace(/var\([^)]*\),?\s*/g, ''),
      dark: !document.body.hasClass('theme-light'),
    });
  },
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.cw) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!this.nodes.length) return;
    const col = this.colors();
    const cam = this.cam;
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);
    // every node fades on its own (~0.2 s): dim when something else is in focus, lit when it is part of the focus.
    // So moving from one node straight onto its neighbour cross-fades too.
    const now = performance.now();
    const focus = this.focusSet();
    const dt = this.fadeBusy && this.fadeAt ? Math.min(50, now - this.fadeAt) : 16; // a new fade starts with one frame's step
    this.fadeAt = now;
    const f = prefersReducedMotion() ? 1 : Math.min(1, dt / 60);
    let busy = false;
    const ease = (v, t) => {
      const x = v == null ? t : v + (t - v) * f;
      if (Math.abs(t - x) < 0.02) return t;
      busy = true;
      return x;
    };
    for (const n of this.nodes) {
      const inF = !!focus && focus.has(n.i);
      n.dim = ease(n.dim, focus && !inF ? 1 : 0);
      n.lit = ease(n.lit, inF ? 1 : 0);
    }
    this.fadeBusy = busy;
    ctx.lineCap = 'round';
    // calm style: links one quiet grey, lit in the accent around the focus; nodes plain accent dots with a faint glow
    const linkA = (col.dark ? 0.16 : 0.1) * clamp(250 / Math.max(1, this.links.length), 0.35, 1);
    // links grouped by strength (20 steps) so a big graph is still a handful of strokes
    const strokeGroups = (alphaOf, style, width) => {
      const groups = new Map();
      for (const l of this.links) {
        const a = Math.round(alphaOf(l) * 20) / 20;
        if (a <= 0) continue;
        if (!groups.has(a)) groups.set(a, new Path2D());
        const path = groups.get(a);
        path.moveTo(l.s.x, l.s.y);
        path.lineTo(l.t.x, l.t.y);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (const [a, path] of groups) {
        ctx.globalAlpha = a;
        ctx.stroke(path);
      }
    };
    const mix = (a, b, k) => a + (b - a) * k;
    strokeGroups((l) => mix(linkA, 0.03, Math.max(l.s.dim, l.t.dim)), col.muted, 0.8 / Math.sqrt(cam.k));
    strokeGroups((l) => 0.55 * Math.min(l.s.lit, l.t.lit), col.hot, 1.2 / Math.sqrt(cam.k));
    // drawn size: smaller than the hit size n.r, so hubs read as bigger dots, not balloons
    const dr = (n) => 2.5 + n.r * 0.45;
    ctx.fillStyle = col.hot;
    for (const n of this.nodes) {
      ctx.globalAlpha = mix(0.9, 0.12, n.dim);
      if (col.dark && n.dim < 0.5) {
        ctx.shadowColor = col.hotA(0.35);
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, dr(n), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // hover / selection: one plain ring
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col.text;
    ctx.lineWidth = 1.5 / cam.k;
    for (const i of [this.selected, this.hover]) {
      const n = i >= 0 && this.nodes[i];
      if (!n) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, dr(n) + 3 / cam.k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // names: hovered or picked always; hubs and the focus with labels on; everything once zoomed in
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.nodes) {
      const special = n.i === this.hover || n.i === this.selected;
      const hub = n.r > 12;
      if (!special && !(this.showLabels && (hub || n.lit > 0.5 || cam.k > 1.4))) continue;
      const fs = 10 + n.r * 0.25;
      if (!special && fs * cam.k < 7) continue;
      ctx.globalAlpha = mix(1, 0.14, n.dim);
      ctx.font = `${special ? 700 : 500} ${fs}px ${col.font}`;
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = col.bg;
      const y = n.y + dr(n) + fs * 0.8;
      ctx.strokeText(n.label, n.x, y);
      ctx.fillStyle = special ? col.text : col.muted;
      ctx.fillText(n.label, n.x, y);
    }
    ctx.globalAlpha = 1;
  },

  kick() {
    if (this.raf || this.closed) return;
    const loop = (now) => {
      this.raf = 0;
      let busy = false;
      if (this.sim && this.sim.alpha > 0.004) {
        this.sim.tick();
        this.dirty = true;
        busy = true;
      }
      if (this.camAnim) {
        const a = this.camAnim;
        const t = clamp((now - a.t0) / a.dur, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        this.cam = {
          k: a.from.k + (a.to.k - a.from.k) * e,
          x: a.from.x + (a.to.x - a.from.x) * e,
          y: a.from.y + (a.to.y - a.from.y) * e,
        };
        if (t >= 1) this.camAnim = null;
        this.dirty = true;
        busy = true;
      }
      if (this.dirty) {
        this.draw();
        this.dirty = !!this.fadeBusy; // keep drawing until the dimming has faded in or out
        busy = busy || this.fadeBusy;
      }
      if (busy || this.drag) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  requestDraw() {
    this.dirty = true;
    this.kick();
  },

  hit(x, y) {
    for (let j = this.nodes.length - 1; j >= 0; j--) {
      const n = this.nodes[j];
      const r = n.r + 4 / this.cam.k;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
  },

  bindCanvas() {
    const cv = this.canvas;
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      return { sx, sy, x: (sx - this.cam.x) / this.cam.k, y: (sy - this.cam.y) / this.cam.k };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = pt(e);
      const n = this.hit(p.x, p.y);
      cv.setPointerCapture(e.pointerId);
      this.camAnim = null;
      this.drag = { n, sx: p.sx, sy: p.sy, camX: this.cam.x, camY: this.cam.y, moved: false };
      if (n) n.fixed = true;
      cv.addClass('is-grabbing');
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pt(e);
      const d = this.drag;
      if (d) {
        if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) > 4) d.moved = true;
        if (!d.moved) return;
        if (d.n) {
          d.n.x = p.x;
          d.n.y = p.y;
          if (this.sim) this.sim.alpha = Math.max(this.sim.alpha, 0.15);
          this.requestDraw();
        } else {
          this.cam.x = d.camX + (p.sx - d.sx);
          this.cam.y = d.camY + (p.sy - d.sy);
          this.requestDraw();
        }
        return;
      }
      const n = this.hit(p.x, p.y);
      const h = n ? n.i : -1;
      if (h !== this.hover) {
        this.hover = h;
        cv.toggleClass('is-hovering', !!n);
        this.requestDraw();
      }
    });
    const end = (e) => {
      const d = this.drag;
      this.drag = null;
      cv.removeClass('is-grabbing');
      if (!d) return;
      if (d.n) d.n.fixed = e.altKey;
      if (!d.moved) this.select(d.n ? d.n.i : -1);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => {
      if (this.hover !== -1 && !this.drag) {
        this.hover = -1;
        this.requestDraw();
      }
    });
    cv.addEventListener('dblclick', (e) => {
      const p = pt(e);
      const n = this.hit(p.x, p.y);
      if (n) this.activateNode(n, e);
      else this.fit(true);
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = pt(e);
        const k = clamp(this.cam.k * Math.exp(-e.deltaY * 0.0015), 0.06, 6);
        this.camAnim = null;
        this.cam = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
        this.requestDraw();
      },
      { passive: false },
    );
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = pt(e);
      const n = this.hit(p.x, p.y);
      if (n) this.nodeMenu(n, e);
    });
  },

});
/* @src src/deck/settings.js */
/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

class NeonSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    containerEl.empty();
    containerEl.addClass('nd-settings');
    const save = () => p.saveSettings();
    const num = (setting, key, min, max) => numSetting(setting, s, key, min, max, save);

    new Setting(containerEl).setName('Look').setHeading();
    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Every theme has a light and a dark version.')
      .addDropdown((d) => d.addOptions(THEME_LABEL).setValue(s.theme).onChange((v) => p.setLook({ theme: v })));
    new Setting(containerEl)
      .setName('Pattern')
      .setDesc('The live background behind the dashboard and the card explorer. “Theme default” follows the theme.')
      .addDropdown((d) => d.addOptions({ auto: 'Theme default', ...PATTERN_LABEL }).setValue(s.pattern).onChange((v) => p.setLook({ pattern: v })));
    new Setting(containerEl)
      .setName('Pattern strength')
      .addDropdown((d) => d.addOptions(STRENGTH_LABEL).setValue(s.patternStrength).onChange((v) => p.setLook({ patternStrength: v })));
    new Setting(containerEl)
      .setName('Pattern motion')
      .setDesc('The pattern drifts very slowly. It always pauses when Obsidian is in the background and when your system asks for reduced motion.')
      .addToggle((t) => t.setValue(s.patternMotion).onChange((v) => p.setLook({ patternMotion: v })));
    new Setting(containerEl)
      .setName('Your name')
      .setDesc('Used in the dashboard greeting.')
      .addText((t) => t.setValue(s.name).onChange((v) => ((s.name = v.trim()), save())));
    new Setting(containerEl).setName('Open dashboard on startup').addToggle((t) => t.setValue(s.openDashboardOnStartup).onChange((v) => ((s.openDashboardOnStartup = v), save())));

    new Setting(containerEl).setName('Locations').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: `Used only when you use that feature; nothing is created or moved in advance. Empty: the name shown, inside the base folder (${NEON_BASE.folder || 'the vault root'}; set it in Overview).` });
    const loc = (name, desc, key, def, kind) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath(def)).setValue(s[key]).onChange((v) => ((s[key] = v.trim() ? normalizePath(v.trim()) : ''), (p._ex = null), save())), kind));
    loc('Weekly review folder', 'Where “Create / open this week’s review” saves the review.', 'reviewFolder', 'Reviews', 'folder');
    new Setting(containerEl)
      .setName('Weekly review template')
      .setDesc('Note the weekly review starts from. {{weekLine}} (the week in numbers), {{weekNotes}} (new and edited notes), {{date:…}} and {{weekEnd:…}} are filled in.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('templates/weekly_review_template.md').setValue(s.reviewTemplate).onChange((v) => ((s.reviewTemplate = v.trim()), save())), 'file'));
    loc('Pin board note', 'One pin per line. Made the first time you pin something.', 'pinBoardPath', 'Pin board.md', 'file');
    loc('Pinned files folder', 'Where files dropped onto the pin board from outside Obsidian are saved.', 'pinnedFolder', 'Pinned', 'folder');
    loc('Bridge note folder', 'Where the graph saves bridge notes.', 'bridgeFolder', 'Bridges', 'folder');
    new Setting(containerEl)
      .setName('Inbox folder')
      .setDesc(`Inbox notes go here: from New note’s Inbox button, and from Quick capture (“Inbox note”, named after the first line). Empty: ${basePath('Inbox')}.`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Inbox')).setValue(s.inboxFolder).onChange((v) => ((s.inboxFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'));
    new Setting(containerEl)
      .setName('Inbox card')
      .setDesc('Inbox notes not dealt with yet, newest first, with an “Add to Inbox” box. A note is dealt with when its status is one of these (comma-separated).')
      .addToggle((t) => t.setValue(s.inboxCard !== false).onChange(async (v) => ((s.inboxCard = v), await save(), p.registerInboxCard())))
      .addText((t) => t.setPlaceholder('completed, cancelled, stopped').setValue(s.inboxDone).onChange((v) => ((s.inboxDone = v), save())));
    new Setting(containerEl)
      .setName('Inbox tag and status')
      .setDesc('Every inbox note gets this tag and this status property, also when it starts from the template.')
      .addText((t) => t.setPlaceholder('inbox').setValue(s.inboxTag).onChange((v) => ((s.inboxTag = v.trim().replace(/^#/, '')), save())))
      .addText((t) => t.setPlaceholder('waiting').setValue(s.inboxStatus).onChange((v) => ((s.inboxStatus = v.trim()), save())));
    new Setting(containerEl)
      .setName('Inbox template')
      .setDesc('Optional template for inbox notes; the captured text goes below it.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('e.g. templates/inbox_template.md').setValue(s.inboxTemplate).onChange((v) => ((s.inboxTemplate = v.trim()), save())), 'file'));
    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Comma-separated, e.g. an archive folder. Left out of stats, Recently touched, the Activity calendar, the graph, tasks and projects.')
      .addText((t) => t.setPlaceholder('4.Archive').setValue(s.excludeFolders).onChange((v) => ((s.excludeFolders = v), (p._ex = null), save())));
    new Setting(containerEl)
      .setName('Leave out folders starting with _')
      .setDesc('Folders such as _claude (tools, scripts, caches) count as excluded folders too. The card explorer and search still show them.')
      .addToggle((t) => t.setValue(s.excludeUnderscore !== false).onChange((v) => ((s.excludeUnderscore = v), (p._ex = null), save())));
    new Setting(containerEl)
      .setName('Ignored tags')
      .setDesc('Comma-separated. Notes with one of these tags in their properties are ignored by stats, tasks, projects and research, e.g. folder index notes (vault_index).')
      .addText((t) => t.setPlaceholder('vault_index').setValue(s.excludeTags).onChange((v) => ((s.excludeTags = v), setIgnoredTags(v), (p._ex = null), save())));
    new Setting(containerEl)
      .setName('Ignore the templates folder')
      .setDesc(`The folders set in the core Templates plugin and Templater${p.tplFolders.length ? ` (${p.tplFolders.join(', ')})` : ''}, so template tasks and properties never count.`)
      .addToggle((t) => t.setValue(s.excludeTemplates).onChange((v) => ((s.excludeTemplates = v), (p._ex = null), save())));

    new Setting(containerEl)
      .setName('Ignore archive folders')
      .setDesc('Top-level folders with “archive” in their name (e.g. 4.Archive).')
      .addToggle((t) => t.setValue(s.excludeArchive).onChange((v) => ((s.excludeArchive = v), (p._ex = null), save())));

    new Setting(containerEl).setName('Areas card').setHeading();
    new Setting(containerEl)
      .setName('Show the Areas card')
      .setDesc('One row per group (areas, or customers): active projects, open tasks, notes edited this month and when you last touched it; the quietest first. Takes the Claude card’s place.')
      .addToggle((t) => t.setValue(s.areasCard).onChange(async (v) => ((s.areasCard = v), await save(), p.registerClaudeCard())));
    new Setting(containerEl).setName('Claude card').setHeading();
    new Setting(containerEl)
      .setName('Show the Claude card')
      .setDesc('Notes waiting for Claude and notes Claude changed, by a property. Read only.')
      .addToggle((t) => t.setValue(s.claudeCard).onChange(async (v) => ((s.claudeCard = v), await save(), p.registerClaudeCard())));
    const cl = (name, key, ph) => new Setting(containerEl).setName(name).addText((t) => t.setPlaceholder(ph).setValue(s[key]).onChange((v) => ((s[key] = v.trim() || ph), save(), p.registerClaudeCard())));
    cl('Property', 'claudeProperty', 'claude');
    cl('Waiting for Claude (values)', 'claudeWaiting', 'process, refine');
    cl('To review (values)', 'claudeReview', 'updated');

    new Setting(containerEl).setName('Daily notes').setHeading();
    const coreDaily = corePluginOn(p.app, 'daily-notes');
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: coreDaily
        ? `Obsidian’s core Daily notes plugin is on, so its settings are used (folder “${dailyOpts(p.app).folder || '/'}”, format “${dailyOpts(p.app).format}”). The settings below apply only when it is off.`
        : 'Obsidian’s core Daily notes plugin is off, so these settings are used. A format may include folders, e.g. YYYY/YYYY-ww for weekly notes.',
    });
    // fork: filled in from the core Daily notes plugin the first time (see loadSettings)
    const daily = (name, key, ph, kind) =>
      new Setting(containerEl).setName(name).addText((t) => {
        t.setPlaceholder(ph).setValue(s[key]).onChange((v) => ((s[key] = v.trim()), p.applyDailyFallback(), save()));
        return kind ? suggestPaths(p.app, t, kind) : t;
      });
    daily('Folder', 'dailyFolder', 'e.g. Daily', 'folder');
    daily('File name format', 'dailyFormat', 'YYYY-MM-DD');
    daily('Template', 'dailyTemplate', 'e.g. templates/daily.md', 'file');

    new Setting(containerEl).setName('Card explorer').setHeading();
    new Setting(containerEl).setName('Show cards in the left sidebar').addToggle((t) => t.setValue(s.cardsInSidebar).onChange((v) => ((s.cardsInSidebar = v), save())));
    new Setting(containerEl)
      .setName('Replace the file explorer')
      .setDesc('Closes the tree-view file explorer on startup. Get it back with “Files: Show file explorer”.')
      .addToggle((t) => t.setValue(s.replaceFileExplorer).onChange((v) => ((s.replaceFileExplorer = v), save())));

    new Setting(containerEl).setName('Graph').setHeading();
    num(new Setting(containerEl).setName('Max notes').setDesc('The graph shows up to twice this many notes.'), 'graphMaxNodes', 20, 400);
    madeWith(containerEl);
  }
}

/* @src src/deck/pins.js */
/* ---- pin board note: one pin per line ---------------------------------- */
// `- [[path]]` or `- ![[path]]` is a file pin, any other line a text pin; frontmatter and # headings are skipped
function parsePins(text) {
  return stripFrontmatter(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l))
    .map((raw) => {
      const body = raw.replace(/^[-*+]\s+/, '');
      const m = body.match(/^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
      return m ? { raw, link: m[1].trim() } : { raw, text: body };
    });
}
/** The note with `line` added at the end (unchanged when that pin is already there). */
function addPinLine(text, line) {
  text = text || '';
  if (parsePins(text).some((p) => p.raw === line)) return text;
  return (text && !text.endsWith('\n') ? text + '\n' : text) + line + '\n';
}
/** The note without the first line that is `raw` (trimmed). */
function removePinLine(text, raw) {
  const lines = (text || '').split('\n');
  const i = lines.findIndex((l) => l.trim() === raw);
  if (i < 0) return text;
  lines.splice(i, 1);
  return lines.join('\n');
}
/** One pin line for a piece of text: a single line, never read back as a link or heading. */
function textPinLine(text) {
  return `- ${String(text).replace(/\s*\n\s*/g, ' ').trim()}`;
}
/* @src src/deck/plugin.js */
/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

class NeonDeck extends Plugin {
  async onload() {
    await this.loadSettings();
    this.wordCache = new Map();
    this.lookListeners = new Set();
    this.widgets = new Map();
    this.captures = new Map();
    this.facts = new Map();
    this.activity = new Map(); // id -> () => [{ t, kind, text, src, status?, open? }] (Recently done log)
    this.actions = new Map();
    this.weekLines = new Map();
    this.excludes = new Map();
    // fork: templates folders (core Templates, Templater) are left out of stats, tasks and projects
    this.tplFolders = [];
    this.excludes.set('templates', () => (this.settings.excludeTemplates ? this.tplFolders : []));
    this.excludes.set('archive', () => (this.settings.excludeArchive ? this.app.vault.getRoot().children.filter((c) => c instanceof TFolder && /archive/i.test(c.name)).map((c) => c.path) : []));
    this.readTemplateFolders();
    // fork: customers as categories — read now and whenever a folder changes under the customers folder
    const cats = debounce(() => (refreshCategories(this.app), this.emitLook && this.emitLook()), 500, true);
    this.app.workspace.onLayoutReady(() => refreshCategories(this.app));
    const isFolderEv = (f, old) => f instanceof TFolder || (old && !String(old).endsWith('.md'));
    this.registerEvent(this.app.vault.on('create', (f) => isFolderEv(f) && cats()));
    this.registerEvent(this.app.vault.on('delete', (f) => isFolderEv(f) && cats()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => isFolderEv(f, old) && cats()));
    this.services = new Map();
    this.dragging = null;
    this.api = this.buildApi();
    this.initIsland();
    this.applyLook();

    this.registerView(VIEW_DASH, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_INBOX, (leaf) => new InboxView(leaf, this)); // fork
    this.registerView(VIEW_CARDS, (leaf) => new CardsView(leaf, this));
    this.registerView(VIEW_GRAPH, (leaf) => new GraphView(leaf, this));
    for (const [v, d] of [[VIEW_DASH, 'dashboard'], [VIEW_CARDS, 'cards'], [VIEW_GRAPH, 'graph'], [VIEW_INBOX, 'inbox']]) this.registerHoverLinkSource(v, { display: `${appName()} ${d}`, defaultMod: true });

    this.addRibbonIcon('layout-dashboard', `${appName()} dashboard`, () => this.activate(VIEW_DASH, 'tab'));
    if (!NEON_MOBILE.on) {
      // fork: the card explorer and the graph are desktop-only (heavy on a phone)
      this.addRibbonIcon('layout-grid', 'Card explorer', () => this.activate(VIEW_CARDS, 'tab'));
      this.addRibbonIcon('waypoints', 'Note graph', () => this.openGraph('notes'));
    }

    const cmds = [
      ['open-dashboard', 'Open dashboard', () => this.activate(VIEW_DASH, 'tab')],
      ['open-inbox', 'Open the Inbox tab', () => this.activate(VIEW_INBOX, 'tab')], // fork
      ['open-cards', 'Open card explorer (tab)', () => this.activate(VIEW_CARDS, 'tab')],
      ['open-cards-sidebar', 'Open card explorer (sidebar)', () => this.activate(VIEW_CARDS, 'left')],
      ['open-graph', 'Open note graph', () => this.openGraph('notes')],
      ['graph-active-note', 'Note graph of active note', () => this.openGraph('notes', 'note')],
      ['open-today', 'Open today’s daily note', () => this.openToday()],
      ['next-theme', 'Next theme', () => this.setLook({ theme: THEMES[(THEMES.indexOf(this.settings.theme) + 1) % THEMES.length] }, true)],
      ['next-pattern', 'Next pattern', () => this.setLook({ pattern: PATTERNS[(PATTERNS.indexOf(this.activePattern()) + 1) % PATTERNS.length] }, true)],
      ['weekly-review', 'Create / open this week’s review', () => this.weeklyReview()],
    ];
    const desktopOnly = new Set(['open-cards', 'open-cards-sidebar', 'open-graph', 'graph-active-note']); // fork: not on mobile
    for (const [id, name, callback] of cmds) if (!(NEON_MOBILE.on && desktopOnly.has(id))) this.addCommand({ id, name, callback });
    // hidden while the Tasks module is on: it brings its own New note command
    this.addCommand({
      id: 'new-note',
      name: 'New note',
      checkCallback: (checking) => {
        if (this.services.has('newNote')) return false;
        if (!checking) this.newNote(this.currentFolder());
        return true;
      },
    });
    this.addCommand({
      id: 'quick-capture',
      name: 'Quick capture',
      // popout windows keep the dialog; the main window uses the island's input line
      callback: () => (activeDocument !== document ? new QuickCaptureModal(this).open() : this.openIsland({ focus: true })),
    });
    this.addCommand({ id: 'toggle-pin-board', name: 'Toggle pin board', callback: () => this.toggleIsland() });

    // last, so Alt+1..4 stay Task, Global task, Ticket, Time entry as in the spec
    this.addSettingTab(new NeonSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (!f) return;
        this.lastFile = f;
        this.markSeen(f.path, true);
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f, old) => {
        this.wordCache.delete(old);
        const seen = this.settings.seen;
        if (seen[old]) {
          seen[f.path] = seen[old];
          delete seen[old];
          this.saveSoon();
        }
        if (f instanceof TFolder) this.renamePins(old, f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        if (this.settings.seen[f.path]) {
          delete this.settings.seen[f.path];
          this.saveSoon();
        }
      }),
    );
    this.registerDomEvent(window, 'focus', () => this.emitLook());
    this.app.workspace.onLayoutReady(() => this.onReady());
  }

  onunload() {
    if (this._saveSoon) (this._saveSoon.cancel(), this.saveSettings()); // don't lose the last 4 s of changes
    document.body.removeClass('nd-themed', ...THEMES.map((x) => `nd-theme-${x}`));
    this.app.workspace.trigger('neon-deck:core-unloaded');
  }

  async loadSettings() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    setIgnoredTags(this.settings.excludeTags); // fork
    const s = this.settings;
    if (!Array.isArray(s.pinnedFolders)) s.pinnedFolders = [];
    if (!s.folderColors || typeof s.folderColors !== 'object') s.folderColors = {};
    for (const [k, v] of Object.entries(s.folderColors)) if (!FOLDER_COLOR_RE.test(String(v))) delete s.folderColors[k];
    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    if ((raw.settingsVersion || 0) < 3) {
      // 1.2 -> 1.3: style "intensity" becomes a theme; glass/random are gone
      s.theme = raw.intensity === 'calm' ? 'calm' : 'marathon';
      this.legacy = Object.assign({}, raw);
      for (const k of OLD_KEYS) delete s[k];
      s.settingsVersion = 3;
      await this.saveData(s);
    }
    // 1.6.6: the sidebar sorts by the `created` property by default (item 25); moved once
    if ((s.sortRule || 0) < 1) {
      if (s.cardSort === 'modified') s.cardSort = 'created-prop';
      s.sortRule = 1;
    }
    if (!THEMES.includes(s.theme)) s.theme = 'marathon';
    if (s.pattern === 'circuit' || s.pattern === 'shard') s.pattern = 'prism'; // 2.0.4: Circuit (and the short-lived Shard) became Prism
    if (s.pattern !== 'auto' && !PATTERNS.includes(s.pattern)) s.pattern = 'auto';
    if (!STRENGTHS.includes(s.patternStrength)) s.patternStrength = 'subtle';
    // fork: Neon's own daily-note settings start as the core Daily notes plugin's (used only while it is off)
    if (!s.dailySeeded) {
      await readDailyOpts(this.app);
      if (dailyCache && (dailyCache.folder || dailyCache.format || dailyCache.template)) {
        if (!s.dailyFolder) s.dailyFolder = (dailyCache.folder || '').trim();
        if (!s.dailyFormat || s.dailyFormat === 'YYYY-MM-DD') s.dailyFormat = (dailyCache.format || '').trim() || 'YYYY-MM-DD';
        if (!s.dailyTemplate) s.dailyTemplate = (dailyCache.template || '').trim();
        s.dailySeeded = true;
        await this.saveData(s);
      }
    }
    this.applyDailyFallback();
    // fork: earlier fork builds saved Neon/… paths; unused ones now follow the base folder
    if (dropOldDefaults(this.app, s, { reviewFolder: 'Neon/Reviews', pinBoardPath: 'Neon/Pin board.md', pinnedFolder: 'Neon/Pinned', bridgeFolder: 'Neon/Bridges', inboxPath: 'Neon/Inbox.md' })) await this.saveData(s);
  }
  /** fork: Neon's own daily-note settings, used while the core Daily notes plugin is off. */
  applyDailyFallback() {
    const s = this.settings;
    Object.assign(NEON_DAILY_FALLBACK, { folder: s.dailyFolder || '', format: s.dailyFormat || 'YYYY-MM-DD', template: s.dailyTemplate || '' });
  }
  /** fork: the templates folders of the core Templates plugin and of Templater (read only). */
  async readTemplateFolders() {
    const read = (p) => this.app.vault.adapter.read(normalizePath(p)).then((t) => JSON.parse(t), () => null);
    const dir = this.app.vault.configDir;
    const [core, tp] = await Promise.all([read(`${dir}/templates.json`), read(`${dir}/plugins/templater-obsidian/data.json`)]);
    this.tplFolders = [core && core.folder, tp && tp.templates_folder].filter((x) => typeof x === 'string' && x.trim() && x.trim() !== '/').map((x) => normalizePath(x.trim()));
    this._ex = null;
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._saveSoon) this._saveSoon = debounce(() => this.saveSettings(), 4000, true);
    this._saveSoon();
  }

  /* API for the Tasks, Projects and Time modules --------------------------- */
  buildApi() {
    const p = this;
    const changed = (ev) => p.app.workspace.trigger(ev);
    return {
      version: ND_VERSION,
      registerWidget(def) {
        p.widgets.set(def.id, def);
        changed('neon-deck:slots-changed');
      },
      unregisterWidget(id) {
        if (p.widgets.delete(id)) changed('neon-deck:slots-changed');
      },
      registerCapture(def) {
        p.registerCapture(def);
        changed('neon-deck:captures-changed');
      },
      unregisterCapture(id) {
        if (p.captures.delete(id)) changed('neon-deck:captures-changed');
      },
      registerFacts(id, fn) {
        p.facts.set(id, fn);
        changed('neon-deck:facts-changed');
      },
      unregisterFacts(id) {
        p.facts.delete(id);
      },
      factsChanged: () => changed('neon-deck:facts-changed'),
      /** Recently done: a module offers its log (ticked tasks, tickets set to Done/Waiting); the Deck only merges and draws */
      registerActivity(id, fn) {
        p.activity.set(id, fn);
        changed('neon-deck:activity-changed');
      },
      unregisterActivity(id) {
        if (p.activity.delete(id)) changed('neon-deck:activity-changed');
      },
      activityChanged: () => changed('neon-deck:activity-changed'),
      registerAction(def) {
        p.actions.set(def.id, def);
        changed('neon-deck:slots-changed');
      },
      unregisterAction(id) {
        if (p.actions.delete(id)) changed('neon-deck:slots-changed');
      },
      registerWeekLine(id, fn) {
        p.weekLines.set(id, fn);
      },
      unregisterWeekLine(id) {
        p.weekLines.delete(id);
      },
      registerExcluded(id, fn) {
        p.excludes.set(id, fn);
      },
      unregisterExcluded(id) {
        p.excludes.delete(id);
      },
      /** named services, e.g. 'newNote' from Tasks, 'newTicket' from Projects */
      provide(name, fn) {
        p.services.set(name, fn);
      },
      unprovide(name) {
        p.services.delete(name);
      },
      service: (name) => p.services.get(name) || null,
      openFile: (f, e, line) => openFile(p.app, f, e, line),
      bindFileMouse: (el, f, view) => p.bindFileMouse(el, f, view),
      /** the live dashboard pattern behind any element; returns { kick, destroy } */
      mountPattern: (host, scroller, cardSel) => new PatternLayer(p, host, scroller, cardSel),
      fileMenu: (f, e, extra) => p.fileMenu(f, e, extra),
      onLook: (fn) => p.onLook(fn),
      theme: () => p.settings.theme,
    };
  }
  registerCapture(def) {
    this.captures.set(def.id, def);
  }
  captureTargets() {
    return [...this.captures.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  }


  /* look: theme + pattern -------------------------------------------------- */
  activePattern() {
    const s = this.settings;
    return s.pattern === 'auto' ? THEME_PATTERN[s.theme] || 'none' : s.pattern;
  }
  applyLook() {
    const b = document.body;
    b.addClass('nd-themed');
    for (const t of THEMES) b.toggleClass(`nd-theme-${t}`, this.settings.theme === t);
  }
  async setLook(patch, notify) {
    Object.assign(this.settings, patch);
    this.applyLook();
    await this.saveSettings();
    this.app.workspace.trigger('css-change');
    this.emitLook();
    if (notify) new Notice(`${THEME_LABEL[this.settings.theme]} · ${PATTERN_LABEL[this.activePattern()]}`);
  }
  onLook(fn) {
    this.lookListeners.add(fn);
    return () => this.lookListeners.delete(fn);
  }
  emitLook() {
    for (const fn of this.lookListeners) fn();
  }

}
/* @src src/deck/claude-card.js */
/* ---- Claude card (fork) ---------------------------------------------------------
 * Notes marked for Claude by a property (default `claude`): values asking Claude for work (process,
 * refine) under "Waiting for Claude", and notes Claude changed (updated) under "To review".
 * Read only: the card never writes to notes. */

/** The setting's comma list in lower case. */
const claudeList = (text) =>
  String(text || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
/** Group notes by their Claude property: { waiting: [{ file, value }], review: [...] } (pure). */
function claudeGroups(entries, waitList, reviewList) {
  const out = { waiting: [], review: [] };
  for (const e of entries) {
    const v = String(e.value || '').trim().toLowerCase();
    if (waitList.includes(v)) out.waiting.push(e);
    else if (reviewList.includes(v)) out.review.push(e);
  }
  const newest = (a, b) => b.file.stat.mtime - a.file.stat.mtime;
  out.waiting.sort(newest);
  out.review.sort(newest);
  return out;
}

Object.assign(NeonDeck.prototype, {
  claudeEntries() {
    const key = (this.settings.claudeProperty || 'claude').trim();
    const out = [];
    for (const { file: f, fm } of noteIndex(this.app).withProperty(key)) {
      if (this.isExcluded(f)) continue;
      const v = Array.isArray(fm[key]) ? fm[key][0] : fm[key];
      if (v != null && typeof v !== 'object') out.push({ file: f, value: String(v) });
    }
    return out;
  },
  registerClaudeCard() {
    // fork: the Areas card can take this place instead (a vault without Claude notes, e.g. PARA)
    if (this.settings.areasCard) {
      this.api.unregisterWidget('claude');
      return this.api.registerWidget({ id: 'areas', slot: 'claude', title: groupWord(true), icon: 'layers', sub: 'Projects, tasks and notes · quietest first', mount: (card, view) => this.mountAreas(card, view) });
    }
    this.api.unregisterWidget('areas');
    if (!this.settings.claudeCard) return this.api.unregisterWidget('claude');
    this.api.registerWidget({ id: 'claude', slot: 'claude', title: 'Claude', icon: 'bot', sub: `Notes by their ${this.settings.claudeProperty || 'claude'} property`, mount: (card) => this.mountClaude(card) });
  },
  mountClaude(card) {
    const list = card.body.createDiv('nd-claude');
    const render = () => {
      if (!list.isConnected) return;
      const g = claudeGroups(this.claudeEntries(), claudeList(this.settings.claudeWaiting), claudeList(this.settings.claudeReview));
      card.badge.setText(g.waiting.length + g.review.length ? String(g.waiting.length + g.review.length) : '');
      list.empty();
      if (!g.waiting.length && !g.review.length) return void emptyState(list, 'Nothing waiting for Claude or for your review ✦');
      for (const [label, items, cls] of [['Waiting for Claude', g.waiting, 'is-waiting'], ['To review', g.review, 'is-review']]) {
        if (!items.length) continue;
        list.createDiv({ cls: `nd-claude-head ${cls}`, text: `${label} · ${items.length}` });
        for (const { file, value } of items.slice(0, 25)) {
          const r = list.createDiv('nd-claude-row');
          r.createSpan({ cls: `nd-claude-v ${cls}`, text: value });
          r.createSpan({ cls: 'nd-claude-name', text: file.basename });
          const where = r.createSpan({ cls: 'nd-claude-where', text: shortAgoDeck(file.stat.mtime) });
          tip(where, file.path);
          r.addEventListener('click', (e) => openFile(this.app, file, e));
        }
      }
    };
    const soon = debounce(render, 400, true);
    const ref = this.app.metadataCache.on('changed', soon);
    const ref2 = this.app.vault.on('delete', soon);
    const ref3 = this.app.vault.on('rename', soon);
    render();
    return {
      destroy: () => {
        this.app.metadataCache.offref(ref);
        this.app.vault.offref(ref2);
        this.app.vault.offref(ref3);
      },
    };
  },
});
/** "now", "5m", "3h", "2d", then the date. */
function shortAgoDeck(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return 'now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  if (d < 7 * 86400000) return `${Math.floor(d / 86400000)}d`;
  return moment(ms).format('D MMM');
}
/* @src src/deck/areas-card.js */
/* ---- Areas card (fork) -------------------------------------------------------------
 * One row per group (areas in a PARA vault, customers otherwise): active projects, open tasks, notes
 * edited in the last 30 days and when it was last touched. Areas left alone longest come first, so the
 * ones you may be neglecting stand out. Read only. Takes the Claude card's place on the dashboard. */
const AREA_QUIET_DAYS = 30;

/**
 * Rows for the card (pure). groups: [[key, label]]; notes: [{ group, mtime }]; projects: [{ group }]
 * (active ones); tasks: [{ group }] (open ones). Returns rows sorted by last touched, oldest first.
 */
function areaRows(groups, notes, projects, tasks, now) {
  const month = now - AREA_QUIET_DAYS * 86400000;
  const rows = groups.map(([key, label]) => ({ key, label, projects: 0, tasks: 0, notes: 0, recent: 0, last: 0 }));
  const by = new Map(rows.map((r) => [r.key, r]));
  for (const n of notes) {
    const r = by.get(n.group);
    if (!r) continue;
    r.notes++;
    if (n.mtime >= month) r.recent++;
    if (n.mtime > r.last) r.last = n.mtime;
  }
  for (const p of projects) if (by.has(p.group)) by.get(p.group).projects++;
  for (const t of tasks) if (by.has(t.group)) by.get(t.group).tasks++;
  for (const r of rows) r.quiet = !r.last || r.last < month;
  return rows.sort((a, b) => a.last - b.last || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

Object.assign(NeonDeck.prototype, {
  /** The data behind the Areas card, from the vault, the Projects module and the Tasks module. */
  areaData() {
    const app = this.app;
    const groupOf = (f) => noteCategory(app.metadataCache.getFileCache(f), f.path);
    const groups = NEON_CATS.customers ? CATS.map((k) => [k, CAT_LABEL[k] || k]) : [];
    const notes = this
      .includedNotes()
      .map((f) => ({ group: groupOf(f), mtime: f.stat.mtime }));
    const tk = neonPlugin(app, 'neon-tickets');
    const projects = tk && tk.activeProjects ? tk.activeProjects().map((t) => ({ group: String(t.customer || '').toLowerCase() })) : [];
    const ts = neonPlugin(app, 'neon-tasks');
    const tasks = ts && Array.isArray(ts.openTasks) ? ts.openTasks.map((t) => ({ group: groupOf(t.file) })) : [];
    return areaRows(groups, notes, projects, tasks, Date.now());
  },
  /** Open a group: its index note (0.Index, index, README or a note named like it), else show the folder. */
  openArea(label, e) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(`${NEON_CATS.customersFolder}/${label}`));
    if (!(folder instanceof TFolder)) return;
    const note = folder.children.find((c) => c instanceof TFile && c.extension === 'md' && (c.basename.toLowerCase() === label.toLowerCase() || /^(0\.?\s*index|index|readme)$/i.test(c.basename)));
    if (note) return openFile(this.app, note, e);
    const fx = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('file-explorer');
    if (fx && fx.enabled && fx.instance && fx.instance.revealInFolder) fx.instance.revealInFolder(folder);
  },
  mountAreas(card, comp) {
    const owner = comp || this; // the dashboard view: its listeners go when it closes
    const list = card.body.createDiv('nd-areas');
    const render = () => {
      if (!list.isConnected) return;
      const rows = this.areaData();
      const quiet = rows.filter((r) => r.quiet).length;
      card.badge.setText(quiet ? `${quiet} quiet` : '');
      list.empty();
      if (!rows.length) return void emptyState(list, `No ${groupWord(true, true)} yet: set the groups folder in Projects settings ✦`);
      for (const r of rows) {
        const row = list.createDiv('nd-area-row' + (r.quiet ? ' is-quiet' : ''));
        const dot = row.createSpan('nd-area-dot');
        dot.style.background = catColor(r.key);
        const main = row.createDiv('nd-area-main');
        main.createDiv({ cls: 'nd-area-name', text: r.label });
        const bits = [];
        if (r.projects) bits.push(`${r.projects} project${r.projects === 1 ? '' : 's'}`);
        if (r.tasks) bits.push(`${r.tasks} task${r.tasks === 1 ? '' : 's'}`);
        bits.push(r.recent ? `${r.recent} note${r.recent === 1 ? '' : 's'} this month` : `${r.notes} note${r.notes === 1 ? '' : 's'}`);
        main.createDiv({ cls: 'nd-area-meta', text: bits.join(' · ') });
        row.createSpan({ cls: 'nd-area-when', text: r.last ? shortAgoDeck(r.last) : 'never' });
        tip(row, r.quiet ? `Not touched for over ${AREA_QUIET_DAYS} days` : `Last touched ${r.last ? moment(r.last).format('D MMM YYYY') : 'never'}`);
        row.addEventListener('click', (e) => this.openArea(r.label, e));
      }
    };
    const soon = debounce(render, 1500, true);
    owner.registerEvent(this.app.metadataCache.on('changed', soon));
    owner.registerEvent(this.app.vault.on('delete', soon));
    owner.registerEvent(this.app.vault.on('rename', soon));
    owner.registerEvent(this.app.workspace.on('neon-deck:facts-changed', soon));
    render();
    return { destroy() {} };
  },
});
/* @src src/deck/inbox.js */
/* ---- Inbox (fork) -----------------------------------------------------------------
 * Inbox notes go in the inbox folder (default <base folder>/Inbox): from Quick capture or the Inbox card (named
 * YYYYMMDD_HHmmss, the text you typed in the note, below the template if there is one) or from New note's Inbox
 * button (named as typed). Every inbox note gets the inbox tag and status (default: tags: inbox, status:
 * waiting), also when it starts from a template. The card lists each note by its title, else its first line. */

/** File name for a captured thought: the time it was captured, YYYYMMDD_HHmmss (pure). */
const inboxName = (now) => now.format('YYYYMMDD_HHmmss');
/** One line of text, plain: no heading, list, checkbox or quote marks, links as their text (pure). */
function inboxPlain(line) {
  return String(line || '')
    .trim()
    .replace(/^(#+|>+|[-*+]\s+\[.\]|[-*+]|\d+[.)])\s+/, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}
/** The first line of some text with something in it, plain (pure). */
const inboxHeadline = (text) => inboxPlain(String(text || '').split('\n').find((l) => inboxPlain(l)) || '');
/** A new inbox note's title: the first line, at most 40 characters, cut at a word where it can be, with … (pure). */
function inboxTitle(text, max = 40) {
  const line = inboxHeadline(text);
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
/** What the Inbox card shows for a note: its title property, else the first line of its text (after the
 *  properties), else its file name (pure). */
function inboxLabel(content, title, basename) {
  // a title that is just the file name (the Linter's YAML title rule writes one) says nothing: use the text
  if (title != null && typeof title !== 'object' && String(title).trim() && String(title).trim() !== basename) return String(title).trim();
  const body = String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*(\n|$)/, '');
  return inboxHeadline(body) || basename;
}
/** Body of an inbox note without a template (pure). */
function inboxBody(title, text, day) {
  return ['---', `title: ${JSON.stringify(title)}`, `created: ${day}`, '---', '', String(text || '').trim(), ''].join('\n');
}
/** Put the inbox tag and status on a note's properties (pure; fm as Obsidian's processFrontMatter gives it). */
function inboxProps(fm, tag, status) {
  tag = String(tag || '').trim().replace(/^#/, '');
  if (tag) {
    const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? String(fm.tags).split(/[,\s]+/).filter(Boolean) : [];
    if (!tags.some((t) => String(t).replace(/^#/, '').toLowerCase() === tag.toLowerCase())) tags.push(tag);
    fm.tags = tags;
  }
  if (String(status || '').trim()) fm.status = String(status).trim();
  return fm;
}

/** The setting's comma list, lower case (pure). */
const inboxList = (text) =>
  String(text || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
/** Is an inbox note still open: no status, or one not in the done list (pure)? */
function inboxOpen(status, doneList) {
  const v = Array.isArray(status) ? status[0] : status;
  const s = v == null || typeof v === 'object' ? '' : String(v).trim().toLowerCase();
  return !s || !doneList.includes(s);
}

Object.assign(NeonDeck.prototype, {
  /** fork: open inbox notes (status not in the done list), newest first: [{ file, status }]. */
  inboxItems() {
    const root = normalizePath(this.inboxFolder());
    const done = inboxList(this.settings.inboxDone);
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(root + '/') || isIgnoredNote(this.app, f)) continue;
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (inboxOpen(fm.status, done)) out.push({ file: f, title: fm.title, status: fm.status == null || typeof fm.status === 'object' ? '' : String(fm.status) });
    }
    return out.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
  },
  registerInboxCard() {
    // fork: the Inbox tab is in the sidebar list (not in the dashboard header, which has the card)
    this.api.registerAction({ id: 'inbox', icon: 'inbox', label: 'Inbox', order: 12, view: VIEW_INBOX, hero: false, run: () => this.activate(VIEW_INBOX, 'tab') });
    if (this.settings.inboxCard === false) return this.api.unregisterWidget('inbox');
    this.api.registerWidget({ id: 'inbox', slot: 'inbox', title: 'Inbox', icon: 'inbox', sub: this.inboxFolder(), open: () => this.activate(VIEW_INBOX, 'tab'), openTitle: 'Open the Inbox tab', mount: (card, view) => this.mountInbox(card, view) });
  },
  /** The inbox list and its Add box in a card; comp (the dashboard or the Inbox tab) owns the event listeners. */
  mountInbox(card, comp) {
    const owner = comp || this;
    const body = card.body;
    body.addClass('nd-inbox-body');
    const list = body.createDiv('nd-inbox');
    const render = () => {
      if (!list.isConnected) return;
      const items = this.inboxItems();
      card.badge.setText(items.length ? String(items.length) : '');
      list.empty();
      if (!items.length) return void emptyState(list, 'Inbox is empty ✦');
      for (const { file, title, status } of items.slice(0, 60)) {
        const r = list.createDiv('nd-inbox-row');
        const name = r.createSpan({ cls: 'nd-inbox-name', text: inboxLabel('', title, file.basename) });
        if (status) r.createSpan({ cls: 'nd-inbox-status', text: status });
        r.createSpan({ cls: 'nd-inbox-when', text: shortAgoDeck(file.stat.ctime) });
        tip(r, file.path);
        // no title (or only the file name): the note's first line, as much as fits (the whole line on hover)
        if (inboxLabel('', title, file.basename) === file.basename)
          this.app.vault.cachedRead(file).then((text) => {
            const label = inboxLabel(text, null, file.basename);
            name.setText(label);
            if (label !== file.basename) tip(r, `${label}\n${file.path}`);
          }, () => {});
        r.addEventListener('click', (e) => openFile(this.app, file, e));
        hoverPreview(this.app, r, file);
      }
    };
    const add = body.createDiv('nt-add');
    // a text box that grows: Enter adds the note, Shift+Enter starts a new line; the text goes in the note
    const input = add.createEl('textarea', { cls: 'nd-input', attr: { rows: '1', placeholder: 'Add to Inbox… (Enter · Shift+Enter for a new line)' } });
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.max(38, Math.min(input.scrollHeight + 3, 160))}px`; // + its border
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      grow();
      try {
        const f = await this.createInboxNote('', v);
        new Notice(`✦ Added ${inboxTitle(v) || f.basename} to the inbox`);
      } catch (err) {
        if (!(err && err.neonReadOnly)) {
          console.error(`${appName()} – Dashboard: inbox`, err);
          new Notice('Could not add to the inbox');
        }
        input.value = v;
        grow();
      }
    });
    button(card.actions, { icon: 'folder-open', cls: 'nd-icon-btn', title: 'Show the inbox folder', onClick: () => this.revealFolder(this.inboxFolder()) });
    const soon = debounce(render, 400, true);
    owner.registerEvent(this.app.metadataCache.on('changed', (f) => f.path.startsWith(normalizePath(this.inboxFolder()) + '/') && soon()));
    owner.registerEvent(this.app.vault.on('delete', soon));
    owner.registerEvent(this.app.vault.on('rename', soon));
    owner.registerEvent(this.app.vault.on('create', soon));
    render();
    return { destroy() {} };
  },
  /** Show a folder in the file explorer (if it is on). */
  revealFolder(path) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
    const fx = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('file-explorer');
    if (folder instanceof TFolder && fx && fx.enabled && fx.instance && fx.instance.revealInFolder) fx.instance.revealInFolder(folder);
    else new Notice(`${path} doesn’t exist yet: it is made with the first inbox note`);
  },
  /** The inbox folder: the setting, else <base folder>/Inbox. */
  inboxFolder() {
    return locPath(this.settings.inboxFolder, 'Inbox');
  },
  registerInboxCapture() {
    this.api.registerCapture({ id: 'inbox', label: 'Inbox note', short: 'Inbox', icon: 'inbox', order: 5, run: (v) => this.captureToInbox(v) });
    this.api.provide('inboxNote', (title, text) => this.createInboxNote(title, text)); // New note's Inbox button
  },
  /** A new inbox note (from the template if set) with the inbox tag and status; returns the file. Without a
   *  title (Quick capture, the Inbox card) the file is named by the time, and its title is the text's first line. */
  async createInboxNote(name, text = '') {
    const s = this.settings;
    const now = moment();
    text = String(text || '').trim();
    name = safeName(name);
    const title = name || inboxTitle(text) || inboxName(now);
    name = name || inboxName(now);
    let body = null;
    if (s.inboxTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.inboxTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.inboxTemplate));
      if (tf instanceof TFile) body = `${applyTemplate(await this.app.vault.read(tf), now, title).replace(/\s*$/, '')}\n${text ? `\n${text}\n` : ''}`;
      else new Notice(`Inbox template “${s.inboxTemplate}” not found: using standard properties`);
    }
    const f = await createUnique(this.app, this.inboxFolder(), name, body != null ? body : inboxBody(title, text, now.format('YYYY-MM-DD')));
    await this.app.fileManager.processFrontMatter(f, (fm) => inboxProps(fm, s.inboxTag, s.inboxStatus));
    return f;
  },
  async captureToInbox(text) {
    text = String(text || '').trim();
    if (!text) return;
    try {
      const f = await this.createInboxNote('', text);
      new Notice(`✦ Saved to ${f.path}`);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error(`${appName()} – Dashboard: inbox capture`, e);
        new Notice('Could not save the inbox note');
      }
    }
  },
});
/* @src src/deck/inbox-view.js */
/* ---- Inbox tab (fork) ----------------------------------------------------------------
 * The Inbox card full size in the main pane, listed in the sidebar with Dashboard, Tasks, Projects… */
class InboxView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_INBOX;
  }
  getDisplayText() {
    return 'Inbox';
  }
  getIcon() {
    return 'inbox';
  }
  async onOpen() {
    addHelpAction(this, 'dashboard'); // fork: the ? button in the header (src/shared/help.js)
    const p = this.plugin;
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-inbox-view');
    const inner = root.createDiv('nd-inbox-view-inner');
    const card = widget(inner, 'nd-inbox-page', 'Inbox', 'inbox', p.inboxFolder());
    p.mountInbox(card, this);
  }
  async onClose() {
    this.contentEl.empty();
  }
}
/* @src src/deck/workspace.js */
Object.assign(NeonDeck.prototype, {
  async onReady() {
    const ws = this.app.workspace;
    // fork: the automatic “tidy into Core” move was removed; the plugin never moves your files
    this.lastFile = ws.getActiveFile();
    this.registerClaudeCard(); // fork
    this.registerInboxCapture(); // fork
    this.registerInboxCard(); // fork
    // after a plugin restart Obsidian puts our tabs back only once onload is done, so arrange tabs a moment later
    // (doing it straight away added a second Cards tab and a second Dashboard on every restart)
    window.setTimeout(() => this.arrangeOnStart(), 600);
    ws.trigger('neon-deck:core-ready', this.api);
  },

  async arrangeOnStart() {
    // fork: on phones and tablets the left sidebar is the swipe-out drawer: no card explorer there, and the
    // file explorer stays (the desktop settings "Cards in sidebar" / "Replace file explorer" don't apply)
    if (NEON_MOBILE.on) await this.tidyMobileSidebar();
    else await this.ensureSidebarCards();
    await this.foldNeonTabs();
    if (!this.settings.openDashboardOnStartup) return;
    const ws = this.app.workspace;
    // reuse a Dashboard that's already open in the main area instead of adding another
    const open = ws.getLeavesOfType(VIEW_DASH).find((l) => l.getRoot() === ws.rootSplit);
    if (open) await ws.revealLeaf(open);
    else await this.activate(VIEW_DASH, 'tab');
  },
  /** fork: mobile: close card explorer / graph tabs left by earlier versions; bring the file explorer back if they replaced it. */
  async tidyMobileSidebar() {
    const ws = this.app.workspace;
    for (const t of [VIEW_CARDS, VIEW_GRAPH]) ws.getLeavesOfType(t).forEach((l) => l.detach());
    const core = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('file-explorer');
    if (core && core.enabled && !ws.getLeavesOfType('file-explorer').length) {
      const leaf = ws.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: 'file-explorer' });
    }
  },
  /** One Cards tab in the left sidebar: add it when missing, close copies left by earlier restarts. */
  async ensureSidebarCards() {
    const ws = this.app.workspace;
    if (!this.settings.cardsInSidebar) return;
    const side = [];
    const walk = (n) => {
      if (n.view && n.getViewState().type === VIEW_CARDS) side.push(n);
      (n.children || []).forEach(walk);
    };
    walk(ws.leftSplit);
    if (!side.length) {
      const leaf = ws.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_CARDS, active: true });
    } else if (side.length > 1) {
      const keep = side.find((l) => !l.isDeferred) || side[0];
      for (const l of side) if (l !== keep) l.detach();
    }
    if (this.settings.replaceFileExplorer) ws.getLeavesOfType('file-explorer').forEach((l) => l.detach());
  },

  /* weekly review ------------------------------------------------------------ */
  weekLine(start, end) {
    const parts = [];
    for (const fn of this.weekLines.values()) {
      try {
        parts.push(...(fn(start, end) || []));
      } catch (e) {
        console.error(`${appName()} – Dashboard: week line`, e);
      }
    }
    const md = this.includedNotes();
    const made = md.filter((f) => f.stat.ctime >= start.valueOf() && f.stat.ctime < end.valueOf()).length;
    if (!parts.length || made) parts.push(`${made} new note${made === 1 ? '' : 's'}`);
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  },
  async weeklyReview() {
    const m = moment().startOf('isoWeek');
    const end = m.clone().add(7, 'days');
    const folder = this.reviewFolder();
    const path = normalizePath(`${folder}/${m.format('GGGG-[W]WW')} Review.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return openFile(this.app, existing);

    const inWeek = (t) => t >= m.valueOf() && t < end.valueOf();
    const md = this.includedNotes();
    const created = md.filter((f) => inWeek(f.stat.ctime)).sort((a, b) => a.stat.ctime - b.stat.ctime);
    const touched = md.filter((f) => inWeek(f.stat.mtime) && !inWeek(f.stat.ctime)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    const link = (f) => `- [[${f.path.replace(/\.md$/, '')}|${f.basename}]]`;
    const notesMd = [
      created.length ? `**New (${created.length})**\n${created.slice(0, 30).map(link).join('\n')}` : '_No new notes._',
      touched.length ? `\n**Edited (${touched.length})**\n${touched.slice(0, 30).map(link).join('\n')}` : '',
    ].join('\n');
    const line = this.weekLine(m, end);

    let tpl = '';
    // fork: the template note from settings; else upstream's "Templates/Weekly Review"
    const want = (this.settings.reviewTemplate || '').trim();
    const tf = want ? this.app.metadataCache.getFirstLinkpathDest(want.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(want)) : this.app.metadataCache.getFirstLinkpathDest('Templates/Weekly Review', '');
    if (want && !(tf instanceof TFile)) new Notice(`Weekly review template “${want}” not found: using the built-in layout`);
    if (tf) tpl = await this.app.vault.read(tf);
    if (!tpl) tpl = '# Week {{date:GGGG-[W]WW}}\n\n> {{weekLine}}\n\n## Notes\n{{weekNotes}}\n';
    else if (!/{{\s*weekLine\s*}}/.test(tpl)) tpl = tpl.replace(/^(#[^\n]*\n)?/, (h) => `${h || ''}\n> {{weekLine}}\n\n`);
    const content = applyTemplate(tpl, m, path.split('/').pop().replace(/\.md$/, ''))
      .replace(/{{\s*weekLine\s*}}/g, line)
      .replace(/{{\s*weekFocus\s*}}/g, '') // old templates: the focus timer is gone
      .replace(/{{\s*weekNotes\s*}}/g, notesMd)
      .replace(/{{\s*weekEnd(?::([^}]+))?\s*}}/g, (_, f) => end.clone().subtract(1, 'day').format(f ? f.trim() : 'YYYY-MM-DD'));
    await ensureFolder(this.app, folder);
    const f = await this.app.vault.create(path, content);
    openFile(this.app, f);
  },

  /**
   * Once, after the switch to one main pane: Dashboard, Cards, Tickets, Time… used to sit in their
   * own (often pinned) tabs. Keep one of them as the unpinned main pane and close the rest.
   */
  async foldNeonTabs() {
    if (this.settings.singlePane) return;
    const ws = this.app.workspace;
    // getLeavesOfType also finds tabs Obsidian hasn't loaded yet
    const neon = MAIN_VIEWS.flatMap((t) => ws.getLeavesOfType(t)).filter((l) => l.getRoot() === ws.rootSplit);
    if (neon.length) {
      const keep = neon.find((l) => l.getViewState().type === VIEW_DASH) || neon[0];
      for (const l of neon) if (l !== keep) l.detach();
      keep.setPinned(false);
    }
    this.settings.singlePane = true;
    await this.saveSettings();
  },

  /* navigation helpers ---------------------------------------------------- */
  activate(type, where = 'tab') {
    return activateView(this.app, type, where);
  },
  async openCardsAt(path, newTab) {
    const ws = this.app.workspace;
    let leaf;
    if (newTab) leaf = ws.getLeaf('tab');
    else leaf = reusableLeaf(this.app); // the main pane
    await leaf.setViewState({ type: VIEW_CARDS, active: true, state: { path } });
    await ws.revealLeaf(leaf);
  },
  async openGraph(mode, scope) {
    const leaf = await this.activate(VIEW_GRAPH, 'tab');
    const view = leaf.view;
    if (view instanceof GraphView) await view.setState({ mode: 'notes', scope: scope || view.scope }, { history: false });
  },
  openFile(file, evt, line) {
    return openFile(this.app, file, evt, line);
  },
  openSearch(q) {
    const ws = this.app.workspace;
    const leaf = ws.getLeavesOfType('search')[0] || ws.getLeftLeaf(false);
    if (!leaf) return;
    leaf.setViewState({ type: 'search', active: true, state: { query: q } }).then(() => ws.revealLeaf(leaf));
  },
  /** fork: locations inside the base folder unless set */
  reviewFolder() {
    return locPath(this.settings.reviewFolder, 'Reviews');
  },
  bridgeFolder() {
    return locPath(this.settings.bridgeFolder, 'Bridges');
  },
});
/* @src src/deck/files.js */
Object.assign(NeonDeck.prototype, {
  /* pins & seen -------------------------------------------------------------- */
  async togglePin(path) {
    const pins = this.settings.pinnedFolders;
    const i = pins.indexOf(path);
    if (i >= 0) pins.splice(i, 1);
    else pins.push(path);
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed');
  },
  /** A folder was renamed or moved: its pins and icon colours (and those of folders inside it) follow. */
  async renamePins(oldPath, newPath) {
    let hit = false;
    const move = (p) => (p === oldPath || p.startsWith(oldPath + '/') ? ((hit = true), newPath + p.slice(oldPath.length)) : p);
    this.settings.pinnedFolders = this.settings.pinnedFolders.map(move);
    const cols = this.settings.folderColors;
    for (const k of Object.keys(cols)) {
      const nk = move(k);
      if (nk !== k) ((cols[nk] = cols[k]), delete cols[k]);
    }
    if (!hit) return;
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed');
  },
  /** Icon colour of one folder; null goes back to the category colour. */
  async setFolderColor(path, color) {
    if (color && FOLDER_COLOR_RE.test(color)) this.settings.folderColors[path] = color;
    else delete this.settings.folderColors[path];
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed'); // cards views redraw on it
  },
  markSeen(path, quiet) {
    this.settings.seen[path] = Date.now();
    this.saveSoon();
    if (!quiet) this.app.workspace.trigger('neon-deck:seen-changed');
  },

  /** The notes that aren't excluded: one vault scan shared by everything drawn in the same pass (cleared after it). A copy, so callers may sort it. */
  includedNotes() {
    if (!this._notes) {
      this._notes = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
      queueMicrotask(() => (this._notes = null));
    }
    return this._notes.slice();
  },
  /** Excluded folders/files (settings + other Neon plugins). Cached briefly: isExcluded runs once per note in vault scans. */
  excludedPaths() {
    const now = Date.now();
    if (!this._ex || now - this._exAt > 2000) {
      const ex = this.settings.excludeFolders.split(',').map((x) => normalizePath(x.trim())).filter((x) => x && x !== '/');
      for (const fn of this.excludes.values()) {
        try {
          ex.push(...(fn() || []).map(normalizePath));
        } catch (e) {
          console.error(`${appName()} – Dashboard: exclude`, e);
        }
      }
      this._ex = ex;
      this._exAt = now;
    }
    return this._ex;
  },
  isExcluded(f) {
    if (this.settings.excludeUnderscore !== false && inUnderscoreFolder(f.path, !(f instanceof TFile))) return true; // fork: _claude and the like
    return this.excludedPaths().some((p) => f.path === p || f.path.startsWith(p + '/')) || isIgnoredNote(this.app, f); // fork: + ignored tags
  },
  currentFolder() {
    const f = this.app.workspace.getActiveFile();
    return f && f.parent ? f.parent.path : '/';
  },

  bindFileMouse(el, file, hoverParent) {
    el.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      const pop = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && this.services.get('ticketClick');
      if (pop && pop(file)) return;
      openFile(this.app, file, e);
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        openFile(this.app, file, { ctrlKey: true });
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fileMenu(file, e);
    });
    if (hoverParent && !(hoverParent instanceof CardsView)) {
      el.addEventListener('mouseover', (e) => {
        this.app.workspace.trigger('hover-link', {
          event: e,
          source: hoverParent.getViewType ? hoverParent.getViewType() : VIEW_DASH,
          hoverParent,
          targetEl: el,
          linktext: file.path,
        });
      });
    }
    el.setAttr('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      this.dragging = file;
      this.setDragData(e, file);
    });
    el.addEventListener('dragend', () => (this.dragging = null));
  },
  /** Plain browser drag data: a link in the user's link style for files (a note inserts it as is), the path for folders.
   *  No text/uri-list: with one, the editor wraps the text in a [text](url) link. */
  setDragData(e, item) {
    const dt = e.dataTransfer;
    if (!dt) return;
    const active = this.app.workspace.getActiveFile();
    dt.setData('text/plain', item instanceof TFile ? this.app.fileManager.generateMarkdownLink(item, active ? active.path : '') : item.path);
    dt.effectAllowed = 'all';
  },
  /** A vault file or folder from a path, [[link]] or obsidian://open URL (as Obsidian's file list drags them), or null. */
  vaultItemOf(s) {
    s = (s || '').trim();
    const url = s.match(/^obsidian:\/\/open\?(.*)$/);
    if (url) s = new URLSearchParams(url[1]).get('file') || '';
    else s = s.replace(/^!?\[\[([^\]|#]+).*\]\]$/, '$1');
    if (!s) return null;
    const v = this.app.vault;
    return v.getAbstractFileByPath(normalizePath(s)) || v.getAbstractFileByPath(normalizePath(s + '.md')) || this.app.metadataCache.getFirstLinkpathDest(s, '') || null;
  },
  /** Vault items in a drop (only readable on drop, not while dragging over). */
  droppedItems(dt) {
    const raw = (dt && (dt.getData('text/uri-list') || dt.getData('text/plain'))) || '';
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    const items = lines.map((l) => this.vaultItemOf(l));
    return lines.length && items.every(Boolean) ? items : [];
  },
  fileMenu(file, e, extra) {
    const menu = new Menu();
    if (file instanceof TFile) {
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => openFile(this.app, file, { ctrlKey: true })));
      menu.addItem((i) => i.setTitle('Open to the right').setIcon('separator-vertical').onClick(() => openFile(this.app, file, { shiftKey: true })));
    }
    if (extra) extra(menu);
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => this.promptRename(file)));
    menu.addItem((i) => {
      i.setTitle('Delete').setIcon('trash-2').onClick(() => this.confirmDelete(file));
      if (i.setWarning) i.setWarning(true);
    });
    menu.addSeparator();
    this.app.workspace.trigger('file-menu', menu, file, 'neon-deck');
    menu.showAtMouseEvent(e);
  },
  promptRename(file) {
    const base = file instanceof TFile ? file.basename : file.name;
    new PromptModal(this.app, {
      title: 'Rename',
      value: base,
      cta: 'Rename',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name || name === base) return;
        const parent = file.parent && file.parent.path !== '/' ? file.parent.path + '/' : '';
        const np = normalizePath(parent + name + (file instanceof TFile ? `.${file.extension}` : ''));
        if (this.app.vault.getAbstractFileByPath(np)) return new Notice('Something with that name already exists');
        await this.app.fileManager.renameFile(file, np);
      },
    }).open();
  },
  confirmDelete(file) {
    new ConfirmModal(this.app, {
      title: 'Move to trash?',
      text: `“${file.name}”${file instanceof TFolder ? ' and everything inside it' : ''} will be moved to the trash.`,
      cta: 'Move to trash',
      onConfirm: () => this.app.fileManager.trashFile(file),
    }).open();
  },
  async moveTo(f, dest) {
    const np = normalizePath((dest === '/' ? '' : dest + '/') + f.name);
    if (this.app.vault.getAbstractFileByPath(np)) return new Notice('Something with that name already exists there');
    await this.app.fileManager.renameFile(f, np);
    new Notice(`Moved “${f.name}” → ${dest === '/' ? 'vault root' : dest}`);
  },
  /** Files dropped from the computer (PDF, DOCX, images, …): copied into dest; a taken name gets a number, nothing is overwritten. */
  async importFiles(dt, dest) {
    const where = dest === '/' ? 'vault root' : dest;
    // read entries now: the drop's data is gone after the first await
    const entries = Array.from(dt.items || []).map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry());
    const files = Array.from(dt.files);
    let n = 0;
    const made = []; // top-level files created, for the caller (the pin board pins them)
    const free = async (dir, name) => {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let np = normalizePath(dir + name);
      for (let k = 1; await this.app.vault.adapter.exists(np); k++) np = normalizePath(`${dir}${base} ${k}${ext}`);
      return np;
    };
    const addFile = async (f, dir, inFolder) => {
      try {
        const np = await free(dir, f.name);
        // files of a dropped folder stay where they are: Write's image mover skips these paths
        if (inFolder) (this.placed || (this.placed = new Set())).add(np);
        const tf = await this.app.vault.createBinary(np, await f.arrayBuffer());
        if (!inFolder) made.push(tf);
        n++;
      } catch (err) {
        console.error(`${appName()} – Dashboard: could not add`, f.name, err);
        new Notice(`Could not add “${f.name}”`);
      }
    };
    // a dropped folder comes in with everything inside it (issue 55); an existing name gets a number
    const addDir = async (entry, dir) => {
      const path = await free(dir, entry.name);
      await this.app.vault.createFolder(path);
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) {
          if (c.isDirectory) await addDir(c, path + '/');
          else await addFile(await new Promise((res, rej) => c.file(res, rej)), path + '/', true);
        }
      }
    };
    const dir = dest === '/' ? '' : dest + '/';
    for (const [i, f] of files.entries()) {
      try {
        if (entries[i] && entries[i].isDirectory) await addDir(entries[i], dir);
        else await addFile(f, dir);
      } catch (err) {
        console.error(`${appName()} – Dashboard: could not add`, f.name, err);
        new Notice(`Could not add “${f.name}”`);
      }
    }
    if (n) new Notice(`Added ${n} file${n === 1 ? '' : 's'} → ${where}`);
    return made;
  },

  /* file creation --------------------------------------------------------- */
  newNote(folder) {
    const svc = this.services.get('newNote');
    if (svc) return svc(folder || '/');
    new PromptModal(this.app, {
      title: 'New note',
      placeholder: 'Untitled',
      cta: 'Create',
      onSubmit: async (v) => {
        const f = await createUnique(this.app, folder, v || 'Untitled', '');
        await openNewNote(this.app, f);
      },
    }).open();
  },
  newFolder(parent) {
    new PromptModal(this.app, {
      title: 'New folder',
      placeholder: 'Folder name',
      cta: 'Create',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name) return;
        const p = normalizePath((parent && parent !== '/' ? parent + '/' : '') + name);
        if (this.app.vault.getAbstractFileByPath(p)) return new Notice('That folder already exists');
        await this.app.vault.createFolder(p);
      },
    }).open();
  },
  async openToday() {
    openFile(this.app, await ensureToday(this.app));
  },

  /* vault data ------------------------------------------------------------- */
  collectVaultData() {
    const app = this.app;
    const md = this.includedNotes();
    const rl = app.metadataCache.resolvedLinks;
    const incoming = new Set();
    let links = 0;
    // fork: links from excluded notes (archive, ignored tags such as generated index notes) don't count
    const counts = (path) => {
      const f = app.vault.getAbstractFileByPath(path);
      return !(f instanceof TFile) || !this.isExcluded(f);
    };
    for (const src in rl) {
      if (!counts(src)) continue;
      for (const dst in rl[src]) {
        links += rl[src][dst];
        incoming.add(dst);
      }
    }
    const orphans = md.filter((f) => !incoming.has(f.path) && !(rl[f.path] && Object.keys(rl[f.path]).length));
    const startToday = moment().startOf('day').valueOf();
    const editedToday = md.filter((f) => f.stat.mtime >= startToday);
    return { md, links, orphans, editedToday };
  },
  async totalWords(md) {
    let total = 0;
    for (const f of md.slice(0, 5000)) {
      const c = this.wordCache.get(f.path);
      if (c && c.mtime === f.stat.mtime) {
        total += c.words;
        continue;
      }
      const words = countWords(await this.app.vault.cachedRead(f));
      this.wordCache.set(f.path, { mtime: f.stat.mtime, words });
      total += words;
    }
    return total;
  },
  stopwords() {
    const extra = this.settings.extraStopwords
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    return new Set([...STOPWORDS, ...extra]);
  },
});
/* @src src/deck/island.js */
/* ---- Dynamic Island: a pin board that drops down from the top bar ---------------
 * Pins live in one note (settings.pinBoardPath). Dragging a file, card or text over the
 * top bar opens it, dropping on it pins; Quick capture is its input line. Main window only. */
Object.assign(NeonDeck.prototype, {
  initIsland() {
    this.island = { el: null, open: false, byDrag: false, dwell: 0, fold: 0, tabDrag: false };
    this.registerCapture({ id: 'pin', label: 'Pin board', short: 'Pin', icon: 'pin', order: 90, run: (v) => this.pinText(v) });
    this.register(() => {
      window.clearTimeout(this.island.dwell);
      window.clearTimeout(this.island.fold);
      if (this.island.anim) this.island.anim.cancel();
      if (this.island.el) this.island.el.remove();
      if (this.island.svg) this.island.svg.remove();
      if (this.island.anchor) this.island.anchor.removeClass('is-island-open');
    });
    const isBoard = (f) => f && f.path === this.boardPath();
    const redraw = debounce(() => this.renderPins(), 150, true);
    for (const ev of ['modify', 'delete', 'create']) this.registerEvent(this.app.vault.on(ev, (f) => isBoard(f) && redraw()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (isBoard(f) || old === this.boardPath()) && redraw()));
    // drags: tab drags never open it; anything else that lingers over the top bar does
    this.registerDomEvent(document, 'dragstart', (e) => (this.island.tabDrag = !!(e.target.closest && e.target.closest('.workspace-tab-header'))), true);
    this.registerDomEvent(document, 'dragover', (e) => this.islandDragOver(e));
    const end = (e) => {
      this.island.tabDrag = false;
      window.clearTimeout(this.island.dwell);
      this.island.dwell = 0;
      const el = this.island.el;
      if (this.island.byDrag && !(el && e && e.target instanceof Node && el.contains(e.target))) this.foldSoon(300);
    };
    this.registerDomEvent(document, 'dragend', end, true);
    this.registerDomEvent(document, 'drop', end, true);
    this.registerDomEvent(document, 'dragleave', (e) => !e.relatedTarget && end()); // left the window
    this.registerDomEvent(document, 'keydown', (e) => {
      if (e.key === 'Escape' && this.island.open && !document.querySelector('body > .menu')) { // a menu open: Escape closes only it
        e.preventDefault();
        this.closeIsland();
      }
    });
    this.registerDomEvent(document, 'mousedown', (e) => {
      if (!this.island.open || !(e.target instanceof Element)) return;
      if (this.island.el.contains(e.target) || e.target.closest('.menu, .modal-container, .popover, .nd-ticker')) return;
      this.closeIsland();
    });
  },
  boardPath() {
    return locPath(this.settings.pinBoardPath, 'Pin board.md');
  },
  async pinBoard(create) {
    const p = this.boardPath();
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile || !create) return f instanceof TFile ? f : null;
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (dir) await ensureFolder(this.app, dir);
    return this.app.vault.create(p, '');
  },
  /** Top bar = everything above the workspace's first header row (title bar + tab strip). */
  topBarBottom() {
    const top = this.app.workspace.containerEl.getBoundingClientRect().top;
    const h = parseFloat(getComputedStyle(document.body).getPropertyValue('--header-height')) || 40;
    return top + h;
  },
  islandDragOver(e) {
    const s = this.island;
    if (s.tabDrag || (s.open && !s.byDrag) || activeDocument !== document) return;
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    const ok = this.dragging || types.includes('Files') || types.includes('text/plain');
    if (s.open) {
      window.clearTimeout(s.fold); // still dragging: stay open
      return;
    }
    const onTicker = e.target instanceof Element && e.target.closest('.nd-ticker');
    if (!ok || (e.clientY > this.topBarBottom() && !onTicker)) {
      window.clearTimeout(s.dwell);
      s.dwell = 0;
      return;
    }
    if (!s.dwell) s.dwell = window.setTimeout(() => this.openIsland({ byDrag: true }), 250);
  },
  foldSoon(ms) {
    window.clearTimeout(this.island.fold);
    this.island.fold = window.setTimeout(() => this.closeIsland(), ms);
  },
  toggleIsland() {
    if (this.island.open) this.closeIsland();
    else this.openIsland({ focus: true });
  },
  /** The dashboard's ticker line when one is on screen: the island's resting form there. */
  tickerAnchor() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_DASH)) {
      const t = leaf.view.tickerEl;
      if (!t || !t.isConnected || t.ownerDocument !== document) continue;
      const r = t.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit.closest('.nd-ticker') === t) return t;
    }
    return null;
  },
  /** Where the island grows from: the ticker pill, or a small drop under the top bar. */
  islandOrigin() {
    const s = this.island;
    if (s.anchor && s.anchor.isConnected) {
      const r = s.anchor.getBoundingClientRect();
      return { top: r.top, x: r.left + r.width / 2, w: r.width, h: r.height };
    }
    return { top: this.topBarBottom() + 8, x: window.innerWidth / 2, w: 150, h: 30 };
  },
  openIsland({ focus = false, byDrag = false } = {}) {
    const s = this.island;
    window.clearTimeout(s.fold);
    window.clearTimeout(s.dwell);
    s.dwell = 0;
    if (!s.el) this.buildIsland();
    s.byDrag = byDrag;
    this.fillTargets();
    if (!s.open || s.closing) {
      if (s.anim) s.anim.cancel();
      s.closing = false;
      if (!s.open) (s.anchor = this.tickerAnchor()), (s.seen = null);
      const o = this.islandOrigin();
      const w = Math.min(640, window.innerWidth - 32);
      s.el.style.setProperty('--nd-island-top', `${Math.round(o.top)}px`);
      s.el.style.setProperty('--nd-island-x', `${Math.round(Math.min(Math.max(o.x, w / 2 + 16), window.innerWidth - w / 2 - 16))}px`);
      s.el.toggleClass('from-ticker', !!s.anchor);
      s.open = true;
      s.el.addClass('is-open');
      s.el.setAttr('aria-hidden', 'false');
      if (s.anchor) s.anchor.addClass('is-island-open');
      this.renderPins();
      this.morph(true, o);
    }
    if (focus) window.setTimeout(() => s.input.focus(), 0);
  },
  closeIsland() {
    const s = this.island;
    window.clearTimeout(s.fold);
    if (!s.open || s.closing) return;
    s.closing = true;
    s.el.removeClass('is-target');
    if (s.el.contains(document.activeElement)) document.activeElement.blur();
    const done = () => {
      s.open = s.byDrag = s.closing = false;
      s.el.removeClass('is-open');
      s.el.setAttr('aria-hidden', 'true');
      if (s.anchor) s.anchor.removeClass('is-island-open');
      s.anchor = null;
    };
    const a = this.morph(false, this.islandOrigin());
    if (a) a.onfinish = () => (done(), a.cancel());
    else done();
  },
  /** Ferrofluid grow / shrink: squash and stretch between the origin pill and the full island. */
  morph(opening, from) {
    const s = this.island;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    const r = s.el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const at = (x, y) => ({ transform: `translate(-50%, 0) scale(${x}, ${y})` });
    const pill = at(Math.min(1, from.w / r.width), Math.min(1, from.h / r.height));
    const frames = opening
      ? [pill, { ...at(1.035, 0.94), offset: 0.55 }, { ...at(0.99, 1.025), offset: 0.78 }, at(1, 1)]
      : [at(1, 1), { ...at(1.025, 0.95), offset: 0.3 }, pill];
    if (s.anim) s.anim.cancel();
    s.anim = s.el.animate(frames, opening ? { duration: 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : { duration: 340, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
    s.body.animate(opening ? [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], { duration: opening ? 460 : 340 });
    return s.anim;
  },
  /** A swallow: the blob squashes as a pin goes in. */
  gulp() {
    const { el, open } = this.island;
    if (!el || !open || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const at = (x, y) => ({ transform: `translate(-50%, 0) scale(${x}, ${y})` });
    el.animate([at(1, 1), { ...at(1.03, 0.93), offset: 0.35 }, { ...at(0.99, 1.03), offset: 0.7 }, at(1, 1)], { duration: 420, easing: 'ease-out' });
  },

  buildIsland() {
    const s = this.island;
    const el = (s.el = document.body.createDiv({ cls: 'nd-island nd-root', attr: { 'aria-hidden': 'true', role: 'dialog', 'aria-labelledby': 'nd-island-title' } }));
    el.createEl('h2', { cls: 'nd-island-title', text: 'Pin board', attr: { id: 'nd-island-title' } }); // named without aria-label: that shows a tooltip
    // ferrofluid: shapes in one layer melt together through an SVG goo filter; text sits above, crisp
    if (!document.getElementById('nd-goo-filter')) {
      s.svg = document.body.createSvg('svg', { cls: 'nd-goo-defs', attr: { 'aria-hidden': 'true', width: '0', height: '0' } });
      const f = s.svg.createSvg('defs').createSvg('filter', { attr: { id: 'nd-goo-filter', x: '-20%', y: '-40%', width: '140%', height: '180%' } });
      f.createSvg('feGaussianBlur', { attr: { in: 'SourceGraphic', stdDeviation: '6', result: 'blur' } });
      f.createSvg('feColorMatrix', { attr: { in: 'blur', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11'  } });
    }
    const goo = (s.goo = el.createDiv('nd-island-goo'));
    goo.createDiv('nd-goo-neck');
    goo.createDiv('nd-goo-core');
    for (let i = 0; i < 7; i++) goo.createDiv('nd-goo-drop').style.setProperty('--d', String(i));
    el.createDiv('nd-island-skin'); // the crisp, glossy surface over the melted shape
    const body = (s.body = el.createDiv('nd-island-body'));
    const cap = body.createDiv('nd-island-cap');
    // where it goes: a button with Obsidian's own menu (in the theme's colours; a <select>'s list was the system's)
    s.target = cap.createEl('button', { cls: 'nd-island-target', attr: { type: 'button', 'aria-label': 'Capture into', 'aria-haspopup': 'menu' } });
    s.targetLabel = s.target.createSpan('nd-island-target-label');
    setIcon(s.target.createSpan('nd-island-target-chev'), 'chevrons-up-down');
    s.target.addEventListener('click', () => this.islandTargetMenu());
    // a text box that grows with what is typed: Enter sends, Shift+Enter starts a new line
    s.input = cap.createEl('textarea', { cls: 'nd-input nd-island-input', attr: { rows: '1', placeholder: 'Pin a note, or pick where it goes… (Enter; Shift+Enter: new line)' } });
    s.input.addEventListener('input', () => this.islandGrow());
    s.list = body.createDiv('nd-island-pins');
    s.input.addEventListener('keydown', (e) => this.islandKey(e));
    // the island is the drop target while open
    // no stopPropagation: Obsidian's drag label follows the mouse through document-level events
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      window.clearTimeout(s.fold);
      el.addClass('is-target');
    });
    el.addEventListener('dragleave', (e) => !el.contains(e.relatedTarget) && el.removeClass('is-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.removeClass('is-target');
      this.islandDrop(e);
    });
  },
  /** The text box's height follows its lines, up to about six. */
  islandGrow() {
    const { input } = this.island;
    input.style.height = 'auto';
    input.style.height = `${Math.max(32, Math.min(input.scrollHeight + 2, 150))}px`; // + its border
  },
  fillTargets() {
    const s = this.island;
    s.targets = this.captureTargets();
    this.setIslandTarget('pin');
  },
  /** Choose where the text goes; shown on the button. */
  setIslandTarget(id) {
    const s = this.island;
    const t = (s.targets || []).find((x) => x.id === id) || (s.targets || [])[0];
    s.targetId = t ? t.id : null;
    s.targetLabel.setText(t ? t.label : 'Nowhere to send it');
  },
  islandTargetMenu() {
    const s = this.island;
    const m = new Menu();
    for (const t of s.targets || []) m.addItem((i) => i.setTitle(t.label).setIcon(t.icon || null).setChecked(t.id === s.targetId).onClick(() => (this.setIslandTarget(t.id), s.input.focus())));
    const r = s.target.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  },
  async islandKey(e) {
    const s = this.island;
    const { input } = s;
    const list = s.targets || [];
    const n = list.length;
    const at = Math.max(0, list.findIndex((x) => x.id === s.targetId));
    if (e.key === 'Tab' && n) {
      e.preventDefault();
      this.setIslandTarget(list[(at + (e.shiftKey ? n - 1 : 1)) % n].id);
    } else if (e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= n) {
      e.preventDefault();
      this.setIslandTarget(list[Number(e.key) - 1].id);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const t = this.captures.get(s.targetId);
      const v = input.value.trim();
      if (!t || (!v && !t.allowEmpty)) return;
      this.lastCaptureTarget = t.id;
      input.value = '';
      this.islandGrow();
      if (t.id !== 'pin') this.closeIsland(); // the other targets may open their own dialogs
      try {
        // the pin board: one pin per line (a pin is one line); the others get the text as typed
        if (t.id === 'pin' && v.includes('\n')) await this.addPins(v.split('\n').map((x) => x.trim()).filter(Boolean).map(textPinLine));
        else await t.run(v);
      } catch (err) {
        console.error(`${appName()} – Dashboard: capture`, err);
        new Notice('Capture failed — see console');
      }
    }
  },

  /* pins ------------------------------------------------------------------- */
  async addPins(lines) {
    if (!lines.length) return;
    const f = await this.pinBoard(true);
    const text = await writeNote(this.app, f, (t) => lines.reduce(addPinLine, t));
    this.gulp();
    this.renderPins(text);
  },
  pinText(v) {
    return this.addPins([textPinLine(v)]);
  },
  pinFiles(files) {
    const from = this.boardPath();
    return this.addPins(files.map((f) => `- [[${this.app.metadataCache.fileToLinktext(f, from)}]]`));
  },
  async unpin(raw) {
    const f = await this.pinBoard(false);
    if (f) this.renderPins(await writeNote(this.app, f, (t) => removePinLine(t, raw)));
  },
  async islandDrop(e) {
    const dt = e.dataTransfer;
    const dragged = this.dragging;
    const text = dt ? dt.getData('text/plain') : ''; // read now: the drop's data is gone after the first await
    const items = this.droppedItems(dt);
    try {
      if (dragged instanceof TFile) await this.pinFiles([dragged]);
      else if (dt && dt.files && dt.files.length) await this.pinFiles((await this.importFiles(dt, locPath(this.settings.pinnedFolder, 'Pinned'))) || []);
      else if (items.length) await this.pinFiles(items.filter((f) => f instanceof TFile));
      else if (text.trim()) await this.pinText(text);
    } catch (err) {
      console.error(`${appName()} – Dashboard: pin drop`, err);
      new Notice('Could not pin that — see console');
    }
    if (this.island.byDrag) this.foldSoon(1200);
  },
  async renderPins(text) {
    const s = this.island;
    if (!s || !s.el || !s.open) return;
    if (text === undefined) {
      const f = await this.pinBoard(false);
      text = f ? await this.app.vault.cachedRead(f) : '';
    }
    const list = s.list;
    list.empty();
    const pins = parsePins(text);
    if (!pins.length) {
      list.createDiv({ cls: 'nd-island-empty', text: 'Drop files here, or type above and press Enter.' });
      return;
    }
    const from = this.boardPath();
    const fresh = s.seen ? pins.filter((p) => !s.seen.has(p.raw)) : pins; // after opening, every pin bubbles in
    s.seen = new Set(pins.map((p) => p.raw));
    for (const p of pins) {
      const card = list.createDiv('nd-island-pin');
      const k = fresh.indexOf(p);
      if (k >= 0) {
        card.addClass('is-new');
        card.style.setProperty('--i', String(Math.min(k, 12)));
      }
      if (p.link) {
        const f = this.app.metadataCache.getFirstLinkpathDest(p.link, from);
        icon(card, f ? (f.extension === 'md' ? 'file-text' : 'file') : 'file-x');
        card.createSpan({ cls: 'nd-island-name', text: f ? f.basename : p.link });
        if (f) this.bindFileMouse(card, f);
        else card.addClass('is-missing');
        card.setAttr('title', f ? f.path : `${p.link} (not found)`);
      } else {
        icon(card, 'sticky-note');
        card.createSpan({ cls: 'nd-island-name', text: p.text });
        card.addClass('is-text');
        card.setAttr('draggable', 'true');
        card.addEventListener('dragstart', (e) => e.dataTransfer && e.dataTransfer.setData('text/plain', p.text));
      }
      const x = card.createEl('button', { cls: 'nd-island-x clickable-icon', attr: { type: 'button', 'aria-label': 'Unpin' } });
      setIcon(x, 'x');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        card.addClass('is-leaving');
        window.setTimeout(() => this.unpin(p.raw), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
      });
    }
  },
});
return NeonDeck;
})();
/* ==== module neon-tasks ==== */
const NeonTasksModule = (() => {
/* @src src/tasks/tasks-view.js */
/* ---- Tasks tab (fork) -------------------------------------------------------------
 * The two task cards of the dashboard, full size in the main pane: Tasks (#task lines across your
 * notes, by date) and Todo (your Todo note). Opened from the Neon sidebar list or the command. */
const VIEW_TASKS = 'neon-tasks-view';

class TasksView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.handles = [];
  }
  getViewType() {
    return VIEW_TASKS;
  }
  getDisplayText() {
    return 'Tasks';
  }
  getIcon() {
    return 'list-checks';
  }
  async onOpen() {
    addHelpAction(this, 'tasks'); // fork: the ? button in the header (src/shared/help.js)
    const p = this.plugin;
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'nt-view');
    this.scroller = this.contentEl.createDiv('nt-scroll');
    const grid = this.scroller.createDiv('nt-view-grid');
    if (p.settings.showTimeline !== false) this.mountTimeline(grid); // fork: Mermaid Gantt of due-dated tasks
    const tasks = widget(grid, 'nt-view-card nt-view-tasks', 'Tasks', 'list-checks', `${p.settings.taskTag || 'Tasks'} across your notes · by date`);
    const todo = widget(grid, 'nt-view-card nt-view-todo', 'Todo', 'star', p.quickPath());
    this.handles.push(p.mountTasks(tasks), p.mountGlobal(todo));
    this.mountPattern();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountPattern()));
  }
  async onClose() {
    for (const h of this.handles) if (h && h.destroy) h.destroy();
    this.handles = [];
    this.unmountPattern();
    this.contentEl.empty();
  }
  /** The dashboard's pattern behind the cards, when the Dashboard module is on. */
  mountPattern() {
    this.unmountPattern();
    const api = deckApi(this.app);
    if (api && api.mountPattern) this.pattern = api.mountPattern(this.contentEl, this.scroller, '.nd-card');
  }
  unmountPattern() {
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }
}
/* @src src/tasks/timeline.js */
/* ---- Tasks timeline (fork): due-dated tasks as a Gantt chart, drawn by the plugin (shared plan-draw.js) -------- */
const TASK_TIMELINE_MAX = 60; // rows; more than this stops being readable

// the timeline's colours: [kind, label]
const TASK_TL_KEY = [
  ['overdue', 'Overdue'],
  ['soon', 'Due within a week'],
  ['doing', 'In progress'],
  ['ready', 'Open'],
];

/**
 * Rows for the drawn timeline (pure): one section per note (nearest first), a bar from 🛫 start to 📅 due, else a
 * diamond on the due date; coloured overdue, due within a week, in progress or open. win: { from, to } or null.
 */
function taskTimelineRows(tasks, win, today) {
  const week = ymdAdd(today, 7);
  const dated = tasks.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, TASK_TIMELINE_MAX);
  const by = new Map();
  for (const t of dated) {
    const start0 = (String(t.raw || '').match(/🛫\s*(\d{4}-\d{2}-\d{2})/u) || [])[1];
    let start = start0 && start0 < t.due ? start0 : t.due;
    let end = t.due;
    if (win && (end < win.from || start > win.to)) continue;
    if (win && start < win.from) start = win.from;
    if (win && end > win.to) end = win.to;
    const kind = t.group === 'overdue' || t.due < today ? 'overdue' : t.doing ? 'doing' : t.due <= week ? 'soon' : 'ready';
    const note = t.file && t.file.basename ? t.file.basename : 'Tasks';
    if (!by.has(note)) by.set(note, []);
    by.get(note).push({ bar: { id: '', task: t, kind, crit: false, mark: null, start, end }, label: t.display || t.raw, who: '', milestone: start === end && !start0, thin: false });
  }
  const rows = [];
  for (const [note, list] of by) rows.push({ section: note }, ...list);
  return rows;
}

Object.assign(TasksView.prototype, {
  /** The timeline card across the top of the Tasks tab: dated tasks, drawn by the plugin; a click opens the task. */
  mountTimeline(grid) {
    const p = this.plugin;
    const card = widget(grid, 'nt-view-card nt-view-timeline', 'Timeline', 'calendar-range', 'Open tasks with a due date, by note');
    let items = [];
    const bar = card.body.createDiv('nd-timeline-bar');
    pills(bar, GANTT_ZOOMS, p.settings.timelineZoom || '3m', (z) => {
      p.settings.timelineZoom = z || '3m';
      p.saveSettings();
      draw();
    }, 'nd-timeline-zoom');
    const key = card.body.createDiv('np-legend nt-tl-key');
    for (const [kind, label] of TASK_TL_KEY) {
      const k = key.createSpan('np-key');
      k.createSpan({ cls: 'np-swatch' }).style.backgroundColor = planColour(kind);
      k.createSpan({ text: label });
    }
    const chart = card.body.createDiv('np-chart nt-tl-chart');
    const draw = () => {
      const today = moment().format('YYYY-MM-DD');
      const rows = taskTimelineRows(items, ganttWindow(p.settings.timelineZoom || '3m', today), today);
      chart.empty();
      const lay = rows.length ? planGanttLayout(rows, { today, width: chart.clientWidth || card.body.clientWidth || 900, labelW: 300, minDay: 1, maxDay: 30 }) : null;
      if (!lay) return void emptyState(chart, 'No open tasks with a due date in this window');
      planDrawGantt(chart, lay, { colours: planColourMap(), onBar: (e, b) => openFile(this.app, b.task.file, e, b.task.line) });
    };
    const refresh = async () => {
      items = await p.collectTasks();
      draw();
    };
    const soon = debounce(refresh, 500, true);
    this.register(p.onChange(soon));
    refresh();
  },
});
/* @src src/tasks/helpers.js */

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

const TASKS_DEFAULTS = {
  // fork: one Todo note replaces both "Quick tasks" and the Global tasks list kept in plugin data
  quickTasksPath: '', // the Todo note ('' = <base folder>/Todo.md): new tasks go at its head; its open tasks fill the Todo card
  taskTag: '#task', // fork: a checkbox line with this tag is a task wherever it is (Tasks-plugin style); empty = off
  projectTasks: 'none', // fork: tasks in project notes and project folders belong to the project's plan ('all' = show them here too)
  askOnCreate: false, // fork: off — Templater, daily notes and your own habits make new notes
  stampDone: true,
  showTimeline: true, // fork: the timeline card on the Tasks tab
  timelineZoom: '3m',
  carryDays: 14,
  showNoCategoryBar: false, // fork: off
  // fork: New note with customers (1.Customers/<customer>/<folder>/), a template per kind
  meetingsFolder: 'Meetings',
  peopleFolder: 'People',
  researchFolder: 'Research',
  noCustomerFolder: '', // where notes without a customer go ('' = vault root)
  newNoteHere: false, // fork: New note puts the note in the folder it was opened from (remembered)
  noteTemplate: '',
  meetingTemplate: '',
  personTemplate: '',
  researchTemplate: '',
  noteTypes: null, // fork: New note types [{ name, folder, template, tag, person }]; null = built from the settings above
  installedAt: 0,
  globalTasks: [],
  doneLog: [],
  lastBackup: '',
};
const SYSTEM_FOLDERS = []; // fork: the review, time log and project folders come from the settings (see isSystemPath)
const PROP_ORDER = [
  'type', 'title', 'ticket', 'status', 'priority', 'tags', 'aliases',
  'projects', 'school', 'admin', 'operations', 'untracked',
  'created', 'due', 'remind', 'completed', 'waiting_on', 'follow_up', 'waiting_since', 'jira', 'cover',
];
// fork: "[/]" (in progress, Tasks plugin) is an open task too
const TASK_LINE_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[ /]\]\s+(.*)$/;
const OPEN_BOX_RE = /\[[ /]\]/;
const escTag = (tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** fork: the task tag setting may list several tags ("#task, #todo"); the first is used for new tasks. */
function taskTags(tag) {
  return String(tag || '')
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
}
/** Does a task's text carry one of the task tags (e.g. #task, not #tasks or #task/sub)? */
function hasTaskTag(raw, tag) {
  return taskTags(tag).some((t) => new RegExp(`(^|\\s)${escTag(t)}(?=$|\\s)`, 'iu').test(raw));
}
/** A note's text with a new task line at its head: after the properties, above the first task there. */
function addTaskAtHead(text, line) {
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  const head = fm ? fm[0] : '';
  let rest = text.slice(head.length);
  const blank = rest.match(/^(?:[ \t]*\r?\n)*/)[0];
  rest = rest.slice(blank.length);
  const nextIsTask = TASK_LINE_RE.test(rest.split('\n')[0] || '') || /^\s*[-*+]\s+\[[^\]]\]/.test(rest);
  return head + (head ? '\n' : '') + line + '\n' + (rest && !nextIsTask ? '\n' : '') + rest;
}

/** Clean display text of a task line (Tasks-plugin emoji and the task tag stripped). */
function taskDisplay(raw, tag = '#task') {
  return excerptOf(
    raw
      // plan fields: 🆔 id, ⛔ depends-on ids, Dataview [key:: value] fields such as [duration:: 3d]
      .replace(/🆔\s*[\w-]+/gu, '')
      .replace(/⛔\uFE0F?\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, '')
      .replace(/\[[\w-]+::\s*(?:\[\[[^\]]*\]\]|[^\]\[])*\]/gu, '') // fork: [key:: value] fields, links inside them too
      .replace(taskTags(tag).length ? new RegExp(`(^|\\s)(?:${taskTags(tag).map(escTag).join('|')})(?=$|\\s)`, 'giu') : /$^/, '$1')
      .replace(/(?:📅|⏳|🛫|✅|➕)\s*\d{4}-\d{2}-\d{2}/gu, '')
      .replace(/🔁[^📅⏳🛫✅➕]*/gu, '')
      .replace(/[⏫🔼🔽🔺⏬]/gu, ''),
    140,
  );
}

/**
 * Group of a task: by its 📅 due date; else ⏳ scheduled on or before today → Today (fork);
 * else Today for a daily note; else Later. `due` is the date shown (due, else scheduled).
 */
function taskGroup(raw, daily, todayKey) {
  const date = (e) => (raw.match(new RegExp(`${e}\\s*(\\d{4}-\\d{2}-\\d{2})`, 'u')) || [])[1] || null;
  const due = date('📅');
  if (due) return { due, group: due < todayKey ? 'overdue' : due === todayKey ? 'today' : 'later' };
  const sched = date('⏳');
  if (sched) return { due: sched, group: sched <= todayKey ? 'today' : 'later' };
  return { due: null, group: daily ? 'today' : 'later' };
}
/** Quick shake, e.g. Enter on an empty add box. */
function shake(el) {
  el.removeClass('is-shake');
  void el.offsetWidth; // restart the animation
  el.addClass('is-shake');
}
/** True while the user types in an edit field inside `list`: don't touch the list then. */
const editingIn = (list) => !!(document.activeElement && document.activeElement.matches('.nt-edit') && list.contains(document.activeElement));
/** Collapse a row out of its list, then remove it. */
function leaveRow(el) {
  if (prefersReducedMotion() || !el.hasClass('nt-task')) return el.remove();
  el.style.height = `${el.offsetHeight}px`;
  void el.offsetHeight; // start the collapse from the current height
  el.addClass('is-leaving');
  el.style.height = '0px'; // collapses with the row's transition
  window.setTimeout(() => el.remove(), 260);
}
/**
 * Make `list` show `want` (elements, in order) without redrawing: kept rows stay, new ones are
 * inserted, the rest collapse out, and rows that move glide to their new place.
 */
function patchList(list, want) {
  const keep = new Set(want);
  const top = new Map([...list.children].map((el) => [el, el.getBoundingClientRect().top]));
  for (const el of [...list.children]) if (!keep.has(el) && !el.hasClass('is-leaving')) leaveRow(el);
  let cur = list.firstChild;
  for (const el of want) {
    while (cur && cur !== el && cur.hasClass('is-leaving')) cur = cur.nextSibling;
    if (cur === el) cur = cur.nextSibling;
    else list.insertBefore(el, cur);
  }
  if (prefersReducedMotion()) return;
  for (const el of want) {
    const t0 = top.get(el);
    const dy = t0 == null ? 0 : t0 - el.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}

class NewNoteModal extends Modal {
  /** opts: { folder, file (existing empty note), name } */
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const { file } = this.opts;
    this.modalEl.addClass('nd-modal', 'nt-newnote');
    this.titleEl.setText(file ? 'New note · a few questions' : 'New note');
    const c = this.contentEl;
    const field = (label, hint) => {
      const f = c.createDiv('nt-field');
      const l = f.createDiv('nt-label');
      l.createSpan({ text: label });
      if (hint) l.createSpan({ cls: 'nt-hint', text: hint });
      return f;
    };
    const name = field('Name').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Untitled' } });
    name.value = file ? file.basename : this.opts.name || '';
    const kinds = [['note', 'Note'], ['tasks', 'Task list']];
    if (this.plugin.inboxService()) kinds.push(['inbox', 'Inbox']); // fork
    if (this.plugin.ticketService()) kinds.push(['ticket', 'Project']);
    this.kind = pills(field('Kind'), kinds, 'note', (v) => sync());
    this.cat = pills(
      field('Category', 'for the time tracker · optional'),
      [...CATS.map((k) => [k, CAT_LABEL[k]]), ['untracked', 'Untracked']],
      null,
      null,
      'can-clear nt-cats',
    );
    for (const k of CATS) this.cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
    this.cat.btns.get('untracked').style.setProperty('--pill-accent', 'var(--nd-muted)');
    const folderField = field('Folder');
    const folder = folderField.createEl('input', { cls: 'nd-input', attr: { type: 'text', list: 'nt-folders', placeholder: '/ (vault root)' } });
    const dl = folderField.createEl('datalist', { attr: { id: 'nt-folders' } });
    for (const f of this.app.vault.getAllLoadedFiles()) if (f instanceof TFolder && f.path !== '/') dl.createEl('option', { value: f.path });
    folder.value = file ? (file.parent && file.parent.path !== '/' ? file.parent.path : '') : this.opts.folder && this.opts.folder !== '/' ? this.opts.folder : '';
    const note = c.createDiv({ cls: 'nt-note', text: 'You can close this and just type — the note keeps a small “No category yet” reminder.' });
    const row = c.createDiv('nd-modal-row');
    row.createDiv({ cls: 'nt-keys', text: 'Enter / Ctrl+Enter creates · Esc skips' });
    button(row, { text: file ? 'Skip' : 'Cancel', onClick: () => this.close() });
    const go = button(row, { text: file ? 'Save' : 'Create', cls: 'mod-cta', onClick: () => this.submit(name.value, folder.value) });
    const sync = () => {
      const t = this.kind.get() === 'ticket';
      const inbox = this.kind.get() === 'inbox';
      folderField.toggle(!t && !inbox);
      note.setText(t ? 'Opens the New project form with this name as the title.' : inbox ? `Creates an inbox note in ${inboxWhere(this.plugin)}, tagged and marked to deal with later.` : 'You can close this and just type — the note keeps a small “No category yet” reminder.');
      go.querySelector('.nd-btn-label').setText(t ? 'Continue' : file ? 'Save' : 'Create');
    };
    c.addEventListener('keydown', (e) => {
      // Enter creates from anywhere in the card (also right after clicking a category pill)
      // (Enter on a focused Skip / Cancel / Create button keeps that button's own action)
      const inFooter = e.target instanceof HTMLElement && e.target.closest('.nd-modal-row');
      if (e.key === 'Enter' && !e.isComposing && !inFooter) {
        e.preventDefault();
        this.submit(name.value, folder.value);
      }
    });
    sync();
    window.setTimeout(() => {
      name.focus();
      name.select();
    }, 20);
  }
  async submit(nameRaw, folderRaw) {
    const name = safeName(nameRaw) || 'Untitled';
    const kind = this.kind.get();
    const cat = this.cat.get();
    this.close();
    const { file } = this.opts;
    if (kind === 'ticket') {
      if (file && !(await this.app.vault.read(file)).trim()) await this.app.fileManager.trashFile(file);
      return this.plugin.ticketService()({ title: name, category: CATS.includes(cat) ? cat : null });
    }
    if (kind === 'inbox') return void (await openNewInbox(this.plugin, file, name));
    const props = (fm) => {
      if (kind === 'tasks') fm.tags = [...new Set([...fmTags(fm), 'tasks'])];
      if (CATS.includes(cat)) fm[cat] = true;
      if (cat === 'untracked') fm.untracked = true;
      if (!fm.created) fm.created = moment().format('YYYY-MM-DD');
    };
    let target = file;
    if (target) {
      const dest = normalizePath(`${folderRaw.trim() && folderRaw.trim() !== '/' ? folderRaw.trim() + '/' : ''}${name}.md`);
      if (dest !== target.path) {
        if (this.app.vault.getAbstractFileByPath(dest)) new Notice('A note with that name already exists — kept the old name');
        else {
          await ensureFolder(this.app, dest.split('/').slice(0, -1).join('/'));
          await this.app.fileManager.renameFile(target, dest);
        }
      }
    } else {
      this.plugin.selfCreated.add('pending');
      try {
        target = await createUnique(this.app, folderRaw.trim() || '/', name, kind === 'tasks' ? '\n- [ ] ' : '\n');
      } finally {
        this.plugin.selfCreated.delete('pending');
      }
    }
    await this.app.fileManager.processFrontMatter(target, (fm) => {
      props(fm);
      reorderProps(fm);
    });
    if (!file) await openNewNote(this.app, target);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Put known properties in a fixed order; others keep their order after them. */
function reorderProps(fm) {
  const entries = Object.entries(fm);
  for (const [k] of entries) delete fm[k];
  const rank = (k) => {
    const i = PROP_ORDER.indexOf(k);
    return i < 0 ? PROP_ORDER.length : i;
  };
  entries
    .map((e, i) => [e, i])
    .sort((a, b) => rank(a[0][0]) - rank(b[0][0]) || a[1] - b[1])
    .forEach(([[k, v]]) => (fm[k] = v));
}

class UncategorisedModal extends SuggestModal {
  constructor(plugin, files) {
    super(plugin.app);
    this.files = files;
    this.setPlaceholder('Notes without a category — pick one to open it');
    this.modalEl.addClass('nd-modal');
  }
  getSuggestions(q) {
    q = q.toLowerCase();
    return this.files.filter((f) => f.path.toLowerCase().includes(q));
  }
  renderSuggestion(f, el) {
    el.createDiv({ cls: 'nd-suggest-title', text: f.basename });
    el.createDiv({ cls: 'nd-suggest-meta', text: `${f.parent && f.parent.path !== '/' ? f.parent.path + ' · ' : ''}created ${moment(f.stat.ctime).fromNow()}` });
  }
  onChooseSuggestion(f, evt) {
    openFile(this.app, f, evt);
  }
}

/* @src src/tasks/settings.js */
class NeonTasksSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = () => p.saveSettings();
    containerEl.empty();
    containerEl.addClass('nd-settings');
    new Setting(containerEl).setName('Tasks').setHeading();
    new Setting(containerEl).setDesc('The Tasks card shows open tasks ([ ] and [/]) across your notes, grouped by 📅 due or ⏳ scheduled date: checkbox lines with the task tag anywhere, every checkbox in notes tagged “tasks” and in recent daily notes. Excluded folders are skipped.');
    new Setting(containerEl)
      .setName('Task tags')
      .setDesc('A checkbox line with one of these tags is a task wherever it is, as in the Tasks plugin. Several: separate with commas (#task, #todo); new tasks get the first. Empty: only tagged notes, daily notes and the Todo note.')
      .addText((t) => t.setPlaceholder('#task').setValue(s.taskTag).onChange((v) => ((s.taskTag = taskTags(v).join(', ')), (NEON_PLAN.taskTag = s.taskTag), save(), p.emit())));
    new Setting(containerEl)
      .setName('Tasks in projects')
      .setDesc('Tasks in project notes (and in project folders) belong to the project: its plan and the counts on the Projects card and tab. Show them on the Tasks card and tab as well?')
      .addDropdown((d) => d.addOption('none', 'No: only in the project').addOption('all', 'Yes: with the other tasks').setValue(s.projectTasks === 'all' ? 'all' : 'none').onChange((v) => ((s.projectTasks = v), save(), p.emit())));
    numSetting(new Setting(containerEl).setName('Carry over unfinished daily-note tasks (days)').setDesc('Open tasks from earlier daily or weekly notes show under Today. 0 = only the current note.'), s, 'carryDays', 0, 90, save);
    new Setting(containerEl)
      .setName('Stamp completion date')
      .setDesc('Adds ✅ YYYY-MM-DD when you tick a task on the dashboard (Tasks-plugin compatible).')
      .addToggle((t) => t.setValue(s.stampDone).onChange((v) => ((s.stampDone = v), save())));
    new Setting(containerEl)
      .setName('Timeline on the Tasks tab')
      .setDesc('A Gantt chart (Mermaid) of open tasks with a due date: bars where a task also has a 🛫 start date. “Copy as Mermaid” pastes it into a note.')
      .addToggle((t) => t.setValue(s.showTimeline !== false).onChange((v) => ((s.showTimeline = v), save())));
    new Setting(containerEl).setName('Todo').setHeading();
    new Setting(containerEl)
      .setName('Todo note')
      .setDesc(`Its open tasks fill the Todo card. Tasks you add on the dashboard go at the head of this note as “- [ ] #task … ➕ date”. Empty: ${basePath('Todo.md')}.`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Todo.md')).setValue(s.quickTasksPath).onChange((v) => ((s.quickTasksPath = v.trim()), save(), p.emit())), 'file'));
    new Setting(containerEl).setName('New notes').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'With a groups folder (Projects section), New note asks for a name, a group and a type. In a folder, {group} stands for <groups folder>/<group>; without a group chosen, such notes go in the folder for notes without a group. Templates fill {{title}}, {{date}} and {{time}}; without one the note gets title, created, modified, the group property and the tag. Projects always go through New project.' });
    const types = s.noteTypes;
    const box = containerEl.createDiv('nt-types');
    const drawTypes = () => {
      box.empty();
      types.forEach((ty, i) => {
        const row = new Setting(box).setClass('nt-type-row');
        row.addText((t) => t.setPlaceholder('Name').setValue(ty.name || '').onChange((v) => ((ty.name = v.trim()), save())));
        row.addText((t) => t.setPlaceholder('Folder, e.g. {group}/Meetings').setValue(ty.folder || '').onChange((v) => ((ty.folder = v.trim()), save())));
        row.addText((t) => suggestPaths(p.app, t.setPlaceholder('Template (optional)').setValue(ty.template || '').onChange((v) => ((ty.template = v.trim()), save())), 'file'));
        row.addText((t) => t.setPlaceholder('Tag').setValue(ty.tag || '').onChange((v) => ((ty.tag = v.trim().replace(/^#/, '')), save())));
        row.addToggle((t) => t.setTooltip('Person: named @Name, with aliases').setValue(!!ty.person).onChange((v) => ((ty.person = v), save())));
        row.addExtraButton((b) =>
          b.setIcon('trash-2').setTooltip('Remove this type').onClick(() => {
            if (types.length <= 1) return new Notice('Keep at least one type');
            types.splice(i, 1);
            save();
            drawTypes();
          }),
        );
      });
      new Setting(box).addButton((b) =>
        b.setButtonText('Add a type').onClick(() => {
          types.push({ name: '', folder: '{group}', template: '', tag: '', person: false });
          save();
          drawTypes();
        }),
      );
    };
    drawTypes();
    new Setting(containerEl)
      .setName('Folder for notes without a group')
      .setDesc('Empty: the vault root.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('e.g. 2.Resources').setValue(s.noCustomerFolder).onChange((v) => ((s.noCustomerFolder = v.trim()), save())), 'folder'));
    new Setting(containerEl)
      .setName('Ask a few questions when I create a note')
      .setDesc('Name, kind and category. Close the card to skip it.')
      .addToggle((t) => t.setValue(s.askOnCreate).onChange((v) => ((s.askOnCreate = v), save())));
    new Setting(containerEl)
      .setName('“No category yet” reminder')
      .setDesc('A small bar on new notes without a category. Only notes created since the plugin was installed, and never with customer folders (the folder is the customer).')
      .addToggle((t) => t.setValue(s.showNoCategoryBar).onChange((v) => ((s.showNoCategoryBar = v), save(), p.updateBar())));
    madeWith(containerEl);
  }
}

/* @src src/tasks/plugin.js */
class NeonTasks extends Plugin {
  async onload() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, TASKS_DEFAULTS, raw || {});
    const s = this.settings;
    if (!Array.isArray(s.globalTasks)) s.globalTasks = [];
    if (!Array.isArray(s.doneLog)) s.doneLog = [];
    if (!Array.isArray(s.noteTypes) || !s.noteTypes.length) s.noteTypes = noteTypesFrom(s); // fork: older per-kind settings → the types list
    if (!s.installedAt) s.installedAt = Date.now();
    // fork: the "No category yet" bar is off by default now; vaults that saved the old default (on) get it off once
    if (!s.noCatBarOff) {
      s.showNoCategoryBar = false;
      s.noCatBarOff = true;
    }
    NEON_PLAN.taskTag = s.taskTag; // fork: project plans read the same task tags
    dropOldDefaults(this.app, s, { quickTasksPath: 'Todo.md' }); // fork: the Todo note follows the base folder unless set
    this.freshData = !raw;
    await this.saveSettings();
    this.selfCreated = new Set();
    this.listeners = new Set();

    // fork: a Tasks tab in the main pane, listed in the Neon sidebar like Projects, Time and Research
    this.registerView(VIEW_TASKS, (leaf) => new TasksView(leaf, this));
    this.registerHoverLinkSource(VIEW_TASKS, { display: `${appName()} tasks`, defaultMod: true }); // page previews (hoverPreview)
    this.addCommand({ id: 'open-tasks', name: 'Open the Tasks tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-note', name: 'New note', callback: () => this.newNote(this.currentFolder()) });
    // fork: "Fix properties" (current note / folder) and the automatic ops → operations rename are removed:
    // they deleted empty properties (e.g. due: and completed: from your templates) and imposed upstream categories
    this.addCommand({ id: 'add-global-task', name: 'Add a task to Todo', callback: () => new PromptModal(this.app, { title: 'Add to Todo', placeholder: 'Goes at the top of your Todo note', cta: 'Add', onSubmit: (v) => this.addQuickTask(v) }).open() });
    this.addCommand({ id: 'uncategorised', name: 'Show new notes without a category', callback: () => new UncategorisedModal(this, this.uncategorised()).open() });
    this.addSettingTab(new NeonTasksSettingTab(this.app, this));
    this.buildStatus();

    const changed = debounce(() => this.emit(), 250, true);
    // fork: finished tasks come from the notes; rescan when a note with ticked tasks changes
    const rescan = debounce(() => this.scanDone().catch((e) => console.error('Neon Work done tasks', e)), 1000, true);
    this.registerEvent(this.app.metadataCache.on('changed', (f, _d, cache) => (cache && cache.listItems && cache.listItems.some((li) => li.task === 'x' || li.task === 'X')) || (this.doneTasks || []).some((x) => x.path === f.path) ? rescan() : null));
    this.registerEvent(this.app.vault.on('delete', rescan));
    this.registerEvent(this.app.vault.on('rename', rescan));
    const doneRef = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(doneRef);
      rescan();
    });
    this.registerEvent(doneRef);
    // Only notes that feed the Tasks widget trigger a refresh.
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, _d, cache) => {
        if (!this.sourcePaths || this.sourcePaths.has(f.path) || this.mayHoldTasks(f, cache) || f.path === this.quickPath()) changed();
      }),
    );
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', changed));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateBar()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.updateBar()));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        const a = this.app.workspace.getActiveFile();
        if (a && f.path === a.path) this.updateBar();
      }),
    );
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.ready = Date.now();
      this.registerEvent(this.app.vault.on('create', (f) => this.onCreate(f)));
      this.hookCore();
      this.updateBar();
      this.offerGlobalMove();
      // fork: no Global tasks backup (they are the Todo note); a new day moves tasks between groups
      this.registerInterval(window.setInterval(() => this.dayKey !== (this.dayKey = moment().format('YYYY-MM-DD')) && (this.emit(), rescan()), 10 * 60 * 1000));
      rescan();
    });
  }
  onunload() {
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tasks');
      api.unregisterAction('tasks');
      api.unregisterWidget('global');
      api.unregisterCapture('task');
      api.unregisterCapture('global');
      api.unregisterFacts('tasks');
      api.unregisterActivity && api.unregisterActivity('tasks');
      api.unregisterWeekLine('tasks');
      api.unprovide('newNote');
      api.unregisterExcluded('tasks');
    }
    document.querySelectorAll('.nt-nocat-bar').forEach((el) => el.remove());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  emit() {
    for (const fn of this.listeners) fn();
    const api = deckApi(this.app);
    if (api) api.factsChanged();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  openTab() {
    return activateView(this.app, VIEW_TASKS, 'tab');
  }
  currentFolder() {
    const f = this.app.workspace.getActiveFile();
    return f && f.parent ? f.parent.path : '/';
  }
  /** fork: the Dashboard's inbox (New note's Inbox button), or null when the Dashboard is off. */
  inboxService() {
    const api = deckApi(this.app);
    return api && api.service ? api.service('inboxNote') : null;
  }
  ticketService() {
    const t = neonPlugin(this.app, 'neon-tickets');
    return t && t.newTicket ? (opts) => t.newTicket(opts) : null;
  }

  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tasks', slot: 'tasks', title: 'Tasks', icon: 'list-checks', sub: `${this.settings.taskTag || 'Tasks'} across your notes · by date`, open: () => this.openTab(), openTitle: 'Open the Tasks tab', mount: (card) => this.mountTasks(card) });
    api.registerWidget({ id: 'global', slot: 'global', title: 'Todo', icon: 'star', sub: this.quickPath(), open: () => this.openTab(), openTitle: 'Open the Tasks tab (Todo is beside the tasks there)', mount: (card) => this.mountGlobal(card) });
    api.registerAction({ id: 'tasks', icon: 'list-checks', label: 'Tasks', order: 15, view: VIEW_TASKS, run: () => this.openTab() });
    api.registerCapture({ id: 'task', label: 'Todo task', short: 'Todo', icon: 'square-check', order: 10, run: (v) => this.addQuickTask(v) });
    // Recently done on the dashboard (fork): tasks ticked anywhere, read from their ✅ dates in your notes
    if (api.registerActivity) api.registerActivity('tasks', () => this.doneActivity());
    api.registerFacts('tasks', () => {
      const out = [];
      if (this.openCount != null) out.push({ v: this.openCount, l: 'open tasks' });
      const n = this.doneOn(moment());
      if (n) out.push({ v: n, l: n === 1 ? 'task done' : 'tasks done' });
      return out;
    });
    api.registerWeekLine('tasks', (start, end) => {
      const n = this.doneBetween(start, end);
      return n ? [`${n} task${n === 1 ? '' : 's'} done`] : [];
    });
    api.provide('newNote', (folder) => this.newNote(folder));
    api.registerExcluded('tasks', () => []);
  }
  doneOn(m) {
    return this.doneBetween(m.clone().startOf('day'), m.clone().startOf('day').add(1, 'day'));
  }
  logDone(text, src, due) {
    const log = this.settings.doneLog;
    log.push(due ? { t: Date.now(), text, src, due } : { t: Date.now(), text, src });
    const cut = Date.now() - 120 * 864e5;
    while (log.length && log[0].t < cut) log.shift();
    this.saveSettings();
    this.app.workspace.trigger('neon:task-done', { text, src });
    const api = deckApi(this.app);
    if (api && api.activityChanged) api.activityChanged();
  }

}
/* @src src/tasks/new-note.js */
/* ---- New note, by group and type (fork) ----------------------------------------
 * When the vault has a groups folder (customers: 1.Customers/<customer>/…; PARA: 2.Areas/<area>), the New note
 * card asks for a name, a group and a type, and puts the note in the type's folder from its template. */
/* fork: the kinds of note New note offers are a list in the settings (noteTypes). A type has a name, a folder
 * ({group} = <groups folder>/<group>), a template, a tag for notes made without a template, and person
 * behaviour (@Name, aliases). Projects always go through New project. Older settings become this list once. */
const NOTE_TYPE_ICONS = { note: 'file-text', meeting: 'users', person: 'user', research: 'library', resource: 'archive', project: 'briefcase' };

/** The New note types from the settings, or built from the older per-kind settings (pure). */
function noteTypesFrom(s) {
  if (Array.isArray(s.noteTypes) && s.noteTypes.length) return s.noteTypes;
  const sub = (f) => (f ? `{group}/${f}` : '{group}');
  return [
    { name: 'Note', folder: '{group}', template: s.noteTemplate || '', tag: '', person: false },
    { name: 'Meeting', folder: sub(s.meetingsFolder || 'Meetings'), template: s.meetingTemplate || '', tag: 'meeting', person: false },
    { name: 'Person', folder: sub(s.peopleFolder || 'People'), template: s.personTemplate || '', tag: 'person', person: true },
    { name: 'Research', folder: sub(s.researchFolder || 'Research'), template: s.researchTemplate || '', tag: 'research', person: false },
  ];
}
/** Does a type's folder depend on the group? */
const typeUsesGroup = (type) => /\{group\}/i.test(type.folder || '');
/**
 * Where a new note of a type goes (pure). {group} needs a group; without one the note goes in the fallback
 * folder ('' = vault root). People notes get an @ in front of the name. With `here` (a folder path, '/' = vault
 * root) the note goes there instead, whatever the type's folder says.
 */
function newNotePath(type, groupsFolder, group, name, fallback, here = null) {
  let folder;
  if (here != null) folder = here || '/';
  else if (typeUsesGroup(type)) folder = group ? (type.folder || '').replace(/\{group\}/gi, `${groupsFolder}/${group}`) : fallback || '/';
  else folder = type.folder || fallback || '/';
  folder = normalizePath(folder.replace(/^\/+|\/+$/g, '') || '/');
  const file = type.person && !name.startsWith('@') ? `@${name}` : name;
  return { folder: !folder || folder === '.' ? '/' : folder, file };
}
/** Properties for a new note without a template (pure). */
function newNoteFrontmatter(type, title, day, group) {
  const lines = ['---', `title: ${JSON.stringify(title)}`, `created: ${day}`, `modified: ${day}`];
  if (type.person) {
    const plain = title.replace(/^@/, '');
    const first = plain.split(/\s+/)[0];
    lines.push('aliases:', `  - ${JSON.stringify(plain)}`);
    if (first && first !== plain) lines.push(`  - ${JSON.stringify(first)}`);
  }
  if (group) lines.push(`${groupProps()[0] || 'customer'}: ${JSON.stringify(group.toLowerCase())}`); // fork: the first group property
  const tag = String(type.tag || '').trim().replace(/^#/, '');
  if (tag) lines.push('tags:', `  - ${tag}`);
  lines.push('---', '');
  return lines.join('\n');
}

/** fork: where inbox notes go, for the dialog's hint. */
function inboxWhere(p) {
  const deck = neonPlugin(p.app, 'neon-deck');
  return deck && deck.inboxFolder ? deck.inboxFolder() : 'the inbox folder';
}
/** fork: New note's Inbox button: make the inbox note, drop an empty note New note was asked about, open it. */
async function openNewInbox(p, file, title) {
  const f = await p.inboxService()(title, '');
  if (file && file !== f && !(await p.app.vault.read(file)).trim()) await p.app.fileManager.trashFile(file);
  await openNewNote(p.app, f);
}

class CustomerNoteModal extends Modal {
  /** opts: { folder, file (an existing empty note), name } */
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    const s = p.settings;
    const { file } = this.opts;
    this.modalEl.addClass('nd-modal', 'nt-newnote');
    this.titleEl.setText('New note');
    const c = this.contentEl;
    const field = (label, hint) => {
      const f = c.createDiv('nt-field');
      const l = f.createDiv('nt-label');
      l.createSpan({ text: label });
      if (hint) l.createSpan({ cls: 'nt-hint', text: hint });
      return f;
    };
    const name = field('Name').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Untitled' } });
    name.value = file ? file.basename : this.opts.name || '';
    this.types = noteTypesFrom(s);
    const kinds = this.types.map((t, i) => [String(i), t.name || 'Note']);
    if (p.inboxService()) kinds.push(['inbox', 'Inbox']); // fork
    if (p.ticketService()) kinds.push(['project', 'Project']);
    this.kind = pills(field('Kind'), kinds, '0', () => sync());
    const customers = CATS.map((k) => [k, CAT_LABEL[k] || k]);
    const here = this.opts.folder || (file && file.parent ? file.parent.path : '');
    const guess = pathCustomer(`${here}/x.md`) || '';
    // fork: "Put it in this folder": the folder New note was opened from, instead of the group and type folders
    const hereField = field('Folder');
    const hereLabel = hereField.createEl('label', { cls: 'nt-here' });
    const hereBox = hereLabel.createEl('input', { attr: { type: 'checkbox' } });
    hereLabel.createSpan({ text: `Put it in ${here && here !== '/' ? here : 'the vault root'}` });
    hereBox.checked = !!s.newNoteHere;
    this.here = () => (hereBox.checked && !['project', 'inbox'].includes(this.kind.get()) ? here || '/' : null);
    const groupField = field(groupWord());
    const sel = groupField.createEl('select', { cls: 'dropdown' });
    for (const [k, l] of customers) sel.createEl('option', { value: k, text: l });
    sel.createEl('option', { value: '', text: `No ${groupWord(false, true)} (${s.noCustomerFolder || 'vault root'})` });
    sel.value = guess;
    const where = c.createDiv({ cls: 'nt-note' });
    const row = c.createDiv('nd-modal-row');
    row.createDiv({ cls: 'nt-keys', text: 'Enter creates · Esc cancels' });
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const go = button(row, { text: 'Create', cls: 'mod-cta', onClick: () => this.submit(name.value, sel.value) });
    const label = (k) => CAT_LABEL[k] || k;
    const sync = () => {
      const kind = this.kind.get();
      if (kind === 'project') where.setText(`Opens New project with this name and ${groupWord(false, true)}.`);
      else if (kind === 'inbox') where.setText(`Creates an inbox note in ${inboxWhere(p)}, tagged and marked to deal with later.`);
      else {
        const type = this.types[Number(kind)] || this.types[0];
        const { folder, file: fname } = newNotePath(type, NEON_CATS.customersFolder, sel.value ? label(sel.value) : '', safeName(name.value) || 'Untitled', s.noCustomerFolder, this.here());
        where.setText(`Creates ${folder === '/' ? '' : folder + '/'}${fname}.md${(type.template || '').trim() ? ` from ${type.template.trim()}` : ''}`);
      }
      go.querySelector('.nd-btn-label').setText(kind === 'project' ? 'Continue' : 'Create');
      hereField.toggle(kind !== 'project' && kind !== 'inbox');
      groupField.toggle(this.here() == null);
    };
    hereBox.addEventListener('change', () => {
      s.newNoteHere = hereBox.checked;
      p.saveSettings();
      sync();
    });
    sel.addEventListener('change', sync);
    name.addEventListener('input', sync);
    c.addEventListener('keydown', (e) => {
      const inFooter = e.target instanceof HTMLElement && e.target.closest('.nd-modal-row');
      if (e.key === 'Enter' && !e.isComposing && !inFooter) {
        e.preventDefault();
        this.submit(name.value, sel.value);
      }
    });
    sync();
    window.setTimeout(() => (name.focus(), name.select()), 20);
  }
  async submit(nameRaw, customerKey) {
    const p = this.plugin;
    const kind = this.kind.get();
    const title = safeName(nameRaw) || 'Untitled';
    const here = this.here();
    // fork: in this folder, the group comes from the folder (if it is inside one), not the hidden dropdown
    const key = here != null ? pathCustomer(`${here}/x.md`) || '' : customerKey;
    const customer = key ? CAT_LABEL[key] || key : '';
    this.close();
    try {
      const { file } = this.opts;
      if (kind === 'project') {
        if (file && !(await this.app.vault.read(file)).trim()) await this.app.fileManager.trashFile(file);
        return p.ticketService()({ title, customer });
      }
      if (kind === 'inbox') return void (await openNewInbox(p, file, title));
      const type = this.types[Number(kind)] || this.types[0];
      const { folder, file: fname } = newNotePath(type, NEON_CATS.customersFolder, customer, title, p.settings.noCustomerFolder, here);
      const day = moment();
      const tpl = await p.templateText(type.template, fname, day);
      const body = tpl != null ? tpl : newNoteFrontmatter(type, fname, day.format('YYYY-MM-DD'), customer);
      p.selfCreated.add('pending');
      let target;
      try {
        target = await createUnique(this.app, folder, fname, body);
      } finally {
        p.selfCreated.delete('pending');
      }
      if (file && file !== target && !(await this.app.vault.read(file)).trim()) await this.app.fileManager.trashFile(file);
      await openNewNote(this.app, target);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error(`${appName()} – Tasks: could not create the note`, e);
        new Notice('Could not create the note');
      }
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}

Object.assign(NeonTasks.prototype, {
  /** A template note's text with {{title}}, {{date}}, {{time}} filled in, or null without one. */
  async templateText(path, title, day) {
    path = String(path || '').trim();
    if (!path) return null;
    const tf = this.app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(tf instanceof TFile)) {
      new Notice(`Template “${path}” not found: using standard properties`);
      return null;
    }
    return applyTemplate(await this.app.vault.read(tf), day, title);
  },
});
/* @src src/tasks/props.js */
Object.assign(NeonTasks.prototype, {
  /* new notes ------------------------------------------------------------- */
  newNote(folder) {
    // fork: with customers, the card that knows the customer folder layout
    if (NEON_CATS.customers) return new CustomerNoteModal(this, { folder }).open();
    new NewNoteModal(this, { folder }).open();
  },
  /** Folders the plugins write to themselves (log notes, reviews, backups): never asked about. */
  isSystemPath(path) {
    const deck = neonPlugin(this.app, 'neon-deck');
    const time = neonPlugin(this.app, 'neon-time');
    const projects = neonPlugin(this.app, 'neon-tickets');
    const dirs = [...SYSTEM_FOLDERS, deck && deck.reviewFolder && deck.reviewFolder(), time && time.logFolder && time.logFolder(), projects && projects.projectFolder && projects.projectFolder()].filter(Boolean);
    return dirs.some((p) => path === p || path.startsWith(p + '/'));
  },
  onCreate(f) {
    if (!this.settings.askOnCreate || !(f instanceof TFile) || f.extension !== 'md') return;
    if (!this.ready || Date.now() - this.ready < 3000) return;
    if (this.selfCreated.size || f.stat.size > 0 || this.isSystemPath(f.path) || dailyDateOf(this.app, f)) return;
    if (Date.now() - f.stat.ctime > 5000) return;
    // let Obsidian open the note first, then ask (only if it is still empty)
    window.setTimeout(async () => {
      const cur = this.app.vault.getAbstractFileByPath(f.path);
      if (!(cur instanceof TFile)) return;
      if ((await this.app.vault.read(cur)).trim()) return;
      new (NEON_CATS.customers ? CustomerNoteModal : NewNoteModal)(this, { file: cur }).open();
    }, 350);
  },
  needsCategory(f) {
    if (!(f instanceof TFile) || f.extension !== 'md') return false;
    // fork: with customer folders, a note's customer comes from its folder, and notes elsewhere don't need one
    if (NEON_CATS.customers) return false;
    if (f.stat.ctime < this.settings.installedAt || this.isSystemPath(f.path) || dailyDateOf(this.app, f)) return false;
    if (f.path === this.quickPath()) return false; // fork: the Global tasks backup note (backupPath) is gone
    return noteCategory(this.app.metadataCache.getFileCache(f), f.path) === null;
  },
  uncategorised() {
    return this.app.vault.getMarkdownFiles().filter((f) => this.needsCategory(f)).sort((a, b) => b.stat.ctime - a.stat.ctime);
  },
  buildStatus() {
    const el = this.addStatusBarItem();
    el.addClass('nd-status', 'nt-status', 'mod-clickable');
    const ic = el.createSpan('nd-status-icon');
    setIcon(ic, 'tag');
    const txt = el.createSpan('nd-status-text');
    tip(el, 'New notes without a category — click to list them');
    el.addEventListener('click', () => new UncategorisedModal(this, this.uncategorised()).open());
    const update = () => {
      const n = this.uncategorised().length;
      el.toggle(n > 0 && this.settings.showNoCategoryBar && !NEON_CATS.customers); // fork: no nagging by default
      txt.setText(`${n} no category`);
    };
    this.register(this.onChange(update));
    this.app.workspace.onLayoutReady(update);
  },
  updateBar() {
    document.querySelectorAll('.nt-nocat-bar').forEach((el) => el.remove());
    if (!this.settings.showNoCategoryBar) return;
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (!view || !view.file || !this.needsCategory(view.file)) return;
    const file = view.file;
    const header = view.containerEl.querySelector('.view-header');
    const bar = createDiv('nt-nocat-bar');
    if (header) header.after(bar);
    else view.containerEl.prepend(bar);
    icon(bar, 'tag');
    bar.createSpan({ cls: 'nt-nocat-k', text: 'No category yet' });
    for (const c of [...CATS, 'untracked']) {
      const b = bar.createEl('button', { cls: 'nd-pill-btn', text: CAT_LABEL[c] });
      b.style.setProperty('--pill-accent', c === 'untracked' ? 'var(--nd-muted)' : catColor(c));
      b.addEventListener('click', async () => {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm[c] = true;
          if (!fm.created) fm.created = moment(file.stat.ctime).format('YYYY-MM-DD');
          reorderProps(fm);
        });
        bar.remove();
      });
    }
    const x = bar.createDiv('nt-nocat-x');
    setIcon(x, 'x');
    tip(x, 'Hide for now');
    x.addEventListener('click', () => bar.remove());
  },
});
/* @src src/tasks/widget-global.js */
Object.assign(NeonTasks.prototype, {
  /* the Todo card (fork) --------------------------------------------------
   * Replaces the Global tasks list kept in plugin data: it shows the open tasks of the Todo note in file
   * order. Adding writes a task at the head of that note; ticking and editing change its line there. */
  async addGlobal(text) {
    await this.addQuickTask(text);
  },
  /** Global tasks saved by upstream Neon Deck's Tasks module (plugin data): offer once to move them into the Todo note. */
  offerGlobalMove() {
    const items = this.settings.globalTasks || [];
    if (!items.length || this.settings.globalMoveAsked) return;
    new ConfirmModal(this.app, {
      title: 'Move Global tasks into Todo?',
      text: `${items.length} Global task${items.length === 1 ? '' : 's'} from an earlier version are stored in plugin data. Add them to the head of ${this.quickPath()}?`,
      cta: 'Move',
      warning: false,
      onConfirm: async () => {
        try {
          for (const t of items.slice().reverse()) await this.writeQuickTask(t.text);
          this.settings.globalTasks = [];
        } catch (e) {
          if (!(e && e.neonReadOnly)) console.error(`${appName()} – Tasks: could not move Global tasks`, e);
          return;
        }
        this.settings.globalMoveAsked = true;
        await this.saveSettings();
        new Notice(`✦ Moved ${items.length} task${items.length === 1 ? '' : 's'} into Todo`);
      },
    }).open();
    this.settings.globalMoveAsked = true;
    this.saveSettings();
  },
  mountGlobal(card) {
    const body = card.body;
    const list = body.createDiv('nt-list nt-global');
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add to Todo… (Enter)' } });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (!input.value.trim()) return shake(add);
      const v = input.value;
      input.value = '';
      this.addQuickTask(v);
    });
    button(card.actions, {
      icon: 'file-text',
      cls: 'nd-icon-btn',
      title: 'Open the Todo note',
      onClick: (e) => {
        const f = this.todoFile();
        if (f) openFile(this.app, f, e);
        else new Notice(`No Todo note at ${this.quickPath()} yet. Set it in the plugin’s settings, Tasks section.`);
      },
    });
    let token = 0;
    let first = true;
    let count = 0;
    const render = async () => {
      const my = ++token;
      const items = await this.collectTodo();
      if (my !== token || !list.isConnected || editingIn(list)) return;
      // tasks typed a moment ago that the index hasn't seen yet
      const have = new Set(items.map((t) => t.raw));
      const todayKey = moment().format('YYYY-MM-DD');
      this.pendingQuick = (this.pendingQuick || []).filter((p) => ![...have].some((r) => r.includes(p.text)) && Date.now() - p.at < 10000);
      const pending = this.pendingQuick.map((p) => ({ file: { path: this.quickPath(), basename: 'Todo' }, line: -1, raw: p.text, ...taskGroup(p.text, null, todayKey), carried: null, display: p.text, quick: true, pending: true }));
      const all = [...pending, ...items];
      countUp(card.badge, count, all.length, (v) => (Math.round(v) ? String(Math.round(v)) : ''), 300);
      count = all.length;
      const old = new Map([...list.children].filter((el) => el.dataset.key && !el.hasClass('is-leaving')).map((el) => [el.dataset.key, el]));
      const want = [];
      if (!all.length) {
        let e = old.get('empty');
        if (!e) {
          e = emptyState(list, this.todoFile() ? 'Nothing open in Todo ✦' : `No Todo note yet: the first task you add creates ${this.quickPath()}`);
          e.addClass('nt-fade-in');
          e.dataset.key = 'empty';
        }
        want.push(e);
      }
      const dup = new Map();
      all.slice(0, 60).forEach((t, i) => {
        const base = `${t.line}|${t.raw}`;
        const n = dup.get(base) || 0;
        dup.set(base, n + 1);
        const key = `${base}#${n}`;
        const sig = `${t.group}|${t.due}|${t.display}|${t.doing ? 1 : 0}|${t.pending ? 1 : 0}`;
        let row = old.get(key);
        if (row && row.dataset.sig === sig) row._t = t;
        else {
          const fresh = this.taskRow(list, t, i, true);
          fresh.dataset.key = key;
          fresh.dataset.sig = sig;
          if (row) row.replaceWith(fresh);
          else if (!first) fresh.addClass('is-new');
          row = fresh;
        }
        want.push(row);
      });
      patchList(list, want);
      first = false;
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },
});
/* @src src/tasks/widget-tasks.js */
Object.assign(NeonTasks.prototype, {
  /* tasks widget --------------------------------------------------------- */
  mountTasks(card) {
    const body = card.body;
    // fork: tasks from across your notes; the Todo note has its own card (with the add box)
    body.addClass('is-list'); // a column, the list filling it (styles.css)
    const list = body.createDiv('nt-list');
    button(card.actions, { icon: 'calendar-days', cls: 'nd-icon-btn', title: 'Open this period’s daily / weekly note', onClick: async () => openFile(this.app, await ensureToday(this.app)) });
    let token = 0;
    let first = true; // the first draw shows rows without the "new" animation
    let count = 0;
    const render = async () => {
      const my = ++token;
      const all = await this.collectTasks();
      if (my !== token || !list.isConnected) return;
      if (editingIn(list)) return; // redrawn when the edit ends
      this.openCount = all.length;
      this.openTasks = all; // fork: the Areas card counts open tasks per area
      const items = all.filter((t) => !t.quick); // Todo tasks are in the Todo card
      countUp(card.badge, count, items.length, (v) => (Math.round(v) ? String(Math.round(v)) : ''), 300);
      count = items.length;
      const old = new Map([...list.children].filter((el) => el.dataset.key && !el.hasClass('is-leaving')).map((el) => [el.dataset.key, el]));
      const want = [];
      if (!items.length) {
        let e = old.get('empty');
        if (!e) {
          e = emptyState(list, 'All clear ✦ no open tasks');
          e.addClass('nt-fade-in');
          e.dataset.key = 'empty';
          e.createDiv({ cls: 'nt-empty-hint', text: `Tasks are checkbox lines with ${this.settings.taskTag || 'the task tag'} in any note (Todo has its own card), plus notes tagged “tasks” and recent daily notes.` });
        }
        want.push(e);
      }
      let i = 0;
      const dup = new Map();
      for (const [g, label] of [['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later']]) {
        const group = items.filter((t) => t.group === g);
        if (!group.length) continue;
        const head = old.get(`g:${g}`) || list.createDiv({ cls: `nt-group is-${g}` });
        head.dataset.key = `g:${g}`;
        head.setText(`${label} · ${group.length}`);
        want.push(head);
        for (const t of group.slice(0, 40)) {
          const base = `${t.file.path}|${t.raw}`;
          const n = dup.get(base) || 0;
          dup.set(base, n + 1);
          const key = `${base}#${n}`;
          const sig = `${t.group}|${t.due}|${t.carried ? t.carried.format('YYYY-MM-DD') : ''}|${t.display}|${t.doing ? 1 : 0}`;
          let row = old.get(key);
          if (row && row.dataset.sig === sig) row._t = t;
          else {
            const fresh = this.taskRow(list, t, i);
            fresh.dataset.key = key;
            fresh.dataset.sig = sig;
            if (row) row.replaceWith(fresh); // same task, changed text: swap in place
            else if (!first) fresh.addClass('is-new');
            row = fresh;
          }
          i++;
          want.push(row);
        }
      }
      patchList(list, want);
      first = false;
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },
  taskRow(list, t, i, inTodo) {
    const row = list.createDiv('nt-task' + (t.pending ? ' is-pending' : '') + (t.doing ? ' is-doing' : ''));
    row._t = t; // handlers read the latest task: a kept row may have moved to another line
    row.style.setProperty('--i', String(Math.min(i, 20)));
    const box = row.createDiv('nt-check');
    tip(box, 'Done');
    // fork: the text gets the full width; the date and note sit on a smaller line underneath
    const body = row.createDiv('nt-body');
    const txt = body.createDiv({ cls: 'nt-text', text: t.display || t.raw });
    const meta = body.createDiv('nt-meta');
    const pri = planPriority(t.raw); // fork: the Tasks plugin's priority, shown as its emoji
    if (pri !== 2) tip(meta.createSpan({ cls: 'nt-pri', text: planPrioritySign(pri) }), `${PLAN_PRIORITIES.find((p) => p[0] === pri)[2]} priority`);
    if (t.due) {
      const d = moment(t.due);
      meta.createSpan({ cls: `nt-due is-${t.group}`, text: t.group === 'today' ? 'today' : d.format('D MMM') });
    } else if (t.carried) meta.createSpan({ cls: 'nt-due is-carried', text: `from ${t.carried.format('ddd')}` });
    if (t.doing) tip(box, 'In progress · click when done');
    const src = meta.createSpan({ cls: 'nt-src', text: inTodo ? '' : t.quick ? 'Todo' : t.file.basename });
    if (!meta.textContent) meta.remove();
    tip(src, t.file.path);
    const edit = row.createDiv('nt-del nt-edit-btn');
    setIcon(edit, 'pencil');
    tip(edit, 'Edit');
    box.addEventListener('click', async () => {
      if (row.hasClass('is-done') || row._t.pending) return;
      row.addClass('is-done');
      try {
        if ((await this.completeTask(row._t)) === false) (row.removeClass('is-done'), this.emit());
      } catch (e) {
        console.error(`${appName()} – Tasks: could not tick task`, e);
        new Notice('Could not tick the task');
        row.removeClass('is-done');
      }
    });
    const open = (e) => !row._t.pending && openFile(this.app, row._t.file, e, row._t.line);
    txt.addEventListener('click', open);
    src.addEventListener('click', open);
    if (row._t.file) hoverPreview(this.app, src, row._t.file, row._t.line); // the note's name: its page preview
    edit.addEventListener('click', () => {
      if (row._t.pending || row.querySelector('.nt-edit')) return;
      const inp = createEl('input', { cls: 'nd-input nt-edit', attr: { type: 'text' } });
      inp.value = row._t.raw; // the whole line text, so the 📅 date and tags can be changed too
      txt.replaceWith(inp);
      inp.focus();
      const done = async (save) => {
        if (!inp.isConnected) return;
        const v = inp.value.trim();
        inp.replaceWith(txt);
        if (save && v && v !== row._t.raw) {
          txt.setText(taskDisplay(v, this.settings.taskTag));
          try {
            if (!(await this.editTask(row._t, v))) txt.setText(row._t.display || row._t.raw);
          } catch (e) {
            console.error(`${appName()} – Tasks: could not edit task`, e);
            new Notice('Could not save the task');
            txt.setText(row._t.display || row._t.raw);
          }
        }
        this.emit();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) done(true);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          done(false);
        }
      });
      inp.addEventListener('blur', () => done(true));
    });
    return row;
  },

});
/* @src src/tasks/collect.js */
Object.assign(NeonTasks.prototype, {
  /* collecting tasks ----------------------------------------------------- */
  /** Old-style ticket notes keep their steps to themselves; projects' #task lines are normal tasks (fork). */
  isLegacyTicket(cache) {
    const fm = cache && cache.frontmatter;
    return !!fm && /^ticket$/i.test(String(fm.type || '').trim());
  },
  /** A note whose every open checkbox counts: tagged “tasks” in its properties. */
  isTaskSource(f, cache) {
    if (this.isLegacyTicket(cache)) return false;
    return fmTags(cache && cache.frontmatter).includes('tasks');
  },
  /** Could this note hold tasks we show? (cheap: metadata only) */
  mayHoldTasks(f, cache) {
    return !!(cache && cache.listItems && cache.listItems.some((li) => li.task === ' ' || li.task === '/'));
  },
  /**
   * Open tasks ([ ] and [/]) from: lines with the task tag anywhere (fork, Tasks-plugin style), notes tagged
   * “tasks”, the Todo note and recent daily/weekly notes. Excluded folders (archive, templates) are skipped.
   */
  async collectTasks() {
    const app = this.app;
    const today = moment().startOf('day');
    const todayKey = today.format('YYYY-MM-DD');
    const tag = (this.settings.taskTag || '').trim();
    const todo = this.quickPath();
    const deck = neonPlugin(app, 'neon-deck');
    const sources = new Map();
    for (const { file: f, cache } of noteIndex(app).withOpenTasks()) {
      if (this.isLegacyTicket(cache)) continue;
      // fork: tasks in a project note or project folder are the project's plan (Projects), not shown here
      if (this.settings.projectTasks !== 'all' && f.path !== todo && planScopeOf(app, f, cache)) continue;
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      const d = dailyDateOf(app, f);
      const daily = d && !d.isAfter(today) && today.diff(d, 'days') <= this.settings.carryDays ? d : null;
      // every open checkbox counts here; elsewhere only lines with the task tag
      const all = f.path === todo || this.isTaskSource(f, cache) || !!daily;
      if (!all && !tag) continue;
      sources.set(f.path, { f, cache, daily, all });
    }
    const out = [];
    for (const { f, cache, daily, all } of sources.values()) {
      const lis = cache.listItems.filter((li) => li.task === ' ' || li.task === '/');
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of lis) {
        const line = (lines[li.position.start.line] || '').replace(/\r$/, '');
        const m = line.match(TASK_LINE_RE);
        if (!m || !m[1].trim()) continue;
        const raw = m[1];
        if (!all && !hasTaskTag(raw, tag)) continue;
        const { due, group } = taskGroup(raw, daily, todayKey);
        out.push({
          file: f,
          line: li.position.start.line,
          raw,
          due,
          group,
          doing: li.task === '/',
          carried: daily && !daily.isSame(today, 'day') ? daily : null,
          display: taskDisplay(raw, tag),
          priority: planPriority(raw), // fork: the Tasks plugin's priority
          quick: f.path === todo,
        });
      }
    }
    // fork: by date, then highest priority first, then the most recently changed note
    out.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.priority - a.priority || b.file.stat.mtime - a.file.stat.mtime || a.line - b.line);
    this.sourcePaths = new Set(sources.keys());
    return out;
  },
  /** The Todo note's path (setting “Todo note”; the old Quick tasks setting). */
  quickPath() {
    const p = locPath(this.settings.quickTasksPath, 'Todo.md');
    return normalizePath(p.endsWith('.md') ? p : p + '.md');
  },
  todoFile() {
    const f = this.app.vault.getAbstractFileByPath(this.quickPath());
    return f instanceof TFile ? f : null;
  },
  /** Open tasks of the Todo note, in file order. */
  async collectTodo() {
    const f = this.todoFile();
    if (!f) return [];
    const cache = this.app.metadataCache.getFileCache(f);
    if (!cache || !cache.listItems) return [];
    const tag = (this.settings.taskTag || '').trim();
    const todayKey = moment().format('YYYY-MM-DD');
    const lines = (await this.app.vault.cachedRead(f)).split('\n');
    const out = [];
    for (const li of cache.listItems) {
      if (li.task !== ' ' && li.task !== '/') continue;
      const m = (lines[li.position.start.line] || '').replace(/\r$/, '').match(TASK_LINE_RE);
      if (!m || !m[1].trim()) continue;
      out.push({ file: f, line: li.position.start.line, raw: m[1], ...taskGroup(m[1], null, todayKey), doing: li.task === '/', carried: null, display: taskDisplay(m[1], tag), quick: true });
    }
    return out;
  },
  /** A new task line in Tasks-plugin form: “#task text ➕ YYYY-MM-DD” (tag and date only when missing). */
  taskLine(text) {
    const tag = (this.settings.taskTag || '').trim();
    const first = taskTags(tag)[0]; // fork: new tasks get the first task tag
    const withTag = first && !hasTaskTag(text, tag) ? `${first} ${text}` : text;
    const created = /➕\s*\d{4}-\d{2}-\d{2}/u.test(withTag) ? '' : ` ➕ ${moment().format('YYYY-MM-DD')}`;
    return `- [ ] ${withTag}${created}`;
  },
  async addQuickTask(text) {
    text = String(text || '').trim();
    if (!text) return;
    // shown at once; the real row takes its place once Obsidian has indexed the note
    const pend = { text, at: Date.now() };
    (this.pendingQuick = this.pendingQuick || []).push(pend);
    this.emit();
    try {
      await this.writeQuickTask(text);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error(`${appName()} – Tasks: could not add task`, e);
        new Notice('Could not add the task');
      }
      this.pendingQuick = this.pendingQuick.filter((x) => x !== pend);
      this.emit();
    }
  },
  /** fork: new tasks go at the head of the Todo note (made with a title if it doesn't exist yet). */
  async writeQuickTask(text) {
    const path = this.quickPath();
    let f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      await ensureFolder(this.app, path.split('/').slice(0, -1).join('/'));
      const day = moment().format('YYYY-MM-DD');
      f = await this.app.vault.create(path, `---\ntitle: Todo\ncreated: ${day}\nmodified: ${day}\n---\n`);
    }
    const line = this.taskLine(text);
    await writeNote(this.app, f, (d) => addTaskAtHead(d, line));
  },
  /** Rewrite one open task line in its note (item 15); the line must still be the task that was shown. */
  async editTask(t, raw) {
    let ok = false;
    await writeNote(this.app, t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      if (l === undefined || !OPEN_BOX_RE.test(l) || !l.includes(t.raw)) return data;
      lines[t.line] = l.replace(t.raw, () => raw);
      ok = true;
      return lines.join('\n');
    });
    if (!ok) new Notice('That task changed in the meantime — refreshed');
    return ok;
  },
  async completeTask(t) {
    const stamp = this.settings.stampDone ? ` ✅ ${moment().format('YYYY-MM-DD')}` : '';
    let ok = false;
    await writeNote(this.app, t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      // the line must still be this open task (the note may have changed since the list was drawn)
      if (l === undefined || !OPEN_BOX_RE.test(l) || !l.includes(t.raw)) return data;
      const cr = l.endsWith('\r') ? '\r' : '';
      const body = cr ? l.slice(0, -1) : l;
      lines[t.line] = body.replace(OPEN_BOX_RE, '[x]') + stamp + cr;
      ok = true;
      return lines.join('\n');
    });
    if (ok) this.logDone(t.display, t.file.path, t.due);
    else new Notice('That task changed in the meantime — refreshed');
    return ok;
  },
});
/* @src src/tasks/done.js */
/* ---- finished tasks, read from your notes (fork) ------------------------------------
 * Recently done, the "tasks done" fact and the weekly review count tasks ticked anywhere in Obsidian
 * (editor, Tasks plugin, these cards): a ticked line with a ✅ date. Read only, nothing is logged. */
const DONE_TASK_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s+(.*)$/;
const DONE_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const DONE_DAYS = 42; // the card shows 14 days; weekly reviews may look back a few weeks

/** A ticked task line → { date, raw }, or null (not ticked, or no ✅ date). */
function doneTaskOf(line) {
  const m = String(line || '').replace(/\r$/, '').match(DONE_TASK_RE);
  if (!m || !m[1].trim()) return null;
  const d = m[1].match(DONE_DATE_RE);
  return d ? { date: d[1], raw: m[1] } : null;
}

Object.assign(NeonTasks.prototype, {
  /** Ticked tasks with a ✅ date in the last DONE_DAYS days, newest first. */
  async scanDone() {
    const app = this.app;
    const cut = moment().startOf('day').subtract(DONE_DAYS, 'days');
    const cutKey = cut.format('YYYY-MM-DD');
    const deck = neonPlugin(app, 'neon-deck');
    const tag = (this.settings.taskTag || '').trim();
    const todo = this.quickPath();
    const out = [];
    for (const { file: f, cache } of noteIndex(app).withDoneTasks(cut.valueOf())) {
      if (this.isLegacyTicket(cache)) continue;
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of cache.listItems) {
        if (li.task !== 'x' && li.task !== 'X') continue;
        const d = doneTaskOf(lines[li.position.start.line]);
        if (!d || d.date < cutKey) continue;
        out.push({ date: d.date, text: taskDisplay(d.raw, tag), path: f.path, src: f.path === todo ? 'Todo' : f.basename, line: li.position.start.line });
      }
    }
    out.sort((a, b) => b.date.localeCompare(a.date) || a.src.localeCompare(b.src) || a.line - b.line);
    const sig = out.map((x) => `${x.date}|${x.path}|${x.line}|${x.text}`).join('\n');
    this.doneTasks = out;
    if (sig === this.doneSig) return;
    this.doneSig = sig;
    const api = deckApi(app);
    if (api) {
      if (api.activityChanged) api.activityChanged();
      if (api.factsChanged) api.factsChanged();
    }
  },
  /** Recently done rows for the dashboard. */
  doneActivity() {
    return (this.doneTasks || []).map((x) => {
      const f = this.app.vault.getAbstractFileByPath(x.path);
      return { t: moment(x.date, 'YYYY-MM-DD').valueOf(), allDay: true, kind: 'task', text: x.text, src: x.src, open: f ? (e) => openFile(this.app, f, e) : null };
    });
  },
  /** Tasks ticked between two moments (by their ✅ date). */
  doneBetween(start, end) {
    const a = start.format('YYYY-MM-DD');
    const b = end.format('YYYY-MM-DD');
    return (this.doneTasks || []).filter((x) => x.date >= a && x.date < b).length;
  },
});
return NeonTasks;
})();
/* ==== module neon-time ==== */
const NeonTimeModule = (() => {
/* @src src/time/constants.js */

/* =========================================================================
 * TIME — active time per category, manual entries, overtime and one
 * log note per day for your AI agent. Never talks to Jira or the network.
 * ========================================================================= */
const VIEW_TIME = 'neon-time';
// fork: categories can change (customers), so time categories are read when needed: timeCats()
const TIME_DEFAULTS = {
  tracking: true,
  logFolder: '', // fork: '' = <base folder>/Time Log
  writeNotes: true,
  dayHours: 8,
  idleMin: 30,
  workIdleH: 2, // a started workday ends by itself after this many hours without input
  wrapLead: 30,
  installedAt: 0,
  days: {}, // 'YYYY-MM-DD' -> { entries: [], done: [], tomorrow, wrapped }
};
const SOURCES = ['auto', 'manual', 'ticket'];
let entrySeq = 0;
const newId = () => `${Date.now().toString(36)}${(entrySeq++).toString(36)}`;
const entryMin = (e) => Math.round(e.ms / 60000);
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/* @src src/time/entry-modal.js */
/* ---- manual entry / edit -------------------------------------------------- */
/** "930", "0930", "9:5", "9.30", "14" -> "09:30", "09:30", "09:05", "09:30", "14:00"; null when it isn't a time. */
function parseClock(s) {
  const t = String(s || '').trim();
  const m = /^(\d{1,2})(?:[:.h ](\d{1,2}))?$/.exec(t) || /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null;
  return `${m[1].padStart(2, '0')}:${(m[2] || '0').padStart(2, '0')}`;
}
/** Date plus From / Until clock text -> { start, ms }, or { bad: 'from' | 'until' }; Until at or before From means the
 *  next day (23:30 -> 00:30 is 1 h), max 16 h. */
function entryRange(date, from, until) {
  const f = parseClock(from);
  if (!f) return { bad: 'from' };
  const u = parseClock(until);
  if (!u) return { bad: 'until' };
  const s = moment(`${date} ${f}`, 'YYYY-MM-DD HH:mm', true);
  const e = moment(`${date} ${u}`, 'YYYY-MM-DD HH:mm', true);
  if (!s.isValid()) return { bad: 'from' };
  if (!e.isAfter(s)) e.add(1, 'day'); // crosses midnight (moment keeps the clock time across DST)
  const n = e.diff(s, 'minutes');
  return n > 0 && n <= 960 ? { start: s.valueOf(), ms: n * 60000 } : { bad: 'until' };
}
class EntryModal extends Modal {
  /** entry: existing entry to edit (with .day), or a partial one for a new entry */
  constructor(plugin, entry, isNew, isBreak = false) {
    super(plugin.app);
    Object.assign(this, { plugin, entry, isNew, isBreak });
  }
  onOpen() {
    const p = this.plugin;
    const e = this.entry;
    this.modalEl.addClass('nd-modal', 'tm-modal');
    this.titleEl.setText(this.isBreak ? 'Log a break' : this.isNew ? 'Add time' : 'Edit time entry');
    const c = this.contentEl;
    const field = (label, parent = c) => {
      const f = parent.createDiv('tm-field');
      f.createDiv({ cls: 'tm-label', text: label });
      return f;
    };
    const row = c.createDiv('tm-row');
    // From / Until: you say when you finished, not how many minutes it took
    let s0;
    let s1;
    if (e.ms) (s0 = moment(e.start)), (s1 = moment(e.start + e.ms));
    else if (e.start) (s0 = moment(e.start)), (s1 = moment(e.start).add(this.isBreak ? 15 : 30, 'minutes'));
    else {
      // today: ends now, or for a break where work stopped (an open pause or End day)
      const w = this.isBreak && p.workOf(moment().format('YYYY-MM-DD'));
      const open = w && w.breaks.find((x) => x[1] == null);
      s1 = moment(w ? Math.min(Date.now(), w.end || Infinity, open ? open[0] : Infinity) : Date.now());
      s0 = s1.clone().subtract(this.isBreak ? 15 : 30, 'minutes');
    }
    const date = field('Date', row).createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    date.value = s0.format('YYYY-MM-DD');
    const clockField = (label, m) => {
      const el = field(label, row).createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. 930 or 9:30', 'aria-label': label } });
      el.value = m.format('HH:mm');
      el.addEventListener('blur', () => {
        const v = parseClock(el.value);
        if (v) el.value = v;
      });
      return el;
    };
    const from = clockField('From', s0);
    const until = clockField('Until', s1);
    const dur = c.createDiv('tm-dur');
    const showDur = () => {
      const r = entryRange(date.value, from.value, until.value);
      for (const el of [from, until]) el.removeClass('is-invalid');
      dur.setText(r.bad ? (parseClock(from.value) && parseClock(until.value) ? 'Over 16 h — check From and Until' : '') : `= ${fmtMin(r.ms / 60000)}`);
      dur.toggleClass('is-bad', !!r.bad);
    };
    for (const el of [date, from, until]) el.addEventListener('input', showDur);
    const shown = () => [date.value, from.value, until.value].join('|');
    const initial = shown(); // an edit that leaves the times alone keeps the exact start and length
    showDur();
    // quick lengths count back from Until
    const quick = c.createDiv('nd-pills tm-chips');
    for (const n of [15, 30, 45, 60, 90, 120]) {
      const b = quick.createEl('button', { cls: 'nd-pill-btn', text: fmtMin(n), attr: { type: 'button', title: `From = Until − ${fmtMin(n)}` } });
      b.addEventListener('click', () => {
        const u = parseClock(until.value);
        if (!u) return until.addClass('is-invalid');
        from.value = moment(`${date.value} ${u}`, 'YYYY-MM-DD HH:mm').subtract(n, 'minutes').format('HH:mm');
        showDur();
      });
    }
    let cat;
    let note;
    if (!this.isBreak) {
      cat = pills(field('Category'), timeCats().map((k) => [k, CAT_LABEL[k]]), normCat(e.cat) || 'operations', null, 'tm-cats');
      for (const k of timeCats()) cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
      note = field('What did you do?').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. Customer call' } });
      note.value = e.note || '';
    }

    const foot = c.createDiv('nd-modal-row');
    if (!this.isNew)
      button(foot, {
        icon: 'trash-2',
        text: 'Delete',
        cls: 'tm-del',
        onClick: () => {
          this.close();
          p.deleteEntry(e);
        },
      });
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const save = () => {
      if (!moment(date.value, 'YYYY-MM-DD', true).isValid()) return date.addClass('is-invalid');
      const r = entryRange(date.value, from.value, until.value);
      if (r.bad) return (r.bad === 'from' ? from : until).addClass('is-invalid');
      const v = e.ms && shown() === initial ? { start: e.start, ms: e.ms } : { start: r.start, ms: r.ms };
      if (this.isBreak) {
        if (p.addBreak(v)) this.close();
        return;
      }
      this.close();
      Object.assign(v, { cat: cat.get() || 'other', note: note.value.trim(), jira: e.jira || '' });
      if (this.isNew) p.addEntry({ ...v, path: e.path || '', source: e.source || 'manual' });
      else p.updateEntry(e, v);
    };
    button(foot, { text: this.isNew ? 'Add' : 'Save', cls: 'mod-cta', onClick: save });
    c.addEventListener('keydown', (ev) => {
      // Enter saves from the fields only; on a focused button (Delete, Cancel, a chip) it presses that button
      if (ev.key === 'Enter' && !ev.isComposing && ev.target instanceof HTMLInputElement) {
        ev.preventDefault();
        save();
      }
    });
    window.setTimeout(() => (this.isNew && !e.note && note ? note : until).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* @src src/time/wrap-up.js */
/* ---- wrap up ------------------------------------------------------------ */
class WrapUpModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    const p = this.plugin;
    const key = moment().format('YYYY-MM-DD');
    const sum = p.summary(key, true);
    const day = p.day(key);
    this.modalEl.addClass('nd-modal', 'tm-wrap');
    this.titleEl.setText(`Wrap up · ${moment().format('dddd D MMM')}`);
    const c = this.contentEl;
    const top = c.createDiv('tm-wrap-top');
    p.donut(top, sum, 96, true);
    const bars = top.createDiv('tm-legend');
    p.legend(bars, sum);
    const facts = c.createDiv('tm-wrap-facts');
    const fact = (v, l, cls = '') => {
      const f = facts.createDiv(`tm-fact ${cls}`);
      f.createDiv({ cls: 'tm-fact-v', text: String(v) });
      f.createDiv({ cls: 'tm-fact-l', text: l });
    };
    fact(fmtMin(sum.total), sum.target ? `of ${fmtMin(sum.target)}` : 'weekend');
    fact(sum.over ? `+${fmtMin(sum.over)}` : '—', 'overtime', sum.over ? 'is-over' : '');
    fact(day.done.filter((d) => d.kind === 'task').length, 'tasks done');
    fact(new Set(day.done.filter((d) => d.kind === 'ticket').map((d) => d.ref)).size, 'projects moved');
    c.createDiv({ cls: 'tm-label', text: 'A line about tomorrow' });
    const ta = c.createEl('textarea', { cls: 'nd-input', attr: { rows: '2', placeholder: 'Start with…' } });
    ta.value = day.tomorrow || '';
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    button(row, {
      text: 'Save to log',
      cls: 'mod-cta',
      onClick: async () => {
        day.tomorrow = ta.value.trim();
        day.wrapped = true;
        this.close();
        p.closeSession();
        p.workEnd(key);
        p.changed(key);
        await p.writeDay(key, true);
        new Notice('✦ Day wrapped up. Nice work.');
      },
    });
    window.setTimeout(() => ta.focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* @src src/time/time-view.js */
/* ---- Time tab ------------------------------------------------------------ */
class TimeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.cursor = moment().startOf('day');
  }
  getViewType() {
    return VIEW_TIME;
  }
  getDisplayText() {
    return 'Time';
  }
  getIcon() {
    return 'clock';
  }
  async onOpen() {
    addHelpAction(this, 'time'); // fork: the ? button in the header (src/shared/help.js)
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'tm-view');
    this.scroller = this.contentEl.createDiv('tm-scroll');
    this.first = true;
    this.mountPattern();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountPattern()));
    const soon = debounce(() => this.render(), 300, true);
    this.register(this.plugin.onChange((now) => (now ? this.render() : soon())));
    this.registerInterval(window.setInterval(() => this.render(), 60 * 1000));
    this.render();
  }
  async onClose() {
    this.unmountPattern();
    this.contentEl.empty();
  }
  /** The dashboard's dot pattern behind the cards, when the Dashboard module is on. */
  mountPattern() {
    this.unmountPattern();
    const api = deckApi(this.app);
    if (api && api.mountPattern) this.pattern = api.mountPattern(this.contentEl, this.scroller, '.tm-panel');
  }
  unmountPattern() {
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }
  /** A dashboard-style card. Returns the card parts; body gets cls. */
  card(parent, cls, title, ic, sub) {
    const w = widget(parent, 'tm-panel', title, ic, sub);
    w.body.addClass(cls);
    return w;
  }
  render() {
    const p = this.plugin;
    const sc = this.scroller;
    const scroll = sc.scrollTop;
    sc.empty();
    const root = sc.createDiv('tm-inner');
    if (this.first) {
      this.first = false;
      root.addClass('is-entering');
      window.setTimeout(() => root.removeClass('is-entering'), 900);
    }
    const key = this.cursor.format('YYYY-MM-DD');
    const isToday = this.cursor.isSame(moment(), 'day');
    const sum = p.summary(key, isToday);

    const head = root.createDiv('nd-hero tm-head');
    const nav = head.createDiv('tm-nav');
    nav.createDiv({ cls: 'nd-hero-greet', text: 'Time' });
    button(nav, { icon: 'chevron-left', cls: 'nd-icon-btn', title: 'Previous day', onClick: () => this.go(-1) });
    nav.createDiv({ cls: 'nd-hero-date tm-date', text: this.cursor.format('dddd D MMM YYYY') });
    button(nav, { icon: 'chevron-right', cls: 'nd-icon-btn', title: 'Next day', onClick: () => this.go(1) });
    if (!isToday) button(nav, { text: 'Today', onClick: () => ((this.cursor = moment().startOf('day')), this.render()) });
    const acts = head.createDiv('tm-acts');
    button(acts, { icon: 'plus', text: 'Add time', cls: 'mod-cta', onClick: () => p.newEntry({ start: isToday ? undefined : this.cursor.clone().hour(9).valueOf() }) });
    if (p.workOf(key)) button(acts, { icon: 'coffee', text: 'Log break', onClick: () => new EntryModal(p, { start: isToday ? undefined : this.cursor.clone().hour(12).valueOf() }, true, true).open() });
    if (isToday) p.workButton(acts);
    if (isToday) button(acts, { icon: 'sunset', text: 'Wrap up', onClick: () => new WrapUpModal(p).open() });
    button(acts, { icon: 'file-text', text: 'Log note', onClick: () => p.openDayNote(key) });

    const top = root.createDiv('tm-top');
    const today = this.card(top, 'tm-today', isToday ? 'Today' : 'This day', 'pie-chart', sum.target ? `${fmtMin(sum.total)} of ${fmtMin(sum.target)}` : fmtMin(sum.total)).body;
    // a new day on screen (or the tab just opened): the ring draws in and entries rise in
    const intro = key !== this.shownKey;
    this.shownKey = key;
    p.donut(today, sum, 150, intro);
    p.legend(today.createDiv('tm-legend'), sum);

    const bal = this.card(top, 'tm-balance', 'Balance', 'scale').body;
    const wk = p.balance(this.cursor.clone().startOf('isoWeek'), this.cursor.clone().endOf('isoWeek'));
    const mo = p.balance(this.cursor.clone().startOf('month'), this.cursor.clone().endOf('month'));
    const bl = (v, l) => {
      const b = bal.createDiv(`tm-bal ${v > 0 ? 'is-over' : v < 0 ? 'is-under' : ''}`);
      b.createDiv({ cls: 'tm-bal-v', text: `${v > 0 ? '+' : ''}${fmtMin(v)}` });
      b.createDiv({ cls: 'tm-label', text: l });
    };
    bl(wk.balance, `week ${this.cursor.isoWeek()} balance`);
    bl(mo.balance, `${this.cursor.format('MMMM')} balance`);
    bal.createDiv({ cls: 'tm-hint', text: `${fmtMin(wk.total)} this week · only days with tracked time count` });

    // week strip
    const week = this.card(root, 'tm-week', `Week ${this.cursor.isoWeek()}`, 'calendar-days', 'click a day to open it').body;
    const ws = this.cursor.clone().startOf('isoWeek');
    const days = [...Array(7)].map((_, i) => ws.clone().add(i, 'days'));
    const sums = days.map((d) => p.summary(d.format('YYYY-MM-DD'), d.isSame(moment(), 'day')));
    // scale to the weekday target (not today's, which is 0 on weekends) so the target line stays inside the bar
    const max = Math.max(Math.round(p.settings.dayHours * 60), ...sums.map((s) => s.total)) || 1;
    for (let i = 0; i < 7; i++) {
      const d = days[i];
      const s = sums[i];
      const col = week.createDiv('tm-col' + (d.isSame(this.cursor, 'day') ? ' is-cursor' : ''));
      const bar = col.createDiv('tm-col-bar');
      if (s.target) bar.createDiv('tm-col-target').style.bottom = `${(s.target / max) * 100}%`;
      for (const k of timeCats()) {
        if (!s.by[k]) continue;
        const seg = bar.createDiv('tm-col-seg');
        seg.style.height = `${(s.by[k] / max) * 100}%`;
        seg.style.background = catColor(k);
      }
      // workday time not covered by an entry (issue 54)
      if (s.untracked > 0) {
        const seg = bar.createDiv('tm-col-seg');
        seg.style.height = `${(s.untracked / max) * 100}%`;
        seg.style.background = 'var(--nd-cat-untracked, var(--text-faint))';
      }
      col.createDiv({ cls: 'tm-col-v', text: s.total ? fmtMin(s.total) : '·' });
      col.createDiv({ cls: 'tm-col-d', text: d.format('dd D') });
      tip(col, `${d.format('ddd D MMM')} · ${fmtMin(s.total)}${s.over ? ` · +${fmtMin(s.over)} over` : ''}`);
      col.addEventListener('click', () => ((this.cursor = d.clone()), this.render()));
    }

    // entries
    const ec = this.card(root, 'tm-entries', 'Entries', 'list');
    const list = ec.body;
    if (isToday && p.session) ec.actions.createDiv({ cls: 'tm-live', text: `● tracking ${p.session.name}` });
    const entries = p.entriesOf(key, isToday).reverse(); // newest on top; entriesOf returns a fresh array
    if (!entries.length) emptyState(list, isToday ? 'Nothing tracked yet today. Work in a note and time counts by itself.' : 'Nothing tracked on this day.');
    entries.forEach((e, idx) => {
      const r = list.createDiv('tm-entry' + (e.live ? ' is-live' : '') + (intro ? ' is-intro' : ''));
      r.style.setProperty('--i', String(idx));
      r.style.setProperty('--cat', catColor(e.cat));
      r.createSpan({ cls: 'tm-entry-at', text: moment(e.start).format('HH:mm') });
      r.createSpan({ cls: 'tm-entry-min', text: fmtMin(entryMin(e)) });
      r.createSpan({ cls: 'tm-entry-cat', text: CAT_LABEL[e.cat] || 'Other' });
      const t = r.createSpan({ cls: 'tm-entry-note', text: e.note || (e.path ? e.path.split('/').pop().replace(/\.md$/, '') : '—') });
      if (e.path) {
        t.addClass('is-link');
        t.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(e.path);
          if (f instanceof TFile) openFile(this.app, f);
        });
      }
      r.createSpan({ cls: `tm-entry-src s-${e.source}`, text: e.live ? 'live' : e.source });
      const a = r.createDiv('tm-entry-acts');
      if (!e.live) button(a, { icon: 'pencil', cls: 'nd-icon-btn', title: 'Edit', onClick: () => new EntryModal(p, e, false).open() });
      button(a, { icon: 'trash-2', cls: 'nd-icon-btn', title: e.live && !e.savedId ? 'Discard live time' : 'Delete', onClick: () => p.deleteEntry(e) });
    });
    const day = p.days[key];
    if (day && day.tomorrow) {
      const t = this.card(root, 'tm-tomorrow', 'Note for tomorrow', 'sunrise').body;
      t.createDiv({ text: day.tomorrow });
    }
    madeWith(root.createDiv('tm-foot'));
    sc.scrollTop = scroll;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  go(n) {
    this.cursor.add(n, 'days');
    this.render();
  }
}

/* @src src/time/settings.js */
/* ---- settings ---------------------------------------------------------- */
class NeonTimeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = () => p.saveSettings();
    containerEl.empty();
    containerEl.addClass('nd-settings');
    new Setting(containerEl).setName('Tracking').setHeading();
    new Setting(containerEl)
      .setName('Track time automatically')
      .setDesc('Counts while a note is the focused tab and you type, scroll or click in it. Category comes from the projects / school / admin / operations checkbox (or tag). untracked: true notes are never logged.')
      .addToggle((t) => t.setValue(s.tracking).onChange((v) => p.setTracking(v)));
    numSetting(new Setting(containerEl).setName('Idle cutoff (minutes)').setDesc('Time keeps counting while you are in another app. After this long without typing, scrolling or clicking in Obsidian it stops at your last activity, and the idle time is dropped.'), s, 'idleMin', 1, 120, () => (save(), p.readmeSoon()));
    numSetting(new Setting(containerEl).setName('End an idle workday after (hours)').setDesc('A started workday ends by itself at your last activity after this long without input in Obsidian.'), s, 'workIdleH', 1, 12, () => save());
    numSetting(new Setting(containerEl).setName('Workday (hours)').setDesc('Weekday target. Time past it counts as overtime. Weekend time is all overtime.'), s, 'dayHours', 1, 16, () => (save(), p.emit(), p.readmeSoon()));
    numSetting(new Setting(containerEl).setName('Wrap up shows (minutes before the target)'), s, 'wrapLead', 0, 240, save);
    new Setting(containerEl).setName('Log notes').setHeading();
    new Setting(containerEl)
      .setName('Write a log note per day')
      .setDesc('Totals, a Done today list and a table of entries, for an AI agent (or you) to read. Nothing is sent anywhere.')
      .addToggle((t) => t.setValue(s.writeNotes).onChange((v) => ((s.writeNotes = v), save())));
    new Setting(containerEl)
      .setName('Log folder')
      .setDesc(`Empty: ${basePath('Time Log')} (in the base folder).`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Time Log')).setValue(s.logFolder).onChange((v) => ((s.logFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'))
      .addExtraButton((b) => b.setIcon('refresh-cw').setTooltip('Write today’s note now').onClick(() => p.writeDay(moment().format('YYYY-MM-DD'), true)));
    madeWith(containerEl);
  }
}

/* @src src/time/plugin.js */
/* ---- plugin ------------------------------------------------------------- */
class NeonTime extends Plugin {
  async onload() {
    this.listeners = new Set();
    this.dirty = new Set();
    this.session = null;
    // short bits of work per note (under a minute so far); they add up instead of being dropped
    this.pending = new Map();
    await this.loadSettings();
    // 1.6.6: tracking keeps going in the background, so the old 2-minute default becomes 30
    // (idleRule is not in the defaults, so only saved data says it was migrated)
    if ((this.settings.idleRule || 0) < 2) {
      if (this.settings.idleMin === 2) this.settings.idleMin = 30;
      this.settings.idleRule = 2;
    }
    this.days = this.settings.days;
    // old saved entries: ops -> operations
    for (const d of Object.values(this.days || {})) for (const e of d.entries || []) e.cat = normCat(e.cat);

    this.registerView(VIEW_TIME, (leaf) => new TimeView(leaf, this));
    this.addRibbonIcon('clock', `${appName()} – Time`, () => this.openTab());
    this.addCommand({ id: 'open-time', name: 'Open Time tab', callback: () => this.openTab() });
    this.addCommand({ id: 'add-time', name: 'Add time by hand', callback: () => this.newEntry({}) });
    this.addCommand({ id: 'wrap-up', name: 'Wrap up the day', callback: () => new WrapUpModal(this).open() });
    this.addCommand({ id: 'write-log', name: 'Write today’s time log note now', callback: () => this.writeDay(moment().format('YYYY-MM-DD'), true) });
    this.addCommand({
      id: 'toggle-tracking',
      name: 'Pause / resume automatic tracking',
      callback: () => {
        this.setTracking(!this.settings.tracking);
        new Notice(this.settings.tracking ? '⏱ Time tracking on' : '⏸ Time tracking paused');
      },
    });
    this.addSettingTab(new NeonTimeSettingTab(this.app, this));

    // activity in the focused note keeps the session alive
    // every window counts: the main one and notes moved to a new window (popouts)
    const touch = (e) => this.touch(e);
    const watched = new WeakSet();
    const watch = (win) => {
      if (!win || watched.has(win)) return;
      watched.add(win);
      const doc = win.document;
      this.registerDomEvent(doc, 'keydown', touch, true);
      this.registerDomEvent(doc, 'mousedown', touch, true);
      this.registerDomEvent(doc, 'wheel', touch, { capture: true, passive: true });
      this.registerDomEvent(doc, 'scroll', touch, { capture: true, passive: true });
      // leaving Obsidian keeps the session open: time away counts if you're back within the idle
      // cutoff, else the session ends at the last activity (checked on return and every 15 s)
      this.registerDomEvent(win, 'focus', () => this.tick());
      this.registerDomEvent(doc, 'visibilitychange', () => !doc.hidden && this.tick());
    };
    watch(window);
    this.registerEvent(this.app.workspace.on('window-open', (_w, win) => watch(win)));
    this.app.workspace.onLayoutReady(() => this.app.workspace.iterateAllLeaves((l) => watch(l.view.containerEl.win)));
    // switching tabs ends the session, unless it's still the same note
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const v = this.activeFileView();
        if (this.session && v && v.file && v.file.path === this.session.path) return;
        this.closeSession();
      }),
    );
    this.registerInterval(window.setInterval(() => this.tick(), 15 * 1000));
    // a note's category can change while you work in it (e.g. untracked ticked)
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        const s = this.session;
        const inSession = s && s.path === file.path;
        if (!inSession && !this.pending.has(file.path)) return;
        const cat = this.trackCat(file);
        if (!cat) return this.dropTracking(file.path);
        const pd = this.pending.get(file.path);
        if (pd) pd.cat = cat;
        // new category: save the time so far, the next activity starts a fresh session
        if (inSession && s.cat !== cat) this.closeSession();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('neon:time-entry', (v) => {
        if (!v || !(v.min > 0)) return;
        this.addEntry({ start: v.start, ms: v.min * 60000, cat: normCat(v.cat) || 'operations', note: v.note || '', path: v.path || '', jira: v.jira || '', source: SOURCES.includes(v.source) ? v.source : 'manual' }, true);
      }),
    );
    this.registerEvent(this.app.workspace.on('neon:task-done', (v) => v && this.addDone({ kind: 'task', text: v.text })));
    this.registerEvent(
      this.app.workspace.on('neon:project-changed', (v) => {
        if (!v) return;
        // fork: a project changed (its properties); one line per project per day
        const path = (v.file && v.file.path) || '';
        this.addDone({ kind: 'ticket', ref: path || v.title, path, text: String(v.title || '').trim(), change: v.change });
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f, old) => {
        let hit = false;
        for (const d of Object.values(this.days)) {
          for (const e of d.entries || []) if (e.path === old) ((e.path = f.path), (hit = true));
          for (const x of d.done || []) {
            if (x.ref === old) ((x.ref = f.path), (hit = true));
            if (x.path === old) ((x.path = f.path), (hit = true));
          }
        }
        if (this.session && this.session.path === old) this.session.path = f.path;
        if (this.pending.has(old)) (this.pending.set(f.path, this.pending.get(old)), this.pending.delete(old));
        if (hit) this.saveSoon();
      }),
    );

    this.buildStatus();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.hookCore();
      this.ensureReadme();
    });
  }
  onunload() {
    this.closeSession();
    // keep short bits of work that haven't reached a minute yet
    for (const k of this.flushPending()) this.dirty.add(k);
    for (const k of this.dirty) this.writeDay(k);
    this.saveData(this.settings);
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('time');
      api.unregisterCapture('time');
      api.unregisterFacts('time');
      api.unregisterWeekLine('time');
      api.unprovide('timeDay');
      api.unregisterAction('time');
      api.unregisterExcluded('time');
    }
  }
  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, TIME_DEFAULTS, data);
    if (!this.settings.days || typeof this.settings.days !== 'object') this.settings.days = {};
    if (dropOldDefaults(this.app, this.settings, { logFolder: 'Neon/Time Log' })) await this.saveData(this.settings); // fork: base folder
    if (!this.settings.installedAt) {
      this.settings.installedAt = Date.now();
      await this.saveData(this.settings);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._save) this._save = debounce(() => this.saveData(this.settings), 2000, true);
    this._save();
  }
  /** now: a click, so views redraw at once instead of after their batching delay. */
  emit(now) {
    for (const fn of this.listeners) fn(now);
    this.updateStatus();
    const api = deckApi(this.app);
    if (api) api.factsChanged();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Something changed on a day: save, refresh, and rewrite its log note soon. */
  changed(key, now) {
    this.saveSoon();
    this.dirty.add(key);
    if (!this._write) this._write = debounce(() => this.flush(), 20 * 1000, true);
    this._write();
    this.emit(now);
  }
  async flush() {
    const ed = this.app.workspace.activeEditor;
    const editing = ed && ed.file ? ed.file.path : null;
    const keys = [...this.dirty].filter((k) => this.dayNotePath(k) !== editing);
    for (const k of keys) this.dirty.delete(k);
    if (this.dirty.size && this._write) this._write(); // the open note is written once the user leaves it
    for (const k of keys) await this.writeDay(k);
  }

  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'time', slot: 'time', title: 'Time today', icon: 'clock', sub: this.widgetSub(), open: () => this.openTab(), openTitle: 'Open the Time tab', mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'time', label: 'Time entry', short: 'Time', icon: 'clock', order: 30, allowEmpty: true, run: (v) => this.newEntry({ note: v }) });
    api.registerAction({ id: 'time', icon: 'clock', label: 'Time', order: 40, view: VIEW_TIME, run: () => this.openTab() });
    api.registerExcluded('time', () => [this.logFolder()]);
    api.registerFacts('time', () => {
      const s = this.summary(moment().format('YYYY-MM-DD'), true);
      const out = [];
      const top = timeCats().filter((k) => s.by[k]).sort((a, b) => s.by[b] - s.by[a]);
      for (const k of top.slice(0, 2)) out.push({ v: fmtMin(s.by[k]), l: `${CAT_LABEL[k].toLowerCase()} today` });
      const wk = this.balance(moment().startOf('isoWeek'), moment().endOf('isoWeek'));
      if (wk.over) out.push({ v: fmtMin(wk.over), l: 'overtime this week' });
      return out;
    });
    // the dashboard's Activity timeline reads a day's worked time and entries from here
    api.provide('timeDay', (key) => {
      const s = this.summary(key, key === moment().format('YYYY-MM-DD'));
      return { worked: s.total, target: s.target, over: s.over, entries: this.entriesOf(key, false).map((e) => ({ start: e.start, min: entryMin(e), text: e.note || (e.path ? e.path.split('/').pop().replace(/\.md$/, '') : CAT_LABEL[e.cat] || 'Time') })) };
    });
    if (api.activityChanged) api.activityChanged(); // the Activity card can now show worked time
    api.registerWeekLine('time', (start, end) => {
      const by = {};
      let over = 0;
      for (let d = start.clone(); d.isBefore(end); d.add(1, 'day')) {
        const s = this.summary(d.format('YYYY-MM-DD'), false);
        for (const k of timeCats()) by[k] = (by[k] || 0) + s.by[k];
        over += s.over;
      }
      const top = timeCats().filter((k) => by[k]).sort((a, b) => by[b] - by[a])[0];
      const out = [];
      if (top) out.push(`mostly ${CAT_LABEL[top]}`);
      if (over) out.push(`${fmtMin(over)} overtime`);
      return out;
    });
  }

  widgetSub() {
    return `Active time · ${fmtMin(Math.round(this.settings.dayHours * 60))} day`;
  }

  /* ---- UI --------------------------------------------------------------- */
  async openTab() {
    await activateView(this.app, VIEW_TIME, 'tab');
  }
  buildStatus() {
    const el = (this.statusEl = this.addStatusBarItem());
    el.addClass('nd-status', 'tm-status', 'mod-clickable');
    setIcon(el.createSpan('nd-status-icon'), 'clock');
    this.statusTxt = el.createSpan('nd-status-text');
    el.addEventListener('click', () => this.openTab());
    this.updateStatus();
  }
  updateStatus() {
    if (!this.statusEl) return;
    const s = this.summary(moment().format('YYYY-MM-DD'), true);
    this.statusTxt.setText(this.settings.tracking ? fmtMin(s.total) : `${fmtMin(s.total)} · paused`);
    this.statusEl.toggleClass('is-running', !!this.session);
    tip(this.statusEl, this.session ? `Tracking ${this.session.name} · ${CAT_LABEL[this.session.cat]}` : 'Time today · click for the Time tab');
  }
}
/* @src src/time/widget.js */
Object.assign(NeonTime.prototype, {
  /** SVG donut: categories against the day target, overtime as an accent slice. */
  /** intro: segments draw in one after another and the total counts up (first paint only). */
  donut(parent, sum, size, intro = false) {
    const wrap = parent.createDiv('tm-donut' + (intro ? ' is-intro' : ''));
    wrap.style.setProperty('--size', `${size}px`);
    const svg = wrap.createSvg('svg', { attr: { viewBox: '0 0 120 120', width: String(size), height: String(size) } });
    const R = 50;
    const C = 2 * Math.PI * R;
    svg.createSvg('circle', { cls: 'tm-donut-track', attr: { cx: '60', cy: '60', r: String(R) } });
    // breaks always get room: once the day is full the ring stretches to fit them (issue 52)
    const base = Math.max(sum.target || sum.total, sum.total + (sum.breaks || 0)) || 1;
    const within = Math.min(sum.total, sum.target || sum.total);
    const scale = sum.total ? within / sum.total : 0;
    const slices = timeCats().filter((k) => sum.by[k]).map((k) => [catColor(k), sum.by[k] * scale]);
    if (sum.untracked) slices.push(['var(--nd-cat-untracked, var(--text-faint))', sum.untracked * scale]);
    if (sum.over && sum.target) slices.push(['var(--nd-cat-over, var(--nd-warn))', sum.over, true]);
    // breaks follow the worked time on the ring; they never count as worked
    if (sum.breaks) slices.push(['var(--nd-cat-break)', sum.breaks, false, true]);
    const gap = slices.length > 1 ? 1.2 : 0;
    let off = 0;
    let i = 0;
    for (const [color, v, isOver, isBreak] of slices) {
      const len = (v / base) * C;
      if (len > gap) {
        // createSvg takes one class per string (a space throws), so add is-over separately
        const c = svg.createSvg('circle', { cls: 'tm-donut-seg', attr: { cx: '60', cy: '60', r: String(R) } });
        if (isOver) c.classList.add('is-over');
        if (isBreak) c.classList.add('is-break');
        c.style.stroke = color;
        c.style.setProperty('--i', String(i++));
        c.setAttribute('stroke-dasharray', `${len - gap} ${C - len + gap}`);
        c.setAttribute('stroke-dashoffset', String(-off));
      }
      off += len;
    }
    const mid = wrap.createDiv('tm-donut-mid');
    const v = mid.createDiv({ cls: 'tm-donut-v' });
    if (intro) countUp(v, 0, sum.total, (x) => fmtMin(Math.round(x)), 900);
    else v.setText(fmtMin(sum.total));
    // small rings have no room for the word "over"; the accent colour says it
    const overText = `+${fmtMin(sum.over)}${size >= 140 ? ' over' : ''}`;
    const l = mid.createDiv({ cls: 'tm-donut-l', text: !sum.target ? 'weekend' : sum.over ? overText : `of ${fmtMin(sum.target)}` });
    if (sum.target && sum.over) l.addClass('is-over');
    return wrap;
  },
  legend(el, sum) {
    const w = sum.work !== 'none' && this.workOf(sum.key);
    if (w) {
      const text = { running: `Working since ${moment(w.start).format('HH:mm')}`, paused: 'On a break', ended: `Day ended ${moment(w.end).format('HH:mm')}` }[sum.work];
      el.createDiv({ cls: `tm-work is-${sum.work}`, text: `${text} · timer ${fmtMin(this.workMin(sum.key))}` });
    }
    for (const k of timeCats()) {
      if (!sum.by[k] && k === 'other') continue;
      const r = el.createDiv('tm-leg' + (sum.by[k] ? '' : ' is-zero'));
      r.style.setProperty('--cat', catColor(k));
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: CAT_LABEL[k] });
      r.createSpan({ cls: 'tm-leg-v', text: sum.by[k] ? fmtMin(sum.by[k]) : '—' });
    }
    for (const [n, label, color] of [[sum.untracked, 'Untracked', 'var(--nd-cat-untracked, var(--text-faint))'], [sum.breaks, 'Breaks', 'var(--nd-cat-break)']]) {
      if (!n) continue;
      const r = el.createDiv('tm-leg');
      r.style.setProperty('--cat', color);
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: label });
      r.createSpan({ cls: 'tm-leg-v', text: fmtMin(n) });
    }
    if (sum.over && sum.target) {
      const r = el.createDiv('tm-leg is-over');
      r.style.setProperty('--cat', 'var(--nd-cat-over, var(--nd-warn))');
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: 'Overtime' });
      r.createSpan({ cls: 'tm-leg-v', text: fmtMin(sum.over) });
    }
  },
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'Add time by hand', onClick: () => p.newEntry({}) });
    const body = card.body;
    body.addClass('tm-widget');
    // motion: everything rises in on first paint; after that only rows that weren't there before slide in
    let shown = false;
    let seen = new Set();
    const rowKey = (e) => e.id || `live:${e.pendingPath || e.path}:${e.start}`;
    let workBtn = null;
    const render = () => {
      if (!body.isConnected) return;
      body.empty();
      const key = moment().format('YYYY-MM-DD');
      if (workBtn) workBtn.remove();
      workBtn = p.workButton(card.actions, true);
      card.actions.prepend(workBtn);
      const sum = p.summary(key, true);
      const top = body.createDiv('tm-w-top');
      const intro = !shown;
      const d = p.donut(top, sum, 112, intro);
      d.addClass('is-clickable');
      tip(d, 'Open the Time tab');
      d.addEventListener('click', () => p.openTab());
      p.legend(top.createDiv('tm-legend'), sum);
      const sub = card.w.querySelector('.nd-card-sub');
      if (sub) sub.setText(p.widgetSub()); // follows the Workday setting
      card.badge.setText(p.session ? '●' : '');
      card.badge.toggleClass('is-live', !!p.session);
      const recent = p.entriesOf(key, true).slice(-4).reverse();
      const list = body.createDiv('tm-w-list');
      if (!recent.length) emptyState(list, p.settings.tracking ? 'Time counts while you work in a note.' : 'Automatic tracking is paused.');
      recent.forEach((e, idx) => {
        const k = rowKey(e);
        const r = list.createDiv('tm-w-row' + (e.live ? ' is-live' : '') + (intro ? ' is-intro' : seen.has(k) ? '' : ' is-new'));
        r.style.setProperty('--i', String(idx));
        r.style.setProperty('--cat', catColor(e.cat));
        r.createSpan({ cls: 'tm-w-at', text: moment(e.start).format('HH:mm') });
        r.createSpan({ cls: 'tm-w-note', text: e.note || (e.path ? e.path.split('/').pop().replace(/\.md$/, '') : CAT_LABEL[e.cat]) });
        r.createSpan({ cls: 'tm-w-min', text: fmtMin(entryMin(e)) });
        if (!e.live) r.addEventListener('click', () => new EntryModal(p, e, false).open());
        {
          button(r, {
            icon: 'trash-2',
            cls: 'nd-icon-btn tm-w-del',
            title: e.live && !e.savedId ? 'Discard live time' : 'Delete entry',
            onClick: (ev) => {
              ev.stopPropagation();
              p.deleteEntry(e);
            },
          });
        }
      });
      seen = new Set(recent.map(rowKey));
      shown = true;
      const day = p.days[key];
      if (sum.target && sum.total >= sum.target - p.settings.wrapLead) {
        const foot = body.createDiv('tm-w-foot');
        if (day && day.wrapped) foot.createSpan({ cls: 'tm-wrapped', text: '✓ Wrapped up' });
        button(foot, { icon: 'sunset', text: day && day.wrapped ? 'Update wrap up' : 'Wrap up', cls: day && day.wrapped ? '' : 'mod-cta', onClick: () => new WrapUpModal(p).open() });
      }
    };
    const soon = debounce(render, 300, true);
    const off = p.onChange((now) => (now ? render() : soon()));
    const iv = window.setInterval(render, 60 * 1000);
    render();
    return {
      destroy() {
        off();
        window.clearInterval(iv);
      },
    };
  },
});
/* @src src/time/log-notes.js */
Object.assign(NeonTime.prototype, {
  /** fork: the time log folder, inside the base folder unless set */
  logFolder() {
    return locPath(this.settings.logFolder, 'Time Log');
  },
  /* ---- log notes --------------------------------------------------------- */
  dayNotePath(key) {
    return normalizePath(`${this.logFolder()}/${key}.md`);
  },
  async openDayNote(key) {
    await this.writeDay(key, true);
    const f = this.app.vault.getAbstractFileByPath(this.dayNotePath(key));
    if (f instanceof TFile) openFile(this.app, f);
    else new Notice('Nothing logged on this day yet.');
  },
  dayNote(key, synced) {
    const d = this.days[key] || { entries: [], done: [] };
    const s = this.summary(key, false);
    const m = moment(key, 'YYYY-MM-DD');
    const lines = ['---', `date: ${key}`, `total_min: ${s.total}`, `untracked_min: ${s.untracked}`, `break_min: ${s.breaks}`];
    for (const k of timeCats()) lines.push(`${k.replace(/[^a-z0-9]+/g, '_')}_min: ${s.by[k]}`); // fork: customer names → safe keys
    lines.push(`target_min: ${s.target}`, `overtime_min: ${s.over}`, `synced: ${synced ? 'true' : 'false'}`, '---', '');
    lines.push(`# Time log · ${m.format('ddd D MMM YYYY')}`, '');
    const split = timeCats().filter((k) => s.by[k]).map((k) => `${CAT_LABEL[k]} ${fmtMin(s.by[k])}`);
    lines.push(`**${fmtMin(s.total)}**${s.target ? ` of ${fmtMin(s.target)}` : ' (weekend)'}${s.over ? ` · +${fmtMin(s.over)} overtime` : ''}${split.length ? ' · ' + split.join(' · ') : ''}`, '');
    lines.push('## Done today');
    const notes = new Map();
    for (const e of d.entries) if (e.path && e.source === 'auto') notes.set(e.path, (notes.get(e.path) || 0) + e.ms);
    const done = [];
    for (const [path, ms] of notes) done.push(`- Worked on [[${path.replace(/\.md$/, '')}|${cell(path.split('/').pop().replace(/\.md$/, ''))}]] (${fmtMin(ms / 60000)})`);
    for (const x of d.done.filter((x) => x.kind === 'task')) done.push(`- [x] ${x.text}`);
    const tickets = new Map();
    for (const x of d.done.filter((x) => x.kind === 'ticket')) {
      const t = tickets.get(x.ref) || { text: x.text, changes: [] };
      if (x.change && !t.changes.includes(x.change)) t.changes.push(x.change);
      const path = x.path || (/\.md$/.test(x.ref) ? x.ref : '');
      if (path) t.path = path; // latest location wins
      tickets.set(x.ref, t);
    }
    for (const [ref, t] of tickets) {
      const name = t.path ? `[[${t.path.replace(/\.md$/, '')}|${cell(t.text || ref)}]]` : t.text || ref;
      done.push(`- 🎫 ${name}: ${t.changes.join('; ')}`);
    }
    lines.push(...(done.length ? done : ['- (nothing yet)']), '');
    if (d.tomorrow) lines.push('## Tomorrow', d.tomorrow, '');
    const w = this.workOf(key);
    if (w) {
      const hm = (t) => moment(t).format('HH:mm');
      lines.push('## Workday', `Started ${hm(w.start)}${w.end ? ` · ended ${hm(w.end)}` : ''} · worked ${fmtMin(this.workMin(key))}`);
      for (const [a, b] of w.breaks) lines.push(`- Break ${hm(a)}–${b == null ? 'now' : hm(b)}${b == null ? '' : ` (${fmtMin(Math.round((b - a) / 60000))})`}`);
      lines.push('');
    }
    lines.push('## Entries', '| Start | Min | Category | Note | Source |', '| --- | --- | --- | --- | --- |');
    for (const e of [...d.entries].sort((a, b) => a.start - b.start)) {
      const note = e.note || (e.path ? `[[${e.path.split('/').pop().replace(/\.md$/, '')}]]` : '');
      lines.push(`| ${moment(e.start).format('HH:mm')} | ${entryMin(e)} | ${e.cat} | ${cell(note)} | ${e.source} |`);
    }
    return lines.join('\n') + '\n';
  },
  /** Write (or update) a day's log note. Keeps `synced: true` unless the entries changed. */
  async writeDay(key, force) {
    if (!this.settings.writeNotes && !force) return;
    const d = this.days[key];
    const path = this.dayNotePath(key);
    const f = this.app.vault.getAbstractFileByPath(path);
    const empty = !d || (!d.entries.length && !d.done.length && !d.tomorrow && !this.workOf(key));
    // nothing to write for a new day; an existing note is still rewritten so deleted time disappears from it
    if (empty && !(f instanceof TFile)) return;
    const table = (t) => (t.split(/\n## Entries\n/)[1] || '').trim();
    try {
      if (f instanceof TFile) {
        await writeNote(this.app, f, (old) => {
          const wasSynced = /^synced:\s*true\s*$/m.test(old.split(/\n---/)[0] || '');
          const fresh = this.dayNote(key, false);
          const next = wasSynced && table(old) === table(fresh) ? this.dayNote(key, true) : fresh;
          return next === old ? old : next;
        });
      } else {
        await ensureFolder(this.app, this.logFolder()); // fork: the resolved folder (empty setting = <base folder>/Time Log)
        await this.app.vault.create(path, this.dayNote(key, false));
      }
    } catch (e) {
      console.error(`${appName()} – Time: could not write log note`, e);
    }
  },
  readmeSoon() {
    if (!this._readme) this._readme = debounce(() => this.ensureReadme(), 2000, true);
    this._readme();
  },
  async ensureReadme() {
    if (!this.settings.writeNotes) return;
    const path = normalizePath(`${this.logFolder()}/README.md`); // fork: was the raw setting, so an empty one pointed at the vault root
    const existing = this.app.vault.getAbstractFileByPath(path);
    const target = Math.round(this.settings.dayHours * 60);
    const idle = this.settings.idleMin;
    const text = [
      '# Time Log — format',
      '',
      `${appName()} writes one note per day here, named \`YYYY-MM-DD.md\`. Nothing is sent anywhere; an AI agent (or you) can read these notes.`,
      '',
      '## Properties',
      '- `date` — the day.',
      '- `total_min` — minutes worked: the category minutes added up, or the workday timer (Start day to End day minus breaks) when that is longer.',
      '- `untracked_min` — workday minutes not covered by a category; `break_min` — breaks in the workday (not counted as worked).',
      '- `<customer>_min`, `other_min` — active minutes per category, i.e. per customer (`other` = notes without one).',
      `- \`target_min\` — ${target} on weekdays (${fmtMin(target)}), 0 on weekends. \`overtime_min\` — time past the target.`,
      '- `synced` — for your own use (e.g. an agent sets it to `true` once it has processed the day); kept unless entries change afterwards, then it goes back to `false`.',
      '',
      '## Body',
      '- **Done today** — notes worked on, tasks ticked and project changes.',
      '- **Tomorrow** — the line written in Wrap up, if any.',
      '- **Workday** — when the work timer started and ended, time worked, and each break.',
      '- **Entries** — one row per block of work:',
      '',
      '| Start | Min | Category | Note | Source |',
      '| --- | --- | --- | --- | --- |',
      '| 09:12 | 47 | acme widgets | [[API migration]] | auto |',
      '| 10:05 | 30 | symca | Customer call | manual |',
      '',
      '`Source` is `auto` (counted while you worked in the note), or `manual` (added by hand).',
      '',
      `Auto time counts while a note is the focused tab and you type, scroll or click, also while you are briefly in another app; after ${idle} minute${idle === 1 ? '' : 's'} without input in Obsidian it ends at your last activity and the idle time is dropped. Short bits of work on the same note add up and become an entry once they reach a minute; bits still under a minute are saved when tracking is paused or Obsidian closes. Back-to-back sessions on the same note are merged, and a session past midnight is split between the two days. Notes with \`untracked: true\` are never logged.`,
      '',
      'These notes are rewritten by the plugin; edits to them are overwritten (except `synced`). Change entries in the Time tab instead. This README is rewritten too when the Time settings change.',
      '',
    ].join('\n');
    try {
      if (existing instanceof TFile) {
        // keep it in step with the settings, as long as it's still the generated README
        await writeNote(this.app, existing, (old) => (old.startsWith('# Time Log — format') ? text : old));
      } else if (!existing) {
        await ensureFolder(this.app, this.logFolder()); // fork: the resolved folder (empty setting = <base folder>/Time Log)
        await this.app.vault.create(path, text);
      }
    } catch (e) {
      console.error(`${appName()} – Time: README`, e);
    }
  },

});
/* @src src/time/entries.js */
Object.assign(NeonTime.prototype, {
  /* ---- data ------------------------------------------------------------- */
  day(key) {
    let d = this.days[key];
    if (!d) d = this.days[key] = { entries: [], done: [], tomorrow: '', wrapped: false };
    return d;
  },
  /** Entries of a day, sorted, with the running session added when live. */
  entriesOf(key, live) {
    const d = this.days[key];
    const out = d ? [...d.entries] : [];
    if (live) for (const [path, pd] of this.pending) if (pd.key === key) out.push({ start: pd.start, ms: pd.ms, cat: pd.cat, note: '', path, jira: pd.jira, source: 'auto', live: true, pendingPath: path });
    const s = this.session;
    if (live && s && dayKey(s.start) === key && s.last - s.start >= 1000) {
      const prev = out[out.length - 1];
      const liveMs = s.last - s.start;
      // the live row continues a saved entry: show them as one; deleting it removes both (savedId)
      if (prev && prev.source === 'auto' && prev.path === s.path && prev.cat === s.cat && s.start - prev.end <= this.settings.idleMin * 60000)
        out[out.length - 1] = { ...prev, id: undefined, savedId: prev.id, ms: prev.ms + liveMs, liveMs, live: true, sessionLive: true };
      else out.push({ start: s.start, ms: liveMs, liveMs, cat: s.cat, note: '', path: s.path, jira: s.jira, source: 'auto', live: true, sessionLive: true });
    }
    return out.sort((a, b) => a.start - b.start);
  },
  targetMin(m) {
    const wd = (m || moment()).isoWeekday();
    return wd <= 5 ? Math.round(this.settings.dayHours * 60) : 0;
  },
  /** Minutes per category as logged; with a started workday the total is the larger of logged time and the
   *  work timer (issue 48), the difference is "untracked", breaks are reported but never counted (issue 52). */
  summary(key, live) {
    const by = Object.fromEntries(timeCats().map((k) => [k, 0]));
    for (const e of this.entriesOf(key, live)) by[timeCats().includes(e.cat) ? e.cat : 'other'] += e.ms / 60000;
    for (const k of timeCats()) by[k] = Math.round(by[k]);
    const tracked = timeCats().reduce((s, k) => s + by[k], 0);
    const w = this.workOf(key);
    // a past day never ended stops at its last activity instead of growing forever
    const now = w ? w.end || (live ? Date.now() : w.last) : 0;
    const total = w ? Math.max(tracked, this.workMin(key, now)) : tracked;
    const breaks = w ? Math.round(w.breaks.reduce((n, [a, b]) => n + Math.max(0, Math.min(b == null ? now : b, now) - a), 0) / 60000) : 0;
    const target = this.targetMin(moment(key, 'YYYY-MM-DD'));
    return { key, by, tracked, untracked: total - tracked, breaks, total, target, over: Math.max(0, total - target), work: this.workState(key) };
  },

  /** Overtime balance over a range: only days with tracked time count; today counts once it's past the target. */
  balance(from, to) {
    const todayKey = moment().format('YYYY-MM-DD');
    let balance = 0;
    let total = 0;
    let over = 0;
    for (const key of Object.keys(this.days)) {
      const m = moment(key, 'YYYY-MM-DD');
      if (m.isBefore(from, 'day') || m.isAfter(to, 'day') || key > todayKey) continue;
      const s = this.summary(key, key === todayKey);
      if (!s.total) continue;
      total += s.total;
      over += s.over;
      balance += key === todayKey ? s.over : s.total - s.target;
    }
    return { balance, total, over };
  },
  addEntry(v, quiet) {
    const e = { id: newId(), start: v.start, end: v.start + v.ms, ms: v.ms, cat: v.cat, note: v.note || '', path: v.path || '', jira: v.jira || '', source: v.source || 'manual' };
    const key = dayKey(e.start);
    const day = this.day(key);
    day.entries.push(e);
    day.entries.sort((a, b) => a.start - b.start);
    this.changed(key);
    if (!quiet) new Notice(`⏱ ${fmtMin(entryMin(e))} ${CAT_LABEL[e.cat] || 'Other'} logged`);
  },
  findEntry(e) {
    for (const [key, d] of Object.entries(this.days)) {
      const i = d.entries.findIndex((x) => x.id === e.id);
      if (i !== -1) return { key, d, i };
    }
    return null;
  },
  updateEntry(e, v) {
    const hit = this.findEntry(e);
    if (!hit) return;
    const cur = hit.d.entries[hit.i];
    Object.assign(cur, v, { end: v.start + v.ms, source: cur.source === 'auto' ? 'auto' : cur.source });
    const key = dayKey(cur.start);
    if (key !== hit.key) {
      hit.d.entries.splice(hit.i, 1);
      this.day(key).entries.push(cur);
      this.changed(hit.key);
    }
    this.day(key).entries.sort((a, b) => a.start - b.start);
    this.changed(key);
  },
  deleteEntry(e) {
    // live rows: drop the running session and/or the short bits not saved yet
    if (e.live) {
      if (e.sessionLive) this.session = null;
      if (e.pendingPath) this.pending.delete(e.pendingPath);
      if (!e.id && !e.savedId) {
        new Notice(`Discarded ${fmtMin((e.liveMs || e.ms) / 60000)} of live time`);
        return this.emit();
      }
    }
    const hit = this.findEntry({ id: e.id || e.savedId });
    if (!hit) return;
    const [gone] = hit.d.entries.splice(hit.i, 1);
    this.changed(hit.key);
    let undone = false;
    const notice = new Notice(createFragment((f) => {
      f.appendText(`Deleted ${fmtMin(entryMin(gone))} entry · `);
      const u = f.createEl('a', { text: 'Undo', href: '#' });
      u.addEventListener('click', (ev) => {
        ev.preventDefault();
        // only once, and not if it's back already
        if (undone || this.findEntry(gone)) return;
        undone = true;
        hit.d.entries.push(gone);
        hit.d.entries.sort((a, b) => a.start - b.start);
        this.changed(hit.key);
        notice.hide();
      });
    }), 6000);
  },
  addDone(item, quiet, key = moment().format('YYYY-MM-DD')) {
    const d = this.day(key);
    if (item.kind === 'note' && d.done.some((x) => x.kind === 'note' && x.ref === item.ref)) return;
    d.done.push({ t: Date.now(), ...item });
    if (d.done.length > 300) d.done.splice(0, d.done.length - 300);
    if (!quiet) this.changed(key);
  },
  newEntry(partial) {
    new EntryModal(this, { cat: 'operations', ...partial }, true).open();
  },

});
/* @src src/time/workday.js */
Object.assign(NeonTime.prototype, {
  /* ---- work timer (item 14): start, pause, resume, end the day ---- */
  workOf(key) {
    const d = this.days[key];
    return d && d.work && d.work.start ? d.work : null;
  },
  workState(key) {
    const w = this.workOf(key);
    if (!w) return 'none';
    if (w.end) return 'ended';
    const b = w.breaks[w.breaks.length - 1];
    return b && b[1] == null ? 'paused' : 'running';
  },
  /** Minutes worked: start to end (or now), minus breaks; null without a started day. */
  workMin(key, now = Date.now()) {
    const w = this.workOf(key);
    if (!w) return null;
    const end = w.end || now;
    const off = w.breaks.reduce((n, [a, b]) => n + Math.max(0, Math.min(b == null ? end : b, end) - a), 0);
    return Math.max(0, Math.round((end - w.start - off) / 60000));
  },
  /** Add a completed break without changing the independently logged work entries. */
  addBreak({ start, ms }) {
    const w = this.workOf(dayKey(start));
    if (!w) {
      new Notice('Start the workday before logging a break.');
      return false;
    }
    const end = w.end || Date.now();
    const stop = start + ms;
    const overlap = w.breaks.some(([a, b]) => start < (b == null ? end : b) && a < stop);
    if (!Number.isFinite(start) || !Number.isInteger(ms) || ms <= 0 || start < w.start || stop > end || overlap) {
      new Notice(overlap ? 'That break overlaps an existing break.' : 'Choose a break within the started workday.');
      return false;
    }
    w.breaks.push([start, stop]);
    w.breaks.sort((a, b) => a[0] - b[0]);
    this.changed(dayKey(start), true);
    new Notice(`Break logged · ${fmtMin(ms / 60000)}`);
    return true;
  },
  /** The Start / Pause / Resume button. */
  workToggle(startAt) {
    const key = moment().format('YYYY-MM-DD');
    const now = Date.now();
    const d = this.day(key);
    const st = this.workState(key);
    if (st === 'none') d.work = { start: Math.min(startAt || now, now), breaks: [], end: null, last: now };
    else if (st === 'running') d.work.breaks.push([now, null]);
    else if (st === 'paused') d.work.breaks[d.work.breaks.length - 1][1] = now;
    else (d.work.breaks.push([d.work.end, now]), (d.work.end = null)); // ended: the gap becomes a break
    d.work.last = now;
    this.changed(key, true);
  },
  /** Today's workday buttons: Start day, which becomes End day once started, plus Pause / Resume while it runs. */
  workButton(parent, iconOnly) {
    const key = moment().format('YYYY-MM-DD');
    const st = this.workState(key);
    const wrap = parent.createDiv('tm-work-btns');
    const btn = (ic, text, cta, onClick) => button(wrap, { icon: ic, text: iconOnly ? undefined : text, cls: iconOnly ? 'nd-icon-btn tm-work-btn' : 'tm-work-btn' + (cta ? ' mod-cta' : ''), title: text, onClick });
    if (st === 'running' || st === 'paused') {
      btn('square', 'End day', true, () => {
        this.workEnd(key);
        new Notice(`Workday ended · ${fmtMin(this.workMin(key))} worked`);
      });
      btn(st === 'running' ? 'pause' : 'play', st === 'running' ? 'Pause' : 'Resume', false, () => this.workToggle());
    } else btn('play', st === 'none' ? 'Start day' : 'Resume day', st === 'none', () => (st === 'none' ? this.workStartAsk() : this.workToggle()));
    return wrap;
  },
  /** Start day asks when the day began: you may have clocked in before opening Obsidian (issue 57). */
  workStartAsk() {
    new PromptModal(this.app, {
      title: 'When did your day start?',
      value: moment().format('HH:mm'),
      placeholder: '9:30',
      cta: 'Start day',
      onSubmit: (v) => {
        const c = parseClock(v);
        const at = c && moment(`${moment().format('YYYY-MM-DD')} ${c}`, 'YYYY-MM-DD HH:mm', true);
        if (!at || !at.isValid() || at.valueOf() > Date.now() + 60000) return void new Notice('Enter a start time today, not later than now (e.g. 8:45).');
        this.workToggle(at.valueOf());
        new Notice(`Workday started at ${at.format('HH:mm')}`);
      },
    }).open();
  },
  /** End the workday at `at` (Wrap up, or the idle rule with the last activity). */
  workEnd(key, at = Date.now()) {
    const w = this.workOf(key);
    if (!w || w.end) return;
    const b = w.breaks[w.breaks.length - 1];
    if (b && b[1] == null) b[1] = Math.max(b[0], at);
    w.end = Math.max(w.start, at);
    this.changed(key, true);
  },
  /** Any input in Obsidian: the workday is still going. */
  workSeen() {
    const now = Date.now();
    // yesterday too: a day started before midnight keeps running
    for (const key of [moment().format('YYYY-MM-DD'), moment().subtract(1, 'day').format('YYYY-MM-DD')]) {
      const w = this.workOf(key);
      // after a long idle (sleep) the tick ends the day at the real last activity first
      if (!w || w.end || now - w.last < 30000 || now - w.last > this.settings.workIdleH * 3600000) continue;
      w.last = now;
      this.saveSoon();
    }
  },
  /** Idle rule: a running day with no input for workIdleH hours ends at the last activity. */
  workIdleCheck() {
    const limit = this.settings.workIdleH * 3600000;
    for (const key of [moment().format('YYYY-MM-DD'), moment().subtract(1, 'day').format('YYYY-MM-DD')]) {
      const w = this.workOf(key);
      if (w && !w.end && this.workState(key) === 'running' && Date.now() - w.last > limit) {
        this.workEnd(key, w.last);
        new Notice(`⏱ Workday ended at ${moment(w.last).format('HH:mm')} (no activity for ${this.settings.workIdleH} h)`);
      }
    }
  },
});
/* @src src/time/tracker.js */
Object.assign(NeonTime.prototype, {
  /* ---- tracking -------------------------------------------------------- */
  isLogFile(f) {
    const folder = this.logFolder();
    return !!f && (f.path === folder || f.path.startsWith(folder + '/'));
  },
  /** Category a file's time goes to, or null when it must not be logged. */
  trackCat(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.isLogFile(file)) return null;
    const c = fileCategory(this.app, file);
    if (c === 'untracked') return null;
    return c || 'other';
  },
  touch(e) {
    this.workSeen();
    if (!this.settings.tracking || activeDocument.hidden) return;
    const now = Date.now();
    // cheap throttle: one check every 3 s is plenty for minute-level time
    if (this.session && now - this.session.last < 3000) return;
    const view = this.activeFileView();
    if (!view || !view.file || (e && e.target && e.target.nodeType && !view.containerEl.contains(e.target))) return;
    const file = view.file;
    const idle = this.settings.idleMin * 60000;
    const s = this.session;
    if (s && s.path === file.path && now - s.last <= idle) {
      // re-read the category: the note may have been set to untracked or moved category mid-session
      const cat = this.trackCat(file);
      if (cat === s.cat) {
        s.last = now;
        return;
      }
      if (!cat) return this.dropTracking(file.path);
    }
    this.closeSession();
    const cat = this.trackCat(file);
    if (!cat) return;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    this.session = { path: file.path, name: file.basename, cat, jira: fm.jira ? String(fm.jira) : '', start: now, last: now };
    this.updateStatus();
  },
  /** The focused note's view (markdown, ticket view, …), or null. */
  activeFileView() {
    const ws = this.app.workspace;
    const v = ws.getActiveViewOfType(FileView);
    return v && v.file instanceof TFile ? v : null;
  },
  tick() {
    this.workIdleCheck();
    const s = this.session;
    if (s && Date.now() - s.last > this.settings.idleMin * 60000) this.closeSession();
    else if (s && dayKey(s.start) !== dayKey(Date.now())) {
      // past midnight: save the old day's part and keep tracking on the new day
      this.closeSession();
      const f = this.app.vault.getAbstractFileByPath(s.path);
      const t = Math.max(s.last, moment().startOf('day').valueOf());
      if (!(f instanceof TFile) || this.trackCat(f)) this.session = { ...s, start: t, last: t };
      this.updateStatus();
    } else if (s) this.updateStatus();
  },
  /** End the running session at its last activity, merging into the previous entry when it's the same note. */
  closeSession() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    // the note was set to untracked before the session ended: keep none of it
    const f = this.app.vault.getAbstractFileByPath(s.path);
    if (f instanceof TFile && !this.trackCat(f)) {
      this.pending.delete(s.path);
      return this.emit();
    }
    if (s.last - s.start <= 0) return this.updateStatus();
    // a session past midnight is split, so each day gets its own part
    let from = s.start;
    while (dayKey(from) !== dayKey(s.last)) {
      const midnight = moment(from).add(1, 'day').startOf('day').valueOf();
      this.savePiece(s, from, midnight);
      from = midnight;
    }
    this.savePiece(s, from, s.last);
  },
  /** Save one day's part of a session: merge into the previous entry, or add up as short bits until they reach a minute. */
  savePiece(s, start, end) {
    const ms = end - start;
    if (ms <= 0) return;
    const key = dayKey(start);
    const day = this.day(key);
    const prev = day.entries[day.entries.length - 1];
    const idle = this.settings.idleMin * 60000;
    if (prev && prev.source === 'auto' && prev.path === s.path && prev.cat === s.cat && start - prev.end <= idle) {
      prev.ms += ms;
      prev.end = end;
      this.changed(key);
      return;
    }
    // short sessions on the same note (e.g. between glances at the dashboard) add up;
    // once they reach a minute they become one entry
    let pend = this.pending.get(s.path);
    if (!pend || pend.key !== key) pend = { key, start, end, ms: 0, cat: s.cat, name: s.name, jira: s.jira };
    pend.cat = s.cat;
    pend.ms += ms;
    pend.end = end;
    if (pend.ms >= 60000) {
      this.pending.delete(s.path);
      day.entries.push({ id: newId(), start: pend.start, end: pend.end, ms: pend.ms, cat: s.cat, note: '', path: s.path, jira: s.jira, source: 'auto' });
      day.entries.sort((a, b) => a.start - b.start);
      this.addDone({ kind: 'note', ref: s.path, text: s.name }, true, key);
      this.changed(key);
    } else {
      this.pending.set(s.path, pend);
      this.emit();
    }
  },

  /** Save the short bits of work not saved yet as entries (on pause and unload). Returns the day keys touched. */
  flushPending() {
    const keys = new Set();
    for (const [path, pd] of this.pending) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile && !this.trackCat(f)) continue;
      const entries = this.day(pd.key).entries;
      entries.push({ id: newId(), start: pd.start, end: pd.end, ms: pd.ms, cat: pd.cat, note: '', path, jira: pd.jira, source: 'auto' });
      entries.sort((a, b) => a.start - b.start);
      keys.add(pd.key);
    }
    this.pending.clear();
    return keys;
  },
  /** Turn automatic tracking on or off. Pausing saves what was tracked so far. */
  setTracking(on) {
    this.settings.tracking = on;
    if (!on) {
      this.closeSession();
      for (const k of this.flushPending()) this.dirty.add(k);
      this.changed(moment().format('YYYY-MM-DD'));
    } else this.emit();
    this.saveSettings();
  },
  /** Throw away time not saved yet for a note (it was set to untracked). */
  dropTracking(path) {
    if (this.session && this.session.path === path) this.session = null;
    this.pending.delete(path);
    this.emit();
  },

});
return NeonTime;
})();
/* ==== module neon-tickets ==== */
const NeonProjectsModule = (() => {
/* @src src/tickets/constants.js */
/* ------------------------------------------------------------------ */
/* Projects (fork; upstream Neon Deck's Tickets module, rewritten)    */
/* ------------------------------------------------------------------ */
// The module keeps upstream's id (neon-tickets) and view type, so its data folder and saved layouts carry on.

const VIEW_TICKETS = 'neon-deck-tickets';
const VIEW_PLAN = 'neon-plan'; // fork: one project's plan (plan-view.js)
/** The four status groups: how a project is counted and coloured. */
const PROJECT_KINDS = ['open', 'in-progress', 'waiting', 'done'];
const PROJECT_KIND_LABEL = { open: 'Not started', 'in-progress': 'Active', waiting: 'On hold', done: 'Closed' };
const PROJECT_BUCKETS = [
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['week', 'Next 7 days'],
  ['later', 'Later'],
  ['nodate', 'No due date'],
  ['done', 'Closed'],
];
const PROJECTS_DEFAULTS = {
  planReportsFolder: '', // fork: where Planning reports go ('' = <base folder>/Reports)
  planReportsWhere: 'folder', // fork: 'folder' = all in the reports folder; 'project' = next to each project (plan-report-folder.js)
  planReportsSubfolder: 'Reports', // fork: the folder name used next to a project
  planReportProps: 'cssclasses', // fork: project properties copied into its reports (plan-report-props.js), besides the group
  planHolidayName: 'Holidays',
  planMe: '', // fork: you, as in a task's owners ([[@Kevin Mulholland]]): your own time off is striped in the calendar // fork: the name of the Holidays notes Planning looks for (plan-calendar.js)
  planMarks: true, // fork: underline plan problems (unknown ids, ids used twice, loops) in project notes
  planBaselines: {}, // fork: Planning baselines per project: { path: { saved, end, tasks: { id: finish } } }
  // which notes are projects, and their status values (comma lists, in the order offered)
  projectTag: 'project',
  statusNotStarted: 'init, created',
  statusActive: 'inprogress, ongoing',
  statusOnHold: 'paused, blocked',
  statusClosed: 'completed, cancelled',
  statusCancelled: 'cancelled', // closing with this value writes a `cancelled` date instead of `completed`
  // where new projects go: <customers folder>/<customer>/<projects folder name>/, else the project folder
  customersFolder: '1.Customers',
  groupLabel: 'Customer', // fork: what a group is called (Area in a PARA vault)
  groupProperty: 'customer', // fork: the properties naming a note's group (comma list; values may be links)
  groupSkip: '', // fork: folders in the groups folder that aren't groups (e.g. Dailynotes, Tasks)
  projectsFolderName: 'Projects',
  projectFolders: '', // fork: each folder directly inside this one is a project too (PARA: 1.Projects)
  projectFolder: '', // projects without a customer; '' = <base folder>/Projects
  projectTemplate: '',
  // the tracker and reminders
  tabSort: 'customer',
  showTimeline: true, // fork: a Mermaid Gantt chart above the list on the Projects tab
  timelineZoom: '12m',
  reminders: true,
  remindDays: 1,
  notified: {},
  statusLog: [], // { t, title, status, path }: projects set to a status below (Recently done on the dashboard)
  activityStatuses: ['done', 'waiting'],
};
const PROJECT_SORTS = [
  ['customer', 'Customer'],
  ['status', 'Status'],
  ['due', 'Due date'],
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['changed', 'Recently changed'],
  ['title', 'Title A–Z'],
];

/** Status group of a value: from the settings (NEON_PROJECTS), else a few common words, else not started. */
function projectKind(v) {
  const k = NEON_PROJECTS.kinds[String(v == null ? '' : v).trim().toLowerCase()];
  if (k) return k;
  const s = String(v || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (/^(done|closed|resolved|completed?|cancell?ed)$/.test(s)) return 'done';
  if (/^(in-?progress|doing|active|wip|started|ongoing)$/.test(s)) return 'in-progress';
  if (/^(waiting|blocked|on-?hold|paused|pending)$/.test(s)) return 'waiting';
  return 'open';
}
const daysFromToday = (m) => m.clone().startOf('day').diff(moment().startOf('day'), 'days');
/** Short due text for a project row. */
function projectDueText(t) {
  if (t.status === 'done') return t.completed ? `${t.statusRaw || 'closed'} ${t.completed.format('D MMM')}` : t.statusRaw || 'closed';
  if (!t.due) return 'no date';
  const d = t.daysLeft;
  if (d < -1) return `${-d}d late`;
  if (d === -1) return '1d late';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 14) return `in ${d}d`;
  return `in ${Math.round(d / 7)}w`;
}
/** Default order: open first, then by due date (none last), then title. */
function projectSort(a, b) {
  return (a.status === 'done') - (b.status === 'done') || (a.due ? a.due.valueOf() : Infinity) - (b.due ? b.due.valueOf() : Infinity) || a.title.localeCompare(b.title);
}
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
/** Projects in sections for a sort mode: [[key, label, projects]]. */
function projectGroups(items, mode) {
  if (mode === 'customer') {
    const names = [...new Set(items.map((t) => t.customer || ''))].sort((a, b) => (!a - !b) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return names.map((c) => [`customer-${c || 'none'}`, c || `No ${groupWord(false, true)}`, items.filter((t) => (t.customer || '') === c).sort(projectSort)]);
  }
  if (mode === 'status') {
    return PROJECT_KINDS.map((k) => [`status-${k}`, PROJECT_KIND_LABEL[k], items.filter((t) => t.status === k).sort(projectSort)]);
  }
  const flat = {
    newest: ['Newest first', (a, b) => b.created.valueOf() - a.created.valueOf()],
    oldest: ['Oldest first', (a, b) => a.created.valueOf() - b.created.valueOf()],
    changed: ['Recently changed', (a, b) => b.file.stat.mtime - a.file.stat.mtime],
    title: ['Title A–Z', byTitle],
  }[mode];
  if (flat) return [['flat', flat[0], items.slice().sort(flat[1])]];
  return PROJECT_BUCKETS.map(([bucket, l]) => {
    const g = items.filter((t) => t.bucket === bucket);
    g.sort(bucket === 'done' ? (a, b) => (b.completed ? b.completed.valueOf() : 0) - (a.completed ? a.completed.valueOf() : 0) : projectSort);
    return [bucket, l, g];
  });
}
/* @src src/tickets/tracker.js */
/* ---- the Projects tab ---------------------------------------------------------- */
class ProjectsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.filter = 'active';
    this.query = '';
  }
  getViewType() {
    return VIEW_TICKETS;
  }
  getDisplayText() {
    return 'Projects';
  }
  getIcon() {
    return 'briefcase';
  }
  async onOpen() {
    addHelpAction(this, 'projects'); // fork: the ? button in the header (src/shared/help.js)
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'tk-tracker', 'tk-host');
    const sc = root.createDiv('tk-scroll');
    // one panel that grows and shrinks with the projects in it
    this.island = sc.createDiv('tk-island');
    const inner = this.island.createDiv('tk-island-inner');
    const bar = inner.createDiv('tk-bar');
    const head = bar.createDiv('tk-bar-head');
    head.createDiv({ cls: 'tk-k', text: 'Projects' });
    this.dateEl = head.createDiv({ cls: 'tk-bar-date' });
    this.counterEl = bar.createDiv('tk-counter');
    this.summary = bar.createDiv('tk-summary');
    const tools = bar.createDiv('tk-tools');
    const seg = tools.createDiv('nd-seg');
    this.segBtns = {};
    for (const [k, label] of [['active', 'Active'], ['waiting', 'On hold'], ['done', 'Closed'], ['all', 'All']]) {
      const b = seg.createEl('button', { cls: 'nd-seg-btn', text: label });
      b.addEventListener('click', () => {
        if (this.filter !== k) this.filterChanged = true;
        this.filter = k;
        this.render();
      });
      this.segBtns[k] = b;
    }
    // fork: the timeline (a Mermaid Gantt chart above the list), on unless switched off here or in settings
    this.timelineBtn = button(tools, {
      icon: 'calendar-range',
      text: 'Timeline',
      cls: 'tk-mode',
      title: 'Show or hide the timeline',
      onClick: () => {
        this.plugin.settings.showTimeline = this.plugin.settings.showTimeline === false;
        this.plugin.saveSettings();
        this.render();
      },
    });
    const sort = tools.createEl('select', { cls: 'dropdown tk-sort', attr: { 'aria-label': 'Sort or group projects' } });
    for (const [k, label] of PROJECT_SORTS) sort.createEl('option', { value: k, text: k === 'customer' ? groupWord() : label }); // fork: the group's name
    sort.value = this.plugin.settings.tabSort;
    sort.addEventListener('change', () => {
      this.plugin.settings.tabSort = sort.value;
      this.plugin.saveSettings();
      this.filterChanged = true;
      this.render();
    });
    const search = tools.createEl('input', { cls: 'nd-input tk-search', attr: { type: 'search', placeholder: 'Filter projects…' } });
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    });
    button(tools, { icon: 'plus', text: 'New project', cls: 'mod-cta', onClick: () => this.plugin.newProject() });
    this.timelineEl = inner.createDiv('tk-timeline');
    this.listEl = inner.createDiv('tk-list');
    this.fitIsland = () => {
      const h = Math.ceil(inner.offsetHeight);
      if (Math.abs(h - (parseFloat(this.island.style.height) || 0)) < 1) return;
      this.island.style.height = `${h}px`;
      const end = performance.now() + 560;
      const step = () => {
        if (this.pattern) this.pattern.kick();
        if (performance.now() < end) window.requestAnimationFrame(step);
      };
      step();
    };
    const iro = new ResizeObserver(() => this.fitIsland());
    iro.observe(inner);
    this.register(() => iro.disconnect());
    const mount = () => {
      if (this.pattern) this.pattern.destroy();
      const api = deckApi(this.app);
      this.pattern = api && api.mountPattern ? api.mountPattern(root, sc, '.tk-island, .tk-stat, .tk-row') : null;
    };
    mount();
    this.register(() => this.pattern && this.pattern.destroy());
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', mount));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.pattern && (this.pattern.destroy(), (this.pattern = null))));
    const refresh = debounce(() => this.render(), 400, true);
    this.register(this.plugin.onChange(refresh));
    this.registerInterval(window.setInterval(() => this.render(), 10 * 60 * 1000));
    this.render();
  }
  render() {
    if (this.pattern) this.pattern.kick();
    const p = this.plugin;
    const all = p.collectProjects();
    const active = all.filter((t) => t.status !== 'done');
    const count = (b) => active.filter((t) => t.bucket === b).length;
    this.dateEl.setText(`${moment().format('dddd D MMM YYYY')} · week ${moment().isoWeek()}`);
    if (!this.prevNums) this.prevNums = new Map();
    const countTo = (el, key, n) => {
      const from = this.prevNums.has(key) ? this.prevNums.get(key) : 0;
      this.prevNums.set(key, n);
      countUp(el, from, n, (x) => String(Math.round(x)), from ? 450 : 800);
    };
    p.renderCounter(this.counterEl, all);
    const cn = this.counterEl.querySelector('.tk-counter-n');
    if (cn) countTo(cn, 'counter', Number(cn.textContent) || 0);
    this.summary.empty();
    this.summary.toggleClass('is-intro', !this.rendered);
    let si = 0;
    const stat = (n, label, cls, onClick) => {
      const s = this.summary.createDiv(`tk-stat ${cls}${n ? ' has-value' : ''}`);
      s.style.setProperty('--i', String(si++));
      countTo(s.createDiv({ cls: 'tk-stat-n' }), `stat:${label}`, n);
      s.createDiv({ cls: 'tk-stat-l', text: label });
      if (onClick) s.addEventListener('click', onClick);
    };
    stat(count('overdue'), 'overdue', 'is-overdue');
    stat(count('today'), 'due today', 'is-today');
    stat(count('week'), 'next 7 days', 'is-week');
    stat(active.filter((t) => t.status === 'in-progress').length, 'active', 'is-active');
    stat(active.filter((t) => t.status === 'waiting').length, 'on hold', 'is-waiting', () => ((this.filter = 'waiting'), this.render()));
    for (const [k, b] of Object.entries(this.segBtns)) b.toggleClass('is-active', k === this.filter);
    let items = all;
    if (this.filter === 'active') items = active;
    else if (this.filter === 'waiting') items = active.filter((t) => t.status === 'waiting');
    else if (this.filter === 'done') items = all.filter((t) => t.status === 'done');
    if (this.query) items = items.filter((t) => `${t.title} ${t.file.path} ${t.statusRaw} ${t.customer} ${t.stage} ${t.note}`.toLowerCase().includes(this.query));
    // fork: the timeline shows the same projects as the list below it
    const timeline = p.settings.showTimeline !== false;
    this.timelineBtn.toggleClass('is-active', timeline);
    this.timelineEl.toggle(timeline);
    if (timeline) this.showTimeline(items);
    this.listEl.empty();
    const calm = !!this.rendered && !this.filterChanged;
    this.listEl.toggleClass('is-calm', calm);
    this.listEl.toggleClass('is-refilter', !!this.filterChanged);
    this.filterChanged = false;
    this.rendered = true;
    const before = this.rowState || null;
    this.rowState = new Map();
    this.rowCalm = calm ? before : null;
    if (!items.length) {
      const e = this.listEl.createDiv('tk-empty');
      e.createDiv({ text: all.length ? 'Nothing matches this filter.' : `No projects yet. A project is a note with “${NEON_PROJECTS.tag}” in its tags.` });
      if (!all.length) button(e, { icon: 'plus', text: 'Create your first project', cls: 'mod-cta', onClick: () => p.newProject() });
      return;
    }
    let idx = 0;
    for (const [key, label, group] of projectGroups(items, p.settings.tabSort)) {
      if (!group.length) continue;
      const sec = this.listEl.createDiv(`tk-group is-${key}`);
      const gh = sec.createDiv('tk-group-head');
      gh.createSpan({ cls: 'tk-group-title', text: label });
      gh.createSpan({ cls: 'tk-group-count', text: String(group.length).padStart(2, '0') });
      for (const t of group) this.renderRow(sec, t, idx++);
    }
  }
  renderRow(parent, t, i) {
    const p = this.plugin;
    const row = parent.createDiv(`tk-row is-${t.bucket} status-${t.status}`);
    row.style.setProperty('--i', String(Math.min(i, 20)));
    const state = `${t.statusRaw}|${t.bucket}`;
    if (this.rowState) this.rowState.set(t.file.path, state);
    if (this.rowCalm) {
      const was = this.rowCalm.get(t.file.path);
      if (was === undefined) row.addClass('is-new');
      else if (was !== state) row.addClass('is-changed');
    }
    const main = row.createDiv('tk-row-main');
    const top = main.createDiv('tk-row-top');
    top.createSpan({ cls: 'tk-row-title', text: t.title });
    const meta = main.createDiv('tk-row-meta');
    const st = meta.createSpan({ cls: `tk-st s-${t.status}`, text: t.statusRaw || PROJECT_KIND_LABEL[t.status] });
    tip(st, 'Click to choose a status');
    st.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = new Menu();
      for (const v of p.statusChoices()) m.addItem((it) => it.setTitle(v).setChecked((t.statusRaw || '').toLowerCase() === v.toLowerCase()).onClick(() => p.setStatus(t, v)));
      m.showAtMouseEvent(e);
    });
    if (t.customer && p.settings.tabSort !== 'customer') meta.createSpan({ cls: 'tk-age tk-customer', text: t.customer });
    if (t.stage) meta.createSpan({ cls: 'tk-age', text: `stage: ${t.stage}` });
    p.renderPlanSummary(meta, t); // fork: the project's tasks
    meta.createSpan({ cls: 'tk-age', text: `${t.startedOn ? 'started' : 'created'} ${(t.startedOn || t.created).format('D MMM')} · ${t.age}d` });
    if (t.remind && t.status !== 'done') meta.createSpan({ cls: 'tk-age', text: `🔔 ${t.remind.format('D MMM')}` });
    if (t.note) tip(main.createDiv({ cls: 'tk-row-note', text: t.note }), 'The project’s note property');
    if (t.due && t.status !== 'done') {
      const prog = main.createDiv('tk-progress');
      prog.createDiv('tk-progress-fill').style.width = `${Math.round(t.progress * 100)}%`;
      tip(prog, `${Math.round(t.progress * 100)}% of the time from start to due has passed`);
    }
    const due = row.createDiv('tk-row-due');
    due.createDiv({ cls: 'tk-row-due-main', text: projectDueText(t) });
    if (t.due) due.createDiv({ cls: 'tk-row-due-date', text: t.due.format('ddd D MMM') });
    const acts = row.createDiv('tk-row-acts');
    const menu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = new Menu();
      projectMenu(p, t, m);
      m.showAtMouseEvent(e);
    };
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'More', onClick: menu });
    row.addEventListener('click', (e) => p.openProject(t.file, e));
    hoverPreview(this.app, row, t.file); // page preview on hover
    row.addEventListener('contextmenu', menu);
  }
}
/* @src src/tickets/timeline.js */
/* ---- All projects in one view (fork): the Projects tab's timeline, drawn by the plugin --------------------------
 * One row per project, grouped by customer: a bar from its start to its plan's forecast finish (else its due date, or
 * its closing date once closed), a hollow diamond on its due date, coloured by how it stands. Drawn with the Planning
 * view's Gantt (planGanttLayout / planDrawGantt), since Obsidian's chart engine takes no colours per bar. A click
 * opens the project's Planning view (Ctrl/Cmd-click: its note). */

// colours by how a project stands (the kinds reuse the plan colours)
const PROJECT_KEY = [
  ['overdue', 'Late (forecast after due, or past due)'],
  ['soon', 'Needs attention (overdue or blocked tasks)'],
  ['doing', 'In progress'],
  ['ready', 'Not started'],
  ['waiting', 'On hold'],
  ['done', 'Closed'],
];

/**
 * Rows for the drawn timeline (pure). sums: Map note path → the project's plan summary (planCounts + end, late), or
 * nothing yet. win: { from, to } or null. One section per customer, one bar per project.
 */
function projectTimelineRows(items, sums, win) {
  const d = (m) => (m && m.format ? m.format('YYYY-MM-DD') : m || null);
  const inWin = (x) => !win || (x >= win.from && x <= win.to);
  const rows = [];
  for (const [, name, list] of projectGroups(items, 'customer')) {
    const sec = [];
    for (const t of list) {
      const c = sums.get(t.file.path) || null;
      const closed = t.status === 'done';
      let start = d(t.startedOn || t.created);
      if (!start) continue;
      let end = closed ? d(t.completed) || d(t.due) || start : (c && c.end) || d(t.due) || start;
      if (end < start) end = start;
      const due = closed ? null : d(t.due);
      if (win && (end < win.from || start > win.to) && !(due && inWin(due))) continue;
      if (win) {
        if (start < win.from) start = win.from;
        if (end > win.to) end = win.to;
        if (end < start) end = start;
      }
      const kind = closed ? 'done' : (c && c.late) || t.bucket === 'overdue' ? 'overdue' : c && (c.overdue || c.blocked) ? 'soon' : t.status === 'waiting' ? 'waiting' : t.status === 'in-progress' ? 'doing' : 'ready';
      const note = closed ? t.statusRaw || 'closed' : [c && c.late ? `${c.late} working day${c.late === 1 ? '' : 's'} late` : '', c ? planSummaryText(c, true) : ''].filter(Boolean).join(' · ');
      const bar = { id: '', task: null, project: t, hasPlan: !!(c && c.total), kind, crit: false, mark: null, start, end, due: due && inWin(due) ? due : null };
      sec.push({ bar, label: t.title, who: note, milestone: false, thin: false });
    }
    if (sec.length) rows.push({ section: name || 'No customer' }, ...sec);
  }
  return rows;
}

Object.assign(ProjectsView.prototype, {
  /** The timeline above the list, for the projects the list shows (same filter and search). */
  showTimeline(items) {
    const p = this.plugin;
    this.timelineItems = items;
    if (!this.tl) {
      const el = this.timelineEl;
      el.empty();
      const bar = el.createDiv('nd-timeline-bar');
      const zoom = pills(bar, GANTT_ZOOMS, p.settings.timelineZoom || '12m', (z) => {
        p.settings.timelineZoom = z || '12m';
        p.saveSettings();
        this.drawTimeline();
      }, 'nd-timeline-zoom');
      const key = el.createDiv('np-legend tk-tl-key');
      for (const [kind, label] of PROJECT_KEY) {
        const k = key.createSpan('np-key');
        k.createSpan({ cls: 'np-swatch' }).style.backgroundColor = planColour(kind);
        k.createSpan({ text: label });
      }
      key.createSpan({ cls: 'np-key', text: '◇ due date' });
      this.tl = { zoom, chart: el.createDiv('np-chart tk-tl-chart'), sums: new Map() };
    }
    this.drawTimeline();
    // the plans' forecasts come in a moment later: draw again with them
    const token = (this.tlToken = {});
    Promise.all(items.map((t) => p.planSummary(t).then((c) => [t.file.path, c]))).then((pairs) => {
      if (this.tlToken !== token || !this.tl) return;
      this.tl.sums = new Map(pairs.filter(([, c]) => c));
      this.drawTimeline();
    });
  },
  drawTimeline() {
    const p = this.plugin;
    const { chart, sums } = this.tl;
    const today = moment().format('YYYY-MM-DD');
    const win = ganttWindow(p.settings.timelineZoom || '12m', today);
    const rows = projectTimelineRows(this.timelineItems || [], sums, win);
    chart.empty();
    const lay = rows.length ? planGanttLayout(rows, { today, width: chart.clientWidth || this.timelineEl.clientWidth || 900, labelW: 320, minDay: 1, maxDay: 24 }) : null;
    if (!lay) emptyState(chart, 'No projects with dates in this window');
    else
      planDrawGantt(chart, lay, {
        colours: planColourMap(),
        onBar: (e, b) => {
          const t = b.project;
          if (e.ctrlKey || e.metaKey || !b.hasPlan) return p.openProject(t.file, e);
          p.openPlan(p.planScope(t), 'gantt');
        },
      });
    if (this.fitIsland) this.fitIsland();
  },
});
/* @src src/tickets/settings.js */
class NeonProjectsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = () => p.saveSettings();
    const proj = () => (p.applyProjectSettings(), save(), p.emitSoon());
    containerEl.empty();
    containerEl.addClass('nd-settings');

    new Setting(containerEl).setName('Projects').setHeading();
    new Setting(containerEl)
      .setName('Project tag')
      .setDesc('Notes with this tag in their tags property are projects, wherever they are.')
      .addText((t) => t.setPlaceholder('project').setValue(s.projectTag).onChange((v) => ((s.projectTag = v.trim().replace(/^#/, '')), proj())));
    new Setting(containerEl)
      .setName('Group name')
      .setDesc('What the groups that projects and notes belong to are called: Customer by default, Area for a PARA vault, or Client, Team…')
      .addText((t) => t.setPlaceholder('Customer').setValue(s.groupLabel).onChange((v) => ((s.groupLabel = v.trim() || 'Customer'), proj())));
    new Setting(containerEl)
      .setName('Group properties')
      .setDesc('The properties that name a note’s group, tried in order (e.g. area, parent). A value can be a name (acme), a link ([[Photography]]) or a link to a note inside a group folder. Without one, the folder the note is in decides.')
      .addText((t) => t.setPlaceholder('customer').setValue(s.groupProperty).onChange((v) => ((s.groupProperty = v.trim() || 'customer'), proj())));
    new Setting(containerEl)
      .setName('Groups folder')
      .setDesc('Each folder inside it is a group (a customer, or an area or project folder in a PARA vault). A note in one of them, at any depth, belongs to that group.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('1.Customers').setValue(s.customersFolder).onChange((v) => ((s.customersFolder = normalizePath(v.trim() || '1.Customers')), proj())), 'folder'));
    new Setting(containerEl)
      .setName('Not groups')
      .setDesc('Comma-separated folders inside the groups folder that are not groups, e.g. Dailynotes, Tasks.')
      .addText((t) => t.setPlaceholder('Dailynotes, Tasks').setValue(s.groupSkip).onChange((v) => ((s.groupSkip = v), proj())));
    new Setting(containerEl)
      .setName('Project folders')
      .setDesc('Optional. Each folder directly inside this one is a project too, unless it already holds a tagged project note (PARA: 1.Projects). Its status and dates come from a note named like the folder, else one with a status, else its index note.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('e.g. 1.Projects').setValue(s.projectFolders).onChange((v) => ((s.projectFolders = v.trim() ? normalizePath(v.trim()) : ''), proj())), 'folder'));
    new Setting(containerEl)
      .setName('Projects folder name')
      .setDesc('New projects for a group go in <groups folder>/<group>/<this folder>/.')
      .addText((t) => t.setPlaceholder('Projects').setValue(s.projectsFolderName).onChange((v) => ((s.projectsFolderName = v.trim() || 'Projects'), save())));
    new Setting(containerEl)
      .setName('Project folder')
      .setDesc(`Where new projects without a group go. Empty: ${basePath('Projects')} (in the base folder).`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Projects')).setValue(s.projectFolder).onChange((v) => ((s.projectFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'));
    new Setting(containerEl)
      .setName('Project template')
      .setDesc('Note that new projects start from; {{title}}, {{date}}, <% tp.file.title %> and <% tp.date.now() %> are filled in. Empty: title, tags, started, due, completed and status.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('templates/project_template.md').setValue(s.projectTemplate).onChange((v) => ((s.projectTemplate = v.trim()), save())), 'file'));

    new Setting(containerEl)
      .setName('Save Planning reports')
      .setDesc('Where Report (in the Planning view) saves a plan’s report note and its chart: all in one reports folder, or next to each project, so a customer’s reports stay in its folder (beside a project note, or inside a project folder).')
      .addDropdown((d) => d.addOption('folder', 'In the reports folder').addOption('project', 'Next to the project').setValue(s.planReportsWhere === 'project' ? 'project' : 'folder').onChange((v) => ((s.planReportsWhere = v), save())));
    new Setting(containerEl)
      .setName('Planning reports folder')
      .setDesc(`The reports folder, also used when a project has no suitable folder of its own (a note at the vault root, or directly in the Project folders). Empty: ${basePath('Reports')} (in the base folder).`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Reports')).setValue(s.planReportsFolder || '').onChange((v) => ((s.planReportsFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'));
    new Setting(containerEl)
      .setName('Reports folder next to a project')
      .setDesc('With reports saved next to the project: the name of the folder made beside the project note (or inside the project folder).')
      .addText((t) => t.setPlaceholder('Reports').setValue(s.planReportsSubfolder || 'Reports').onChange((v) => ((s.planReportsSubfolder = planReportSubName(v)), save())));
    new Setting(containerEl)
      .setName('Copy into reports')
      .setDesc('Comma-separated properties of the project note that its reports keep, as they are, e.g. cssclasses. Reports always keep the project’s group (its customer or Area property, else the one from its folder). Never copied: tags, aliases, status, started, due, completed and cancelled, so a report never counts as a project or shows out-of-date dates.')
      .addText((t) => t.setPlaceholder('cssclasses').setValue(s.planReportProps == null ? 'cssclasses' : s.planReportProps).onChange((v) => ((s.planReportProps = v.trim()), save())));
    // Planning's working days (plan-calendar.js): open plans are redrawn when one changes
    const plans = () => (proj(), p.app.workspace.getLeavesOfType(VIEW_PLAN).forEach((l) => l.view && l.view.refresh && l.view.refresh()));
    new Setting(containerEl)
      .setName('Holidays notes')
      .setDesc('Planning reads working days, holidays and time off from a note with this name: in the project’s folder or a folder above it, its customer or Area folder (a customer or Area can have its own), else in the base folder. Its All section: “public holidays: England and Wales” (or Scotland, Northern Ireland), “working days: Mon-Fri”, and dates or ranges with a name for everyone (closures, other countries’ holidays). Under it, each person ([[@Name]]) with their dates or “every Tuesday”.')
      .addText((t) => t.setPlaceholder('Holidays').setValue(s.planHolidayName || 'Holidays').onChange((v) => ((s.planHolidayName = v.trim() || 'Holidays'), plans())));
    new Setting(containerEl)
      .setName('You')
      .setDesc('Optional: you, written as in a task’s owners ([[@Your Name]] or your name). In the task editor’s calendar your own time off is then striped on your tasks; everyone else’s is underlined in orange.')
      .addText((t) => t.setPlaceholder('[[@Your Name]]').setValue(s.planMe || '').onChange((v) => ((s.planMe = v.trim()), proj())));
    new Setting(containerEl)
      .setName('Underline plan problems in project notes')
      .setDesc('While you edit a project note: a ⛔ id no task has, a 🆔 used twice, and the links of a dependency loop get a wavy underline, with the reason on hover. Only the display changes, nothing is written.')
      .addToggle((t) => t.setValue(s.planMarks !== false).onChange((v) => ((s.planMarks = v), save(), p.planMarksRefresh && p.planMarksRefresh())));

    new Setting(containerEl).setName('Status values').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Comma-separated, in the order they are offered. The group decides how a project is counted and coloured; unknown values count as not started. Changing a status only updates properties.' });
    const statuses = (name, key, desc, ph) => new Setting(containerEl).setName(name).setDesc(desc).addText((t) => t.setPlaceholder(ph).setValue(s[key]).onChange((v) => ((s[key] = v), proj())));
    statuses('Not started', 'statusNotStarted', 'The first one is used for new projects.', 'init, created');
    statuses('Active', 'statusActive', '', 'inprogress, ongoing');
    statuses('On hold', 'statusOnHold', '', 'paused, blocked');
    statuses('Closed', 'statusClosed', 'Choosing one writes today’s date in the completed property.', 'completed, cancelled');
    new Setting(containerEl)
      .setName('Cancelled status')
      .setDesc('Closing with this value writes a cancelled date property instead of completed.')
      .addText((t) => t.setPlaceholder('cancelled').setValue(s.statusCancelled).onChange((v) => ((s.statusCancelled = v.trim()), proj())));

    new Setting(containerEl)
      .setName('Timeline on the Projects tab')
      .setDesc('A Gantt chart (Mermaid) above the list, one section per group (customer): a bar from started to due, or to the closed date.')
      .addToggle((t) => t.setValue(s.showTimeline !== false).onChange((v) => ((s.showTimeline = v), save(), p.emitSoon())));

    new Setting(containerEl).setName('Dashboard and reminders').setHeading();
    for (const k of ['done', 'waiting', 'in-progress'])
      new Setting(containerEl)
        .setName(`Recently done: ${PROJECT_KIND_LABEL[k].toLowerCase()}`)
        .setDesc(k === 'done' ? 'Projects closed in the last 14 days (by their completed or cancelled date, however the status was changed) appear in the dashboard’s Recently done card.' : '')
        .addToggle((t) =>
          t.setValue(s.activityStatuses.includes(k)).onChange((v) => {
            s.activityStatuses = v ? [...new Set([...s.activityStatuses, k])] : s.activityStatuses.filter((x) => x !== k);
            save();
          }),
        );
    new Setting(containerEl)
      .setName('Reminders')
      .setDesc('A notice inside Obsidian, once a day per project: overdue, due soon, or past its remind date. Nothing is written to notes.')
      .addToggle((t) => t.setValue(s.reminders).onChange((v) => ((s.reminders = v), save())));
    numSetting(new Setting(containerEl).setName('Remind this many days before due'), s, 'remindDays', 0, 30, save);
  }
}
/* @src src/tickets/plugin.js */
class NeonProjects extends Plugin {
  async onload() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, PROJECTS_DEFAULTS, raw || {});
    const s = this.settings;
    if (!s.notified || typeof s.notified !== 'object') s.notified = {};
    s.statusLog = Array.isArray(s.statusLog) ? s.statusLog.slice(-200) : [];
    s.activityStatuses = Array.isArray(s.activityStatuses) ? s.activityStatuses.slice() : ['done', 'waiting'];
    if (!PROJECT_SORTS.some(([k]) => k === s.tabSort)) s.tabSort = 'customer';
    this.applyProjectSettings();
    this.listeners = new Set();
    this.cache = null;

    this.registerView(VIEW_TICKETS, (leaf) => new ProjectsView(leaf, this));
    this.registerHoverLinkSource(VIEW_TICKETS, { display: `${appName()} projects`, defaultMod: true }); // page previews (hoverPreview)
    this.registerHoverLinkSource(VIEW_PLAN, { display: `${appName()} planning`, defaultMod: true });
    this.hookPlans(); // fork: Plan view and the buttons on project notes
    this.hookPlanMarks(); // fork: plan problems underlined in project notes (plan-marks.js)
    this.addRibbonIcon('briefcase', 'Projects', () => this.openTracker());
    this.addCommand({ id: 'open-tickets', name: 'Open the Projects tab', callback: () => this.openTracker() });
    this.addCommand({ id: 'new-ticket', name: 'New project', callback: () => this.newProject() });
    this.addCommand({ id: 'ticket-reminders', name: 'Show projects that need attention', callback: () => this.checkReminders(true) });
    const cur = (id, name, fn) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const t = this.projectFor(this.app.workspace.getActiveFile());
          if (!t) return false;
          if (!checking) fn(t);
          return true;
        },
      });
    cur('project-status', 'Project: set status of current project', (t) => {
      const m = new Menu();
      projectMenu(this, t, m);
      const r = document.body.getBoundingClientRect();
      m.showAtPosition({ x: r.width / 2, y: r.height / 3 });
    });
    cur('ticket-postpone-7', 'Project: postpone current project by 1 week', (t) => this.postpone(t, 7));
    cur('ticket-due', 'Project: set due date of current project', (t) => this.promptDate(t, 'due'));
    cur('project-note', 'Project: set note of current project', (t) => this.promptNote(t));
    this.addSettingTab(new NeonProjectsSettingTab(this.app, this));
    this.buildStatus();

    // only project notes invalidate the list: typing in other notes costs nothing
    this.hookBaselines(); // fork: automatic Planning baselines (src/tickets/plan-baseline.js)
    const dirty = () => {
      this.cache = null;
      this.planCache = null; // fork: plan counts on the rows
      this.emitSoon();
      this.autoBaselinesSoon(); // a project that has just started gets its baseline
      const api = deckApi(this.app);
      if (api && api.activityChanged) api.activityChanged(); // Recently done reads the closed dates
    };
    const known = (path) => !!(this.cache && this.cache.paths.has(path));
    this.registerEvent(this.app.metadataCache.on('changed', (f, _d, cache) => (isProjectCache(cache) || known(f.path) || this.inProjectFolders(f.path)) && dirty()));
    this.registerEvent(this.app.vault.on('delete', (f) => (known(f.path) || this.inProjectFolders(f.path)) && dirty()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (known(old) || f instanceof TFolder || isProjectCache(this.app.metadataCache.getFileCache(f))) && dirty()));
    const ref = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(ref);
      dirty();
    });
    this.registerEvent(ref);
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.hookCore();
      window.setTimeout(() => this.checkReminders(), 4000);
      this.registerInterval(window.setInterval(() => this.checkReminders(), 15 * 60 * 1000));
    });
  }
  onunload() {
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tickets');
      api.unregisterCapture('ticket');
      api.unregisterAction('tickets');
      api.unregisterFacts('tickets');
      if (api.unregisterActivity) api.unregisterActivity('tickets');
      api.unregisterWeekLine('tickets');
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit)
      this._emit = debounce(() => {
        for (const fn of this.listeners) fn();
        const api = deckApi(this.app);
        if (api) api.factsChanged();
      }, 300, true);
    this._emit();
  }
  /** New project from other modules (New note, capture): { title, customer }. */
  newTicket(opts) {
    this.newProject(opts || {});
  }
  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tickets', slot: 'tickets', title: 'Projects', icon: 'briefcase', open: () => this.openTracker(), openTitle: 'Open the Projects tab', mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'ticket', label: 'Project', short: 'Project', icon: 'briefcase', order: 20, allowEmpty: true, run: (v) => this.newProject({ title: v }) });
    api.registerAction({ id: 'tickets', icon: 'briefcase', label: 'Projects', order: 20, view: VIEW_TICKETS, run: () => this.openTracker() });
    if (api.registerActivity)
      api.registerActivity('tickets', () => this.closedActivity());
    api.registerFacts('tickets', () => {
      const act = this.activeProjects();
      const week = act.filter((t) => t.due && t.daysLeft >= 0 && t.daysLeft <= 7).length;
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const out = [{ v: week, l: week === 1 ? 'project due this week' : 'projects due this week' }];
      if (over) out.push({ v: over, l: 'overdue' });
      const n = this.closedIn(moment());
      if (n) out.push({ v: n, l: `closed in ${moment().format('MMMM')}` });
      return out;
    });
    api.registerWeekLine('tickets', (start, end) => {
      const n = this.collectProjects().filter((t) => t.completed && !t.completed.isBefore(start) && t.completed.isBefore(end)).length;
      return n ? [`${n} project${n === 1 ? '' : 's'} closed`] : [];
    });
  }
  openTracker() {
    return activateView(this.app, VIEW_TICKETS, 'tab');
  }
  buildStatus() {
    const el = this.addStatusBarItem();
    el.addClass('nd-status', 'tk-statusbar', 'mod-clickable');
    setIcon(el.createSpan('nd-status-icon'), 'briefcase');
    const txt = el.createSpan('nd-status-text');
    tip(el, 'Projects — click to open the Projects tab');
    el.addEventListener('click', () => this.openTracker());
    const update = () => {
      const act = this.activeProjects();
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const today = act.filter((t) => t.bucket === 'today').length;
      el.toggle(act.length > 0);
      const parts = [];
      if (over) parts.push(`${over} overdue`);
      if (today) parts.push(`${today} due today`);
      txt.setText(parts.length ? parts.join(' · ') : `${act.length} open projects`);
      el.toggleClass('is-alert', over > 0);
      el.toggleClass('is-warn', !over && today > 0);
    };
    this.register(this.onChange(update));
    this.registerInterval(window.setInterval(update, 5 * 60 * 1000));
    this.app.workspace.onLayoutReady(update);
  }
}
/* @src src/tickets/projects.js */
/* ---- projects (fork) --------------------------------------------------------
 * In this fork the Projects module (upstream: Tickets) tracks projects: notes tagged `project` (setting) with the vault's own
 * properties: status (values from settings, grouped into not started / active / on hold / closed),
 * started, due, completed, cancelled, stage, note and customer. The customer comes from the `customer`
 * property, else from the folder under the customers folder (1.Customers/<customer>/...). */

/** The setting's comma list, trimmed, without blanks or repeats (case kept for writing). */
function projectList(text) {
  const seen = new Set();
  return String(text || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}
/** NEON_PROJECTS from the settings: tag, value → kind map, the order offered, the cancelled value. */
function projectConfig(s) {
  const groups = [
    ['open', projectList(s.statusNotStarted)],
    ['in-progress', projectList(s.statusActive)],
    ['waiting', projectList(s.statusOnHold)],
    ['done', projectList(s.statusClosed)],
  ];
  const kinds = {};
  const order = [];
  for (const [kind, values] of groups)
    for (const v of values) {
      if (kinds[v.toLowerCase()]) continue;
      kinds[v.toLowerCase()] = kind;
      order.push(v);
    }
  return { tag: String(s.projectTag || '').trim().replace(/^#/, ''), kinds, order, cancelled: String(s.statusCancelled || '').trim() };
}
/** Customer of a note: its `customer` property, else the folder under the customers folder. */
function projectCustomer(path, fm, customersFolder) {
  // fork: the group properties (a name, link or path; see groupFromProps), shown as the group folder's name
  const g = groupFromProps(fm, path);
  if (g) return CAT_LABEL[g] || g;
  // a plain name that isn't a group folder is still shown as written (customer: acme widgets → acme widgets)
  const c = fm && fm[groupProps()[0]];
  if (c != null && typeof c !== 'object' && String(c).trim() && !/^\[\[|\//.test(String(c).trim())) return String(c).trim();
  const root = folderSetting(customersFolder);
  if (!root || !path.startsWith(root + '/')) return '';
  const rest = path.slice(root.length + 1).split('/');
  const k = rest.length > 1 ? rest[0] : '';
  return k && !(NEON_CATS.skip || []).some((x) => x.toLowerCase() === k.toLowerCase()) ? k : ''; // fork: not the "Not groups" folders
}
/**
 * fork: the note that stands for a project folder (see folderProjects): { file, own }, or null when the folder has
 * no notes. own: a note named like the folder, or one with a status, which may hold the project's status. Otherwise
 * file is only for opening (an index note, say) and is never written to: notes with an ignored tag (generated index
 * notes) are not "own".
 */
function projectFolderNote(app, folder) {
  const notes = [];
  const walk = (fd, depth) => {
    for (const c of fd.children || []) {
      if (c instanceof TFile && c.extension === 'md') notes.push({ file: c, depth });
      else if (c instanceof TFolder && depth < 2) walk(c, depth + 1);
    }
  };
  walk(folder, 0);
  if (!notes.length) return null;
  const top = notes.filter((n) => n.depth === 0).map((n) => n.file);
  const fm = (f) => (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
  const mine = top.filter((f) => !isIgnoredNote(app, f));
  const same = mine.find((f) => f.basename.toLowerCase() === folder.name.toLowerCase());
  if (same) return { file: same, own: true };
  const withStatus = mine.find((f) => fm(f).status != null && String(fm(f).status).trim());
  if (withStatus) return { file: withStatus, own: true };
  const index = top.find((f) => /^(0\.?\s*index|index|readme)$/i.test(f.basename));
  return { file: index || top[0] || notes[0].file, own: false };
}
/** A project's display title: the file name, without a leading "Project : ". */
function projectTitle(basename) {
  return basename.replace(/^project\s*:\s*/i, '') || basename;
}
/**
 * Property changes for moving a project to a status value (pure, testable).
 * Closing writes `completed` (or `cancelled` for the cancelled value) with today's date;
 * leaving a closed status removes them. Upstream waiting fields are cleared.
 */
function projectStatusPatch(value, prevKind, today, cfg) {
  const kind = cfg.kinds[String(value).toLowerCase()] || 'open';
  const patch = { status: value, waiting_on: null, follow_up: null, waiting_since: null };
  if (kind === 'done') {
    const cancelled = cfg.cancelled && String(value).toLowerCase() === cfg.cancelled.toLowerCase();
    if (cancelled) Object.assign(patch, { cancelled: today, completed: null });
    else Object.assign(patch, { completed: today, cancelled: null });
  } else if (prevKind === 'done') Object.assign(patch, { completed: null, cancelled: null });
  return { kind, patch };
}

Object.assign(NeonProjects.prototype, {
  applyProjectSettings() {
    Object.assign(NEON_PROJECTS, projectConfig(this.settings));
    NEON_PLAN.folders = this.settings.projectFolders || ''; // fork: project folders are plans too
    NEON_PLAN.holidayName = (this.settings.planHolidayName || 'Holidays').trim() || 'Holidays'; // fork: Holidays notes (plan-calendar.js)
    NEON_PLAN.me = (this.settings.planMe || '').trim(); // fork: you, for the task editor's calendar
    NEON_CATS.label = this.settings.groupLabel || 'Customer'; // fork
    NEON_CATS.prop = (this.settings.groupProperty || 'customer').trim() || 'customer';
    NEON_CATS.skip = String(this.settings.groupSkip || '').split(',').map((x) => x.trim()).filter(Boolean); // fork
    refreshCategories(this.app, this.settings.customersFolder); // fork: customers are the categories too
    this.cache = null;
  },
  /** Status values offered (in order); `kind` limits them to one group. */
  statusChoices(kind) {
    return NEON_PROJECTS.order.filter((v) => !kind || NEON_PROJECTS.kinds[v.toLowerCase()] === kind);
  },
  statusKind(value) {
    return projectKind(value);
  },
  /** Folders under the customers folder, A–Z. */
  customers() {
    const root = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.customersFolder || ''));
    if (!(root instanceof TFolder)) return [];
    return root.children.filter((c) => c instanceof TFolder).map((c) => c.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  },
  /** The free-text `note` property: what's happening right now. */
  promptNote(t) {
    new PromptModal(this.app, {
      title: `Note for ${t.title}`,
      value: t.note,
      placeholder: 'Current status or recent change',
      cta: 'Save',
      onSubmit: (v) => this.patch(t, { note: v.trim() || null }),
    }).open();
  },
  /** Where projects without a customer go: the setting, else <base folder>/Projects. */
  projectFolder() {
    return locPath(this.settings.projectFolder, 'Projects');
  },
  /** fork: a project folder without a note of its own gets one, <folder>/<folder name>.md, from the project template. */
  createFolderProjectNote(t) {
    if (!t.folder) return;
    return this.createProject(t.title, '', t.folder);
  },
  newProject(opts = {}) {
    new NewProjectModal(this, opts).open();
  },
  /** Make a project note from the template (or the standard properties) and open it. */
  async createProject(title, customer, inFolder) {
    const s = this.settings;
    const day = moment();
    const folder = inFolder || (customer ? normalizePath(`${s.customersFolder}/${customer}/${s.projectsFolderName || 'Projects'}`) : this.projectFolder());
    let body = '';
    if (s.projectTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.projectTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.projectTemplate));
      if (tf instanceof TFile) body = applyTemplate(await this.app.vault.read(tf), day, title);
      else new Notice(`Project template “${s.projectTemplate}” not found: using the standard properties`);
    }
    if (!body) {
      const first = this.statusChoices('open')[0] || 'init';
      body = ['---', `title: ${JSON.stringify(title)}`, 'tags:', `  - ${NEON_PROJECTS.tag || 'project'}`, `started: ${day.format('YYYY-MM-DD')}`, 'due:', 'completed:', `status: ${first}`, '---', '', `# ${title}`, ''].join('\n');
    }
    const f = await createUnique(this.app, folder, title, body);
    await openNewNote(this.app, f);
    return f;
  },
});

/** New project: a name and a customer (the folder it goes in). */
class NewProjectModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText('New project');
    const el = this.contentEl;
    const name = el.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Project name' } });
    name.value = this.opts.title || '';
    name.style.width = '100%';
    const list = p.customers();
    const active = this.app.workspace.getActiveFile();
    const guess = active ? projectCustomer(active.path, null, p.settings.customersFolder) : '';
    const sel = el.createEl('select', { cls: 'dropdown' });
    sel.style.marginTop = '10px';
    for (const c of list) sel.createEl('option', { value: c, text: c });
    sel.createEl('option', { value: '', text: list.length ? `No ${groupWord(false, true)} (project folder)` : `No ${groupWord(true, true)} found in ${p.settings.customersFolder}` });
    const want = this.opts.customer || guess;
    sel.value = list.includes(want) ? want : list[0] || '';
    const where = el.createDiv({ cls: 'setting-item-description' });
    const show = () => where.setText(`Goes in ${sel.value ? `${p.settings.customersFolder}/${sel.value}/${p.settings.projectsFolderName || 'Projects'}` : p.projectFolder()}/`);
    sel.addEventListener('change', show);
    show();
    const go = async () => {
      const t = name.value.trim();
      if (!t) return name.focus();
      this.close();
      try {
        await p.createProject(t, sel.value);
      } catch (e) {
        if (!(e && e.neonReadOnly)) {
          console.error(`${appName()} – Projects: could not create the project`, e);
          new Notice('Could not create the project');
        }
      }
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && go());
    const foot = el.createDiv('modal-button-container');
    button(foot, { text: 'Create project', cls: 'mod-cta', onClick: go });
    window.setTimeout(() => name.focus(), 0);
  }
  onClose() {
    this.contentEl.empty();
  }
}
/* @src src/tickets/model.js */
Object.assign(NeonProjects.prototype, {
  /* collecting ------------------------------------------------------------- */
  /** Every project note (excluded folders skipped), cached until a project note changes or the day turns. */
  collectProjects() {
    if (this.cache && this.cache.day === dayKey(Date.now())) return this.cache.list;
    const out = [];
    const today = moment().startOf('day');
    const deck = neonPlugin(this.app, 'neon-deck');
    for (const { file: f, cache } of noteIndex(this.app).projects()) {
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      out.push(this.toProject(f, cache, today));
    }
    out.push(...this.folderProjects(out, today, deck)); // fork: PARA project folders
    out.sort(projectSort);
    this.cache = { day: dayKey(Date.now()), list: out, paths: new Set(out.map((t) => t.file.path)) };
    return out;
  },
  /** A project from its note's properties. */
  toProject(f, cache, today) {
    const fm = (cache && cache.frontmatter) || {};
    const text = (v) => (v != null && typeof v !== 'object' ? String(v).trim() : '');
    const started = parseDay(fm.started);
    const created = parseDay(fm.created) || started || moment(f.stat.ctime);
    const due = parseDay(fm.due);
    const remindRaw = text(fm.remind);
    const statusRaw = text(fm.status);
    const status = projectKind(statusRaw);
    const t = {
      file: f,
      title: projectTitle(f.basename),
      statusRaw,
      status,
      customer: projectCustomer(f.path, fm, this.settings.customersFolder),
      stage: text(fm.stage),
      note: text(fm.note),
      category: noteCategory(cache, f.path) || 'other',
      created,
      startedOn: started,
      due,
      remind: parseDay(remindRaw),
      completed: parseDay(fm.completed) || parseDay(fm.cancelled),
      daysLeft: due ? daysFromToday(due) : null,
      age: Math.max(0, today.diff((started || created).clone().startOf('day'), 'days')),
      progress: 0,
    };
    if (due) {
      const from = started || created;
      const span = due.clone().endOf('day').diff(from, 'minutes');
      t.progress = span > 0 ? clamp(moment().diff(from, 'minutes') / span, 0, 1) : 1;
    }
    t.bucket = status === 'done' ? 'done' : !due ? 'nodate' : t.daysLeft < 0 ? 'overdue' : t.daysLeft === 0 ? 'today' : t.daysLeft <= 7 ? 'week' : 'later';
    return t;
  },
  /**
   * fork: with "Project folders" set (e.g. 1.Projects), each folder directly inside it is a project too, unless a
   * tagged project note already lives in it. Its note is <folder>/<folder name>.md, else a note there with a status,
   * else its index note (0.Index, index, README), else its first note; the project's status and dates come from it.
   */
  folderProjects(tagged, today, deck) {
    const root = folderSetting(this.settings.projectFolders);
    const top = root && this.app.vault.getAbstractFileByPath(root);
    if (!(top instanceof TFolder)) return [];
    const out = [];
    for (const folder of top.children) {
      if (!(folder instanceof TFolder)) continue;
      if (deck && deck.isExcluded && deck.excludedPaths && deck.excludedPaths().some((p) => folder.path === p || folder.path.startsWith(p + '/'))) continue;
      if (tagged.some((t) => t.file.path.startsWith(folder.path + '/'))) continue;
      const rep = projectFolderNote(this.app, folder);
      if (!rep) continue;
      const t = this.toProject(rep.file, this.app.metadataCache.getFileCache(rep.file), today);
      t.title = folder.name;
      t.folder = folder.path;
      if (!rep.own) {
        // fork: its note is only for opening (e.g. a generated index): no status of its own, nothing written there
        Object.assign(t, { noNote: true, statusRaw: '', status: 'open', stage: '', note: '', due: null, daysLeft: null, remind: null, completed: null, bucket: 'nodate', progress: 0 });
      }
      if (!t.customer) t.customer = projectCustomer(folder.path + '/x.md', null, this.settings.customersFolder);
      out.push(t);
    }
    return out;
  },
  /** fork: is this path inside a project folder (so a change there may change the folder projects)? */
  inProjectFolders(path) {
    const root = folderSetting(this.settings.projectFolders);
    return !!root && !!path && path.startsWith(root + '/') && path.slice(root.length + 1).includes('/');
  },
  activeProjects() {
    return this.collectProjects().filter((t) => t.status !== 'done');
  },
  projectFor(file) {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return isProjectCache(cache) ? this.toProject(file, cache, moment().startOf('day')) : null;
  },
  closedIn(m) {
    return this.collectProjects().filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
  },
  renderCounter(el, all) {
    el.empty();
    const now = moment();
    const last = now.clone().subtract(1, 'month');
    const closed = (m) => all.filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
    el.createSpan({ cls: 'tk-counter-n', text: String(closed(now)) });
    el.createSpan({ cls: 'tk-counter-l', text: `closed in ${now.format('MMMM')} · ${closed(last)} in ${last.format('MMMM')}` });
  },
});
/* @src src/tickets/actions.js */
Object.assign(NeonProjects.prototype, {
  /* writing: properties only ------------------------------------------------- */
  /** Set properties; null removes one, except keys your template keeps empty (they stay, empty). */
  async patch(t, patch) {
    await this.app.fileManager.processFrontMatter(t.file, (fm) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v !== null && v !== '') fm[k] = v;
        else if (k === 'cancelled' || k === 'note' || k === 'remind') delete fm[k];
        else if (k in fm) fm[k] = null;
      }
    });
    this.app.workspace.trigger('neon:project-changed', { file: t.file, title: t.title, change: Object.keys(patch).join(', ') });
  },
  /**
   * A project's status. `target` is one of your status values, or a group ('open', 'in-progress',
   * 'waiting', 'done') meaning the first value of that group. Writes status, and completed / cancelled dates.
   */
  async setStatus(t, target) {
    const value = PROJECT_KINDS.includes(target) ? this.statusChoices(target)[0] || target : target;
    if (!value || (t.statusRaw && value.toLowerCase() === t.statusRaw.toLowerCase())) return false;
    const { kind, patch } = projectStatusPatch(value, t.status, moment().format('YYYY-MM-DD'), NEON_PROJECTS);
    await this.patch(t, patch);
    this.logStatus(t, kind, value);
    if (kind === 'done') new Notice(`✓ ${t.title} — ${value}`);
    return true;
  },
  /**
   * Recently done on the dashboard (fork): projects closed in the last 14 days, read from their `completed` /
   * `cancelled` date, however the status was changed; plus projects put on hold from these menus (still logged).
   */
  closedActivity() {
    const cut = moment().startOf('day').subtract(13, 'days');
    const out = [];
    const open = (path) => () => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) this.openProject(f);
    };
    if (this.settings.activityStatuses.includes('done'))
      for (const t of this.collectProjects())
        if (t.status === 'done' && t.completed && !t.completed.isBefore(cut))
          out.push({ t: t.completed.clone().startOf('day').valueOf(), allDay: true, kind: 'ticket', text: t.title, src: t.customer || '', status: 'done', label: t.statusRaw || 'Closed', open: open(t.file.path) });
    for (const x of this.settings.statusLog)
      if (projectKind(x.status) === 'waiting' && this.settings.activityStatuses.includes('waiting')) out.push({ t: x.t, kind: 'ticket', text: x.title, src: '', status: 'waiting', label: x.status, open: open(x.path) });
    return out;
  },
  /** Projects set to a status group chosen in settings, from these menus (only 'on hold' is shown; closed comes from the notes). */
  logStatus(t, kind, value) {
    if (!this.settings.activityStatuses.includes(kind)) return;
    const log = this.settings.statusLog;
    log.push({ t: Date.now(), title: t.title, status: value, path: t.file.path });
    if (log.length > 200) log.splice(0, log.length - 200);
    this.saveSettings();
    const api = deckApi(this.app);
    if (api && api.activityChanged) api.activityChanged();
  },
  async postpone(t, days) {
    const base = t.due && !t.due.isBefore(moment(), 'day') ? t.due.clone() : moment();
    await this.patch(t, { due: base.add(days, 'days').format('YYYY-MM-DD') });
  },
  /** Ask for a date (YYYY-MM-DD) for a date property: due or remind. */
  promptDate(t, key) {
    const cur = key === 'due' ? t.due : t.remind;
    new PromptModal(this.app, {
      title: key === 'due' ? `Due date for ${t.title}` : `Remind me about ${t.title}`,
      value: cur ? cur.format('YYYY-MM-DD') : moment().add(7, 'days').format('YYYY-MM-DD'),
      placeholder: 'YYYY-MM-DD (empty clears it)',
      cta: 'Save',
      onSubmit: (v) => {
        const d = v.trim() ? moment(v.trim(), ['YYYY-MM-DD', 'D/M/YYYY', 'D MMM YYYY'], true) : null;
        if (v.trim() && !(d && d.isValid())) return new Notice('Use a date like 2026-11-20');
        this.patch(t, { [key]: d ? d.format('YYYY-MM-DD') : null });
      },
    }).open();
  },
  openProject(file, e) {
    openFile(this.app, file, e);
  },
});

/** Right-click / ⋯ menu of a project. */
function projectMenu(plugin, t, m) {
  m.addItem((i) => i.setTitle('Open').setIcon('briefcase').onClick(() => plugin.openProject(t.file)));
  m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => plugin.app.workspace.getLeaf('tab').openFile(t.file)));
  m.addItem((i) => i.setTitle('Planning').setIcon('calendar-range').onClick(() => plugin.openPlan(plugin.planScope(t), 'gantt'))); // fork
  m.addSeparator();
  if (t.noNote) {
    // fork: a project folder without a note of its own: offer to make one rather than write to its index note
    m.addItem((i) => i.setTitle(`Create “${t.title}.md” to track this project`).setIcon('file-plus').onClick(() => plugin.createFolderProjectNote(t)));
    return;
  }
  for (const v of plugin.statusChoices()) m.addItem((i) => i.setTitle(`Status: ${v}`).setChecked((t.statusRaw || '').toLowerCase() === v.toLowerCase()).onClick(() => plugin.setStatus(t, v)));
  m.addSeparator();
  m.addItem((i) => i.setTitle('Set note…').setIcon('message-square').onClick(() => plugin.promptNote(t)));
  for (const [n, label] of [[1, '+1 day'], [7, '+1 week'], [14, '+2 weeks']]) m.addItem((i) => i.setTitle(`Postpone ${label}`).setIcon('calendar-clock').onClick(() => plugin.postpone(t, n)));
  m.addItem((i) => i.setTitle('Set due date…').setIcon('calendar').onClick(() => plugin.promptDate(t, 'due')));
  m.addItem((i) => i.setTitle('Remind me on…').setIcon('bell').onClick(() => plugin.promptDate(t, 'remind')));
}
/* @src src/tickets/widget.js */
Object.assign(NeonProjects.prototype, {
  /* the dashboard card ---------------------------------------------------------- */
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'New project', onClick: () => p.newProject() });
    const counter = card.body.createDiv('tk-counter is-mini');
    card.body.addClass('is-list'); // a column, the list filling it (styles-tracker.css)
    const list = card.body.createDiv('tk-mini-list');
    let renders = 0;
    const render = () => {
      if (!list.isConnected) return;
      list.toggleClass('is-calm', renders++ > 0);
      const all = p.collectProjects();
      const act = all.filter((t) => t.status !== 'done');
      card.badge.setText(act.length ? String(act.length) : '');
      card.w.toggleClass('has-overdue', act.some((t) => t.bucket === 'overdue'));
      p.renderCounter(counter, all);
      list.empty();
      if (!act.length) return void emptyState(list, 'No open projects ✦');
      act.slice(0, 30).forEach((t, i) => {
        // fork: two lines: the title and its status; under them when it is due, the customer and what needs action
        const r = list.createDiv(`tk-mini tk-mini-2 is-${t.bucket}`);
        r.style.setProperty('--i', String(Math.min(i, 20)));
        const main = r.createDiv('tk-mini-main');
        const top = main.createDiv('tk-mini-top');
        tip(top.createSpan({ cls: 'tk-mini-title', text: t.title }), t.customer ? `${t.title} · ${t.customer}` : t.title);
        if (t.statusRaw) top.createSpan({ cls: `tk-tag-wait s-${t.status}`, text: t.statusRaw });
        const meta = main.createDiv('tk-mini-meta');
        meta.createSpan({ cls: 'tk-mini-due', text: projectDueText(t) });
        if (t.customer) meta.createSpan({ cls: 'tk-mini-cust', text: t.customer });
        p.renderPlanBadges(meta, t); // fork: late, overdue, due soon, blocked: small coloured pills
        r.addEventListener('click', (e) => p.openProject(t.file, e));
        hoverPreview(p.app, r, t.file);
        r.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const m = new Menu();
          projectMenu(p, t, m);
          m.showAtMouseEvent(e);
        });
      });
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },

  /* reminders: inside Obsidian only, once a day per project; nothing is written to notes ---------- */
  async checkReminders(force) {
    if (!this.settings.reminders && !force) return;
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    this.cache = null;
    const seen = this.settings.notified;
    for (const k of Object.keys(seen)) if (seen[k] !== today) delete seen[k];
    const ahead = this.settings.remindDays;
    const due = this.activeProjects().filter((t) => (t.due && t.daysLeft <= ahead) || (t.remind && !t.remind.isAfter(now)));
    const fresh = force ? due : due.filter((t) => seen[t.file.path] !== today);
    if (!fresh.length) {
      if (force) new Notice('No projects need attention right now ✦');
      return;
    }
    for (const t of fresh) seen[t.file.path] = today;
    await this.saveSettings();
    const frag = createFragment((d) => {
      d.createDiv({ cls: 'tk-notice-title', text: `${fresh.length} project${fresh.length === 1 ? '' : 's'} need${fresh.length === 1 ? 's' : ''} attention` });
      for (const t of fresh.slice(0, 6)) {
        const line = d.createDiv({ cls: `tk-notice-line is-${t.bucket}` });
        line.createSpan({ cls: 'tk-notice-due', text: projectDueText(t) });
        line.createSpan({ text: ` ${t.title}` });
      }
      if (fresh.length > 6) d.createDiv({ text: `+${fresh.length - 6} more` });
      d.createDiv({ cls: 'tk-notice-hint', text: 'Click to open the Projects tab' });
    });
    const n = new Notice(frag, 0);
    const el = n.noticeEl || n.messageEl;
    if (el) {
      el.addClass('tk-notice');
      el.addEventListener('click', () => this.openTracker());
    }
  },
});
/* @src src/tickets/plan-summary.js */
/* ---- Project plans (fork): task counts on the project rows ------------------------------------------------------
 * Tasks in project notes don't show on the Tasks card (setting in the Tasks section); each project's row shows how
 * its own tasks stand instead, so nothing overdue goes unseen. Counts are cached until a project note changes. */

Object.assign(NeonProjects.prototype, {
  /** The plan a project row stands for: its folder, else the folder or note its note belongs to. */
  planScope(t) {
    if (t.folder) return { kind: 'folder', path: t.folder };
    return planScopeOf(this.app, t.file) || { kind: 'note', path: t.file.path };
  },
  /** Promise of the project's task counts (planCounts), or null when they can't be read. */
  planSummary(t) {
    const scope = this.planScope(t);
    const key = `${scope.kind}:${scope.path}`;
    if (!this.planCache) this.planCache = new Map();
    if (!this.planCache.has(key)) {
      const today = moment().format('YYYY-MM-DD');
      const ymd = (m) => (m && m.format ? m.format('YYYY-MM-DD') : null);
      const job = planCollect(this.app, scope, { neighbours: false })
        // fork: a link to an id outside the project may be another project's task: look further only then
        .then((tasks) => (planProblems(tasks).some((p) => p.kind === 'missing') ? planCollect(this.app, scope) : tasks))
        .then((tasks) => {
          const c = planCounts(tasks.filter((x) => !x.external), today);
          c.problems = planProblems(tasks).map((p) => p.text); // missing ids, ids used twice, loops
          // the forecast finish against the due date, when the project has a started date
          const base = ymd(t.startedOn);
          const g = base && c.total ? planGanttText(tasks, { base, today, due: ymd(t.due) }) : null;
          return Object.assign(c, { end: g ? g.end : null, late: g ? g.late : 0, due: ymd(t.due) });
        })
        .catch((e) => {
          console.error('Projects: could not read the project tasks', e);
          return null;
        });
      this.planCache.set(key, job);
    }
    return this.planCache.get(key);
  },
  /** Adds the counts to a row once read; short: only overdue and due this week. Plan problems are always shown. */
  renderPlanSummary(el, t, short = false) {
    this.planSummary(t).then((c) => {
      if (!c || !el.isConnected) return;
      const late = c.late ? `${c.late} working day${c.late === 1 ? '' : 's'} late` : '';
      const text = short ? [planSummaryText(c, true), late].filter(Boolean).join(' · ') : [planSummaryText(c), planForecastText(c.end, c.due, c.late)].filter(Boolean).join(' · ');
      if (!text) return;
      const s = el.createSpan({ cls: `tk-age tk-plan${c.overdue || c.late ? ' is-overdue' : ''}${short ? ' is-short' : ''}`, text: short ? ` · ${text}` : text });
      tip(s, 'This project’s tasks (ready: nothing it depends on is still open)');
      if (c.problems && c.problems.length) tip(el.createSpan({ cls: 'tk-age tk-plan is-overdue tk-plan-problems', text: ` · ${planProblemCount(c.problems.length)}` }), c.problems.join('\n'));
    });
  },
  /** The dashboard card's pills: late, overdue, due soon, blocked (only what needs action). */
  renderPlanBadges(el, t) {
    this.planSummary(t).then((c) => {
      if (!c || !el.isConnected) return;
      const pills = [
        [c.late, `${c.late}d late`, 'is-late', `Forecast finish ${c.late} working day${c.late === 1 ? '' : 's'} after the due date`],
        [c.overdue, `${c.overdue} overdue`, 'is-overdue', 'Tasks past their 📅 date'],
        [c.week, `${c.week} due soon`, 'is-soon', 'Tasks due within a week'],
        [c.blocked, `${c.blocked} blocked`, 'is-blocked', 'Tasks held up by an overdue or #blocked task'],
        [(c.problems || []).length, planProblemCount((c.problems || []).length), 'is-problem', `Open Planning to fix:\n${(c.problems || []).join('\n')}`],
      ];
      for (const [n, text, cls, title] of pills) if (n) tip(el.createSpan({ cls: `tk-pill ${cls}`, text }), title);
    });
  },
});
/* @src src/tickets/plan-gantt.js */
/* ---- Project plans (fork): a plan as Mermaid Gantt text (pure) ----------------------------------------------------
 * Bars come from the schedule (planSchedule): working days, weekends left out. With the project's start date the
 * axis shows dates; without one (or with weeks chosen) it counts weeks from a fixed Monday, so it reads Wk 01, Wk 02…
 * In date mode a task's own 🛫 start / 📅 due dates win over the schedule. One section per phase (the heading the
 * task sits under), in note order; tasks outside the project last. The text keeps Mermaid's own tags (done, active,
 * crit) for when it is pasted into a note; the Plan view colours each bar by its kind (planBarKind). */

const PLAN_OUTSIDE = 'Outside this project';
const PLAN_SOON_DAYS = 7; // due within this many days: "due soon"

/**
 * Kind of a task's bar: outside, done, overdue (its 📅 date has passed, or work in progress was planned to finish
 * before today), soon (📅 within a week), doing, blocked, waiting or ready. finish: the bar's last day (date mode) or null.
 */
function planBarKind(t, state, today, finish = null) {
  if (t.external) return 'outside';
  if (state === 'done') return 'done';
  if (today && ((t.due && t.due < today) || (state === 'doing' && finish && finish < today))) return 'overdue';
  if (today && t.due && t.due <= ymdAdd(today, PLAN_SOON_DAYS)) return 'soon';
  return state === 'doing' || state === 'blocked' || state === 'waiting' ? state : 'ready';
}

/** The marker of a task (#risk, #issue, #decision; the first one if several), or null. */
const planMark = (t) => PLAN_MARKS.find(([k]) => (t.marks || []).includes(k)) || null;
// how bad a state is, for a phase's colour (its worst task)
const PLAN_WORST = ['overdue', 'blocked', 'soon', 'doing', 'waiting', 'ready', 'outside', 'done'];

/**
 * { text, sched, bars: [{ id, task, kind, crit, mark, start, end }], end, late }: Mermaid gantt text. base: the
 * project's start date or null. phases: one bar per phase (its first start to its last finish, coloured by its worst
 * task). due: the project's due date; with real dates the plan's forecast finish and the due date are drawn as two
 * milestones, and late says how many working days the forecast is past the due date (0: on time).
 * With real dates, working days follow the settings' calendar and a task stretches over its owners' time off (leave:
 * the time off planCollect gathered); counted in weeks, plain Monday to Friday.
 */
function planGanttText(tasks, { base = null, weeks = false, today = null, maxName = 45, show = null, phases = false, due = null, leave = tasks.leave } = {}) {
  const relative = weeks || !base;
  const cal = relative ? PLAN_PLAIN_CAL : tasks.calendar || planCal();
  const W = (d, n) => planWorkdays(d, n, cal);
  const from = relative ? PLAN_WEEK_BASE : W(base, 0);
  // with real dates, work not started yet is forecast from today, not from the project's start
  const sched = planSchedule(tasks, { notBefore: !relative && today ? planWorkdaysBetween(from, today, cal) : 0, from: relative ? null : from, span: relative ? null : planLeaveSpan(leave, from, cal) });
  const { byId } = planIndex(tasks);
  const lines = ['gantt', '  dateFormat YYYY-MM-DD', `  axisFormat ${relative ? 'Wk %W' : '%d %b'}`, '  tickInterval 1week', '  weekday monday', '  excludes weekends', `  todayMarker ${!relative && today ? 'on' : 'off'}`];
  const groups = new Map();
  for (const r of sched.rows) {
    const k = r.task.external ? PLAN_OUTSIDE : r.task.phase || 'Tasks';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  if (groups.has(PLAN_OUTSIDE)) {
    const out = groups.get(PLAN_OUTSIDE);
    groups.delete(PLAN_OUTSIDE);
    groups.set(PLAN_OUTSIDE, out);
  }
  const bars = [];
  const drawn = []; // what is drawn, in order: { section } headings and { bar, label, milestone, thin } rows
  let end = null;
  for (const [name, rows] of groups) {
    lines.push(`  section ${mermaidSafe(name)}`);
    drawn.push({ section: name });
    const mine = [];
    for (const r of rows) {
      const t = r.task;
      const state = planState(t, byId, today);
      const crit = r.crit && !t.external && state !== 'done';
      const days = planDays(t);
      let start;
      let last; // the bar's last day (inclusive)
      if (t.milestone) start = last = !relative && (t.due || t.start) ? t.due || t.start : W(from, r.es);
      else if (!relative && t.start && t.due && t.due >= t.start) [start, last] = [t.start, t.due];
      else {
        // done: where it really started; open: the schedule, which keeps a 🛫 date as "not before"
        // the bar's end: from the schedule, so it takes in the owners' time off
        const done = !relative && t.start && planClosed(t);
        start = done ? t.start : W(from, r.es);
        last = done ? W(start, Math.max(0, days - 1)) : W(from, Math.max(r.es, r.ef - 1));
      }
      const mark = planMark(t);
      const bar = { id: `np${bars.length + 1}`, task: t, kind: planBarKind(t, state, today, relative ? null : last), crit, mark: mark ? mark[0] : null, start, end: last };
      bars.push(bar);
      if (!t.external && !relative && (!end || last > end)) end = last;
      if (show && !show(t)) continue; // filtered out (one person): still in the schedule, not drawn
      mine.push(bar);
      if (phases) continue;
      const who = planOwnerShort(t);
      const sign = mark ? `${mark[1]} ` : '';
      const label = planClip(mermaidSafe(sign + (t.external ? '↗ ' : '') + planText(t.raw)), maxName - (who ? who.length + 3 : 0)) + (who ? ` · ${mermaidSafe(who)}` : '');
      const tags = state === 'done' ? ['done'] : [...(state === 'doing' ? ['active'] : []), ...(crit ? ['crit'] : [])];
      const when = t.milestone ? `${start}, 0d` : !relative && t.start && t.due && t.due >= t.start ? `${start}, ${ymdAdd(t.due, 1)}` : `${start}, ${days ? `${days}d` : '4h'}`; // 0 days: a thin bar
      lines.push(`  ${label} :${[...tags, ...(t.milestone ? ['milestone'] : []), bar.id].join(', ')}, ${when}`);
      const pri = planPrioritySign(t.priority ?? 2);
      drawn.push({ bar, label: (pri ? `${pri} ` : '') + sign + (t.external ? '↗ ' : '') + planText(t.raw), who, steps: t.steps || null, stepsDone: planStepsDone(t), milestone: !!t.milestone, thin: !t.milestone && !days });
    }
    if (phases && mine.length) {
      // one bar for the phase: first start to last finish, its worst task's colour
      const first = mine.reduce((a, b) => (b.start < a ? b.start : a), mine[0].start);
      const last = mine.reduce((a, b) => (b.end > a ? b.end : a), mine[0].end);
      const kind = PLAN_WORST.find((k) => mine.some((b) => b.kind === k)) || 'ready';
      const crit = mine.some((b) => b.crit);
      const marks = PLAN_MARKS.filter(([k]) => mine.some((b) => b.mark === k)).map((m) => m[1]).join('');
      const done = mine.filter((b) => b.kind === 'done').length;
      const bar = { id: `np${bars.length + 1}`, task: null, phase: name, kind, crit, mark: null, start: first, end: last };
      bars.push(bar);
      const label = planClip(mermaidSafe(`${marks ? `${marks} ` : ''}${name} (${done}/${mine.length} done)`), maxName + 10);
      lines.push(`  ${label} :${[...(kind === 'done' ? ['done'] : crit ? ['crit'] : []), bar.id].join(', ')}, ${first}, ${ymdAdd(last, 1)}`);
      drawn.push({ bar, label: `${marks ? `${marks} ` : ''}${name} (${done}/${mine.length} done)`, who: '', milestone: false, thin: false });
    }
  }
  let late = 0;
  if (!relative && end) {
    // the project: its forecast finish, and its due date if it has one
    late = due && end > due ? planWorkdaysBetween(due, end, cal) : 0;
    lines.push('  section Project');
    drawn.push({ section: 'Project' });
    const fin = { id: `np${bars.length + 1}`, task: null, kind: late ? 'overdue' : 'ready', crit: false, mark: null, start: end, end };
    bars.push(fin);
    lines.push(`  Forecast finish ${planShortDate(end)} :milestone, ${fin.id}, ${end}, 0d`);
    drawn.push({ bar: fin, label: `Forecast finish ${planShortDate(end)}`, who: '', milestone: true, thin: false });
    if (due) {
      const d = { id: `np${bars.length + 1}`, task: null, kind: late ? 'overdue' : 'done', crit: false, mark: null, start: due, end: due };
      bars.push(d);
      lines.push(`  Due ${planShortDate(due)}${late ? ` (${planWorkingDays(late)} late)` : ''} :milestone, ${d.id}, ${due}, 0d`);
      drawn.push({ bar: d, label: `Due ${planShortDate(due)}${late ? ` (${planWorkingDays(late)} late)` : ''}`, who: '', milestone: true, thin: false });
    }
  }
  const kept = lines.filter((l, i) => !(l.startsWith('  section ') && (lines[i + 1] === undefined || lines[i + 1].startsWith('  section '))));
  // headings with nothing under them (a person's filter) go, as in the text
  const shown = drawn.filter((r, i) => !(r.section && (!drawn[i + 1] || drawn[i + 1].section)));
  return { text: kept.some((l) => / :/.test(l)) ? kept.join('\n') : '', sched, bars, rows: shown, end, late, relative }; // task lines hold ' :'
}

/** "Wk 3" (relative) or "Mon 23 Nov" for a working-day offset from the start. */
function planDayLabel(offset, base, weeks) {
  if (weeks || !base) return `Wk ${Math.floor(offset / 5) + 1}`;
  const d = planWorkdays(base, offset);
  return moment(d, 'YYYY-MM-DD').format('ddd D MMM');
}
/* @src src/tickets/plan-export.js */
/* ---- Project plans (fork): a drawn chart as SVG text, for the Planning report -------------------------------------
 * The chart already drawn is copied with its theme colours (CSS variables) written in, so the report's chart file
 * looks the same outside Obsidian. (The SVG and Copy as Mermaid buttons were dropped, 17 Nov: the report covers it.) */

/** The SVG text of a drawn chart, with sizes, a background and the theme's CSS variables resolved. */
function planSvgText(svg) {
  const css = getComputedStyle(document.body);
  const box = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(Math.ceil(box.width)));
  copy.setAttribute('height', String(Math.ceil(box.height)));
  copy.style.maxWidth = 'none';
  copy.style.backgroundColor = css.getPropertyValue('--background-primary').trim() || '#ffffff';
  return planInlineVars(new XMLSerializer().serializeToString(copy), (name) => css.getPropertyValue(name));
}
/**
 * var(--name) or var(--name, fallback) in serialised SVG → the value in use now. The values land inside
 * double-quoted attributes, so their quotes become single quotes and & < > are escaped: Obsidian's font lists
 * ("??", "??", ui-sans-serif, …) otherwise ended the style attribute early and the SVG would not open.
 */
function planInlineVars(text, get) {
  const safe = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, "'");
  const once = (s) =>
    s.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (m, name, fb) => {
      const v = String(get(name) || '').trim() || (fb || '').trim();
      return v ? safe(v) : m;
    });
  // innermost first, until nothing changes: var(--np-link-c, var(--text-faint)) resolves too
  let out = text;
  for (let i = 0; i < 5; i++) {
    const next = once(out);
    if (next === out) break;
    out = next;
  }
  return out;
}
/* @src src/tickets/plan-view.js */
/* ---- Project plans (fork): the Planning view, one project's plan in its own tab -----------------------------------------
 * Opened from the buttons on a project note's header (plan-actions.js). Modes: Gantt (Mermaid, drawn by Obsidian),
 * Board (plan-board.js), Graph (plan-graph.js) and List. Follows changes in the notes; only the board writes. */

const PLAN_MODES = [
  ['gantt', 'Gantt'],
  ['board', 'Board'],
  ['graph', 'Graph'],
  ['list', 'List'],
];
const PLAN_STATE_LABEL = { ready: 'Ready', waiting: 'Waiting', blocked: 'Blocked', doing: 'In progress', done: 'Done' };

/** The plan's title: the project note's name, or the project folder's. */
function planScopeTitle(scope) {
  const last = scope.path.split('/').pop();
  return scope.kind === 'note' ? projectTitle(last.replace(/\.md$/i, '')) : last;
}
/** The project's start date (its `started` property) as YYYY-MM-DD, or null. */
function planBaseDate(app, scope) {
  let f = app.vault.getAbstractFileByPath(scope.path);
  if (scope.kind === 'folder') {
    const rep = f instanceof TFolder ? projectFolderNote(app, f) : null;
    f = rep ? rep.file : null;
  }
  const fm = f instanceof TFile ? (app.metadataCache.getFileCache(f) || {}).frontmatter || {} : {};
  const m = String(fm.started || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

class PlanView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.plan = null;
    this.mode = 'gantt';
    this.weeks = false;
    this.graph = { dir: 'TB', phases: false }; // graph layout: Down / Across, phase groups
    this.who = null; // one person's tasks (plan-people.js), or everyone
    this.lanes = 'phase'; // board rows: by phase or by person
    this.ganttPhases = false; // Gantt: one bar per phase (plan-forecast.js)
    this.markFilter = null; // List: only risks, issues or decisions
    this.listOrder = 'plan'; // List: the plan's order, or by priority within each phase
    this.selKey = null; // the selected task (planKey): New task follows it
    this.tasks = [];
    this.paths = new Set();
  }
  getViewType() {
    return VIEW_PLAN;
  }
  getDisplayText() {
    return this.plan ? `Planning: ${planScopeTitle(this.plan)}` : 'Planning';
  }
  getIcon() {
    return 'calendar-range';
  }
  getState() {
    return Object.assign(super.getState(), this.plan ? { kind: this.plan.kind, path: this.plan.path, mode: this.mode, weeks: this.weeks, graph: this.graph, who: this.who, lanes: this.lanes, ganttPhases: this.ganttPhases } : {});
  }
  async setState(state, result) {
    if (state && state.path) this.plan = { kind: state.kind === 'folder' ? 'folder' : 'note', path: state.path };
    if (state && PLAN_MODES.some(([k]) => k === state.mode)) this.mode = state.mode;
    if (state && typeof state.weeks === 'boolean') this.weeks = state.weeks;
    if (state && state.graph) this.graph = planGraphState(state.graph);
    if (state && 'who' in state) this.who = state.who || null;
    if (state && (state.lanes === 'phase' || state.lanes === 'person')) this.lanes = state.lanes;
    if (state && typeof state.ganttPhases === 'boolean') this.ganttPhases = state.ganttPhases;
    await super.setState(state, result);
    this.build();
    await this.refresh();
  }
  onResize() {
    // the Gantt fits its width: redraw when the tab changes size
    if (this.mode === 'gantt' && this.bodyEl) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.render(), 200);
    }
  }
  async onOpen() {
    addHelpAction(this, 'planning'); // fork: the ? button in the header (src/shared/help.js)
    this.contentEl.addClass('nd-root', 'np-plan');
    const soon = debounce(() => this.refresh(), 600, true);
    this.registerEvent(this.app.metadataCache.on('changed', (f) => this.touches(f.path) && soon()));
    // ⏳ dates held back while you typed in the note: write them once you leave it
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduledPending && ((this.scheduledPending = false), this.syncScheduled())));
    this.registerEvent(this.app.vault.on('rename', () => soon()));
    this.build();
    await this.refresh();
  }
  /** Is this note part of the plan (or one of its outside neighbours)? */
  touches(path) {
    if (!this.plan) return false;
    if (this.paths.has(path) || (path && path.split('/').pop() === `${String(NEON_PLAN.holidayName).replace(/\.md$/i, '')}.md`)) return true; // or a Holidays note
    return this.plan.kind === 'note' ? path === this.plan.path : path.startsWith(this.plan.path + '/');
  }
  build() {
    const root = this.contentEl;
    root.empty();
    const bar = root.createDiv('np-bar');
    const head = bar.createDiv('np-head');
    // the tab and view header already say "Planning: <project>": only the project's name here. Not this.titleEl:
    // that is Obsidian's own view-header title, which then stayed at "Planning"
    this.planTitleEl = head.createDiv({ cls: 'np-title', text: this.plan ? planScopeTitle(this.plan) : '' });
    this.sumEl = head.createDiv('np-sum');
    const tools = bar.createDiv('np-tools');
    pills(tools, PLAN_MODES, this.mode, (v) => {
      this.mode = v || 'gantt';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    this.weeksEl = pills(tools, [['dates', 'Dates'], ['weeks', 'Weeks']], this.weeks ? 'weeks' : 'dates', (v) => {
      this.weeks = v === 'weeks';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    this.newBtn = button(tools, { icon: 'plus', text: 'New task', cls: 'np-new', title: 'Add a task: after the selected task (the last one you opened), depending on it', onClick: () => this.newTask() });
    this.orderEl = pills(tools, [['plan', 'Plan order'], ['priority', 'By priority']], this.listOrder, (v) => ((this.listOrder = v || 'plan'), this.render()));
    tip(this.orderEl.el, 'List: the plan’s order, or highest priority first within each phase');
    this.markEl = pills(tools, PLAN_MARKS.map(([k, sign, label]) => [k, `${sign} ${label}s`]), this.markFilter, (v) => ((this.markFilter = v || null), this.render()), 'can-clear');
    tip(this.markEl.el, 'Only risks, issues or decisions (click again for all)');
    this.clearSelBtn = button(tools, { icon: 'x', cls: 'nd-icon-btn is-hidden', title: 'New tasks at the end of the plan instead (clear the selection)', onClick: () => this.select(null) });
    button(tools, { icon: 'file-text', cls: 'nd-icon-btn', title: 'Open the project note', onClick: (e) => this.openScope(e) });
    this.buildPeopleTools(tools);
    this.buildForecastTools(tools);
    const g = this.graph;
    const saveGraph = () => (this.app.workspace.requestSaveLayout(), this.render());
    this.dirEl = pills(tools, [['TB', 'Down'], ['LR', 'Across']], g.dir, (v) => ((g.dir = v || 'TB'), saveGraph()));
    this.phaseEl = pills(tools, [['on', 'Phases']], g.phases ? 'on' : null, (v) => ((g.phases = v === 'on'), saveGraph()), 'can-clear');
    tip(this.phaseEl.el, 'Group the boxes by phase (wider)');
    this.issuesEl = root.createDiv('np-issues');
    this.bodyEl = root.createDiv('np-body');
  }
  /** The note new tasks go in: the project note, or a project folder's own note. */
  scopeFile() {
    let f = this.app.vault.getAbstractFileByPath(this.plan.path);
    if (f instanceof TFolder) {
      const rep = projectFolderNote(this.app, f);
      f = rep && rep.own ? rep.file : null;
    }
    return f instanceof TFile ? f : null;
  }
  /** A new task: after `after` (or the selected task), depending on it, straight after its line; else at the end. */
  newTask(after = null) {
    const file = this.scopeFile();
    if (!file) return new Notice('This project folder has no project note to add tasks to');
    const sel = after || this.selected();
    const own = this.tasks.filter((t) => !t.external && t.file === file);
    const follow = sel && !sel.external && sel.file === file ? sel : null;
    this.plugin.openTaskEditor({ scope: this.plan, file, after: follow, phase: own.length ? own[own.length - 1].phase || '' : '', view: this });
  }
  /** The selected task (the last one opened or right-clicked): New task follows it. */
  selected() {
    return this.selKey ? this.tasks.find((t) => planKey(t) === this.selKey) || null : null;
  }
  select(t) {
    this.selKey = t ? planKey(t) : null;
    this.syncSelection();
  }
  syncSelection() {
    const sel = this.selected();
    this.newBtn.querySelector('.nd-btn-label').setText(sel ? `New task after ${sel.id || planClip(planText(sel.raw), 20)}` : 'New task');
    this.clearSelBtn.toggleClass('is-hidden', !sel);
    this.bodyEl.querySelectorAll('.is-selected').forEach((x) => x.removeClass('is-selected'));
    if (sel) this.bodyEl.querySelectorAll(`[data-key="${CSS.escape(this.selKey)}"]`).forEach((x) => x.addClass('is-selected'));
  }
  /** After the editor saves: select that task, so the next New task follows it. */
  async selectSaved(id) {
    if (id) this.selKey = id;
    await this.refresh();
  }
  /** Click on a task: the editor; Ctrl/Cmd-click: its line in the note. Outside tasks open their note. */
  openTask(e, t) {
    if (t.external || (e && (e.ctrlKey || e.metaKey))) return openFile(this.app, t.file, e, t.line);
    this.select(t);
    this.plugin.openTaskEditor({ scope: this.plan, file: t.file, line: t.line, view: this });
  }
  /** Replace a template's {{prefix}} throughout the project note with the plan's prefix. */
  async fillPrefix() {
    const file = this.scopeFile();
    if (!file) return;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const prefix = planPrefix(fm, planScopeTitle(this.plan));
    try {
      await writeNote(this.app, file, (text) => planFillPrefix(text, prefix));
      new Notice(`Ids filled in: ${prefix}-1, ${prefix}-2…`);
    } catch (e) {
      if (!(e && e.neonReadOnly)) console.error('Planning: could not fill in the ids', e);
    }
  }
  openScope(e) {
    if (!this.plan) return;
    let f = this.app.vault.getAbstractFileByPath(this.plan.path);
    if (f instanceof TFolder) f = (projectFolderNote(this.app, f) || {}).file;
    if (f instanceof TFile) openFile(this.app, f, e);
  }
  async refresh() {
    if (!this.plan || !this.bodyEl) return;
    try {
      this.tasks = await planCollect(this.app, this.plan);
    } catch (e) {
      console.error('Plan: could not read the project', e);
      this.tasks = [];
    }
    this.paths = new Set(this.tasks.map((t) => t.file.path));
    this.base = planBaseDate(this.app, this.plan);
    this.due = planDueDate(this.app, this.plan);
    this.planTitleEl.setText(planScopeTitle(this.plan));
    this.leaf.updateHeader && this.leaf.updateHeader();
    this.render();
    this.syncScheduled(); // fork: ⏳ in step with the plan, when the project asks for it (plan-scheduled.js)
  }
  render() {
    if (!this.bodyEl) return;
    if (this.dragActive) return void (this.redrawAfterDrag = true); // a card is being dragged: redraw when it lands
    const weeks = this.weeks || !this.base;
    planUseCalendar(this.tasks); // this plan's working days (another plan's view may have drawn since)
    this.today = moment().format('YYYY-MM-DD');
    const g = planGanttText(this.tasks, { base: this.base, weeks, today: this.today, show: (t) => this.shows(t), phases: this.mode === 'gantt' && this.ganttPhases, due: this.due });
    const { sched, bars } = g;
    this.dated = this.datedPlan(); // real dates whatever the switch: forecast, baseline, slip
    this.ends = new Map(((this.dated && this.dated.bars) || []).filter((b) => b.task).map((b) => [b.task, b.end]));
    this.sched = sched;
    this.kinds = new Map(bars.filter((b) => b.task).map((b) => [b.task, b.kind]));
    const own = this.tasks.filter((t) => !t.external);
    this.sumEl.setText([planSummaryText(planCounts(this.tasks, this.today)), planMarkText(this.tasks), own.length ? this.forecastSummary() || `about ${Math.ceil(sched.length / 5)} weeks of work` : ''].filter(Boolean).join(' · '));
    this.sumEl.toggleClass('is-late', !!(this.dated && this.dated.late));
    this.weeksEl.el.toggleClass('is-hidden', this.mode !== 'gantt' && this.mode !== 'list');
    this.weeksEl.set(weeks ? 'weeks' : 'dates');
    this.weeksEl.btns.get('dates').disabled = !this.base;
    if (!this.base) tip(this.weeksEl.btns.get('dates'), 'Set the project’s started date to see dates');
    for (const p of [this.dirEl, this.phaseEl]) p.el.toggleClass('is-hidden', this.mode !== 'graph');
    this.syncPeopleTools();
    this.syncForecastTools();
    this.renderIssues(sched);
    this.bodyEl.empty();
    if (!own.length) {
      emptyState(this.bodyEl, 'No tasks in this project yet. A task is a checkbox line with the task tag or a 🆔 id.');
      return;
    }
    this.renderLegend(bars);
    this.markEl.el.toggleClass('is-hidden', this.mode !== 'list' || !this.tasks.some((t) => (t.marks || []).length));
    this.orderEl.el.toggleClass('is-hidden', this.mode !== 'list');
    window.setTimeout(() => this.syncSelection(), 0); // after the chart or list is drawn
    if (this.mode === 'list') return this.renderList(sched, weeks);
    if (this.mode === 'board') return this.renderBoard();
    if (this.mode === 'graph') return this.renderGraph(sched);
    // the plugin draws the Gantt itself (Obsidian's chart engine takes no per-bar colours)
    const chart = this.bodyEl.createDiv('np-chart np-gantt-wrap');
    const lay = planGanttLayout(g.rows, { today: this.today, relative: g.relative, width: this.bodyEl.clientWidth || 900 });
    if (!lay) return void emptyState(chart, 'Nothing to draw for this filter');
    const tasksDrawn = !this.ganttPhases;
    const svg = planDrawGantt(chart, lay, {
      colours: planColourMap(),
      // a click opens the task editor, as in the other views (the click ending a drag isn't one); right-click: the menu
      onBar: (e, b) => !this.justDragged && this.openTask(e, b.task),
      onMenu: (e, b) => this.taskMenu(e, b.task),
      selKey: this.selKey,
      links: tasksDrawn, // always: the arrows are part of the plan (Kevin, 17 Nov)
      onLink: (e, l) => this.linkMenu(e, l),
    });
    if (tasksDrawn) this.attachGanttDrag(svg, lay, g.bars); // drag to change dates and lengths, Alt-drag to link (plan-gantt-drag.js)
  }
  /** Colour key for the kinds in this plan; outlined bars are on the critical path. */
  renderLegend(bars) {
    const used = new Set(bars.map((b) => b.kind));
    const el = this.bodyEl.createDiv('np-legend');
    for (const [kind, label] of PLAN_KINDS) {
      if (!used.has(kind)) continue;
      const item = el.createSpan('np-key');
      item.createSpan({ cls: 'np-swatch' }).style.backgroundColor = planColour(kind);
      item.createSpan({ text: label });
    }
    if (this.mode === 'gantt' && bars.some((b) => b.crit)) el.createSpan({ cls: 'np-key np-key-crit', text: 'Outlined: critical path' });
    if (this.mode === 'graph' && bars.some((b) => b.crit)) el.createSpan({ cls: 'np-key np-key-crit', text: 'Outlined, thick arrows: critical path' });
    for (const [k, sign, label, v, fb] of PLAN_MARKS) {
      if (!bars.some((b) => b.mark === k)) continue;
      const item = el.createSpan({ cls: 'np-key np-key-mark', text: `${sign} ${label}` });
      item.style.borderColor = planCssHex(v, fb);
    }
  }
  renderIssues(sched) {
    const el = this.issuesEl;
    el.empty();
    // each line: its text, and the task to open in its note when clicked (the line to fix)
    const lines = planProblems(this.tasks, sched).map((p) => ({ text: p.text, task: p.task }));
    // every step ticked but the task isn't: offer to tick it (never done by itself)
    for (const t of this.tasks.filter((x) => !x.external && planStepsDone(x)))
      lines.push({ text: `${planProblemName(t)}: all ${t.steps.total} step${t.steps.total === 1 ? ' is' : 's are'} done. Mark it done?`, act: () => this.moveTask(t, 'x'), title: 'Tick the task (with today’s ✅ date)' });
    lines.push(...this.loadLines(sched).map((text) => ({ text })));
    const gap = this.dated ? planHolidayGap(this.dated.end) : ''; // the Public holidays note doesn't reach the plan's end
    if (gap) lines.push({ text: gap });
    for (const w of planWeekendDates(this.tasks)) lines.push({ text: `${w.task.id || planClip(planText(w.task.raw), 30)}: ${w.sign} ${planShortDate(w.date)} is not a working day (${w.day})`, task: w.task });
    // schedule warnings: a handful here, the rest counted (the List shows them on each task)
    const warn = planWarnings(this.tasks, this.ends, this.today);
    lines.push(...warn.slice(0, 5).map((w) => ({ text: w.text, task: w.task })));
    if (warn.length > 5) lines.push({ text: `${warn.length - 5} more schedule warnings: see the List` });
    this.warnings = new Map();
    for (const w of warn) this.warnings.set(w.task, [...(this.warnings.get(w.task) || []), w.text]);
    for (const l of lines) {
      const d = el.createDiv({ cls: `np-issue${l.act ? ' is-offer' : ''}`, text: `${l.act ? '✓' : '⚠'} ${l.text}` });
      if (l.act) {
        d.addClass('is-link');
        tip(d, l.title);
        d.addEventListener('click', l.act);
        continue;
      }
      const t = l.task;
      if (!t || !t.file) continue;
      d.addClass('is-link');
      tip(d, `Open ${t.file.basename} at this task`);
      d.addEventListener('click', (e) => openFile(this.app, t.file, e, t.line)), hoverPreview(this.app, d, t.file, t.line);
    }
    if (this.tasks.some((t) => !t.external && /\{\{\s*prefix\s*\}\}/.test(t.raw))) {
      // made from the plan template outside New project: its ids still read {{prefix}}-1
      const d = el.createDiv({ cls: 'np-issue', text: '⚠ This plan’s ids still read {{prefix}}: ' });
      button(d, { icon: 'wand', text: 'Fill in ids', cls: 'np-fill', onClick: () => this.fillPrefix() });
    }
  }
  /** The list's Days cell: − days + (click the number to type one); a milestone shows ◆. */
  daysCell(td, t) {
    if (t.milestone) return void tip(td.createSpan({ cls: 'np-ms', text: '◆' }), 'Milestone (#milestone)');
    if (t.external) return void td.setText(String(planDays(t)));
    const step = (d, label, title) => {
      const b = td.createEl('button', { cls: 'np-step', text: label, attr: { type: 'button', 'aria-label': title } });
      b.addEventListener('click', () => this.setDuration(t, Math.max(0, planDays(t) + d)));
    };
    step(-1, '−', 'One day less');
    const n = td.createSpan({ cls: `np-days-n${t.days == null ? ' is-unset' : ''}`, text: String(planDays(t)) });
    tip(n, t.days == null ? 'No estimate yet (counts as 1 day): click to set' : 'Click to type a duration');
    n.addEventListener('click', () => this.askDuration(t));
    step(1, '+', 'One day more');
  }
  renderList(sched, weeks) {
    const { byId } = planIndex(this.tasks);
    const table = this.bodyEl.createEl('table', { cls: 'np-table' });
    const hr = table.createEl('thead').createEl('tr');
    const slips = !!this.baseline();
    for (const h of ['', 'Task', 'Owner', 'Priority', 'State', 'Steps', 'Id', 'Depends on', 'Days', 'Start', 'Finish', 'Slack', ...(slips ? ['Slip'] : [])]) hr.createEl('th', { text: h });
    const body = table.createEl('tbody');
    let phase = null;
    // by priority: highest first within each phase (phases keep their order)
    const phaseAt = new Map();
    for (const r of sched.rows) {
      const k = r.task.external ? PLAN_OUTSIDE : r.task.phase || 'Tasks';
      if (!phaseAt.has(k)) phaseAt.set(k, phaseAt.size);
    }
    const ph = (r) => phaseAt.get(r.task.external ? PLAN_OUTSIDE : r.task.phase || 'Tasks');
    const ordered = this.listOrder === 'priority' ? sched.rows.map((r, i) => [r, i]).sort((a, b) => ph(a[0]) - ph(b[0]) || (b[0].task.priority ?? 2) - (a[0].task.priority ?? 2) || a[1] - b[1]).map(([r]) => r) : sched.rows;
    for (const r of ordered) {
      const t = r.task;
      if (!this.shows(t)) continue;
      if (this.markFilter && !(t.marks || []).includes(this.markFilter)) continue;
      const ph = t.external ? PLAN_OUTSIDE : t.phase || 'Tasks';
      if (ph !== phase) {
        phase = ph;
        body.createEl('tr', { cls: 'np-phase' }).createEl('td', { text: ph, attr: { colspan: slips ? '13' : '12' } });
      }
      const st = planState(t, byId, this.today);
      const tr = body.createEl('tr', { cls: `np-row is-${st}${r.crit && st !== 'done' && !t.external ? ' is-crit' : ''}${t.external ? ' is-external' : ''}`, attr: { 'data-key': planKey(t) } });
      tr.addEventListener('contextmenu', (e) => this.taskMenu(e, t));
      tip(tr.createEl('td', { cls: 'np-crit', text: r.crit && st !== 'done' && !t.external ? '●' : '' }), 'On the critical path');
      const name = tr.createEl('td', { cls: 'np-name' });
      const mark = planMark(t);
      if (mark) tip(name.createSpan({ cls: `np-mark-sign is-${mark[0]}`, text: `${mark[1]} ` }), mark[2]);
      const ws = this.warnings && this.warnings.get(t);
      if (ws) tip(name.createSpan({ cls: 'np-warn-sign', text: '⏰ ' }), ws.join('\n'));
      const a = name.createEl('a', { cls: mark && mark[0] !== 'decision' ? 'np-strong' : '', text: (t.external ? '↗ ' : '') + planText(t.raw), href: '#' }); // risks and issues in bold
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.openTask(e, t);
      });
      if (t.external) name.createSpan({ cls: 'np-file', text: ` · ${t.file.basename}` });
      tr.createEl('td', { cls: 'np-owner', text: (t.owners || []).map((o) => o.name).join(', ') });
      const pr = PLAN_PRIORITIES.find((p) => p[0] === (t.priority ?? 2));
      tr.createEl('td', { cls: 'np-owner', text: pr[0] === 2 ? '' : `${pr[1]} ${pr[2]}` });
      const kind = this.kinds.get(t) || st;
      const chip = tr.createEl('td').createSpan({ cls: `np-state is-${st}`, text: PLAN_STATE_LABEL[st] });
      planFill(chip, st === 'blocked' || st === 'waiting' ? st : kind);
      const why = planBlockedText(t, byId, this.today);
      if (why) tip(chip, why);
      if (kind === 'overdue' || kind === 'soon') tip(chip, PLAN_KINDS.find(([k]) => k === kind)[1]);
      // the checkboxes under the task: 2/4; all done but the task open: ✓, click to tick it
      const stepsTd = tr.createEl('td', { cls: `np-num np-steps${planStepsDone(t) ? ' is-all' : ''}`, text: t.steps ? `${t.steps.done}/${t.steps.total}${planStepsDone(t) ? ' ✓' : ''}` : '' });
      if (planStepsDone(t)) {
        tip(stepsTd, 'Every step is done: click to mark the task done');
        stepsTd.addEventListener('click', () => this.moveTask(t, 'x'));
      }
      tr.createEl('td', { cls: 'np-id', text: t.id || '' });
      tr.createEl('td', { cls: 'np-id', text: [...t.deps, ...(t.links || []).map((l) => `${planLinkText(l)} (${l.type === 'ss' ? 'starts with' : 'ends with'})`)].join(', ') });
      this.daysCell(tr.createEl('td', { cls: 'np-num np-days' }), t);
      tr.createEl('td', { text: planDayLabel(r.es, this.base, weeks) });
      tr.createEl('td', { text: planDayLabel(Math.max(r.es, r.ef - 1), this.base, weeks) });
      tr.createEl('td', { cls: 'np-num', text: r.slack ? `${r.slack}d` : '' });
      if (slips) {
        const d = this.slip(t);
        tr.createEl('td', { cls: `np-num${d > 0 ? ' is-late' : ''}`, text: d == null ? '' : d ? `${d > 0 ? '+' : ''}${d}d` : '0' });
      }
    }
  }
}
/* @src src/tickets/plan-edit.js */
/* ---- Project plans (fork): changing a task from the Planning view --------------------------------------------------
 * Pure line edits (tested) and the one place that writes them: the checkbox (board), the duration and the milestone
 * tag. Each edit finds the task's line again (by its text, else its 🆔 id), changes only that line through writeNote,
 * then updates the task in memory and redraws, so a quick second edit starts from the note as it is. Nothing is
 * written while read-only is on. The task menu (right-click on a card, row or box; click on a Gantt bar) offers them. */

const PLAN_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s+)(.*)$/u;
const PLAN_DURATIONS = [1, 2, 3, 5, 10]; // offered in the task menu (working days; 5 = a week)

/**
 * Edit one task's line (pure): fn(rest, box) → { rest, box } with rest the text after the checkbox. Returns
 * { text, line, raw, box }, or null when the task can't be found. The task is looked for on its line (same text or
 * same 🆔 id), else on the one line with the same text, else the same id.
 */
function planEditLine(text, t, fn) {
  const lines = text.split('\n');
  const n = planFindLine(lines, t);
  if (n < 0) return null;
  const cr = lines[n].endsWith('\r') ? '\r' : '';
  const m = lines[n].replace(/\r$/, '').match(PLAN_LINE_RE);
  const next = fn(m[4], m[2]);
  if (next.rest === m[4] && next.box === m[2]) return { text, line: n, raw: m[4], box: m[2] };
  lines[n] = m[1] + next.box + m[3] + next.rest + cr;
  return { text: lines.join('\n'), line: n, raw: next.rest, box: next.box };
}
/** The line a task is on now (its line if it still holds the task, else the one line with its text, else its id), or -1. */
function planFindLine(lines, t) {
  const parse = (l) => (l || '').replace(/\r$/, '').match(PLAN_LINE_RE);
  const idRe = t.id ? new RegExp(`🆔\\s*${t.id}(?![\\w-])`, 'u') : null; // ids are letters, digits, - and _
  const sameText = (l) => {
    const m = parse(l);
    return !!m && m[4] === t.raw;
  };
  const sameId = (l) => {
    const m = parse(l);
    return !!m && !!idRe && idRe.test(m[4]);
  };
  const only = (ok) => {
    const hits = lines.map((l, i) => (ok(l) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  };
  const n = sameText(lines[t.line]) || sameId(lines[t.line]) ? t.line : only(sameText);
  return n >= 0 ? n : only(sameId);
}

/** The checkbox set to `box`: done adds "✅ today" if missing, reopening removes it; already there: unchanged. */
function planSetBox(text, t, box, today) {
  return planEditLine(text, t, (rest, now) => {
    if (now === box) return { rest, box };
    if (box === 'x' || box === 'X') return { rest: /✅\s*\d{4}-\d{2}-\d{2}/u.test(rest) ? rest : `${rest} ✅ ${today}`, box };
    return { rest: rest.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/gu, ''), box };
  });
}

/** Where a new field goes: before the first emoji field or tag, else at the end. */
function planFieldAt(rest) {
  const m = rest.match(/\s(?:🆔|⛔|📅|⏳|🛫|✅|➕|❌|🔁|⏫|🔼|🔽|🔺|⏬|#[\w/-])/u);
  return m ? m.index : rest.length;
}

/** The line text with its duration set to `days` (pure); null removes it; its place in the line is kept. */
function planDurRest(rest, days) {
  const field = days == null ? '' : `[duration:: ${days}d]`;
  const re = /\s*\[duration::[^\]]*\]/iu;
  if (re.test(rest)) return rest.replace(re, field ? ` ${field}` : '').replace(/^\s+/, '');
  if (!field) return rest;
  const at = planFieldAt(rest);
  return `${rest.slice(0, at)} ${field}${rest.slice(at)}`;
}
/** The duration set to `days` working days ([duration:: Nd]); null removes it. Its place in the line is kept. */
function planSetDuration(text, t, days) {
  return planEditLine(text, t, (rest, box) => ({ rest: planDurRest(rest, days), box }));
}

/** The #milestone tag on or off; a milestone has no length, so its duration field goes. */
function planSetMilestone(text, t, on) {
  return planEditLine(text, t, (rest, box) => {
    const re = /(^|\s)#milestone(?=\s|$)/iu;
    if (!on) return { rest: rest.replace(re, '').replace(/\s{2,}/g, ' ').trim(), box };
    if (re.test(rest)) return { rest, box };
    const plain = rest.replace(/\s*\[duration::[^\]]*\]/iu, '');
    const at = planFieldAt(plain);
    return { rest: `${plain.slice(0, at)} #milestone${plain.slice(at)}`, box };
  });
}

/** "2 days", "1 week", "Milestone", "1 day (no estimate)". */
function planDaysText(t) {
  if (t.milestone) return 'Milestone';
  const d = planDays(t);
  const s = d % 5 === 0 && d >= 5 ? `${d / 5} week${d === 5 ? '' : 's'}` : `${d} day${d === 1 ? '' : 's'}`;
  return t.days == null ? `${s} (no estimate)` : s;
}

Object.assign(PlanView.prototype, {
  /** Run an edit on a task's line; one at a time, each from the note as it is then. */
  editTask(t, edit) {
    const job = (this.editing || Promise.resolve()).then(() => this.writeEdit(t, edit));
    this.editing = job.catch(() => {});
    return job;
  },
  async writeEdit(t, edit) {
    let res = null;
    try {
      await writeNote(this.app, t.file, (text) => {
        res = edit(text);
        return res ? res.text : text;
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not change the task', e);
        new Notice('Could not change the task. Details in the console.');
      }
      return this.refresh();
    }
    if (!res) {
      new Notice('Could not find that task in its note any more: refreshed');
      return this.refresh();
    }
    // the task as it is now, so the view is right at once and a next edit starts from here
    const now = planTask(`- [${res.box}] ${res.raw}`, { file: t.file, line: res.line, phase: t.phase });
    if (now) Object.assign(t, now);
    this.render();
  },
  moveTask(t, box) {
    return this.editTask(t, (text) => planSetBox(text, t, box, moment().format('YYYY-MM-DD')));
  },
  setDuration(t, days) {
    return this.editTask(t, (text) => planSetDuration(text, t, days));
  },
  setMilestone(t, on) {
    return this.editTask(t, (text) => planSetMilestone(text, t, on));
  },
  /** Ask for a duration: a number of days, or "2w" for weeks; empty removes the estimate. */
  askDuration(t) {
    new PromptModal(this.app, {
      title: `Duration of “${planClip(planText(t.raw), 50)}”`,
      value: t.days == null ? '' : String(t.days),
      placeholder: 'Working days, e.g. 3, or 2w for two weeks; empty: no estimate',
      cta: 'Set',
      onSubmit: (v) => {
        const m = String(v || '').trim().match(/^(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)?$/i);
        if (!String(v || '').trim()) return this.setDuration(t, null);
        if (!m) return new Notice('A number of days (3) or weeks (2w), please');
        this.setDuration(t, Math.max(0, Math.round(parseFloat(m[1]) * (/^w/i.test(m[2] || '') ? 5 : 1))));
      },
    }).open();
  },
  /** The task menu: open, move, duration, milestone. */
  taskMenu(e, t) {
    if (e.preventDefault) e.preventDefault();
    const m = new Menu();
    if (!t.external) {
      this.select(t);
      m.addItem((i) => i.setTitle('Edit…').setIcon('pencil').onClick(() => this.openTask(null, t)));
      m.addItem((i) => i.setTitle('New task after this').setIcon('list-plus').onClick(() => this.newTask(t)));
    }
    m.addItem((i) => i.setTitle('Open the task in its note').setIcon('file-text').onClick(() => openFile(this.app, t.file, null, t.line)));
    if (t.external) return m.showAtMouseEvent(e);
    m.addSeparator();
    for (const [, label, box] of PLAN_COLUMNS)
      if (box !== null) m.addItem((i) => i.setTitle(`Move to ${label}`).setChecked(t.box === box || (box === 'x' && t.status === 'done')).onClick(() => this.moveTask(t, box)));
    m.addSeparator();
    for (const d of PLAN_DURATIONS)
      m.addItem((i) => i.setTitle(`Duration: ${planDaysText({ days: d })}`).setChecked(!t.milestone && t.days === d).onClick(() => this.setDuration(t, d)));
    m.addItem((i) => i.setTitle('Duration…').setIcon('timer').onClick(() => this.askDuration(t)));
    m.addItem((i) => i.setTitle('Milestone').setIcon('diamond').setChecked(!!t.milestone).onClick(() => this.setMilestone(t, !t.milestone)));
    m.addSeparator();
    if (t.status !== 'cancelled') m.addItem((i) => i.setTitle('Cancel task').setIcon('x-circle').onClick(() => this.plugin.cancelPlanTask(t, this)));
    m.addItem((i) => i.setTitle('Delete task…').setIcon('trash-2').setWarning(true).onClick(() => this.plugin.confirmDeleteTask(t, this.tasks, this)));
    m.showAtMouseEvent(e);
  },
});
/* @src src/tickets/plan-form.js */
/* ---- Project plans (fork): the task editor's text work (pure, tested) ------------------------------------------------
 * The editor (plan-editor.js) only collects a form; these functions turn it into line edits. Fields it doesn't
 * manage (priority, recurrence, ➕ created, other tags and [key:: value] fields) stay where they are; the ones it
 * manages are changed in place, removed when cleared, or added before the trailing tags. Ids: the project's
 * `plan-prefix` property, else the initials of its title, then the next free number (pla-50). */

const PLAN_DATE_SIGNS = [
  ['start', '🛫'],
  ['scheduled', '⏳'],
  ['due', '📅'],
];

/** "Pilot - Local AI" → "pla". */
function planInitials(title) {
  const words = String(title || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w) => w[0]).join('').toLowerCase().slice(0, 5) || 'task';
}
/** The id prefix: the plan-prefix property (letters, digits, - and _), else the title's initials. */
function planPrefix(fm, title) {
  const v = String((fm && (fm['plan-prefix'] != null ? fm['plan-prefix'] : fm.planPrefix)) || '').trim();
  const p = /\{\{/.test(v) ? '' : v.replace(/[^\w-]/g, ''); // a template's {{prefix}} not filled in yet: the initials
  return p || planInitials(title);
}
/** The next free id: prefix-(highest number used + 1). ids: every id in use. */
function planNextId(ids, prefix) {
  const used = new Set(ids);
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let n = 0;
  for (const id of used) {
    const m = re.exec(id || '');
    if (m) n = Math.max(n, +m[1]);
  }
  n++;
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/** A line's text in parts: leading tags, the description, other [key:: value] fields in it, the rest (fields). */
function planSplit(rest) {
  const lead = (rest.match(/^(?:#[\w/-]+\s+)+/u) || [''])[0];
  const body = rest.slice(lead.length);
  const at = planFieldAt(body);
  const head = body.slice(0, at);
  const inline = (head.match(PLAN_FIELD_RE) || []).filter((f) => !/^\[(duration|owner|starts-with|ends-with)::/i.test(f)); // the editor sets these
  return { lead, desc: head.replace(PLAN_FIELD_RE, '').replace(/\s+/g, ' ').trim(), inline, tail: body.slice(at) };
}

/** The [owner:: …] field set to these owners (as written: [[@Sam Taylor]] or a plain name); none removes it. */
function planOwnerRest(rest, owners) {
  if (owners === undefined) return rest;
  const field = owners && owners.length ? `[owner:: ${owners.join(', ')}]` : '';
  const re = new RegExp(`\\s*${PLAN_OWNER_RE.source}`, 'iu');
  if (re.test(rest)) return rest.replace(re, field ? ` ${field}` : '').replace(/^\s+/, '');
  if (!field) return rest;
  const dur = rest.match(/\[duration::[^\]]*\]/iu); // next to the duration, else before the fields
  const at = dur ? dur.index + dur[0].length : planFieldAt(rest);
  return `${rest.slice(0, at)} ${field}${rest.slice(at)}`;
}

/** An emoji field set to value (in place), removed (null), or added before the trailing tags. */
function planSetSign(rest, sign, value) {
  const re = new RegExp(`\\s*${sign}\\uFE0F?\\s*[\\w-]+(?:\\s*,\\s*[\\w-]+)*`, 'u');
  if (re.test(rest)) return value ? rest.replace(re, ` ${sign} ${value}`) : rest.replace(re, '');
  if (!value) return rest;
  const tags = rest.match(/(?:\s+#[\w/-]+)+\s*$/u);
  const at = tags ? tags.index : rest.length;
  return `${rest.slice(0, at)} ${sign} ${value}${rest.slice(at)}`;
}
/** The Tasks plugin's priority emoji set to a level (2, normal: none): in place of the old one, else before the tags. */
function planSetPriority(rest, level) {
  const sign = planPrioritySign(level);
  const m = rest.match(/\s*[🔺⏫🔼🔽⏬]\uFE0F?/u);
  if (m) {
    const before = rest.slice(0, m.index);
    const after = rest.slice(m.index + m[0].length).replace(/\s*[🔺⏫🔼🔽⏬]\uFE0F?/gu, '');
    return sign ? `${before} ${sign}${after}` : `${before}${after}`;
  }
  if (!sign) return rest;
  const tags = rest.match(/(?:\s+#[\w/-]+)+\s*$/u);
  const at = tags ? tags.index : rest.length;
  return `${rest.slice(0, at)} ${sign}${rest.slice(at)}`;
}
/** A tag on (added at the end) or off. */
function planSetTag(rest, tag, on) {
  const re = new RegExp(`(^|\\s)#${tag}(?=\\s|$)`, 'iu');
  if (!on) return rest.replace(re, '$1');
  return re.test(rest) ? rest : `${rest} #${tag}`;
}
/** ⛔ with ids added and removed (order kept). */
function planDepsRest(rest, add = [], remove = []) {
  const m = rest.match(/⛔️?\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u);
  const now = m ? m[1].split(',').map((x) => x.trim()) : [];
  const next = [...now.filter((d) => !remove.includes(d)), ...add.filter((d) => !now.includes(d))];
  return planSetSign(rest, '⛔', next.length ? next.join(',') : null);
}

/** The field for a run-alongside link type: starts-with (ss) or ends-with (ff). */
const planLinkName = (type) => (type === 'ss' ? 'starts-with' : 'ends-with');
/** The text with a link field set to these links ([{ id, lag }]); none removes the field. Its place is kept (pure). */
function planSetLinks(rest, type, links) {
  const re = new RegExp(`\\s*\\[${planLinkName(type)}::[^\\]]*\\]`, 'iu');
  const field = links.length ? `[${planLinkName(type)}:: ${links.map(planLinkText).join(', ')}]` : '';
  if (re.test(rest)) return rest.replace(re, field ? ` ${field}` : '').replace(/^\s+/, '');
  if (!field) return rest;
  const at = planFieldAt(rest);
  return `${rest.slice(0, at)} ${field}${rest.slice(at)}`;
}
/** Add ([{ id, lag }]) and remove (ids) run-alongside links of one type (pure). */
function planLinkRest(rest, type, add = [], remove = []) {
  const now = planLinkField(rest, planLinkName(type), type);
  const next = [...now.filter((l) => !remove.includes(l.id) && !add.some((a) => a.id === l.id)), ...add];
  return planSetLinks(rest, type, next);
}

const planTidy = (r) => r.replace(/[ \t]{2,}/g, ' ').trim();

/**
 * A task's text after the editor (pure): { rest, box }. f: { desc, box, days (null: no estimate), milestone, flagged,
 * start, scheduled, due, id, deps: [ids], links: { ss, ff: [{ id, lag }] } (run alongside), tag (new tasks: the task tag) }. Done adds ✅ today, cancelled ❌ today.
 */
function planApplyForm(rest, box, f, today) {
  const p = planSplit(rest);
  let r = `${p.lead}${[String(f.desc || '').replace(/\s+/g, ' ').trim(), ...p.inline].join(' ')}${p.tail}`;
  r = planDurRest(r, f.milestone ? null : f.days);
  r = planOwnerRest(r, f.owners);
  for (const [k, sign] of PLAN_DATE_SIGNS) r = planSetSign(r, sign, f[k] || null);
  r = planSetSign(r, '🆔', f.id || null);
  r = planSetSign(r, '⛔', f.deps && f.deps.length ? f.deps.join(',') : null);
  if (f.links) for (const k of ['ss', 'ff']) r = planSetLinks(r, k, f.links[k] || []); // run alongside
  r = planSetTag(r, 'milestone', !!f.milestone);
  r = planSetTag(r, 'blocked', !!f.flagged);
  if (f.marks) for (const k of ['risk', 'issue', 'decision']) r = planSetTag(r, k, f.marks.includes(k));
  if (f.priority != null) r = planSetPriority(r, f.priority);
  if (f.tag) r = planSetTag(r, f.tag.replace(/^#/, ''), true);
  const nb = f.box != null ? f.box : box;
  if (nb === 'x' || nb === 'X') {
    r = planSetSign(r, '❌', null);
    if (!/✅\s*\d{4}-\d{2}-\d{2}/u.test(r)) r = `${r} ✅ ${today}`;
  } else if (nb === '-') {
    r = planSetSign(r, '✅', null);
    if (!/❌\s*\d{4}-\d{2}-\d{2}/u.test(r)) r = `${r} ❌ ${today}`;
  } else r = planSetSign(planSetSign(r, '✅', null), '❌', null);
  return { rest: planTidy(r), box: nb };
}

/** The note's headings: [{ line, level, text }] (front matter and code blocks skipped). */
function planHeadings(lines) {
  const out = [];
  let fence = false;
  let front = (lines[0] || '').replace(/\r$/, '') === '---';
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, '');
    if (front) {
      if (i > 0 && l === '---') front = false;
      return;
    }
    if (/^(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const m = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) out.push({ line: i, level: m[1].length, text: m[2] });
  });
  return out;
}
/** Where a task goes under a phase: after the section's last list line, else after the heading; no phase: the end. */
function planInsertAt(lines, phase) {
  const hs = planHeadings(lines);
  const h = phase ? hs.find((x) => x.text === phase) : null;
  const item = (l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l || '');
  if (!h) {
    let n = lines.length;
    while (n > 0 && !lines[n - 1].trim()) n--;
    return { at: n, gap: n > 0 && !item(lines[n - 1]) };
  }
  // the phase's own lines: up to the next heading of any level (a sub-heading is a phase of its own; going to the
  // end of the whole section put a task for "1. Scope" after the last task of "8. Close-down")
  const next = hs.find((x) => x.line > h.line);
  const end = next ? next.line : lines.length;
  let last = -1;
  for (let i = h.line + 1; i < end; i++) if (item(lines[i])) last = i;
  return last >= 0 ? { at: last + 1, gap: false } : { at: h.line + 1, gap: true };
}
/** Lines with a task line put at a phase's insert point (blank lines kept around it). */
function planPutLine(lines, line, phase, cr) {
  const { at, gap } = planInsertAt(lines, phase);
  const add = gap ? ['' + cr, line + cr] : [line + cr];
  if (gap && lines[at] !== undefined && lines[at].trim()) add.push('' + cr);
  lines.splice(at, 0, ...add);
  return at + (gap ? 1 : 0);
}

/**
 * The note's text after the editor's save (pure). others: [{ task, fn(rest, box) → { rest, box } }] (dependencies of
 * other tasks, ids given to them); main: { task (null: a new task), form, phase, after (a new task goes straight after
 * this task's line) }. Returns { text, line, raw, box,
 * missing: [tasks not found] }.
 */
function planEditFile(text, { others = [], main = null }, today) {
  let cur = text;
  const missing = [];
  for (const o of others) {
    const r = planEditLine(cur, o.task, o.fn);
    if (r) cur = r.text;
    else missing.push(o.task);
  }
  if (!main) return { text: cur, missing, line: -1 };
  const cr = text.includes('\r\n') ? '\r' : '';
  if (main.task) {
    const r = planEditLine(cur, main.task, (rest, box) => planApplyForm(rest, box, main.form, today));
    if (!r) return { text: cur, missing: [...missing, main.task], line: -1 };
    let line = r.line;
    cur = r.text;
    if (main.phase != null && main.phase !== (main.task.phase || '')) {
      const lines = cur.split('\n');
      const [l] = lines.splice(line, 1);
      line = planPutLine(lines, l.replace(/\r$/, ''), main.phase, cr);
      cur = lines.join('\n');
    }
    return { text: cur, line, raw: r.raw, box: r.box, missing };
  }
  const { rest, box } = planApplyForm('', ' ', main.form, today);
  const lines = cur.split('\n');
  const after = main.after ? planFindLine(lines, main.after) : -1;
  const anchor = main.anchor && after < 0 ? planAnchorLine(lines, main.anchor) : -1;
  let line;
  if (after >= 0 || anchor >= 0) {
    // after a task (below its sub-items, at its indent), or at the cursor (below the list item it is on)
    const from = after >= 0 ? after : anchor;
    line = planBelow(lines, from);
    const indent = planItem(lines[from]) ? lines[from].match(/^\s*/)[0] : '';
    lines.splice(line, 0, `${indent}- [${box}] ${rest}${cr}`);
  } else line = planPutLine(lines, `- [${box}] ${rest}`, main.phase || '', cr);
  return { text: lines.join('\n'), line, raw: rest, box, missing };
}
const planItem = (l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l || '');
/** Where a new line goes below line i: after a list item and its sub-items; at a blank line itself; else the next. */
function planBelow(lines, i) {
  const cur = (lines[i] || '').replace(/\r$/, '');
  if (!cur.trim()) return i;
  if (!planItem(cur)) return i + 1;
  const width = (l) => l.replace(/\r$/, '').match(/^\s*/)[0].replace(/\t/g, '    ').length;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && width(lines[j]) > width(cur)) j++;
  return j;
}
/** The line the cursor was on ({ line, text } when the editor opened), found again if the note has changed since. */
function planAnchorLine(lines, a) {
  const same = (i) => i >= 0 && i < lines.length && lines[i].replace(/\r$/, '') === a.text;
  if (same(a.line)) return a.line;
  for (let d = 1; d < lines.length; d++) {
    if (same(a.line - d)) return a.line - d;
    if (same(a.line + d)) return a.line + d;
  }
  return Math.min(Math.max(a.line, 0), lines.length);
}

/** Tasks that depend on `t`, directly or further on (so `t` can't depend on them: a loop). */
function planDownstream(tasks, t) {
  const kids = new Map();
  for (const x of tasks) for (const d of planLinkIds(x)) (kids.get(d) || kids.set(d, []).get(d)).push(x);
  const out = new Set();
  const walk = (id) => {
    for (const k of kids.get(id) || []) {
      if (out.has(k)) continue;
      out.add(k);
      if (k.id) walk(k.id);
    }
  };
  if (t && t.id) walk(t.id);
  return out;
}
/** Tasks `t` depends on, directly or further back (so they can't depend on `t`). */
function planUpstream(byId, t) {
  const out = new Set();
  const walk = (x) => {
    for (const d of planLinkIds(x)) {
      const y = byId.get(d);
      if (!y || out.has(y)) continue;
      out.add(y);
      walk(y);
    }
  };
  if (t) walk(t);
  return out;
}

/** The plan's dates for each task: Map task → { start, due }, as the Gantt draws them (needs the project's start). */
function planPlannedDates(tasks, base, today) {
  const out = new Map();
  if (!base) return out;
  const cal = tasks.calendar || planCal();
  const from = planWorkdays(base, 0, cal);
  const sched = planSchedule(tasks, { notBefore: today ? planWorkdaysBetween(from, today, cal) : 0, from, span: planLeaveSpan(tasks.leave, from, cal) });
  for (const r of sched.rows) out.set(r.task, { start: planWorkdays(from, r.es, cal), due: planWorkdays(from, Math.max(r.es, r.ef - 1), cal) });
  return out;
}

/** A template's {{prefix}} filled in with the plan's prefix, throughout the note (pure). */
function planFillPrefix(text, prefix) {
  return text.replace(/\{\{\s*prefix\s*\}\}/g, prefix);
}
const PLAN_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Why a date isn't a working day: "Saturday", "Christmas Day", "a closure day"…; '' for a working day (the settings' calendar). */
function planWeekend(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  return planCal().off(ymd);
}
/** Open tasks with a 🛫 ⏳ 📅 date on a day off (weekend, holiday, closure): [{ task, sign, date, day }]. */
function planWeekendDates(tasks) {
  const out = [];
  for (const t of tasks)
    if (!t.external && !planClosed(t))
      for (const [k, sign] of PLAN_DATE_SIGNS) {
        const day = planWeekend(t[k]);
        if (day) out.push({ task: t, sign, date: t[k], day });
      }
  return out;
}
/**
 * A day in the task editor's calendar (date-picker.js): { off, away, event, mark, text }. off: not a working day in
 * this plan (its Holidays note); away: you are off (the "You" setting) and the task is yours: striped; event: someone
 * else is off (anyone in the Holidays notes; the task's owners are named as such): an orange line; mark: the task's
 * planned start or finish. owners: as written. Without the "You" setting everyone's time off is an orange line.
 */
function planDayInfo(tasks, owners, planned, ymd) {
  tasks = tasks || [];
  const why = (tasks.calendar || planCal()).off(ymd);
  const own = planOwners(`[owner:: ${(owners || []).join(', ')}]`);
  const me = planOwners(`[owner:: ${NEON_PLAN.me || ''}]`)[0] || null;
  const same = (a, b) => !!planLeaveFor(new Map([[a.key, a]]), b); // the same person: same name, or same first name
  const myEntry = me ? planLeaveFor(tasks.leave, me) : null;
  const mineTask = !!me && own.some((o) => same(o, me));
  let away = false;
  const names = [];
  for (const e of (tasks.leave || new Map()).values()) {
    if (!planLeaveOff(e, ymd)) continue;
    if (mineTask && e === myEntry) {
      away = true;
      names.unshift('you are off');
      continue;
    }
    const owner = own.some((o) => planLeaveFor(tasks.leave, o) === e); // this person's time off is one of the owners'
    names.push(`${e === myEntry ? 'you' : e.name} off${owner ? ' (owner)' : ''}`);
  }
  const event = names.length > (away ? 1 : 0);
  const mark = planned ? (ymd === planned.start ? 'planned start' : ymd === planned.due ? 'planned finish' : '') : '';
  return { off: !!why, away, event, mark: !!mark, text: [why, ...names, mark].filter(Boolean).join(' · ') };
}
/* @src src/tickets/plan-editor.js */
/* ---- Project plans (fork): the task editor ----------------------------------------------------------------------------
 * A form for one task of a project note: description, status, phase, owners, duration or milestone, #blocked, what it
 * depends on and what it blocks (pickers over the note's tasks, loops refused), dates (with the plan's own dates),
 * and an id given automatically. A preview shows the exact line, and what changes in other tasks, before saving.
 * The text work is in plan-form.js; this file is only the form. One save is one write to the note. */

const PLAN_STATUS_CHOICES = [
  [' ', 'To do'],
  ['/', 'In progress'],
  ['x', 'Done'],
  ['-', 'Cancelled'],
];

class PlanTaskModal extends Modal {
  /** ctx: { scope, file, text (the note now), tasks (the plan), task (null: new), after (a new task follows it), anchor ({ line, text }: a new
   *  task goes below the cursor's line), phase, base, onSaved(id) } */
  constructor(app, ctx) {
    super(app);
    this.ctx = ctx;
    const t = ctx.task;
    const { byId } = planIndex(ctx.tasks);
    this.byId = byId;
    this.today = moment().format('YYYY-MM-DD');
    this.form = {
      desc: t ? planSplit(t.raw).desc : '',
      box: t ? (t.box === 'X' ? 'x' : t.box) : ' ',
      days: t ? t.days : null,
      milestone: !!(t && t.milestone),
      flagged: !!(t && t.flagged),
      marks: t ? [...(t.marks || [])] : [],
      priority: t ? t.priority ?? 2 : 2,
      start: (t && t.start) || null,
      scheduled: (t && t.scheduled) || null,
      due: (t && t.due) || null,
      id: (t && t.id) || null,
    };
    // the note's other tasks: what the pickers offer
    this.mine = ctx.tasks.filter((x) => !x.external && x.file.path === ctx.file.path && x !== t);
    // what it depends on: after (⛔), starts with or ends with ([starts-with:: ], [ends-with:: ]), with a lag
    this.deps = t
      ? [...t.deps.map((id) => ({ id, task: byId.get(id) || null, type: 'fs', lag: 0 })), ...(t.links || []).map((l) => ({ id: l.id, task: byId.get(l.id) || null, type: l.type, lag: l.lag }))]
      : ctx.after
        ? [{ id: ctx.after.id || null, task: ctx.after, type: 'fs', lag: 0 }]
        : [];
    this.owners = t ? (t.owners || []).map((o) => o.text) : []; // as written: [[@Sam Taylor]] or a plain name
    this.peopleNotes = app.vault.getMarkdownFiles().filter((f) => f.basename.startsWith('@')).map((f) => f.basename).sort();
    this.blocks = new Set(t && t.id ? this.mine.filter((x) => x.deps.includes(t.id)) : []);
    this.blocks0 = new Set(this.blocks);
    this.phase = t ? t.phase || '' : ctx.after ? ctx.after.phase || '' : ctx.phase || '';
    this.phase0 = this.phase; // a new task goes at the cursor or after its task unless another phase is chosen
    this.phases = planHeadings(ctx.text.split('\n')).map((h) => h.text);
    const fm = (app.metadataCache.getFileCache(ctx.file) || {}).frontmatter || {};
    this.prefix = planPrefix(fm, planScopeTitle(ctx.scope));
    this.planned = t ? planPlannedDates(ctx.tasks, ctx.base, this.today).get(t) : null;
    planUseCalendar(ctx.tasks); // "not a working day" warnings: this plan's calendar
  }

  onOpen() {
    const { contentEl: el, modalEl } = this;
    modalEl.addClass('nd-modal', 'np-editor');
    this.titleEl.setText(this.ctx.task ? 'Edit task' : this.ctx.after ? `New task after “${planClip(planText(this.ctx.after.raw), 40)}”` : 'New task');
    if (NEON_GUARD.readOnly) el.createDiv({ cls: 'np-ed-warn', text: 'Read-only is on, so saving is blocked. Turn it off in the plugin’s settings to change notes.' });
    const f = this.form;
    const row = (label, cls = '') => {
      const r = el.createDiv(`np-ed-row ${cls}`.trim());
      r.createDiv({ cls: 'np-ed-label', text: label });
      return r.createDiv('np-ed-field');
    };
    // description
    const desc = row('Description').createEl('textarea', { cls: 'np-ed-desc', attr: { rows: '2', placeholder: 'What needs doing' } });
    desc.value = f.desc;
    desc.addEventListener('input', () => ((f.desc = desc.value), this.update()));
    window.setTimeout(() => desc.focus(), 0);
    // status and phase
    const sp = row('Status');
    const status = sp.createEl('select', { cls: 'dropdown' });
    const choices = PLAN_STATUS_CHOICES.some(([b]) => b === f.box) ? PLAN_STATUS_CHOICES : [...PLAN_STATUS_CHOICES, [f.box, `Other [${f.box}]`]];
    for (const [b, label] of choices) status.createEl('option', { text: label, attr: { value: b } });
    status.value = f.box;
    status.addEventListener('change', () => ((f.box = status.value), this.update()));
    sp.createSpan({ cls: 'np-ed-sub', text: 'Priority' });
    const pri = sp.createEl('select', { cls: 'dropdown' });
    for (const [n, e, label] of PLAN_PRIORITIES) pri.createEl('option', { text: e ? `${e} ${label}` : label, attr: { value: String(n) } });
    pri.value = String(f.priority);
    pri.addEventListener('change', () => ((f.priority = +pri.value), this.update()));
    sp.createSpan({ cls: 'np-ed-sub', text: 'Phase' });
    const phase = sp.createEl('select', { cls: 'dropdown' });
    phase.createEl('option', { text: '(end of the note)', attr: { value: '' } });
    for (const p of this.phases) phase.createEl('option', { text: p, attr: { value: p } });
    phase.value = this.phases.includes(this.phase) ? this.phase : '';
    phase.addEventListener('change', () => ((this.phase = phase.value), this.update()));
    this.ownerEl = row('Owner', 'np-ed-pick');
    // duration, milestone, blocked
    const dr = row('Duration');
    const weeks = f.days != null && f.days >= 5 && f.days % 5 === 0;
    const num = dr.createEl('input', { cls: 'np-ed-num', attr: { type: 'number', min: '0', step: '1' } });
    num.value = f.days == null ? '' : String(weeks ? f.days / 5 : f.days);
    const unit = dr.createEl('select', { cls: 'dropdown' });
    for (const [v, label] of [['d', 'days'], ['w', 'weeks']]) unit.createEl('option', { text: label, attr: { value: v } });
    unit.value = weeks ? 'w' : 'd';
    const readDays = () => {
      const v = num.value.trim();
      f.days = v === '' ? null : Math.max(0, Math.round(parseFloat(v) * (unit.value === 'w' ? 5 : 1)));
      this.update();
    };
    num.addEventListener('input', readDays);
    unit.addEventListener('change', readDays);
    const chips = dr.createDiv('np-ed-chips');
    for (const [d, label] of [[1, '1d'], [2, '2d'], [3, '3d'], [5, '1w'], [10, '2w']]) {
      const b = chips.createEl('button', { cls: 'np-ed-chip', text: label, attr: { type: 'button' } });
      b.addEventListener('click', () => {
        num.value = String(d >= 5 ? d / 5 : d);
        unit.value = d >= 5 ? 'w' : 'd';
        readDays();
      });
    }
    const none = chips.createEl('button', { cls: 'np-ed-chip', text: 'No estimate', attr: { type: 'button' } });
    none.addEventListener('click', () => ((num.value = ''), readDays()));
    const flags = row('');
    const toggle = (label, key, title) => {
      const l = flags.createEl('label', { cls: 'np-ed-check' });
      const c = l.createEl('input', { attr: { type: 'checkbox' } });
      c.checked = !!f[key];
      l.createSpan({ text: label });
      tip(l, title);
      c.addEventListener('change', () => {
        f[key] = c.checked;
        if (key === 'milestone') num.disabled = unit.disabled = c.checked;
        this.update();
      });
      return c;
    };
    toggle('Milestone (#milestone)', 'milestone', 'A point in time, no length: a diamond on the Gantt chart');
    toggle('Blocked (#blocked)', 'flagged', 'Held up by something outside the plan (a supplier, an approval); everything after it is blocked too');
    num.disabled = unit.disabled = f.milestone;
    const marks = row('Marker');
    for (const [k, sign, label] of PLAN_MARKS) {
      const l = marks.createEl('label', { cls: 'np-ed-check' });
      const c = l.createEl('input', { attr: { type: 'checkbox' } });
      c.checked = f.marks.includes(k);
      l.createSpan({ text: `${sign} ${label} (#${k})` });
      c.addEventListener('change', () => {
        f.marks = c.checked ? [...f.marks, k] : f.marks.filter((x) => x !== k);
        this.update();
      });
    }
    // dependencies
    this.depsEl = row('Depends on', 'np-ed-pick');
    this.blocksEl = row('Blocks', 'np-ed-pick');
    // dates
    const dt = row('Dates');
    const fields = dt.createDiv('np-ed-dates');
    for (const [key, sign, label] of [['start', '🛫', 'Start'], ['scheduled', '⏳', 'Scheduled'], ['due', '📅', 'Due']]) {
      const w = fields.createDiv('np-ed-date');
      w.createSpan({ text: `${sign} ${label}` });
      // a date field with the plugin's calendar (date-picker.js), opening under the three fields
      const day = (ymd) => planDayInfo(this.ctx.tasks, this.owners, this.planned, ymd);
      this[`${key}El`] = dateField(w, { value: f[key], label: `${label.toLowerCase()} date`, dayInfo: day, panelIn: dt, onChange: (v) => ((f[key] = v), this.update()) });
    }
    this.weekendEl = dt.createDiv('np-ed-warn-line');
    if (this.planned) {
      const p = dt.createDiv('np-ed-planned');
      p.createSpan({ text: `Planned: ${moment(this.planned.start).format('ddd D MMM')} – ${moment(this.planned.due).format('ddd D MMM')} ` });
      const use = p.createEl('button', { cls: 'np-ed-chip', text: 'Use planned dates', attr: { type: 'button' } });
      use.addEventListener('click', () => {
        f.start = this.startEl.value = this.planned.start;
        f.due = this.dueEl.value = this.planned.due;
        this.update();
      });
    } else if (this.ctx.task) dt.createDiv({ cls: 'np-ed-planned', text: 'Set the project’s started date to see the plan’s dates here.' });
    // id and preview
    this.idEl = row('Id').createDiv('np-ed-id');
    const pv = el.createDiv('np-ed-preview');
    pv.createDiv({ cls: 'np-ed-label', text: 'Will write' });
    this.previewEl = pv.createEl('pre');
    this.alsoEl = pv.createDiv('np-ed-also');
    // buttons
    const bar = el.createDiv('np-ed-buttons');
    // an existing task: delete it (red, asks first) or cancel it, apart on the left
    if (this.ctx.task && this.ctx.plugin) {
      const t = this.ctx.task;
      bar.createEl('button', { cls: 'mod-warning np-ed-delete', text: 'Delete task…' }).addEventListener('click', () => this.ctx.plugin.confirmDeleteTask(t, this.ctx.tasks, this.ctx.view, () => this.close()));
      if (t.status !== 'cancelled') bar.createEl('button', { cls: 'np-ed-cancel-task', text: 'Cancel task' }).addEventListener('click', async () => (await this.ctx.plugin.cancelPlanTask(t, this.ctx.view)) && this.close());
      bar.createDiv('np-ed-gap');
    }
    bar.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());
    const save = bar.createEl('button', { cls: 'mod-cta', text: 'Save' });
    save.addEventListener('click', () => this.save());
    this.scope.register(['Mod'], 'Enter', () => (this.save(), false));
    this.update();
  }

  /** Tasks that can't be picked: the task itself and anything that would make a loop. */
  forbidden() {
    const t = this.ctx.task;
    const deps = new Set();
    const blocks = new Set();
    if (t) for (const x of planDownstream(this.ctx.tasks, t)) deps.add(x);
    for (const b of this.blocks) {
      deps.add(b);
      for (const x of planDownstream(this.ctx.tasks, b)) deps.add(x);
    }
    for (const d of this.deps)
      if (d.task) {
        blocks.add(d.task);
        for (const x of planUpstream(this.byId, d.task)) blocks.add(x);
      }
    return { deps, blocks };
  }

  /** A picker: chips of what's chosen, a search box, matching tasks of the note (loops greyed out). */
  picker(el, { chosen, add, remove, bad, hint, extra = null }) {
    el.empty();
    const chips = el.createDiv('np-ed-chips');
    for (const c of chosen) {
      const chip = chips.createSpan({ cls: 'np-ed-tag', text: c.label });
      if (extra) extra(chip, c);
      const x = chip.createSpan({ cls: 'np-ed-x', text: '×' });
      x.addEventListener('click', () => (remove(c), this.update()));
    }
    const q = el.createEl('input', { cls: 'np-ed-search', attr: { type: 'search', placeholder: hint } });
    const list = el.createDiv('np-ed-list');
    const taken = new Set(chosen.map((c) => c.task).filter(Boolean));
    const draw = () => {
      list.empty();
      const s = q.value.trim().toLowerCase();
      if (!s) return;
      const hits = this.mine.filter((x) => !taken.has(x) && `${x.id || ''} ${planText(x.raw)} ${x.phase || ''}`.toLowerCase().includes(s)).slice(0, 8);
      if (!hits.length) list.createDiv({ cls: 'np-ed-none', text: 'No task in this note matches' });
      for (const x of hits) {
        const no = bad.has(x);
        const item = list.createDiv({ cls: `np-ed-hit${no ? ' is-off' : ''}` });
        const dot = item.createSpan('np-swatch');
        dot.style.backgroundColor = planColour(planBarKind(x, planState(x, this.byId, this.today), this.today));
        item.createSpan({ cls: 'np-id', text: x.id || 'no id' });
        item.createSpan({ text: planClip(planText(x.raw), 60) });
        item.createSpan({ cls: 'np-ed-phase', text: x.phase || '' });
        if (no) tip(item, 'That would make a loop: it already comes after this task');
        else item.addEventListener('click', () => (add(x), this.update()));
      }
    };
    q.addEventListener('input', draw);
  }

  /** Owners: chips, and a search over the people notes (@Name); Enter adds a plain name if none matches. */
  drawOwners() {
    const el = this.ownerEl;
    el.empty();
    const chips = el.createDiv('np-ed-chips');
    for (const text of this.owners) {
      const o = planOwners(`[owner:: ${text}]`)[0];
      const chip = chips.createSpan({ cls: 'np-ed-tag', text: `👤 ${o ? o.name : text}` });
      chip.createSpan({ cls: 'np-ed-x', text: '×' }).addEventListener('click', () => {
        this.owners = this.owners.filter((x) => x !== text);
        this.update();
      });
    }
    const q = el.createEl('input', { cls: 'np-ed-search', attr: { type: 'search', placeholder: 'Search people (@ notes), or type a name and press Enter…' } });
    const list = el.createDiv('np-ed-list');
    const add = (text) => {
      if (!this.owners.includes(text)) this.owners.push(text);
      this.update();
    };
    const hits = () => {
      const s = q.value.trim().toLowerCase().replace(/^@/, '');
      return s ? this.peopleNotes.filter((n) => n.toLowerCase().includes(s) && !this.owners.includes(`[[${n}]]`)).slice(0, 8) : [];
    };
    q.addEventListener('input', () => {
      list.empty();
      for (const n of hits()) {
        const item = list.createDiv({ cls: 'np-ed-hit', text: n });
        item.addEventListener('click', () => add(`[[${n}]]`));
      }
    });
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !q.value.trim()) return;
      e.preventDefault();
      const h = hits();
      add(h.length ? `[[${h[0]}]]` : q.value.trim().replace(/[[\],]/g, ''));
    });
  }

  /** The planned change: ids given out, the main task's form, edits of other tasks; and the notes for the preview. */
  plan() {
    const t = this.ctx.task;
    const used = new Set(this.ctx.tasks.map((x) => x.id).filter(Boolean));
    const f = Object.assign({}, this.form, { owners: this.owners.slice(), marks: this.form.marks.slice() });
    const notes = [];
    if (!f.id) {
      f.id = planNextId(used, this.prefix);
      used.add(f.id);
    }
    const ops = new Map(); // task → { add, remove, id }
    const op = (x) => ops.get(x) || ops.set(x, { add: [], remove: [], id: null }).get(x);
    const idOf = (d) => {
      if (d.id) return d.id;
      const o = op(d.task);
      if (!o.id) {
        o.id = planNextId(used, this.prefix);
        used.add(o.id);
        notes.push(`gives “${planClip(planText(d.task.raw), 40)}” the id ${o.id}`);
      }
      return o.id;
    };
    f.deps = this.deps.filter((d) => d.type === 'fs').map(idOf);
    f.links = Object.fromEntries(['ss', 'ff'].map((k) => [k, this.deps.filter((d) => d.type === k).map((d) => ({ id: idOf(d), lag: d.lag || 0 }))]));
    for (const b of this.blocks)
      if (!this.blocks0.has(b)) {
        op(b).add.push(f.id);
        notes.push(`adds ⛔ ${f.id} to “${planClip(planText(b.raw), 40)}”`);
      }
    for (const b of this.blocks0)
      if (!this.blocks.has(b)) {
        op(b).remove.push(f.id);
        notes.push(`removes ⛔ ${f.id} from “${planClip(planText(b.raw), 40)}”`);
      }
    if (!t) f.tag = taskTagFirst();
    const others = [...ops].map(([task, o]) => ({
      task,
      fn: (rest, box) => ({ rest: planDepsRest(o.id ? planSetSign(rest, '🆔', o.id) : rest, o.add, o.remove), box }),
    }));
    const here = !t && this.phase === this.phase0; // the phase as it opened: at the cursor / after the task
    return { plan: { others, main: { task: t, form: f, phase: this.phase, after: here ? this.ctx.after || null : null, anchor: here ? this.ctx.anchor || null : null } }, notes, f };
  }

  update() {
    this.drawOwners();
    const f0 = this.form;
    const weekend = PLAN_DATE_SIGNS.map(([k, sign]) => (planWeekend(f0[k]) ? `${sign} ${planWeekend(f0[k])}` : '')).filter(Boolean);
    if (this.weekendEl) this.weekendEl.setText(weekend.length ? `⚠ Not a working day: ${weekend.join(', ')}. Working days skip weekends and holidays; move it to a working day?` : '');
    const bad = this.forbidden();
    this.picker(this.depsEl, {
      chosen: this.deps.map((d) => ({ task: d.task, label: d.task ? `${d.task.id || 'new id'} · ${planClip(planText(d.task.raw), 30)}${d.task.external ? ' ↗' : ''}` : `${d.id} (not found)`, d })),
      add: (x) => this.deps.push({ id: x.id || null, task: x, type: 'fs', lag: 0 }),
      extra: (chip, c) => this.linkControls(chip, c.d),
      remove: (c) => (this.deps = this.deps.filter((d) => d !== c.d)),
      bad: bad.deps,
      hint: 'Search this note’s tasks it follows, starts with or ends with…',
    });
    this.picker(this.blocksEl, {
      chosen: [...this.blocks].map((x) => ({ task: x, label: `${x.id || 'no id'} · ${planClip(planText(x.raw), 30)}` })),
      add: (x) => this.blocks.add(x),
      remove: (c) => this.blocks.delete(c.task),
      bad: bad.blocks,
      hint: 'Search this note’s tasks that wait for this one…',
    });
    const { plan, notes, f } = this.plan();
    this.idEl.setText(this.form.id ? f.id : `${f.id} (new)`);
    const res = planEditFile(this.ctx.text, plan, this.today);
    const lines = res.text.split('\n');
    this.previewEl.setText(res.line >= 0 ? lines[res.line].replace(/\r$/, '') : '(this task has changed in the note: close and open it again)');
    this.alsoEl.empty();
    const st = this.ctx.task && this.ctx.task.steps;
    if (st) this.alsoEl.createDiv({ text: `Steps: ${st.done} of ${st.total} done${st.done === st.total ? ': tick Done above to close the task' : ''}` });
    for (const n of notes) this.alsoEl.createDiv({ text: `Also ${n}` });
    const where = this.phase ? `under “${this.phase}”` : 'at the end of the note';
    const here = this.phase === this.phase0;
    if (!this.ctx.task && here && this.ctx.after) this.alsoEl.createDiv({ text: `Goes after “${planClip(planText(this.ctx.after.raw), 40)}”` });
    else if (!this.ctx.task && here && this.ctx.anchor) this.alsoEl.createDiv({ text: `Goes at the cursor (line ${res.line + 1})` });
    else if (!this.ctx.task) this.alsoEl.createDiv({ text: `Goes ${where}` });
    else if (this.phase !== (this.ctx.task.phase || '')) this.alsoEl.createDiv({ text: `Moves ${where}` });
  }

  async save() {
    if (!this.form.desc.trim()) return new Notice('A task needs a description');
    const { plan, f } = this.plan();
    this.lastId = f.id; // the view selects the saved task, so the next New task follows it
    let res = null;
    try {
      await writeNote(this.app, this.ctx.file, (text) => {
        res = planEditFile(text, plan, moment().format('YYYY-MM-DD'));
        return res.text;
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not save the task', e);
        new Notice('Could not save the task. Details in the console.');
      }
      return;
    }
    if (res && res.line < 0) return new Notice('That task changed in the note in the meantime: nothing saved. Open it again.');
    if (res && res.missing.length) new Notice(`Saved; ${res.missing.length} other task(s) had changed and were left alone`);
    this.close();
    if (this.ctx.onSaved) this.ctx.onSaved(this.lastId);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** The first task tag (from the Tasks section's setting), for new tasks. */
function taskTagFirst() {
  const t = String(NEON_PLAN.taskTag || '').split(',')[0].trim();
  return t ? (t.startsWith('#') ? t : `#${t}`) : '';
}
/* @src src/tickets/plan-editor-links.js */
/* ---- Project plans (fork): the task editor's link controls --------------------------------------------------
 * On each Depends on chip: after (⛔), starts with ([starts-with:: ]) or ends with ([ends-with:: ]), and a lag in
 * working days for the last two. Split from plan-editor.js. */
Object.assign(PlanTaskModal.prototype, {
  /** On a dependency chip: how it is linked (after / starts with / ends with) and, for the last two, a lag. */
  linkControls(chip, d) {
    const sel = chip.createEl('select', { cls: 'dropdown np-ed-linktype' });
    for (const [k, label] of [['fs', 'after'], ['ss', 'starts with'], ['ff', 'ends with']]) sel.createEl('option', { text: label, attr: { value: k } });
    sel.value = d.type || 'fs';
    tip(sel, 'After: starts when that one finishes (⛔). Starts with: starts no earlier than it starts. Ends with: finishes no earlier than it finishes.');
    sel.addEventListener('change', () => {
      d.type = sel.value;
      if (d.type === 'fs') d.lag = 0;
      this.update();
    });
    if (d.type === 'fs') return;
    const lag = chip.createEl('input', { cls: 'np-ed-lag', attr: { type: 'number', min: '0', step: '1', value: String(d.lag || 0), 'aria-label': 'Lag in working days' } });
    tip(lag, 'Lag: working days after (0: at the same time)');
    lag.addEventListener('change', () => {
      d.lag = Math.max(0, Math.round(Number(lag.value) || 0));
      this.update();
    });
    chip.createSpan({ cls: 'np-ed-lag-unit', text: 'd' });
  },
});
/* @src src/tickets/plan-graph.js */
/* ---- Project plans (fork): the dependency graph (Mermaid flowchart) -----------------------------------------------
 * One box per task, an arrow from each task to the tasks that depend on it, one group per phase, outside tasks in
 * their own group. Boxes take the bar colours (planBarKind); thick arrows join the critical path. Clicking a box
 * opens the task's line. Colours are written into the text, so a copied or saved graph keeps them. */

/** Text for a box: quotes and brackets Mermaid would read as syntax swapped out, clipped. */
const planNodeLabel = (t, max = 40) => {
  const who = t.owners ? planOwnerShort(t) : '';
  const mark = t.marks ? planMark(t) : null;
  const text = planClip(((mark ? `${mark[1]} ` : '') + (t.external ? '↗ ' : '') + planText(t.raw)).replace(/"/g, "'").replace(/[[\]{}<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled', max);
  return who ? `${text} · ${who}` : text;
};

/**
 * { text, nodes: [{ id, task }] }. kinds: Map task → bar kind; colours: { kind: '#hex' }; edge: colour of the
 * critical path's outline. sched: planSchedule(tasks) (its rows give the critical path).
 */
function planGraphText(tasks, sched, { kinds = new Map(), colours = {}, edge = '#222222', dir = 'TB', phases = true, show = null } = {}) {
  const { byId } = planIndex(tasks);
  const crit = new Map(sched.rows.map((r) => [r.task, r]));
  const ids = new Map(tasks.map((t, i) => [t, `n${i + 1}`]));
  const lines = [`flowchart ${dir}`];
  const groups = new Map();
  for (const t of tasks) {
    const k = t.external ? PLAN_OUTSIDE : t.phase || 'Tasks';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  if (groups.has(PLAN_OUTSIDE)) {
    const out = groups.get(PLAN_OUTSIDE);
    groups.delete(PLAN_OUTSIDE);
    groups.set(PLAN_OUTSIDE, out);
  }
  let g = 0;
  for (const [name, list] of groups) {
    if (phases) lines.push(`  subgraph s${++g}["${planNodeLabel({ raw: name }, 60)}"]`);
    for (const t of list) lines.push(`${phases ? '    ' : '  '}${ids.get(t)}["${planNodeLabel(t)}"]`);
    if (phases) lines.push('  end');
  }
  const onPath = (a, b) => {
    const ra = crit.get(a);
    const rb = crit.get(b);
    return ra && rb && ra.crit && rb.crit && !planClosed(b) && !a.external && !b.external && ra.ef === rb.es;
  };
  for (const t of tasks)
    for (const d of t.deps) {
      const from = byId.get(d);
      if (from) lines.push(`  ${ids.get(from)} ${onPath(from, t) ? '==>' : '-->'} ${ids.get(t)}`);
    }
  // run-alongside links: dotted, labelled
  for (const t of tasks)
    for (const l of t.links || []) {
      const from = byId.get(l.id);
      if (from) lines.push(`  ${ids.get(from)} -.->|${l.type === 'ss' ? 'starts with' : 'ends with'}${l.lag ? ` +${l.lag}d` : ''}| ${ids.get(t)}`);
    }
  const byKind = new Map();
  for (const t of tasks) {
    const k = kinds.get(t) || 'ready';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(ids.get(t));
  }
  for (const [k, list] of byKind) {
    const fill = colours[k] || '#888888';
    const ink = k === 'soon' || k === 'outside' || k === 'waiting' ? '#000000' : '#ffffff'; // as planInk
    lines.push(`  classDef ${k} fill:${fill},stroke:${fill},color:${ink}`, `  class ${list.join(',')} ${k}`);
  }
  const critIds = sched.rows.filter((r) => r.crit && !r.task.external && !planClosed(r.task)).map((r) => ids.get(r.task));
  if (critIds.length) lines.push(`  classDef crit stroke:${edge},stroke-width:3px`, `  class ${critIds.join(',')} crit`);
  for (const [k, , , , fb] of PLAN_MARKS) {
    const list = tasks.filter((t) => (t.marks || []).includes(k)).map((t) => ids.get(t));
    if (list.length) lines.push(`  classDef ${k} stroke:${colours[`mark-${k}`] || fb},stroke-width:3px,stroke-dasharray:6 3`, `  class ${list.join(',')} ${k}`);
  }
  const dim = show ? tasks.filter((t) => !show(t)).map((t) => ids.get(t)) : [];
  if (dim.length) lines.push('  classDef dim opacity:0.25', `  class ${dim.join(',')} dim`); // not this person's: greyed
  return { text: tasks.length ? lines.join('\n') : '', nodes: tasks.map((t) => ({ id: ids.get(t), task: t })) };
}

/** Graph layout saved with the tab: Down / Across and phase groups. Older tabs also saved `fit` (the Fit / Full size
 * buttons, removed: Mermaid never drew wider than full size, so they barely differed); it is dropped. */
function planGraphState(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return { dir: s.dir === 'LR' ? 'LR' : 'TB', phases: s.phases === true };
}

Object.assign(PlanView.prototype, {
  /** Draw the graph and make each box open its task. */
  renderGraph(sched) {
    const colours = planColourMap();
    const edge = colours.edge;
    const { dir, phases } = this.graph;
    const { text, nodes } = planGraphText(this.tasks, sched, { kinds: this.kinds, colours, edge, dir, phases, show: this.who ? (t) => this.shows(t) : null });
    const chart = this.bodyEl.createDiv('np-chart np-graph');
    renderMermaid(this.app, chart, text, this).then(() => this.linkNodes(chart, nodes));
  },
  /** Boxes open their task; the drawing keeps its own size (the pane scrolls) rather than shrinking to fit. */
  async linkNodes(chart, nodes) {
    let svg = chart.querySelector('svg');
    for (let i = 0; !svg && i < 30 && chart.isConnected; i++) {
      await new Promise((r) => window.setTimeout(r, 100));
      svg = chart.querySelector('svg');
    }
    if (!svg) return;
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width) {
      svg.style.maxWidth = 'none';
      svg.style.width = `${Math.ceil(vb.width)}px`;
      svg.style.height = `${Math.ceil(vb.height)}px`;
    }
    for (const { id, task } of nodes) {
      // Mermaid names a box …-flowchart-n3-…; Pele (Obsidian's engine now) marks it data-id="n3"
      const g = svg.querySelector(`[data-id="${id}"], g.node[id*="-flowchart-${id}-"], g.node[id^="flowchart-${id}-"]`);
      if (!g) continue;
      g.addClass('np-node');
      g.addEventListener('click', (e) => this.openTask(e, task));
      g.addEventListener('contextmenu', (e) => this.taskMenu(e, task));
    }
  },
});
/* @src src/tickets/plan-board.js */
/* ---- Project plans (fork): the board ---------------------------------------------------------------------------
 * Columns by state: Ready, Waiting (worked out from ⛔, so nothing can be dropped there; blocked cards sit here,
 * purple, with what blocks them), In progress, Done; rows by phase. Dragging a card (or its menu) changes only the checkbox in the note, through writeNote: [ ] / [/] / [x],
 * adding ✅ today when done and removing it when reopened. Nothing is written while read-only is on.
 * Dragging uses pointer events, not the browser's drag and drop: inside Obsidian the drop of an HTML5 drag never
 * reached the board (the target lit up, nothing moved). Pointer events also work with touch. */

const PLAN_COLUMNS = [
  ['ready', 'Ready', ' '],
  ['waiting', 'Waiting', null], // waiting and blocked tasks
  ['doing', 'In progress', '/'],
  ['done', 'Done', 'x'],
];

/** "blocked by pla-gp3 (overdue)" / "blocked: #blocked" for a blocked task, else ''. */
function planBlockedText(t, byId, today) {
  if (!t || planClosed(t) || !byId) return '';
  if (t.flagged) return 'blocked: tagged #blocked';
  const by = planBlockers(t, byId, today);
  if (!by.length) return '';
  const name = (x) => `${x.id || planClip(planText(x.raw), 30)} (${x.flagged ? '#blocked' : 'overdue'})`;
  return `blocked by ${by.slice(0, 2).map(name).join(', ')}${by.length > 2 ? ` +${by.length - 2}` : ''}`;
}

Object.assign(PlanView.prototype, {
  renderBoard() {
    const { byId } = planIndex(this.tasks);
    const own = this.tasks.filter((t) => !t.external && this.shows(t));
    const lanes = new Map();
    const byPerson = this.lanes === 'person' && planPeople(this.tasks).length;
    for (const t of own) {
      // by person: a task with two owners sits in its first owner's row
      const k = byPerson ? ((t.owners || [])[0] || { name: 'No owner' }).name : t.phase || 'Tasks';
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(t);
    }
    if (byPerson && lanes.has('No owner')) {
      const none = lanes.get('No owner');
      lanes.delete('No owner');
      lanes.set('No owner', none);
    }
    const board = this.bodyEl.createDiv('np-board');
    const today = this.today;
    const column = (t) => {
      const s = planState(t, byId, today);
      return s === 'blocked' ? 'waiting' : s;
    };
    for (const [key, label] of PLAN_COLUMNS) {
      const head = board.createDiv({ cls: `np-col-head is-${key}` });
      head.createSpan({ text: label });
      const n = own.filter((t) => column(t) === key).length;
      const blocked = key === 'waiting' ? own.filter((t) => planState(t, byId, today) === 'blocked').length : 0;
      head.createSpan({ cls: 'np-col-n', text: blocked ? `${n} · ${blocked} blocked` : String(n) });
      if (key === 'waiting') tip(head, 'Waiting on earlier tasks (worked out from ⛔, so cards can’t be dropped here). Purple: blocked by an overdue or #blocked task upstream');
    }
    for (const [lane, list] of lanes) {
      board.createDiv({ cls: 'np-lane', text: lane });
      for (const [key, , box] of PLAN_COLUMNS) {
        const cell = board.createDiv({ cls: `np-cell is-${key}` });
        if (box !== null) cell.dataset.box = box; // a drop target (Waiting has none)
        // highest priority first (the plan's order otherwise)
        const cards = list.filter((x) => column(x) === key).map((t, i) => [t, i]).sort((a, b) => (b[0].priority ?? 2) - (a[0].priority ?? 2) || a[1] - b[1]);
        for (const [t] of cards) this.card(cell, t, byId);
      }
    }
  },
  card(cell, t, byId) {
    const kind = this.kinds.get(t) || 'ready';
    const c = cell.createDiv({ cls: `np-card is-${kind}${t.status === 'cancelled' ? ' is-cancelled' : ''}`, attr: { 'data-key': planKey(t) } });
    planFill(c, kind); // same colours as the Gantt bars and graph boxes
    c.createDiv({ cls: 'np-card-text', text: planText(t.raw) });
    const meta = c.createDiv('np-card-meta');
    if (planPrioritySign(t.priority ?? 2)) tip(meta.createSpan({ cls: 'np-pri', text: planPrioritySign(t.priority) }), `${PLAN_PRIORITIES.find((p) => p[0] === t.priority)[2]} priority`);
    if (t.id) meta.createSpan({ cls: 'np-id', text: t.id });
    if (t.steps) tip(meta.createSpan({ cls: planStepsDone(t) ? 'np-steps is-all' : 'np-steps', text: `☑ ${t.steps.done}/${t.steps.total}` }), planStepsDone(t) ? 'Every step is done: move the card to Done' : 'Steps done (the checkboxes under the task)');
    meta.createSpan({ text: t.milestone ? '◆ milestone' : `${planDays(t)}d` });
    if (this.ownerText(t)) meta.createSpan({ text: this.ownerText(t) });
    for (const [k, sign, label] of PLAN_MARKS) if ((t.marks || []).includes(k)) c.createDiv({ cls: `np-mark is-${k}`, text: `${sign} ${label}` });
    if (t.due) meta.createSpan({ cls: kind === 'overdue' || kind === 'soon' ? `is-${kind}` : '', text: `📅 ${moment(t.due, 'YYYY-MM-DD').format('D MMM')}` });
    if (t.status === 'cancelled') meta.createSpan({ text: 'cancelled' });
    const why = planBlockedText(t, byId, this.today);
    if (why) c.createDiv({ cls: 'np-card-why', text: why });
    c.addEventListener('pointerdown', (e) => this.dragStart(e, c, t));
    c.addEventListener('click', (e) => {
      if (Date.now() - (this.dragEndAt || 0) < 400) return; // the click that ends a drag doesn't open anything
      this.openTask(e, t);
    });
    c.addEventListener('contextmenu', (e) => this.taskMenu(e, t));
  },
  /**
   * Drag with the pointer: past a few pixels a copy of the card follows the pointer, the cell under it lights up when
   * it takes drops, and letting go there moves the task. Escape, or letting go elsewhere, cancels.
   */
  dragStart(e, card, t) {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const home = card.parentElement; // dropping back where it came from changes nothing
    let ghost = null;
    let over = null;
    const stop = new AbortController();
    const end = () => {
      stop.abort();
      this.dragActive = false;
      if (this.redrawAfterDrag) {
        this.redrawAfterDrag = false;
        window.setTimeout(() => this.render(), 0);
      }
      if (ghost) ghost.remove();
      card.removeClass('is-dragging');
      if (over) over.removeClass('is-over');
    };
    this.register(() => stop.abort());
    const target = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el && el.closest('.np-cell');
      return cell && this.bodyEl.contains(cell) && cell.dataset.box !== undefined ? cell : null;
    };
    window.addEventListener(
      'pointermove',
      (ev) => {
        if (!ghost) {
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
          const box = card.getBoundingClientRect();
          ghost = card.cloneNode(true);
          ghost.addClass('np-ghost');
          ghost.style.width = `${box.width}px`;
          document.body.appendChild(ghost);
          card.addClass('is-dragging');
          this.dragActive = true; // the board isn't redrawn under the pointer (see render)
        }
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
        const cell = target(ev);
        if (cell !== over) {
          if (over) over.removeClass('is-over');
          over = cell;
          if (over) over.addClass('is-over');
        }
      },
      { signal: stop.signal },
    );
    window.addEventListener(
      'pointerup',
      (ev) => {
        const cell = ghost ? target(ev) : null;
        const dragged = !!ghost;
        end();
        if (!dragged) return;
        this.dragEndAt = Date.now();
        if (!cell || cell === home) return;
        NEON_GUARD.lastGesture = Date.now(); // a drop is asked for by you: a read-only refusal gets a notice
        cell.appendChild(card); // show it at once; the view redraws when the note changes
        this.moveTask(t, cell.dataset.box);
      },
      { signal: stop.signal },
    );
    window.addEventListener('pointercancel', end, { signal: stop.signal });
    window.addEventListener('keydown', (ev) => ev.key === 'Escape' && end(), { signal: stop.signal });
  },
});
/* @src src/tickets/plan-people.js */
/* ---- Project plans (fork): owners in the Planning view -------------------------------------------------------------
 * Owners come from [owner:: [[@Sam Taylor]], Alex] (people notes or plain names). The view can show one person's
 * tasks (the Gantt, board and list leave the others out; the graph greys them), group the board by person, and
 * warns when someone has more than their working days in a week (five, fewer with holidays or time off). */

const PLAN_NOBODY = '\u0000nobody'; // the filter value for tasks without an owner

/** Owners of the plan's own tasks: [{ key, name }] by name. */
function planPeople(tasks) {
  const seen = new Map();
  for (const t of tasks) if (!t.external) for (const o of t.owners || []) if (!seen.has(o.key)) seen.set(o.key, o.name);
  return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

Object.assign(PlanView.prototype, {
  /** The person filter (all modes) and the board's Phase / Person rows. */
  buildPeopleTools(tools) {
    this.whoEl = tools.createEl('select', { cls: 'dropdown np-who' });
    tip(this.whoEl, 'Show one person’s tasks');
    this.whoEl.addEventListener('change', () => {
      this.who = this.whoEl.value || null;
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    this.lanesEl = pills(tools, [['phase', 'By phase'], ['person', 'By person']], this.lanes, (v) => {
      this.lanes = v || 'phase';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
  },
  /** Fill the person list from the plan; hide what doesn't apply to this mode. */
  syncPeopleTools() {
    const people = planPeople(this.tasks);
    const sel = this.whoEl;
    sel.empty();
    sel.createEl('option', { text: 'Everyone', attr: { value: '' } });
    for (const p of people) sel.createEl('option', { text: p.name, attr: { value: p.key } });
    sel.createEl('option', { text: 'No owner', attr: { value: PLAN_NOBODY } });
    if (this.who && this.who !== PLAN_NOBODY && !people.some((p) => p.key === this.who)) this.who = null;
    sel.value = this.who || '';
    sel.toggleClass('is-hidden', !people.length);
    this.lanesEl.el.toggleClass('is-hidden', this.mode !== 'board' || !people.length);
  },
  /** Is this task shown under the person filter? */
  shows(t) {
    if (!this.who) return true;
    const owners = t.owners || [];
    return this.who === PLAN_NOBODY ? !owners.length : owners.some((o) => o.key === this.who);
  },
  /** "Marcus Hale has 7 days of work in the week of Mon 23 Nov (5 available)". */
  loadLines(sched, dated = !(this.weeks || !this.base)) {
    let cap = 5;
    let opts = {};
    if (dated && this.base) {
      // calendar weeks, each person's own working days in them (holidays and their time off left out)
      const from = planWorkdays(this.base, 0);
      const leave = this.tasks.leave;
      const days = new Map();
      const dayOf = (d) => days.get(d) || days.set(d, planWorkdays(from, d)).get(d);
      const monday = (ymd) => ymdAdd(ymd, -((planDow(ymd) + 6) % 7));
      const free = (o, ymd) => !planLeaveOff(planLeaveFor(leave, o), ymd);
      opts = { weekOf: (d) => monday(dayOf(d)), works: (o, d) => free(o, dayOf(d)) };
      cap = (o, week) => [0, 1, 2, 3, 4, 5, 6].map((i) => ymdAdd(week, i)).filter((d) => planCal().isWorkday(d) && free(o, d)).length;
    }
    return planOverloads(sched.rows, cap, opts).map(({ name, week, days, cap: avail, lowest }) => {
      const when = typeof week === 'string' ? `the week of ${moment(week, 'YYYY-MM-DD').format('ddd D MMM')}` : `Wk ${week + 1}`;
      const move = lowest ? `; the easiest to move: ${lowest.id || planClip(planText(lowest.raw), 30)}${lowest.priority !== 2 ? ` (${PLAN_PRIORITIES.find((p) => p[0] === lowest.priority)[2].toLowerCase()} priority)` : ''}` : '';
      return `${name} has ${days} days of work in ${when} (${avail} available)${move}`;
    });
  },
  /** "👤 Marcus, Sofia" for a card or row, or ''. */
  ownerText(t) {
    return (t.owners || []).length ? `👤 ${t.owners.map((o) => o.name).join(', ')}` : '';
  },
});
/* @src src/tickets/plan-forecast.js */
/* ---- Project plans (fork): forecast finish, baseline, phase bars, markers in the Planning view -----------------------
 * With the project's started date the plan has a forecast finish; against its due date it is on time or N working
 * days late (the Gantt draws both as milestones, the Projects rows say so too). Save baseline keeps today's planned
 * finish of every task with an id in the plugin's own data (not the note); the list then shows how far each has
 * slipped since. The Gantt can show one bar per phase. Tasks tagged #risk, #issue or #decision get a marker. */

/** The project's due date (its `due` property) as YYYY-MM-DD, or null. */
function planDueDate(app, scope) {
  let f = app.vault.getAbstractFileByPath(scope.path);
  if (scope.kind === 'folder') {
    const rep = f instanceof TFolder ? projectFolderNote(app, f) : null;
    f = rep ? rep.file : null;
  }
  const fm = f instanceof TFile ? (app.metadataCache.getFileCache(f) || {}).frontmatter || {} : {};
  const m = String(fm.due || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}
/** Working days from a to b, negative when b is earlier (pure). */
function planSlipDays(a, b) {
  return b >= a ? planWorkdaysBetween(a, b) : -planWorkdaysBetween(b, a);
}
/** "forecast finish 12 Dec, 3 working days late" / "…, 4 days to spare" / "…" (no due date). */
function planForecastText(end, due, late) {
  if (!end) return '';
  if (!due) return `forecast finish ${planShortDate(end)}`;
  if (late) return `forecast finish ${planShortDate(end)}, ${late} working day${late === 1 ? '' : 's'} after the due date`;
  const spare = planWorkdaysBetween(end, due);
  return `forecast finish ${planShortDate(end)}${spare ? `, ${spare} working day${spare === 1 ? '' : 's'} to spare` : ', on the due date'}`;
}
/** "2 risks · 1 issue · 3 decisions", or ''. */
function planMarkText(tasks) {
  return PLAN_MARKS.map(([k, , label]) => {
    const n = tasks.filter((t) => !t.external && !planClosed(t) && (t.marks || []).includes(k)).length;
    return n ? `${n} ${label.toLowerCase()}${n === 1 ? '' : 's'}` : '';
  })
    .filter(Boolean)
    .join(' · ');
}

/**
 * Schedule warnings (pure): a task planned to finish after its 📅 date, due before a task it depends on, or in
 * progress past its planned finish. ends: Map task → planned last day (the plan with real dates), or none. Returns
 * [{ task, text }] in the plan's order.
 */
function planWarnings(tasks, ends, today) {
  const { byId } = planIndex(tasks);
  const name = (t) => t.id || planClip(planText(t.raw), 30);
  const out = [];
  for (const t of tasks) {
    if (t.external || planClosed(t)) continue;
    const end = ends && ends.get(t);
    if (end && t.due && end > t.due && !t.milestone) out.push({ task: t, text: `${name(t)}: planned to finish ${planShortDate(end)}, ${planWorkingDays(planWorkdaysBetween(t.due, end))} after its 📅 ${planShortDate(t.due)}` });
    for (const d of t.deps) {
      const x = byId.get(d);
      if (x && t.due && x.due && t.due < x.due) out.push({ task: t, text: `${name(t)}: 📅 ${planShortDate(t.due)} is before ${name(x)}'s 📅 ${planShortDate(x.due)}, which it waits for` });
    }
    if (t.status === 'doing' && end && today && end < today) out.push({ task: t, text: `${name(t)}: in progress, planned to finish ${planShortDate(end)}` });
  }
  return out;
}

Object.assign(PlanView.prototype, {
  /** Gantt: Tasks / Phases; Report; Write dates… (the baseline is automatic: see plan-baseline.js and the ⋯ menu). */
  buildForecastTools(tools) {
    this.phasesOnlyEl = pills(tools, [['tasks', 'Tasks'], ['phases', 'Phases']], this.ganttPhases ? 'phases' : 'tasks', (v) => {
      this.ganttPhases = v === 'phases';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    tip(this.phasesOnlyEl.el, 'One bar per phase, or every task');
    // fork: Undo for the last change made by dragging on the Gantt
    this.undoBtn = button(tools, { icon: 'undo-2', text: 'Undo', cls: 'np-undo-btn is-hidden', title: 'Undo the last change made on the chart', onClick: () => this.undoChange() });
    this.reportBtn = button(tools, { icon: 'file-output', text: 'Report ▾', cls: 'np-report-btn', title: 'Save a printable report of this plan (a note with the chart) in the reports folder or next to the project (a setting): concise, or full with the whole project note', onClick: (e) => this.reportMenu(e) });
    this.datesBtn = button(tools, { icon: 'calendar-check', text: 'Write dates…', cls: 'np-dates-btn', title: 'Record today’s planned dates in the tasks as 🛫 start and 📅 due, choosing which (a snapshot: they don’t follow the plan afterwards)', onClick: () => new PlanDatesModal(this.app, this).open() });
  },
  syncForecastTools() {
    this.phasesOnlyEl.el.toggleClass('is-hidden', this.mode !== 'gantt');
    this.datesBtn.toggleClass('is-hidden', !this.base);
  },
  /** The plan with real dates (whatever the Dates / Weeks switch): forecast, baseline and slip use it. */
  datedPlan() {
    if (!this.base) return null;
    return planGanttText(this.tasks, { base: this.base, today: this.today, due: this.due });
  },
  baseline() {
    const all = this.plugin.settings.planBaselines || {};
    const b = this.plan && all[this.plan.path];
    return b && b.tasks ? b : null; // { removed } only stops the automatic one coming back
  },
  /** The ⋯ menu: re-baseline (a new plan agreed) or remove the baseline; only with real dates. */
  onPaneMenu(menu, source) {
    ItemView.prototype.onPaneMenu.call(this, menu, source);
    if (!this.plan || !this.base) return;
    const b = this.baseline();
    const title = !b ? 'Save a baseline now' : b.provisional ? 'Lock the baseline now (it follows the plan until every task has a duration)' : `Re-baseline (replaces the one from ${planShortDate(b.saved)})`;
    menu.addItem((i) => i.setSection('action').setTitle(title).setIcon('flag').onClick(() => this.saveBaseline()));
    if (b) menu.addItem((i) => i.setSection('action').setTitle('Remove the baseline').setIcon('trash-2').onClick(() => this.saveBaseline(true)));
    // fork: keep ⏳ scheduled dates in step with the plan (plan-scheduled.js)
    menu.addItem((i) => i.setSection('action').setTitle('Keep ⏳ scheduled dates in step with the plan').setIcon('calendar-sync').setChecked(this.keepsScheduled()).onClick(() => this.toggleScheduled()));
  },
  async saveBaseline(remove = false) {
    const s = this.plugin.settings;
    s.planBaselines = s.planBaselines || {};
    if (remove) s.planBaselines[this.plan.path] = { removed: this.today }; // not saved again automatically
    else {
      const dated = this.datedPlan();
      if (!dated) return new Notice('Set the project’s started date first');
      s.planBaselines[this.plan.path] = planBaselineOf(dated, this.today); // chosen by hand: locked
    }
    await this.plugin.saveSettings(); // the plugin's own data, not the note
    new Notice(remove ? 'Baseline removed' : 'Baseline saved and locked');
    this.render();
  },
  /** Working days a task has slipped since the baseline (negative: ahead), or null. */
  slip(t) {
    const b = this.baseline();
    const now = this.ends && this.ends.get(t);
    if (!b || b.provisional) return null; // a provisional baseline follows the plan: no slip yet
    const then = t.id && b.tasks[t.id];
    return then && now ? planSlipDays(then, now) : null;
  },
  /** The summary line's forecast part. */
  forecastSummary() {
    const dated = this.dated;
    if (!dated || !dated.end) return '';
    let s = planForecastText(dated.end, this.due, dated.late);
    const b = this.baseline();
    if (b && b.end) {
      const d = planSlipDays(b.end, dated.end);
      if (b.provisional) s += ' (provisional baseline: it follows the plan until every task has a duration)';
      else s += d ? ` (${d > 0 ? '+' : ''}${d} since the baseline of ${planShortDate(b.saved)})` : ` (as the baseline of ${planShortDate(b.saved)})`;
    }
    return s;
  },
});
/* @src src/tickets/plan-baseline.js */
/* ---- Project plans (fork): automatic baselines -------------------------------------------------------------
 * A baseline is today's planned finish of every task, kept so the Planning view can show later how far tasks have
 * slipped (the List's Slip column, "+N since the baseline" after the forecast). It is saved automatically the first
 * time a project is seen started (its status is in progress or on hold) with a started date and plan tasks. While
 * an open task still has no duration the baseline is provisional: it follows every change to the plan, and locks
 * once every open task has a duration (Kevin's choice, 17 Nov). The Planning view's ⋯ menu locks it early,
 * re-baselines it (a new plan agreed: locked) or removes it. Baselines live in the plugin's own
 * settings, one per project path (no files in the vault): they follow a renamed or moved project, and those of
 * projects that no longer exist are dropped on start. */

/** Is the plan still missing durations (an open task of its own, not a milestone, with none)? */
function planIncomplete(tasks) {
  return tasks.some((t) => !t.external && !t.milestone && t.days == null && t.status !== 'done' && t.status !== 'cancelled');
}
/** The baseline of a dated plan (planGanttText with a base date): { saved, end, tasks: { id: finish }, provisional }. */
function planBaselineOf(dated, today, provisional = false) {
  const tasks = {};
  for (const b of dated.bars || []) if (b.task && b.task.id && !b.task.external) tasks[b.task.id] = b.end;
  return { saved: today, end: dated.end || null, tasks, provisional: !!provisional };
}
/** Same plan (end and every task's finish)? Then a provisional baseline needn't be saved again. */
function planBaselineSame(a, b) {
  return !!a && !!b && a.end === b.end && !!a.provisional === !!b.provisional && JSON.stringify(a.tasks) === JSON.stringify(b.tasks);
}
/** Baselines after a rename: the note's own key, or every key inside a renamed folder. Returns true when changed. */
function planBaselineMove(all, from, to) {
  let changed = false;
  for (const key of Object.keys(all || {})) {
    let next = null;
    if (key === from) next = to;
    else if (key.startsWith(from + '/')) next = to + key.slice(from.length);
    if (next && next !== key) {
      all[next] = all[key];
      delete all[key];
      changed = true;
    }
  }
  return changed;
}
/** Drop the baselines whose project no longer exists. Returns true when any were dropped. */
function planBaselinePrune(all, exists) {
  let changed = false;
  for (const key of Object.keys(all || {}))
    if (!exists(key)) {
      delete all[key];
      changed = true;
    }
  return changed;
}
/** Is the project under way (so its plan is agreed)? Not before it starts, and not once it is done. */
function planIsStarted(t) {
  return !!t && (t.status === 'in-progress' || t.status === 'waiting');
}

Object.assign(NeonProjects.prototype, {
  /** Keep baselines with their projects: follow renames, drop the gone ones once the vault is indexed. */
  hookBaselines() {
    const s = this.settings;
    this.registerEvent(
      this.app.vault.on('rename', (f, old) => {
        if (planBaselineMove(s.planBaselines, old, f.path)) this.saveSettings();
      }),
    );
    const ref = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(ref);
      if (planBaselinePrune(s.planBaselines, (p) => !!this.app.vault.getAbstractFileByPath(p))) this.saveSettings();
      this.autoBaselines();
    });
    this.registerEvent(ref);
    this.autoBaselinesSoon = debounce(() => this.autoBaselines(), 5000, true);
  },
  /** Save a baseline for every started project with a started date and plan tasks that has none yet, and follow
   *  the plan with the provisional ones (locking them once every open task has a duration). */
  async autoBaselines() {
    if (this.baselining) return;
    this.baselining = true;
    try {
      const all = (this.settings.planBaselines = this.settings.planBaselines || {});
      const today = moment().format('YYYY-MM-DD');
      let saved = 0;
      for (const t of this.collectProjects()) {
        if (!planIsStarted(t) || !t.startedOn) continue;
        const scope = this.planScope(t);
        const old = all[scope.path];
        if (old && !old.provisional) continue; // locked, or removed ({ removed })
        const tasks = await planCollect(this.app, scope);
        if (!tasks.some((x) => x.id && !x.external)) continue;
        const base = planBaseDate(this.app, scope);
        if (!base) continue;
        const next = planBaselineOf(planGanttText(tasks, { base, today, due: planDueDate(this.app, scope) }), today, planIncomplete(tasks));
        if (planBaselineSame(old, next)) continue;
        all[scope.path] = next;
        saved++;
      }
      if (saved) {
        await this.saveSettings(); // the plugin's own data, not the notes
        this.app.workspace.getLeavesOfType(VIEW_PLAN).forEach((l) => l.view && l.view.render && l.view.render());
      }
    } catch (e) {
      console.error(`${appName()} – Projects: automatic baseline`, e);
    } finally {
      this.baselining = false;
    }
  },
});
/* @src src/tickets/plan-marks.js */
/* ---- Project plans (fork): plan problems underlined in the note while you edit it -----------------------------
 * In a project note, a ⛔ id no task has, a 🆔 used by two tasks and the links of a dependency loop get a wavy
 * underline, with the reason on hover (planProblems, the same check as the Planning view). The note's own tasks
 * are read live from the editor as you type; the rest of the plan (the project folder's other notes, and other
 * projects' tasks linked to it) from the saved notes, refreshed when they change. Only the display changes:
 * nothing is written, so it works with read-only on. Setting: "Underline plan problems in project notes". */
let planCmView = null;
try {
  planCmView = require('@codemirror/view'); // provided by Obsidian at runtime
} catch (e) {
  planCmView = null; // no editor marks; the Planning view still lists the problems
}
const PLAN_DEP_RE = /⛔️?\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u;
const PLAN_ID_RE = /🆔\s*([\w-]+)/u;

/**
 * Where to underline in one line: [{ from, to, text }] (offsets in the line). problems: planProblems for this task.
 * A missing id is underlined in the ⛔ list; an id used twice at its 🆔; a loop's ⛔ list as a whole.
 */
function planLineMarks(line, problems) {
  const out = [];
  const dep = line.match(PLAN_DEP_RE);
  const depAt = dep ? dep.index + dep[0].length - dep[1].length : -1;
  for (const p of problems) {
    if (p.kind === 'missing') {
      // in the ⛔ list, and in the [starts-with:: ] / [ends-with:: ] fields
      const spans = [];
      if (dep) spans.push([depAt, dep[1]]);
      for (const f of line.matchAll(/\[(?:starts-with|ends-with)::([^\]]*)\]/giu)) spans.push([f.index + f[0].indexOf('::') + 2, f[1]]);
      for (const [at, text] of spans) {
        const re = /[\w-]+/g;
        let m;
        while ((m = re.exec(text))) if (p.ids.includes(m[0])) out.push({ from: at + m.index, to: at + m.index + m[0].length, text: p.text });
      }
    } else if (p.kind === 'dup') {
      const id = line.match(PLAN_ID_RE);
      if (id) out.push({ from: id.index + id[0].length - id[1].length, to: id.index + id[0].length, text: p.text });
    } else if (p.kind === 'loop' && dep) out.push({ from: depAt, to: depAt + dep[1].length, text: p.text });
    else if (p.kind === 'nested') {
      // what makes the line a task: its task tag, else its id
      const tags = String(NEON_PLAN.taskTag || '#task').split(/[,\s]+/).filter(Boolean).map((x) => (x.startsWith('#') ? x : `#${x}`));
      const tag = tags.map((x) => line.indexOf(x)).find((i) => i >= 0);
      const id = line.match(PLAN_ID_RE);
      if (tag != null) out.push({ from: tag, to: tag + tags.find((x) => line.indexOf(x) === tag).length, text: p.text });
      else if (id) out.push({ from: id.index, to: id.index + id[0].length, text: p.text });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
/** The plan tasks in a note's text (a checkbox with a task tag or a 🆔 id), with their 0-based line numbers. */
function planTextTasks(lines, file) {
  const out = [];
  lines.forEach((text, n) => {
    if (!text.includes('[')) return;
    const t = planTask(text, { file, line: n });
    if (t && (t.id || planHasTag(t.raw, NEON_PLAN.taskTag))) out.push(t);
  });
  return planAddSteps(lines, out);
}

Object.assign(NeonProjects.prototype, {
  hookPlanMarks() {
    if (!planCmView || !this.registerEditorExtension) return;
    this.markOutside = new Map(); // note path -> { tasks } (null while loading): the plan's tasks from other notes
    this.markGen = 0;
    const plugin = this;
    const { ViewPlugin, Decoration } = planCmView;
    const ext = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.gen = -1;
          this.decorations = Decoration.none;
          this.build(view);
        }
        update(u) {
          if (u.docChanged || this.gen !== plugin.markGen) this.build(u.view);
        }
        build(view) {
          this.gen = plugin.markGen;
          this.decorations = Decoration.none;
          try {
            const info = obsidian.editorInfoField ? view.state.field(obsidian.editorInfoField, false) : null;
            const file = info && info.file;
            if (!file || plugin.settings.planMarks === false) return;
            const scope = planScopeOf(plugin.app, file);
            if (!scope) return;
            const outside = plugin.planMarkOutside(file, scope);
            if (!outside) return; // still reading the rest of the plan: no marks rather than wrong ones
            const doc = view.state.doc;
            const lines = [];
            for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
            const own = planTextTasks(lines, file);
            if (!own.length) return;
            const byTask = new Map();
            for (const p of planProblems([...own, ...outside])) {
              const hit = p.kind === 'missing' || p.kind === 'nested' ? [p.task] : own.filter((t) => (p.kind === 'dup' ? t.id === p.ids[0] : p.kind === 'loop' && t.id && p.ids.includes(t.id)));
              for (const t of hit) if (own.includes(t)) byTask.set(t, [...(byTask.get(t) || []), p]);
            }
            const ranges = [];
            for (const [t, ps] of byTask) {
              const line = doc.line(t.line + 1);
              for (const m of planLineMarks(line.text, ps)) ranges.push(Decoration.mark({ class: 'np-bad-ref', attributes: { title: `Planning: ${m.text}` } }).range(line.from + m.from, line.from + m.to));
            }
            this.decorations = Decoration.set(ranges, true);
          } catch (e) {
            console.error(`${appName()} – Projects: plan marks`, e);
          }
        }
      },
      { decorations: (v) => v.decorations },
    );
    this.registerEditorExtension(ext);
    // the rest of the plan is read again when a note of the plan is saved (debounced), or the note is reopened
    const redo = debounce(() => this.planMarksRefresh(), 1500, true);
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (!this.markOutside.size) return;
        const scope = planScopeOf(this.app, f);
        let gone = false;
        for (const key of [...this.markOutside.keys()])
          if (key === f.path || (scope && scope.kind === 'folder' && key.startsWith(scope.path + '/'))) gone = this.markOutside.delete(key) || gone;
        if (gone) redo();
      }),
    );
    this.registerEvent(this.app.workspace.on('file-open', (f) => f && this.markOutside.delete(f.path)));
  },
  /** The plan's tasks outside this note (cached), or null while they are being read (then the marks redraw). */
  planMarkOutside(file, scope) {
    const had = this.markOutside.get(file.path);
    if (had) return had.tasks;
    const entry = { tasks: null };
    this.markOutside.set(file.path, entry);
    planCollect(this.app, scope)
      .then((tasks) => (entry.tasks = tasks.filter((t) => t.file.path !== file.path)))
      .catch((e) => {
        console.error(`${appName()} – Projects: plan marks`, e);
        entry.tasks = [];
      })
      .then(() => this.planMarksRefresh());
    return null;
  },
  /** Redraw the marks in every open editor. */
  planMarksRefresh() {
    this.markGen++;
    this.app.workspace.updateOptions();
  },
});
/* @src src/tickets/plan-gantt-drag.js */
/* ---- Project plans (fork): editing on the Gantt chart -------------------------------------------------------
 * Drag a bar's right end to change its length ([duration:: Nd], or the 📅 date of a task fixed by 🛫 and 📅), the
 * bar itself to start it later (🛫 start, "not before": what waits for it moves too; it can't go before what it
 * waits for), and Alt-drag from one bar onto another to link them, by the ends you use: from the right end to the
 * other's left, the second waits for the first (⛔); left end to left end, it starts with it ([starts-with:: ]);
 * right end to right end, it ends with it ([ends-with:: ]). The first gets an id if it has none; no loops. Click an
 * arrow to remove that link. Each change edits only the task lines involved,
 * through the usual queue (editTask); Undo puts the last change back. Off on phones (dragging would fight the
 * scrolling). Kevin, 17 Nov: Alt for links, 🛫 for moving. */

/** The working day a dragged date lands on: a day off moves to the next working day. */
const planDropDay = (ymd) => planWorkdays(ymd, 0);
/** The working day before a date (the settings' calendar). */
function planWorkdaysBack(ymd) {
  let d = ymdAdd(ymd, -1);
  for (let n = 0; !planCal().isWorkday(d) && n < 400; n++) d = ymdAdd(d, -1);
  return d;
}
/** Length in working days of a bar from start to last (inclusive), at least 1 (pure). */
const planBarDays = (start, last) => Math.max(1, planWorkdaysBetween(start, planDropDay(last)) + 1);
/**
 * The earliest a task may start (pure): the working day after the last task it waits for ends, and not before
 * today if it hasn't started. bars: the dated plan's bars.
 */
function planEarliest(t, bars, today) {
  let at = null;
  const later = (d) => (at = !at || d > at ? d : at);
  const barOf = (id) => bars.find((x) => x.task && x.task.id === id);
  for (const id of t.deps || []) {
    const b = barOf(id);
    if (b) later(planWorkdays(b.end, 1));
  }
  // starts with: its start plus the lag; ends with: early enough to finish with it (the length stays)
  for (const l of t.links || []) {
    const b = barOf(l.id);
    if (!b) continue;
    if (l.type === 'ss') later(planWorkdays(b.start, l.lag));
    else {
      const own = bars.find((x) => x.task === t);
      const len = own ? planWorkdaysBetween(own.start, own.end) : 0;
      const fin = planWorkdays(b.end, l.lag);
      // the latest start that still finishes with it: count back the task's length in working days
      let s = fin;
      for (let k = 0; k < len; k++) s = planWorkdaysBack(s);
      later(s);
    }
  }
  if (t.status === 'todo' && today && (!at || today > at)) at = planDropDay(today);
  return at;
}

/**
 * The link an Alt-drag makes (pure): from an end to the other's left half: waits for (fs); from a start to the
 * other's left half: starts with (ss); from an end to the other's right half: ends with (ff); a start to an end:
 * null (not offered). A milestone counts as its left half.
 */
function planDropType(fromStart, x, ends, milestone) {
  const left = milestone || x < (ends.x0 + ends.x1) / 2;
  if (fromStart) return left ? 'ss' : null;
  return left ? 'fs' : 'ff';
}

Object.assign(PlanView.prototype, {
  /** Make the drawn Gantt editable. svg: planDrawGantt's result (redrawn often: its own listeners go with it). */
  attachGanttDrag(svg, lay, bars) {
    if (!svg || NEON_MOBILE.phone) return;
    const dated = !!this.base && !this.weeks;
    const items = lay.items.filter((it) => it.type === 'bar' && it.row.bar.task && !it.row.bar.task.external);
    const scale = () => svg.getBoundingClientRect().width / lay.width || 1;
    const at = (e) => {
      const r = svg.getBoundingClientRect();
      const k = scale();
      return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    };
    const rowAt = (y) => lay.items.find((it) => it.type === 'bar' && y >= it.y && y < it.y + lay.rowH);
    const zone = (p) => {
      const it = rowAt(p.y);
      if (!it || !items.includes(it)) return null;
      const e = planBarEnds(lay, it);
      if (p.x < e.x0 - 4 || p.x > e.x1 + 4) return null;
      return { it, ends: e, end: !it.row.milestone && p.x >= e.x1 - 6 };
    };
    // the pointer shows what a drag would do
    svg.addEventListener('pointermove', (e) => {
      if (this.drag) return;
      const z = zone(at(e));
      svg.style.cursor = !z ? '' : e.altKey ? 'crosshair' : z.end ? 'ew-resize' : dated ? 'grab' : '';
    });
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = at(e);
      const z = zone(p);
      if (!z) return;
      const mode = e.altKey ? 'link' : z.end ? 'end' : dated ? 'move' : null;
      if (!mode) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const key = planKey(z.it.row.bar.task);
      const row = [...svg.querySelectorAll('.np-g-row')].find((r) => r.getAttribute('data-key') === key);
      const shape = row && row.querySelector('.np-g-bar, polygon');
      // Alt-drag: from the left half of the bar, a start; from the right half, an end
      const fromStart = mode === 'link' && !z.it.row.milestone && p.x < (z.ends.x0 + z.ends.x1) / 2;
      this.drag = { mode, it: z.it, ends: z.ends, fromStart, x0: p.x, moved: false, row, shape, w0: shape && shape.getAttr('width') };
    });
    svg.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const p = at(e);
      const dx = p.x - d.x0;
      if (!d.moved && Math.abs(dx) < 4 && d.mode !== 'link') return; // a click, not a drag yet
      if (!d.moved) {
        d.moved = true;
        this.dragActive = true; // no redraws until it lands
        svg.addClass('is-dragging');
      }
      const days = Math.round(dx / lay.dayW);
      const b = d.it.row.bar;
      if (d.mode === 'end' && d.shape) {
        d.shape.setAttr('width', String(Math.max(lay.dayW - 2, Number(d.w0) + days * lay.dayW)));
        this.dragTip(svg, p, `${planBarDays(b.start, ymdAdd(b.end, days))} working day${planBarDays(b.start, ymdAdd(b.end, days)) === 1 ? '' : 's'}`);
      } else if (d.mode === 'move' && d.row) {
        for (const el of d.row.querySelectorAll('.np-g-bar, polygon')) el.setAttr('transform', `translate(${days * lay.dayW} 0)`);
        this.dragTip(svg, p, `Starts ${planShortDate(planDropDay(ymdAdd(b.start, days)))}`);
      } else if (d.mode === 'link') {
        if (!d.line) d.line = svg.createSvg('line', { cls: 'np-g-drag-link' });
        d.line.setAttrs({ x1: d.fromStart ? d.ends.x0 : d.ends.x1, y1: d.ends.y, x2: p.x, y2: p.y });
        const target = rowAt(p.y);
        const ok = target && items.includes(target) && target !== d.it;
        const type = ok ? planDropType(d.fromStart, p.x, planBarEnds(lay, target), target.row.milestone) : null;
        const name = ok ? planClip(planText(target.row.bar.task.raw), 30) : '';
        this.dragTip(svg, p, !ok ? 'Drop on the task to link: its left end to start with, right end to end with' : type === 'fs' ? `${name} waits for this` : type === 'ss' ? `${name} starts with this` : type === 'ff' ? `${name} ends with this` : 'From a start, drop on the other’s left end');
      }
    });
    const end = (e, cancel) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.dragActive = false;
      svg.removeClass('is-dragging');
      if (!d.moved) {
        // a click, not a drag: the pointer was held by the chart, so the bar's own click never comes; open the editor here
        this.justDragged = true;
        window.setTimeout(() => (this.justDragged = false), 300);
        if (!cancel) this.openTask(e, d.it.row.bar.task);
        return;
      }
      this.justDragged = true; // the click that follows the drag isn't a click on the bar
      window.setTimeout(() => (this.justDragged = false), 300);
      if (cancel) return this.render();
      const p = at(e);
      const days = Math.round((p.x - d.x0) / lay.dayW);
      if (d.mode === 'link') {
        const target = rowAt(p.y);
        if (target && items.includes(target) && target !== d.it) {
          const type = planDropType(d.fromStart, p.x, planBarEnds(lay, target), target.row.milestone);
          if (type) return void this.dropLink(d.it.row.bar.task, target.row.bar.task, type);
          new Notice('From the start of a bar, drop on the left end of the other: it then starts with it');
        }
        return this.render();
      }
      if (!days) return this.render();
      if (d.mode === 'end') return void this.dropEnd(d.it.row.bar, days);
      this.dropMove(d.it.row.bar, days, bars);
    };
    svg.addEventListener('pointerup', (e) => end(e, false));
    svg.addEventListener('pointercancel', (e) => end(e, true));
  },
  /** A small label by the pointer while dragging. */
  dragTip(svg, p, text) {
    let tip = svg.querySelector('.np-g-drag-tip');
    if (!tip) tip = svg.createSvg('text', { cls: 'np-g-drag-tip' });
    tip.setAttrs({ x: p.x + 12, y: p.y - 10 });
    tip.textContent = text;
  },
  /** The right end dropped: a new length, or a new 📅 for a task fixed by its 🛫 and 📅 dates. */
  dropEnd(bar, days) {
    const t = bar.task;
    const last = planDropDay(ymdAdd(bar.end, days));
    const fixed = this.base && !this.weeks && t.start && t.due && t.due >= t.start;
    if (fixed) return this.changeTasks(`end of “${planClip(planText(t.raw), 30)}”`, [[t, (rest) => planSetSign(rest, '📅', last < t.start ? t.start : last)]]);
    const n = planBarDays(bar.start, last);
    this.changeTasks(`length of “${planClip(planText(t.raw), 30)}”`, [[t, (rest) => planDurRest(rest, n)]]);
  },
  /** The bar dropped somewhere else: 🛫 start ("not before"), never before what it waits for. */
  dropMove(bar, days, bars) {
    const t = bar.task;
    const start = planDropDay(ymdAdd(bar.start, days));
    const earliest = planEarliest(t, bars, this.today);
    if (earliest && start < earliest) {
      const why = (t.deps || []).map((id) => bars.find((b) => b.task && b.task.id === id)).filter(Boolean).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      new Notice(why && planWorkdays(why.end, 1) === earliest ? `It can’t start before ${planShortDate(earliest)}: it waits for ${why.task.id}, which ends ${planShortDate(why.end)}` : `It can’t start before ${planShortDate(earliest)} (not started yet, so not before today)`);
      return this.render();
    }
    const name = `start of “${planClip(planText(t.raw), 30)}”`;
    if (t.milestone) return this.changeTasks(name, [[t, (rest) => planSetSign(rest, t.due ? '📅' : '🛫', start)]]);
    if (t.start && t.due && t.due >= t.start) {
      // fixed dates: both move, keeping its length in working days
      const due = planWorkdays(start, planWorkdaysBetween(t.start, t.due));
      return this.changeTasks(name, [[t, (rest) => planSetSign(planSetSign(rest, '🛫', start), '📅', due)]]);
    }
    // back to the earliest it can start anyway: no 🛫 needed
    this.changeTasks(name, [[t, (rest) => planSetSign(rest, '🛫', earliest && start === earliest ? null : start)]]);
  },
  /** Alt-drag from one bar onto another: `to` waits for (fs), starts with (ss) or ends with (ff) `from`; `from` gets an id first if it has none. */
  dropLink(from, to, type = 'fs') {
    if (from.id && planLinkIds(to).includes(from.id)) {
      new Notice(`${to.id || planClip(planText(to.raw), 30)} is already linked to ${from.id}: click its arrow to remove that link first`);
      return this.render();
    }
    if (planDownstream(this.tasks, to).has(from)) {
      new Notice('That would make a loop: the first task already waits, in the end, for the second');
      return this.render();
    }
    const edits = [];
    let id = from.id;
    if (!id) {
      const fm = (this.app.metadataCache.getFileCache(from.file) || {}).frontmatter || {};
      id = planNextId(this.tasks.map((x) => x.id).filter(Boolean), planPrefix(fm, planScopeTitle(this.plan)));
      edits.push([from, (rest) => planSetSign(rest, '🆔', id)]);
    }
    edits.push([to, (rest) => (type === 'fs' ? planDepsRest(rest, [id], []) : planLinkRest(rest, type, [{ id, lag: 0 }], []))]);
    this.changeTasks(`link ${id} → ${to.id || planClip(planText(to.raw), 20)}`, edits);
  },
  /** An arrow clicked: remove that link (or open either task). */
  linkMenu(e, l) {
    const m = new Menu();
    const drop = (rest) => (l.type === 'ss' || l.type === 'ff' ? planLinkRest(rest, l.type, [], [l.from.id]) : planDepsRest(rest, [], [l.from.id]));
    m.addItem((i) => i.setTitle(`Remove the link: ${planLinkSentence(l)}`).setIcon('unlink').onClick(() => this.changeTasks(`link ${l.from.id} → ${l.to.id || ''}`, [[l.to, drop]])));
    m.addItem((i) => i.setTitle(`Open ${l.from.id}`).setIcon('file-text').onClick(() => openFile(this.app, l.from.file, null, l.from.line)));
    m.showAtMouseEvent(e);
  },
  /** Change task lines in order ([task, rest => rest]), remembering them for Undo. */
  async changeTasks(label, edits) {
    const before = edits.map(([t]) => ({ t, raw: t.raw, box: t.box }));
    for (const [t, fn] of edits) await this.editTask(t, (text) => planEditLine(text, t, (rest, box) => ({ rest: fn(rest).replace(/\s{2,}/g, ' ').trim(), box })));
    this.lastChange = { label, before };
    this.syncUndo();
  },
  /** Undo: put the last change back (task lines as they were, or a deleted task's lines and links). */
  async undoChange() {
    const c = this.lastChange;
    if (!c) return;
    this.lastChange = null;
    this.syncUndo();
    if (c.restore) await c.restore(); // a deleted task: its lines and links back
    else for (const b of [...c.before].reverse()) await this.editTask(b.t, (text) => planEditLine(text, b.t, () => ({ rest: b.raw, box: b.box })));
    if (c.restore) this.refresh();
    new Notice(`Undone: ${c.label}`);
  },
  syncUndo() {
    if (!this.undoBtn) return;
    this.undoBtn.toggleClass('is-hidden', !this.lastChange);
    if (this.lastChange) this.undoBtn.setAttr('aria-label', `Undo: ${this.lastChange.label}`);
  },
});
/* @src src/tickets/plan-delete.js */
/* ---- Project plans (fork): cancel or delete a task -----------------------------------------------------------
 * From the task editor (and the task menu). Cancel marks it [-] with today's ❌ date: the line, its steps and its
 * history stay, and a cancelled task takes no time, so nothing has to change elsewhere. Delete removes the line and
 * the steps under it, and takes its id out of the ⛔ / starts-with / ends-with links of the tasks that depend on it
 * (in any note of the plan), after a confirmation that lists all of that. Both go through writeNote (read-only
 * blocks them; Ctrl+Z in an open note brings them back), and the Planning view's Undo puts the last one back. */

/** The text without a task's line and the lines under it (its steps, notes): { text, removed, at } or null (pure). */
function planDeleteText(text, t) {
  const lines = text.split('\n');
  const n = planFindLine(lines, t);
  if (n < 0) return null;
  const end = planBelow(lines, n);
  const removed = lines.splice(n, end - n);
  return { text: lines.join('\n'), removed, at: n };
}
/** A task's line with one id taken out of all its links (⛔, starts-with, ends-with) (pure). */
const planUnlinkRest = (rest, id) => planLinkRest(planLinkRest(planDepsRest(rest, [], [id]), 'ss', [], [id]), 'ff', [], [id]);
/** A task's line marked cancelled today: ❌, and no ✅ (pure). */
const planCancelRest = (rest, today) => `${planSetSign(planSetSign(rest, '✅', null), '❌', null).trim()} ❌ ${today}`;

/** What deleting a task would touch: the tasks linked to it, and its steps. */
function planDeleteImpact(t, tasks) {
  const dependants = t.id ? tasks.filter((x) => x !== t && planLinkIds(x).includes(t.id)) : [];
  return { dependants, steps: t.steps || null };
}

/** The delete confirmation: what goes, what changes, and a way to cancel the task instead. */
class PlanDeleteModal extends Modal {
  constructor(app, { task, impact, onDelete, onCancelTask }) {
    super(app);
    Object.assign(this, { task, impact, onDelete, onCancelTask });
  }
  onOpen() {
    const t = this.task;
    const { dependants, steps } = this.impact;
    this.modalEl.addClass('nd-modal', 'np-delete-modal');
    this.titleEl.setText('Delete this task?');
    this.contentEl.createEl('p', { cls: 'np-del-name', text: `${t.id ? `${t.id} · ` : ''}${planText(t.raw)}` });
    const ul = this.contentEl.createEl('ul');
    ul.createEl('li', { text: 'Its line is removed from the note.' });
    if (steps) ul.createEl('li', { text: `Its ${steps.total} step${steps.total === 1 ? '' : 's'} (${steps.done} done) and anything else under it go too.` });
    if (dependants.length) ul.createEl('li', { text: `${dependants.length} task${dependants.length === 1 ? ' depends' : 's depend'} on it: ${planAnd(dependants.map(planProblemName))}. Their links to it are removed.` });
    if (t.milestone) ul.createEl('li', { text: 'It is a milestone: check nothing outside the plan refers to it.' });
    const mark = planMark(t);
    if (mark) ul.createEl('li', { text: `It is marked as ${mark[2].toLowerCase()} (${mark[1]}): the report and the List won't show it any more.` });
    this.contentEl.createEl('p', { cls: 'setting-item-description', text: 'Cancelling keeps the line (and its history) marked ❌ instead; a cancelled task takes no time in the plan.' });
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Keep it', onClick: () => this.close() });
    if (t.status !== 'cancelled')
      button(row, { text: 'Cancel the task instead', cls: 'mod-cta', onClick: () => (this.close(), this.onCancelTask()) });
    button(row, { text: 'Delete', cls: 'mod-warning', onClick: () => (this.close(), this.onDelete()) });
  }
  onClose() {
    this.contentEl.empty();
  }
}

Object.assign(NeonProjects.prototype, {
  /** Cancel a task: [-] and ❌ today. view: the Planning view (for Undo). */
  async cancelPlanTask(t, view = null) {
    const before = { t, raw: t.raw, box: t.box };
    const today = moment().format('YYYY-MM-DD');
    let res = null;
    try {
      await writeNote(this.app, t.file, (text) => {
        res = planEditLine(text, t, (rest) => ({ rest: planCancelRest(rest, today), box: '-' }));
        return res ? res.text : text;
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not cancel the task', e);
        new Notice('Could not cancel the task. Details in the console.');
      }
      return false;
    }
    if (!res) {
      new Notice('That task changed in the note: open it again');
      return false;
    }
    Object.assign(t, planTask(`- [-] ${res.raw}`, { file: t.file, line: res.line, phase: t.phase }) || {});
    new Notice(`Cancelled: ${planClip(planText(t.raw), 50)}`);
    if (view) {
      view.lastChange = { label: `cancel “${planClip(planText(t.raw), 30)}”`, before: [before] };
      view.syncUndo();
      view.render();
    }
    return true;
  },
  /** Ask, then delete a task (its line and steps) and its id from the tasks linked to it. */
  confirmDeleteTask(t, tasks, view = null, after = null) {
    new PlanDeleteModal(this.app, {
      task: t,
      impact: planDeleteImpact(t, tasks),
      onCancelTask: async () => (await this.cancelPlanTask(t, view)) && after && after(),
      onDelete: async () => (await this.deletePlanTask(t, tasks, view)) && after && after(),
    }).open();
  },
  async deletePlanTask(t, tasks, view = null) {
    const { dependants } = planDeleteImpact(t, tasks);
    const undo = { lines: null, at: -1, next: null, links: [] };
    try {
      // the links first, note by note (the task's own note last: its line goes at the end)
      for (const d of dependants) {
        const raw = d.raw;
        let res = null;
        await writeNote(this.app, d.file, (text) => {
          res = planEditLine(text, d, (rest, box) => ({ rest: planUnlinkRest(rest, t.id).replace(/\s{2,}/g, ' ').trim(), box }));
          return res ? res.text : text;
        });
        if (res) undo.links.push({ file: d.file, now: res.raw, box: res.box, raw });
      }
      let gone = null;
      await writeNote(this.app, t.file, (text) => {
        gone = planDeleteText(text, t);
        if (gone) {
          const lines = text.split('\n');
          undo.next = lines[gone.at + gone.removed.length] ?? null; // the line after it, to find the place again
        }
        return gone ? gone.text : text;
      });
      if (!gone) return void new Notice('That task changed in the note: nothing deleted. Open it again.');
      Object.assign(undo, { lines: gone.removed, at: gone.at, file: t.file });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not delete the task', e);
        new Notice('Could not delete the task. Details in the console.');
      }
      return false;
    }
    new Notice(`Deleted: ${planClip(planText(t.raw), 50)}${dependants.length ? ` (and its links from ${dependants.length} task${dependants.length === 1 ? '' : 's'})` : ''}`);
    if (view) {
      view.lastChange = { label: `delete “${planClip(planText(t.raw), 30)}”`, restore: () => this.undoDelete(undo) };
      view.syncUndo();
      view.refresh();
    }
    return true;
  },
  /** Put a deleted task back: its lines where they were (found by the line that followed them), then its links. */
  async undoDelete(u) {
    await writeNote(this.app, u.file, (text) => {
      const lines = text.split('\n');
      let at = u.next == null ? lines.length : lines.indexOf(u.next, Math.max(0, u.at - 5));
      if (at < 0) at = Math.min(u.at, lines.length);
      lines.splice(at, 0, ...u.lines);
      return lines.join('\n');
    });
    for (const l of u.links)
      await writeNote(this.app, l.file, (text) => {
        const res = planEditLine(text, { raw: l.now, id: null }, () => ({ rest: l.raw, box: l.box }));
        return res ? res.text : text;
      });
  },
});
/* @src src/tickets/plan-scheduled.js */
/* ---- Project plans (fork): keep ⏳ scheduled dates in step with the plan ------------------------------------
 * A per-project choice (the project note's `plan-scheduled: true`, set from the Planning tab's ⋯ menu; off by
 * default). When on, each open task of the project gets ⏳ = the day the plan has it starting, updated whenever the
 * plan moves it, so the Tasks plugin, the Tasks card and calendars show the current plan. Only ⏳ is written: 🛫
 * ("not before") and 📅 (a deadline) are left alone, so the plan keeps flowing and nothing turns overdue because of
 * it. Not while you are typing in that note (it waits until you leave it); one write per note, through the view's
 * edit queue. Kevin, 17 Nov. */

/** The ⏳ dates that differ from the plan (pure): [{ task, date }] for the plan's own open tasks. bars: a dated plan's. */
function planScheduledChanges(tasks, bars) {
  const out = [];
  for (const b of bars || []) {
    const t = b.task;
    if (!t || t.external || planClosed(t) || !tasks.includes(t)) continue;
    if (t.scheduled !== b.start) out.push({ task: t, date: b.start });
  }
  return out;
}
/** The note's text with these tasks' ⏳ set ({ task, date }); tasks not found are left out (pure). */
function planScheduledText(text, changes) {
  let cur = text;
  for (const c of changes) {
    const r = planEditLine(cur, c.task, (rest, box) => ({ rest: planSetSign(rest, '⏳', c.date), box }));
    if (r) cur = r.text;
  }
  return cur;
}
/** Is a project set to keep ⏳ in step? (its note's plan-scheduled property) */
const planKeepsScheduled = (fm) => fm && (fm['plan-scheduled'] === true || String(fm['plan-scheduled']).toLowerCase() === 'true');

Object.assign(PlanView.prototype, {
  keepsScheduled() {
    const f = this.scopeFile();
    return !!f && planKeepsScheduled((this.app.metadataCache.getFileCache(f) || {}).frontmatter);
  },
  /** Turn the choice on or off (a property of the project note). */
  async toggleScheduled() {
    const f = this.scopeFile();
    if (!f) return void new Notice('This project has no note of its own to keep the setting in');
    const on = !this.keepsScheduled();
    try {
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        if (on) fm['plan-scheduled'] = true;
        else delete fm['plan-scheduled'];
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) new Notice('Could not change the setting. Details in the console.');
      return;
    }
    new Notice(on ? 'Planning now keeps ⏳ scheduled dates in step with the plan' : 'Planning no longer writes ⏳ scheduled dates');
    // the property change refreshes the view, which then writes the dates
  },
  /** Write ⏳ where the plan has moved a task (when this project keeps them in step). */
  syncScheduled() {
    if (!this.base || !this.keepsScheduled()) return;
    const dated = this.datedPlan();
    const changes = planScheduledChanges(this.tasks, dated && dated.bars);
    if (!changes.length) return;
    const byFile = new Map();
    for (const c of changes) byFile.set(c.task.file, [...(byFile.get(c.task.file) || []), c]);
    // not while you are typing in that note: wait until you leave it
    const typing = (f) => this.app.workspace.getLeavesOfType('markdown').some((l) => l.view.file === f && l.view.editor && l.view.editor.hasFocus());
    for (const [file, list] of byFile) {
      if (typing(file)) {
        this.scheduledPending = true;
        continue;
      }
      const job = (this.editing || Promise.resolve()).then(() => writeNote(this.app, file, (text) => planScheduledText(text, list)));
      this.editing = job.catch((e) => {
        if (!(e && e.neonReadOnly)) console.error('Planning: could not write ⏳ dates', e);
      });
    }
  },
});
/* @src src/tickets/plan-dates.js */
/* ---- Project plans (fork): Durations to dates ---------------------------------------------------------------------
 * The plan works out every task's dates from durations and dependencies; this writes them into the tasks as 🛫 start
 * and 📅 due, after you choose which. Tasks that already have dates are left unticked, so nothing you set is replaced
 * unless you ask. One write per note; only the dates of the chosen tasks change. Milestones get a 📅 only. */

/** The note's text with 🛫 / 📅 set on each task (pure). items: [{ task, start, due }] (null leaves that date alone). */
function planDatesEdit(text, items) {
  let cur = text;
  const missing = [];
  for (const it of items) {
    const r = planEditLine(cur, it.task, (rest, box) => {
      let x = rest;
      if (it.start) x = planSetSign(x, '🛫', it.start);
      if (it.due) x = planSetSign(x, '📅', it.due);
      return { rest: x, box };
    });
    if (r) cur = r.text;
    else missing.push(it.task);
  }
  return { text: cur, missing };
}

class PlanDatesModal extends Modal {
  /** view: the Planning view (its tasks and its plan with real dates). */
  constructor(app, view) {
    super(app);
    this.view = view;
    const ends = new Map((view.dated ? view.dated.bars : []).filter((b) => b.task).map((b) => [b.task, b]));
    this.rows = view.tasks
      .filter((t) => !t.external && !planClosed(t) && ends.has(t))
      .map((t) => {
        const b = ends.get(t);
        const start = t.milestone ? null : b.start;
        const due = b.end;
        const same = (t.milestone || t.start === start) && t.due === due;
        return { task: t, start, due, on: !same && !t.start && !t.due, same };
      });
    this.withStart = true;
    this.withDue = true;
  }
  onOpen() {
    const { contentEl: el, modalEl } = this;
    modalEl.addClass('nd-modal', 'np-dates');
    this.titleEl.setText('Write today’s planned dates into the tasks');
    el.createEl('p', { cls: 'setting-item-description', text: 'The dates the plan works out today from durations and links, written as 🛫 start and 📅 due. This is a snapshot: the dates don’t follow the plan afterwards, and they then hold it (🛫 means “not before”, 📅 is a deadline), so use it when you want dates fixed. Tasks that already have dates are not ticked: tick them to replace their dates. Nothing else in the tasks changes.' });
    el.createEl('p', { cls: 'setting-item-description', text: 'To have the current plan show in the Tasks plugin and calendars all the time, use “Keep ⏳ scheduled dates in step with the plan” in the tab’s ⋯ menu instead.' });
    if (NEON_GUARD.readOnly) el.createDiv({ cls: 'np-ed-warn', text: 'Read-only is on, so writing is blocked. Turn it off in the plugin’s settings to change notes.' });
    const opts = el.createDiv('np-dates-opts');
    const check = (label, key) => {
      const l = opts.createEl('label', { cls: 'np-ed-check' });
      const c = l.createEl('input', { attr: { type: 'checkbox' } });
      c.checked = this[key];
      l.createSpan({ text: label });
      c.addEventListener('change', () => ((this[key] = c.checked), this.update()));
    };
    check('🛫 Start dates', 'withStart');
    check('📅 Due dates', 'withDue');
    const all = opts.createEl('button', { text: 'Tick all', attr: { type: 'button' } });
    all.addEventListener('click', () => (this.rows.forEach((r) => (r.on = !r.same)), this.draw()));
    const none = opts.createEl('button', { text: 'Tick none', attr: { type: 'button' } });
    none.addEventListener('click', () => (this.rows.forEach((r) => (r.on = false)), this.draw()));
    this.listEl = el.createDiv('np-dates-list');
    const bar = el.createDiv('np-ed-buttons');
    this.goBtn = bar.createEl('button', { cls: 'mod-cta' });
    this.goBtn.addEventListener('click', () => this.save());
    bar.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    this.draw();
  }
  draw() {
    const list = this.listEl;
    list.empty();
    if (!this.rows.length) return void list.createDiv({ cls: 'np-ed-none', text: 'No open tasks to date.' });
    const table = list.createEl('table', { cls: 'np-table' });
    const hr = table.createEl('thead').createEl('tr');
    for (const h of ['', 'Task', 'Now', 'Planned']) hr.createEl('th', { text: h });
    const body = table.createEl('tbody');
    const d = (x) => (x ? planShortDate(x) : '–');
    for (const r of this.rows) {
      const tr = body.createEl('tr', { cls: r.same ? 'is-same' : '' });
      const c = tr.createEl('td').createEl('input', { attr: { type: 'checkbox' } });
      c.checked = r.on;
      c.disabled = r.same;
      c.addEventListener('change', () => ((r.on = c.checked), this.update()));
      tr.createEl('td', { text: `${r.task.id ? `${r.task.id} · ` : ''}${planClip(planText(r.task.raw), 50)}` });
      tr.createEl('td', { cls: 'np-id', text: `🛫 ${d(r.task.start)} · 📅 ${d(r.task.due)}` });
      tr.createEl('td', { cls: r.same ? 'np-id' : '', text: r.same ? 'already these dates' : `${r.start ? `🛫 ${d(r.start)} · ` : ''}📅 ${d(r.due)}` });
    }
    this.update();
  }
  chosen() {
    return this.rows.filter((r) => r.on).map((r) => ({ task: r.task, start: this.withStart ? r.start : null, due: this.withDue ? r.due : null }));
  }
  update() {
    const n = this.chosen().filter((x) => x.start || x.due).length;
    this.goBtn.setText(n ? `Write dates into ${n} task${n === 1 ? '' : 's'}` : 'Nothing to write');
    this.goBtn.disabled = !n;
  }
  async save() {
    const items = this.chosen().filter((x) => x.start || x.due);
    const byFile = new Map();
    for (const it of items) (byFile.get(it.task.file) || byFile.set(it.task.file, []).get(it.task.file)).push(it);
    let missing = 0;
    try {
      for (const [file, list] of byFile)
        await writeNote(this.app, file, (text) => {
          const r = planDatesEdit(text, list);
          missing += r.missing.length;
          return r.text;
        });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not write the dates', e);
        new Notice('Could not write the dates. Details in the console.');
      }
      return;
    }
    new Notice(`Dates written into ${items.length - missing} task${items.length - missing === 1 ? '' : 's'}${missing ? `; ${missing} had changed and were left alone` : ''}`);
    this.close();
    this.view.refresh();
  }
  onClose() {
    this.contentEl.empty();
  }
}
/* @src src/tickets/plan-report-details.js */
/* ---- Project plans (fork): the report's People table and Project details -------------------------------------------
 * People: everyone named as a task owner ([owner:: …]) with their open and done tasks, days of open work and phases.
 * Project details: the project note itself, as a snapshot, from the top to the end of the section holding the plan's
 * last task, so research and notes kept below the plan are left out. Its title heading goes and its other headings
 * move down so the highest is ###, under the report's "## Project details"; the front matter, refine callouts and %% comments %% go; links to the note's own headings
 * point at the note; checkbox lines keep their text, owners and 📅 / ✅ dates but lose the plan's working fields (🆔, ⛔,
 * [duration:: …], 🛫 …) and the task tags, and their boxes become ☐ / ☑ so the copy never counts as tasks twice in
 * Tasks or Dataview queries. Both pure (tested). */

/** [{ key, name, open, done, days, phases }] for each task owner, in the order they first appear. */
function planReportPeople(tasks) {
  const by = new Map();
  for (const t of tasks) {
    if (t.external) continue;
    for (const o of t.owners || []) {
      if (!by.has(o.key)) by.set(o.key, { key: o.key, name: o.name, open: 0, done: 0, days: 0, phases: [] });
      const p = by.get(o.key);
      if (planClosed(t)) p.done++;
      else (p.open++, (p.days += planDays(t)));
      const ph = t.phase || 'Tasks';
      if (!p.phases.includes(ph)) p.phases.push(ph);
    }
  }
  return [...by.values()];
}

// checkbox → a symbol that no task query reads as a task
const PLAN_REPORT_BOX = { ' ': '☐', x: '☑', X: '☑', '-': '☒', '/': '◐', '?': '❓', '!': '❗' };

/** One checkbox line for readers (see the header); other lines unchanged. */
function planReportLine(line, taskTags) {
  const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[(.)\]|\((.)\))\s+(.*)$/u);
  if (!m) return line;
  const box = m[2] !== undefined ? m[2] : m[3];
  const owners = planOwners(m[4]).map((o) => o.name);
  let text = m[4]
    .replace(/🆔\s*[\w-]+/gu, '')
    .replace(/⛔️?\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, '')
    .replace(PLAN_FIELD_RE, '')
    .replace(/(?:⏳|🛫|➕|❌)\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/(📅|✅)\s*(\d{4}-\d{2}-\d{2})/gu, (all, sign, d) => `${sign} ${planShortDate(d)}`);
  for (const tag of String(taskTags || '').split(',').map((x) => x.trim().replace(/^#?/, '#')).filter((x) => x.length > 1))
    text = text.replace(new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|\\s)`, 'giu'), '$1');
  text = text.replace(/\s+/g, ' ').trim();
  return `${m[1]}${PLAN_REPORT_BOX[box] || '☐'} ${text}${owners.length ? ` (${owners.join(', ')})` : ''}`;
}

/**
 * The note's text for the report (see the header). text: the note as saved; note: its name (for links to its own
 * headings); lastLine: the line of the plan's last task in it (null: the whole note); taskTags: "#task, #todo".
 */
function planReportDetails(text, { note, lastLine = null, taskTags = '' } = {}) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let from = 0;
  if (lines[0] === '---') {
    const e = lines.indexOf('---', 1);
    if (e > 0) from = e + 1;
  }
  // where each line is a heading (outside code blocks), and its level
  const level = [];
  let fence = null;
  for (const l of lines) {
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
    const h = !fence && !f && l.match(/^(#{1,6})\s/);
    level.push(h ? h[1].length : 0);
  }
  let to = lines.length;
  if (lastLine != null && lastLine >= from && lastLine < lines.length) {
    let top = 7;
    for (let k = lastLine; k >= from; k--)
      if (level[k]) {
        top = level[k];
        break;
      }
    for (let k = lastLine + 1; k < lines.length; k++)
      if (level[k] && level[k] <= top) {
        to = k;
        break;
      }
  }
  // fork: the note's own title heading ("# Pilot - Local AI") goes: the report already names the project. The
  // rest move down so the highest is ### (under the report's "## Project details"), no further than ######.
  const same = (a, b) => a.trim().toLowerCase() === String(b || '').trim().toLowerCase();
  let titleAt = -1;
  for (let k = from; k < to && note; k++) if (level[k] && same(lines[k].replace(/^#+\s+/, '').replace(/\s+#+\s*$/, ''), note)) ((titleAt = k), (k = to));
  let top = 7;
  for (let k = from; k < to; k++) if (level[k] && k !== titleAt) top = Math.min(top, level[k]);
  const shift = top < 7 ? Math.max(0, 3 - top) : 0;
  const out = [];
  let callout = false;
  let comment = false;
  fence = null;
  for (let k = from; k < to; k++) {
    let l = lines[k];
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
    if (fence || f) {
      out.push(l);
      continue;
    }
    // %% comments %%, also across lines
    if (comment) {
      const e = l.indexOf('%%');
      if (e < 0) continue;
      comment = false;
      l = l.slice(e + 2);
    }
    l = l.replace(/%%[\s\S]*?%%/g, '');
    const s = l.indexOf('%%');
    if (s >= 0) ((comment = true), (l = l.slice(0, s)));
    // the refine callout (instructions for Claude), with its lines
    if (/^>\s*\[!refine\]/i.test(l)) {
      callout = true;
      continue;
    }
    if (callout && /^>/.test(l)) continue;
    callout = false;
    if (k === titleAt) continue;
    if (level[k]) l = l.replace(/^(#{1,6})/, (h) => '#'.repeat(Math.min(6, h.length + shift)));
    l = l.replace(/(!?)\[\[#([^\]]*)\]\]/g, (all, bang, rest) => `${bang}[[${note}#${rest}]]`);
    out.push(planReportLine(l, taskTags));
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/* @src src/tickets/plan-report-folder.js */
/* ---- Project plans (fork): where a Planning report is saved -----------------------------------------------------
 * Setting "Save Planning reports" (planReportsWhere): 'folder' (the default) saves every report in the reports
 * folder (planReportsFolder; empty: <base folder>/Reports); 'project' saves it next to the project, in a folder named
 * by planReportsSubfolder (default Reports): beside the note for a single-note project (e.g.
 * 1.Customers/E2I/Projects/Reports), inside the folder for a project folder (e.g. 1.Projects/Website/Reports). So a
 * customer's reports stay with that customer and move with it when it is archived.
 * Falls back to the reports folder when the place next to the project is unsuitable: a note at the vault root, a
 * note sitting directly in the Project folders root (a Reports folder there would itself count as a project), or a
 * path through a `Core` or `Neon` folder, which the plugin never writes. planReportFolder is pure (tested). */

/** The folder name for reports next to a project: one plain folder name (no slashes), default Reports. */
function planReportSubName(v) {
  const s = String(v == null ? '' : v).replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s && s !== '.' && s !== '..' ? s : 'Reports';
}
/** True for a path through a folder the plugin never writes (Core, or Neon at the top). */
function planReportForbidden(path) {
  const parts = String(path || '').split('/');
  return parts.includes('Core') || parts[0] === 'Neon';
}
/**
 * The folder a report is saved in (pure). o: { where ('folder' | 'project'), folder (planReportsFolder),
 * sub (planReportsSubfolder), scope ({ kind: 'note' | 'folder', path }), projectFolders (the Project folders setting) }.
 */
function planReportFolder(o) {
  const fixed = locPath(o.folder, 'Reports');
  if (o.where !== 'project' || !o.scope || !o.scope.path) return fixed;
  const sub = planReportSubName(o.sub);
  const path = normalizePath(o.scope.path);
  let at;
  if (o.scope.kind === 'folder') at = path;
  else {
    const i = path.lastIndexOf('/');
    if (i <= 0) return fixed; // a project note at the vault root
    at = path.slice(0, i);
    if (at === folderSetting(o.projectFolders)) return fixed; // a Reports folder there would be a project folder itself
  }
  const out = normalizePath(`${at}/${sub}`);
  return planReportForbidden(out) ? fixed : out;
}

Object.assign(PlanView.prototype, {
  /** Where this plan's report goes, from the settings. */
  reportFolder() {
    const s = this.plugin.settings;
    return planReportFolder({ where: s.planReportsWhere, folder: s.planReportsFolder, sub: s.planReportsSubfolder, scope: this.plan, projectFolders: s.projectFolders });
  },
});
/* @src src/tickets/plan-report-props.js */
/* ---- Project plans (fork): the project's properties a Planning report keeps --------------------------------------
 * A report's front matter is its own (title, created, tags: plan-report, project: [[note]]), plus:
 * - the group (customer, or Area in a PARA vault): the project note's first group property as written, else the group
 *   worked out from its folder, under the first group property name (Settings → Projects → Group property), written
 *   like the vault's own values (customer: e2i). So a report in the shared reports folder still belongs to its customer.
 * - the properties listed in "Copy into reports" (planReportProps, default cssclasses), as they are.
 * Never copied, even when listed: tags and aliases (a report must not count as a project, or take the note's links),
 * the project's status and dates (a report is a snapshot; its summary already gives them), the report's own keys,
 * and working properties (claude, plan-scheduled). planReportProps is pure (tested). */

const PLAN_REPORT_NEVER = ['tags', 'tag', 'aliases', 'alias', 'title', 'created', 'modified', 'project', 'status', 'started', 'due', 'completed', 'cancelled', 'claude', 'plan-scheduled', 'position'];

/** A YAML scalar: plain when that is safe, else double-quoted. */
function planYamlScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_][\w .\-\/]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|yes|no|on|off|null|~)$/i.test(s) ? s : JSON.stringify(s);
}
/** One property as YAML lines (a list as "- item" lines); [] for an empty or nested value. */
function planYamlProp(key, v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) {
    const items = v.filter((x) => x != null && x !== '' && typeof x !== 'object');
    return items.length ? [`${key}:`, ...items.map((x) => `  - ${planYamlScalar(x)}`)] : [];
  }
  return typeof v === 'object' ? [] : [`${key}: ${planYamlScalar(v)}`];
}
/** The comma list of "Copy into reports" as property names. */
const planReportCopyList = (text) => String(text == null ? '' : text).split(',').map((x) => x.trim()).filter(Boolean);
/**
 * The extra front-matter lines of a report (pure). o: { fm (the project note's properties), groupProps (names, in
 * order), groupKey (the group from the folder, or ''), copy (the "Copy into reports" text) }.
 */
function planReportProps(o) {
  const fm = o.fm || {};
  const props = (o.groupProps || []).filter(Boolean);
  const never = new Set(PLAN_REPORT_NEVER);
  const out = [];
  const done = new Set();
  const has = (k) => fm[k] != null && fm[k] !== '' && !(Array.isArray(fm[k]) && !fm[k].length);
  const asWritten = props.find(has);
  if (asWritten && !never.has(asWritten.toLowerCase())) out.push(...planYamlProp(asWritten, fm[asWritten]));
  else if (props.length && o.groupKey && !never.has(props[0].toLowerCase())) out.push(...planYamlProp(props[0], o.groupKey));
  props.forEach((k) => done.add(k.toLowerCase()));
  for (const k of planReportCopyList(o.copy)) {
    const lk = k.toLowerCase();
    if (never.has(lk) || done.has(lk)) continue;
    done.add(lk);
    const key = Object.keys(fm).find((x) => x.toLowerCase() === lk);
    if (key) out.push(...planYamlProp(key, fm[key]));
  }
  return out;
}

Object.assign(PlanView.prototype, {
  /** This plan's extra report properties, from its project note and settings. */
  reportProps() {
    const f = this.scopeFile();
    const fm = (f && (this.app.metadataCache.getFileCache(f) || {}).frontmatter) || {};
    let key = this.plan && this.plan.kind === 'folder' ? pathCustomer(this.plan.path, true) : f ? pathCustomer(f.path) : null;
    if (!key && f && NEON_CATS.customers) key = fileCategory(this.app, f);
    if (!NEON_CATS.customers || key === 'untracked') key = null;
    return planReportProps({ fm, groupProps: groupProps(), groupKey: key || '', copy: this.plugin.settings.planReportProps });
  },
});
/* @src src/tickets/plan-report.js */
/* ---- Project plans (fork): the printable Report note ------------------------------------------------------------------
 * Report (Planning view) writes a snapshot of the plan into the reports folder (setting; empty: <base folder>/Reports),
 * or next to the project when that is chosen (plan-report-folder.js), keeping its customer and chosen properties
 * (plan-report-props.js):
 * a summary first (forecast, the Gantt chart as an SVG file the note embeds in the plan's colours, phases, people, what
 * needs attention, risks / issues / decisions, workload), then the detail: the project note itself up to the end of
 * the plan (plan-report-details.js), or the whole note with Report: full (named "… (full)"). Print it with
 * Obsidian's Export to PDF. Written only when you press Report, and refused while read-only is on; a second report on
 * the same day replaces that day's files. planReportText is pure (tested). */

const planCell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * The report's Markdown (pure). r: { title, note (the project note's name), today, summary, forecast, baseline, svg
 * (file name), phases: [{ name, total, done, start, end, state }], attention: [text], marks: [{ sign, label, text, owner,
 * state }], crit: [{ id, text, start, end }], load: [text], people: planReportPeople(…), details (Markdown from planReportDetails) }
 */
function planReportText(r) {
  const L = [];
  const d = (x) => (x ? planShortDate(x) : '');
  L.push('---', `title: "Plan report: ${r.title.replace(/"/g, "'")}"`, `created: ${r.today}`, 'tags:', '  - plan-report', `project: "[[${r.note}]]"`, ...(r.props || []), '---', ''); // fork: props: the customer and copied properties (plan-report-props.js)
  L.push(`# Plan report: ${r.title}`, '');
  L.push(`Snapshot report generated on ${d(r.today)}`, '');
  L.push('## Summary', '');
  if (r.forecast) L.push(`- **Forecast:** ${r.forecast}${r.baseline ? ` ${r.baseline}` : ''}`);
  if (r.summary) L.push(`- **Tasks:** ${r.summary}`);
  if (r.crit.length) L.push(`- **Critical path:** ${r.crit.length} tasks, ${d(r.crit[0].start)} to ${d(r.crit[r.crit.length - 1].end)}`);
  if (r.holidays) L.push(`- **Holidays:** ${r.holidays}`);
  L.push('');
  if (r.svg) L.push('## Timeline', '', `![[${r.svg}]]`, '', '*Arrows: what waits for what (dashed: starts with / ends with). 2/4: steps done. Outlined bars: the critical path.*', '');
  if (r.phases.length) {
    L.push('## Phases', '', '| Phase | Done | Start | Finish | State |', '|---|---|---|---|---|');
    for (const p of r.phases) L.push(`| ${planCell(p.name)} | ${p.done}/${p.total} | ${d(p.start)} | ${d(p.end)} | ${planCell(p.state)} |`);
    L.push('');
  }
  if ((r.people || []).length) {
    const off = r.people.some((p) => p.off); // a Time off column only when someone has time off in the plan
    L.push('## People', '', `| Person | Open tasks | Done | Days of open work | Phases |${off ? ' Time off |' : ''}`, `|---|---|---|---|---|${off ? '---|' : ''}`);
    for (const p of r.people) L.push(`| ${planCell(p.name)} | ${p.open} | ${p.done} | ${p.days} | ${planCell(p.phases.join(', '))} |${off ? ` ${planCell(p.off)} |` : ''}`);
    L.push('', '*People named as a task owner ([owner:: …]).*', '');
  }
  L.push('## Needs attention', '');
  if (r.attention.length) for (const a of r.attention) L.push(`- ${a}`);
  else L.push('Nothing overdue, blocked or late.');
  L.push('');
  if (r.marks.length) {
    L.push('## Risks, issues and decisions', '');
    for (const m of r.marks) L.push(`- ${m.sign} **${m.label}:** ${m.text}${m.owner ? ` (${m.owner})` : ''} · ${m.state}`);
    L.push('');
  }
  if (r.load.length) {
    L.push('## Workload', '');
    for (const l of r.load) L.push(`- ${l}`);
    L.push('');
  }
  if (r.details) L.push('## Project details', '', r.details, ''); // the snapshot line at the top says when
  return L.join('\n');
}

Object.assign(PlanView.prototype, {
  /** The report's contents, from the plan as the view has it (real dates when the project has a started date). */
  reportData(svgName, noteText = '', full = false) {
    const today = this.today;
    const plan = this.dated || planGanttText(this.tasks, { weeks: true, today });
    const { byId } = planIndex(this.tasks);
    const bars = new Map(plan.bars.filter((b) => b.task).map((b) => [b.task, b]));
    const own = this.tasks.filter((t) => !t.external);
    const label = (st) => PLAN_STATE_LABEL[st] || st;
    const phases = [];
    for (const t of own) {
      const name = t.phase || 'Tasks';
      let p = phases.find((x) => x.name === name);
      if (!p) phases.push((p = { name, total: 0, done: 0, start: null, end: null, kinds: [] }));
      const b = bars.get(t);
      p.total++;
      if (planClosed(t)) p.done++;
      if (b && (!p.start || b.start < p.start)) p.start = b.start;
      if (b && (!p.end || b.end > p.end)) p.end = b.end;
      if (b) p.kinds.push(b.kind);
    }
    const worst = (kinds) => PLAN_KINDS.find(([k]) => k === (PLAN_WORST.find((w) => kinds.includes(w)) || 'ready'))[1];
    const attention = [];
    for (const t of own) {
      const st = planState(t, byId, today);
      const name = planText(t.raw);
      if (planOverdue(t, today)) attention.push(`**Overdue:** ${name} (📅 ${planShortDate(t.due)})`);
      else if (st === 'blocked') attention.push(`**Blocked:** ${name}, ${planBlockedText(t, byId, today)}`);
    }
    for (const w of planWarnings(this.tasks, this.ends, today)) attention.push(`**Schedule:** ${w.text}`);
    if (this.dated && planHolidayGap(this.dated.end)) attention.push(`**Holidays:** ${planHolidayGap(this.dated.end)}`);
    for (const t of own.filter(planStepsDone)) attention.push(`**Steps done:** ${planText(t.raw)}: all ${t.steps.total} steps are ticked, the task isn't`);
    for (const p of planProblems(this.tasks, plan.sched)) attention.unshift(`**Plan:** ${p.text}`); // broken links first: they make the dates unreliable
    if (this.dated && this.dated.late) attention.unshift(`**Late:** ${planForecastText(this.dated.end, this.due, this.dated.late)}`);
    const marks = [];
    for (const t of own)
      for (const [k, sign, lab] of PLAN_MARKS) if ((t.marks || []).includes(k)) marks.push({ sign, label: lab, text: planText(t.raw), owner: (t.owners || []).map((o) => o.name).join(', '), state: label(planState(t, byId, today)) });
    const crit = plan.sched.rows.filter((r) => r.crit && !r.task.external && !planClosed(r.task)).map((r) => ({ id: r.task.id, text: planText(r.task.raw), start: (bars.get(r.task) || {}).start, end: (bars.get(r.task) || {}).end }));
    return {
      title: planScopeTitle(this.plan),
      props: this.reportProps(),
      note: (this.scopeFile() || { basename: planScopeTitle(this.plan) }).basename,
      today,
      summary: planSummaryText(planCounts(this.tasks, today)) + (planMarkText(this.tasks) ? ` · ${planMarkText(this.tasks)}` : ''),
      forecast: this.dated ? planForecastText(this.dated.end, this.due, this.dated.late) : `about ${Math.ceil(plan.sched.length / 5)} weeks of work (no started date, so no dates)`,
      baseline: (this.forecastSummary().match(/\((?:[+-]?\d+ since|as) the baseline[^)]*\)/) || [''])[0],
      svg: svgName,
      phases: phases.map((p) => ({ name: p.name, total: p.total, done: p.done, start: p.start, end: p.end, state: p.done === p.total ? 'Done' : worst(p.kinds) })),
      attention,
      marks,
      crit,
      load: this.loadLines(plan.sched, !!this.dated),
      // people and the plan's days off, from its first day to its forecast finish (real dates only)
      people: planReportPeople(own).map((p) => ({ ...p, off: this.dated ? planLeaveText(planLeaveFor(this.tasks.leave, p), planWorkdays(this.base, 0), this.dated.end || this.today) : '' })),
      holidays: this.dated ? planDaysOffText(planDaysOff(planWorkdays(this.base, 0), this.dated.end || this.today)) : '',
      full,
      // concise: up to the end of the plan; full: the whole note
      details: noteText ? planReportDetails(noteText, { note: (this.scopeFile() || {}).basename || '', lastLine: full ? null : own.filter((t) => t.file === this.scopeFile()).reduce((m, t) => (t.line > m ? t.line : m), -1), taskTags: NEON_PLAN.taskTag }) : '',
    };
  },
  /** The Gantt for the report: every task (no filter), drawn off screen, as SVG text with the colours written in. */
  reportSvg() {
    const g = this.dated ? planGanttText(this.tasks, { base: this.base, today: this.today, due: this.due }) : planGanttText(this.tasks, { weeks: true, today: this.today });
    const lay = planGanttLayout(g.rows, { today: this.today, relative: g.relative, width: 1100, labelW: 340, minDay: 2 });
    if (!lay) return '';
    const host = document.body.createDiv({ attr: { style: 'position:absolute;left:-20000px;top:0;' } });
    try {
      // as on screen: the dependency arrows, and each task's steps (2/4, with the progress line in its bar)
      const svg = planDrawGantt(host, lay, { colours: planColourMap(), links: true });
      return planSvgText(svg);
    } finally {
      host.remove();
    }
  },
  /** Report: concise (the project note up to the end of the plan) or full (the whole note). */
  reportMenu(e) {
    const m = new Menu();
    m.addItem((i) => i.setTitle('Report: concise').setIcon('file-output').onClick(() => this.writeReport(false)));
    m.addItem((i) => i.setTitle('Report: full (the whole project note)').setIcon('file-text').onClick(() => this.writeReport(true)));
    const r = this.reportBtn.getBoundingClientRect(); // under the button (also from the keyboard)
    m.showAtPosition({ x: r.left, y: r.bottom });
  },
  /** Write the report note and its chart into the reports folder, then open it. full: the whole project note. */
  async writeReport(full = false) {
    planUseCalendar(this.tasks);
    const folder = this.reportFolder(); // the reports folder, or next to the project (plan-report-folder.js)
    const base = `${safeName(planScopeTitle(this.plan))} – plan ${this.today}`;
    const svgName = `${base}.svg`; // the same chart for both
    const mdName = `${base}${full ? ' (full)' : ''}.md`;
    const svgText = this.reportSvg();
    const own = this.scopeFile();
    const md = planReportText(this.reportData(svgText ? svgName : '', own ? await this.app.vault.cachedRead(own) : '', full));
    try {
      await ensureFolder(this.app, folder);
      const put = async (name, text) => {
        const path = normalizePath(`${folder}/${name}`);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) await this.app.vault.process(f, () => text); // today's report again: replaced
        else await this.app.vault.create(path, text);
        return this.app.vault.getAbstractFileByPath(path);
      };
      if (svgText) await put(svgName, svgText);
      const note = await put(mdName, md);
      if (note instanceof TFile) await openInTab(this.app, note); // its own tab, in front
      new Notice('Report saved. To print it: ⋯ menu (or the command palette) → Export to PDF.', 6000);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not write the report', e);
        new Notice('Could not write the report. Details in the console.');
      }
    }
  },
});
/* @src src/tickets/plan-actions.js */
/* ---- Project plans (fork): the Planning button on project notes, opening the Planning view, a command -----------
 * A note that belongs to a project (a project note, or any note in a project folder) gets buttons in its header:
 * one Planning button. It opens the Planning view in a new tab, on the Gantt chart; the view switches to the board,
 * graph and list. Nothing is added to the note. */

Object.assign(NeonProjects.prototype, {
  hookPlans() {
    this.registerView(VIEW_PLAN, (leaf) => new PlanView(leaf, this));
    this.planButtons = new WeakMap();
    const sync = debounce(() => this.syncPlanButtons(), 300, true);
    this.registerEvent(this.app.workspace.on('layout-change', sync));
    this.registerEvent(this.app.workspace.on('file-open', sync));
    this.registerEvent(this.app.metadataCache.on('changed', sync)); // a note tagged as a project gets its buttons
    this.app.workspace.onLayoutReady(() => this.syncPlanButtons());
    this.register(() => this.clearPlanButtons());
    const cmd = (id, name, mode) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const f = this.app.workspace.getActiveFile();
          const scope = f && planScopeOf(this.app, f);
          if (!scope) return false;
          if (!checking) this.openPlan(scope, mode);
          return true;
        },
      });
    // no default hotkey (community plugin guidelines): set one in Settings › Hotkeys, e.g. Ctrl/Cmd+Shift+G
    cmd('plan-gantt', 'Project: open Planning', 'gantt');
    // fork: the task editor from a project note's right-click menu (the task under the cursor, or a new one)
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const at = this.planCursor(editor, info && info.file);
        if (!at) return;
        const { scope, file, n, isTask } = at;
        menu.addItem((i) =>
          i
            .setTitle(isTask ? 'Planning: edit this task' : 'Planning: new task here')
            .setIcon('calendar-range')
            .onClick(() => this.openTaskEditor({ scope, file, line: isTask ? n : null, at: n })),
        );
        if (isTask) menu.addItem((i) => i.setTitle('Planning: new task after this').setIcon('list-plus').onClick(() => this.openTaskEditor({ scope, file, afterLine: n })));
      }),
    );
    // fork: the same three as commands, so they can have hotkeys (none by default; set them in Settings › Hotkeys)
    const editorCmd = (id, name, ok, run) =>
      this.addCommand({
        id,
        name,
        editorCheckCallback: (checking, editor, ctx) => {
          const at = this.planCursor(editor, ctx && ctx.file);
          if (!at || !ok(at)) return false;
          if (!checking) run(at);
          return true;
        },
      });
    editorCmd('plan-edit-task', 'Planning: edit this task', (a) => a.isTask, (a) => this.openTaskEditor({ scope: a.scope, file: a.file, line: a.n, at: a.n }));
    editorCmd('plan-new-task', 'Planning: new task here', () => true, (a) => this.openTaskEditor({ scope: a.scope, file: a.file, line: null, at: a.n }));
    editorCmd('plan-new-task-after', 'Planning: new task after this', (a) => a.isTask, (a) => this.openTaskEditor({ scope: a.scope, file: a.file, afterLine: a.n }));
  },
  /** The cursor's line in a project note: { scope, file, n, isTask } (a plan task: an id or the task tag), or null. */
  planCursor(editor, file) {
    const scope = file && planScopeOf(this.app, file);
    if (!scope || !editor) return null;
    const n = editor.getCursor().line;
    const t = planTask(editor.getLine(n));
    return { scope, file, n, isTask: !!t && (!!t.id || planHasTag(t.raw, NEON_PLAN.taskTag)) };
  },
  /** Adds or removes the header buttons so they match each open note. */
  syncPlanButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const v = leaf.view;
      if (!v || typeof v.addAction !== 'function') continue;
      const scope = v.file ? planScopeOf(this.app, v.file) : null;
      const key = scope ? `${scope.kind}:${scope.path}` : '';
      const had = this.planButtons.get(v);
      if ((had ? had.key : '') === key) continue;
      if (had) had.els.forEach((e) => e.remove());
      this.planButtons.delete(v);
      if (!scope) continue;
      // fork: one button with a word beside its icon, so it is easy to spot
      const e = v.addAction('calendar-range', 'Planning: Gantt chart, board, graph and task list', () => this.openPlan(scope, 'gantt'));
      e.addClass('np-action');
      e.createSpan({ cls: 'np-action-label', text: 'Planning' });
      const els = [e];
      this.planButtons.set(v, { key, els });
    }
  },
  clearPlanButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const had = this.planButtons && this.planButtons.get(leaf.view);
      if (had) had.els.forEach((e) => e.remove());
    }
  },
  /**
   * Opens the task editor: the task on `line` of `file`, or a new task (its phase: the heading above `at`).
   * view: the Planning view it came from (its tasks are used, and it is refreshed after saving).
   */
  async openTaskEditor({ scope, file, line = null, at = null, phase = null, view = null, after = null, afterLine = null }) {
    const tasks = view ? view.tasks : await planCollect(this.app, scope);
    const open = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === file && l.view.editor);
    const text = open ? open.view.editor.getValue() : await this.app.vault.cachedRead(file);
    const lines = text.split('\n');
    const above = (n) => (planHeadings(lines).filter((h) => h.line < n).pop() || {}).text || '';
    let task = null;
    if (line != null) {
      const want = planTask(lines[line]);
      task = tasks.find((t) => t.file === file && t.line === line && want && t.raw === want.raw) || (want && tasks.find((t) => t.file === file && (want.id ? t.id === want.id : t.raw === want.raw))) || null;
      if (!task && want) task = Object.assign(want, { file, line, phase: above(line) }); // not read into the plan yet
    }
    if (afterLine != null && !after) {
      // a new task straight after the task on that line
      const want = planTask(lines[afterLine]);
      after = (want && tasks.find((t) => t.file === file && (want.id ? t.id === want.id : t.raw === want.raw))) || (want ? Object.assign(want, { file, line: afterLine, phase: above(afterLine) }) : null);
    }
    new PlanTaskModal(this.app, {
      scope,
      file,
      text,
      tasks: task && !tasks.includes(task) ? [...tasks, task] : tasks,
      task,
      after,
      phase: phase != null ? phase : at != null ? above(at + 1) : '',
      // "new task here" (right-click or command in the note): below the cursor's line, not at the end of the phase
      anchor: line == null && at != null && !after && !view ? { line: at, text: (lines[at] || '').replace(/\r$/, '') } : null,
      base: planBaseDate(this.app, scope),
      onSaved: (id) => view && view.selectSaved(id),
      plugin: this, // for Delete task / Cancel task
      view,
    }).open();
  },
  /** Opens the plan in a tab: the one already showing this plan, else a new tab. */
  async openPlan(scope, mode = 'gantt') {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_PLAN).find((l) => l.view && l.view.plan && l.view.plan.path === scope.path);
    if (!leaf) leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_PLAN, active: true, state: { kind: scope.kind, path: scope.path, mode } });
    keepTab(this.app, leaf); // not a preview tab that the next note opened would take over
    ws.revealLeaf(leaf);
  },
});
return NeonProjects;
})();
/* ==== module neon-research ==== */
const NeonResearchModule = (() => {
/* @src src/research/constants.js */

/* =========================================================================
 * RESEARCH — one tree per section: topics (folders) → subtopics (folders) → notes,
 * inside each section folder. Its own Research tab (view type neon-research).
 * ========================================================================= */
const VIEW_RESEARCH = 'neon-research';
const NR_DEFAULTS = {
  // fork: no default sections; you choose the folders (Research section of the settings, or + in the tab)
  root: '', // first section's path, kept for older versions
  roots: null, // [{ name, path }]: each is its own tree (filled on load)
  activeRoot: 0, // index of the section shown in the tab
  countAsWork: true, // false: new notes get `untracked: true`, so Time never counts them as work
  linkSuggest: true,
  open: [], // folder paths expanded in the tree
  researchTopics: [], // unused since the fork (status now comes from the notes); kept so older data loads
  cards: {}, // unused since the fork removed quizzes; kept so older data loads
  statusProperty: 'status', // fork: the note property that holds the research status
  doneStatuses: 'completed, done, evergreen', // fork: values that count as researched
  newStatus: 'init', // fork: status given to notes made from the Research tab
  newNoteTags: 'research', // fork: tags for notes made from the Research tab (comma-separated)
  noteTemplate: '', // fork: optional template note for new notes; {{title}}, {{date}}, {{time}} are filled in
}
const DAY = 86400000;
/** Short "how long ago": now, 5m, 3h, 2d, then the date. */
function shortAgo(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return 'now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < DAY) return `${Math.floor(d / 3600000)}h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return moment(ms).format(moment(ms).isSame(moment(), 'year') ? 'D MMM' : 'D MMM YYYY');
}
const CARD_BLOCK = 'neon-cards'; // old flashcard blocks in notes stay hidden (quizzes were removed in the fork)
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Same length as text, with code, links and frontmatter blanked out: where a plain mention may be linked. */
function plainMask(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, blank)
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/!?\[\[[^\]]*\]\]/g, blank)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, blank)
    .replace(/https?:\/\/\S+/g, blank)
    .replace(/^#{1,6}\s.*$/gm, blank);
}

/* @src src/research/link-suggest.js */
/* ---- link suggestions -------------------------------------------------------- */
class LinkSuggestModal extends Modal {
  constructor(plugin, file, hits) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.hits = hits;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-modal');
    this.titleEl.setText(`Possible links · ${this.file.basename}`);
    const c = this.contentEl;
    const list = c.createDiv('nr-links');
    for (const h of this.hits) {
      const r = list.createDiv('nr-link-row');
      const t = r.createDiv('nr-link-main');
      t.createDiv({ cls: 'nr-link-target', text: h.target.basename });
      const ctx = t.createDiv('nr-link-ctx');
      ctx.appendText('…' + h.before);
      ctx.createEl('mark', { text: h.match });
      ctx.appendText(h.after + '…');
      button(r, {
        icon: 'link',
        text: 'Link',
        onClick: async () => {
          await this.plugin.linkMention(this.file, h.target);
          r.addClass('is-done');
          r.querySelector('button').remove();
        },
      });
    }
    const foot = c.createDiv('nd-modal-row');
    button(foot, { text: 'Close', onClick: () => this.close() });
    button(foot, {
      text: `Link all (${this.hits.length})`,
      cls: 'mod-cta',
      onClick: async () => {
        for (const h of this.hits) await this.plugin.linkMention(this.file, h.target);
        this.close();
        new Notice(`Linked ${this.hits.length} mention${this.hits.length === 1 ? '' : 's'}`);
      },
    });
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* @src src/research/tree-view.js */
/* ---- the Research tab: one topic tree per section, or the notes by status ------------ */
class ResearchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_RESEARCH;
  }
  getDisplayText() {
    return 'Research';
  }
  getIcon() {
    return 'library';
  }
  async onOpen() {
    addHelpAction(this, 'research'); // fork: the ? button in the header (src/shared/help.js)
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'nr-view');
    this.scroller = this.contentEl.createDiv('nr-scroll');
    const mount = () => {
      if (this.pattern) this.pattern.destroy();
      const api = deckApi(this.app);
      this.pattern = api && api.mountPattern ? api.mountPattern(this.contentEl, this.scroller, '.nd-card, .nd-hero') : null;
    };
    mount();
    this.register(() => this.pattern && this.pattern.destroy());
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', mount));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.pattern && (this.pattern.destroy(), (this.pattern = null))));
    const soon = debounce(() => this.render(), 150, true);
    // f: one note's text changed but not its cards, so only its row's "edited" time moves; 'now': a click
    this.register(this.plugin.onChange((f) => (f === 'now' ? this.render() : f ? this.touchRow(f) : soon())));
    // hidden tabs skip redraws and catch up when shown
    // checked a frame later: the event fires before the tab is actually shown
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.stale && window.requestAnimationFrame(() => this.stale && this.isShown() && this.render())));
    this.first = true;
    this.render();
  }
  isShown() {
    return this.contentEl.isConnected && this.contentEl.offsetParent !== null;
  }
  touchRow(f) {
    const r = this.rows && this.rows.get(f.path);
    if (r) r.setText(shortAgo(f.stat.mtime));
  }
  async onClose() {
    this.contentEl.empty();
  }
  render() {
    const p = this.plugin;
    const sc = this.scroller;
    if (!sc) return;
    if (!this.first && !this.isShown()) return void (this.stale = true);
    this.stale = false;
    this.rows = new Map(); // note path -> its "edited" cell
    const top = sc.scrollTop;
    sc.empty();
    const root = sc.createDiv('nr-inner' + (this.first ? ' is-entering' : ''));
    if (this.first) {
      this.first = false;
      window.setTimeout(() => root.removeClass('is-entering'), 900);
    }
    const byStatus = this.tab === 'status';
    const rootFolder = p.rootFolder();
    const hero = root.createDiv('nd-hero nr-hero');
    const l = hero.createDiv('nr-hero-l');
    const roots = p.settings.roots;
    const cur = roots[p.settings.activeRoot];
    l.createDiv({ cls: 'nd-hero-greet', text: cur ? cur.name : 'Research' });
    if (rootFolder) {
      const nTopics = rootFolder.children.filter((c) => c instanceof TFolder).length;
      const nNotes = p.researchNotes().length;
      l.createDiv({ cls: 'nr-hero-sub', text: `${nTopics} topic${nTopics === 1 ? '' : 's'} · ${nNotes} note${nNotes === 1 ? '' : 's'}` });
      l.createDiv({ cls: 'nr-hero-sub', text: statusLine(p.statusSummary(rootFolder)) });
      const acts = hero.createDiv('nr-acts');
      button(acts, { icon: 'folder-plus', text: 'Topic', cls: 'mod-cta', title: 'New topic', onClick: () => p.newTopic(rootFolder) });
    } else {
      l.createDiv({ cls: 'nr-hero-sub', text: cur ? `Folder “${cur.path}” not found` : 'No section yet: choose a folder to start' });
    }
    pills(root, [['topics', 'Topics'], ['status', 'By status']], byStatus ? 'status' : 'topics', (v) => {
      if (v === this.tab || (v === 'topics' && !this.tab)) return;
      this.switchDir = v === 'status' ? 1 : -1;
      this.tab = v;
      this.render();
    }, 'nr-view-tabs');
    {
      // section switch on its own row under the title: click to switch, right-click to rename/remove, + to add
      const sw = pills(hero, roots.map((r, i) => [i, r.name]), p.settings.activeRoot, (i) => p.setActiveRoot(i), 'nr-roots');
      for (const [i, btn] of sw.btns) {
        tip(btn, roots[i].path);
        btn.addEventListener('contextmenu', (e) => (e.preventDefault(), p.sectionMenu(i, e)));
      }
      const add = sw.el.createEl('button', { cls: 'nd-pill-btn nr-root-add', attr: { type: 'button', 'aria-label': 'Add a section (folder)' } });
      setIcon(add, 'plus');
      tip(add, 'Add a section: pick or create a folder');
      add.addEventListener('click', () => p.pickSection());
    }

    // the tree sits in one panel (a "window" for the pattern, like the dashboard cards)
    const panel = root.createDiv('nd-card nr-panel');
    if (this.switchDir) {
      panel.addClass('is-switch');
      panel.style.setProperty('--dir', String(this.switchDir));
      this.switchDir = 0;
    }
    if (!rootFolder) {
      const e = panel.createDiv('nr-empty');
      button(e, { icon: 'folder-search', text: roots.length ? 'Choose another folder' : 'Choose a research folder', cls: 'mod-cta', onClick: () => p.pickSection() });
    } else if (byStatus) {
      this.renderStatus(panel);
    } else {
      const kids = this.childrenOf(rootFolder);
      if (!kids.folders.length && !kids.notes.length) {
        const e = panel.createDiv('nr-empty');
        button(e, { icon: 'folder-plus', text: 'Add your first topic', cls: 'mod-cta', onClick: () => p.newTopic(rootFolder) });
      } else {
        const tree = panel.createDiv('nr-tree');
        for (const f of kids.folders) this.folderRow(tree, f, 0);
        for (const f of kids.notes) this.noteRow(tree, f, 0);
      }
    }
    madeWith(root.createDiv('nr-foot'));
    sc.scrollTop = top;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  childrenOf(folder) {
    const folders = [];
    const notes = [];
    for (const c of folder.children || []) {
      if (c instanceof TFolder) folders.push(c);
      else if (c instanceof TFile && c.extension === 'md' && !isIgnoredNote(this.app, c)) notes.push(c); // fork: ignored tags
    }
    // names starting with "!" first (as in the Neon sidebar), then A → Z
    const bangs = (f) => (f.name.match(/^!+/) || [''])[0].length;
    const by = (a, b) => bangs(b) - bangs(a) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return { folders: folders.sort(by), notes: notes.sort(by) };
  }
  folderRow(parent, folder, depth) {
    const p = this.plugin;
    const open = p.isOpen(folder.path);
    const wrap = parent.createDiv('nr-node');
    const row = wrap.createDiv('nr-row is-folder' + (open ? ' is-open' : ''));
    row.style.setProperty('--depth', String(depth));
    const chev = icon(row, open ? 'chevron-down' : 'chevron-right', 'nd-ico nr-chev');
    const fico = icon(row, open ? 'folder-open' : 'folder', 'nd-ico nr-folder-ico');
    row.createSpan({ cls: 'nr-name', text: p.folderLabel(folder) });
    // right-hand columns have fixed widths so they line up from row to row
    const n = p.notesUnder(folder).length;
    row.createSpan({ cls: 'nr-col nr-c-count', text: `${n} note${n === 1 ? '' : 's'}` });
    const toResearch = p.statusSummary(folder).open;
    const dc = row.createSpan('nr-col nr-c-due');
    if (toResearch) dc.createSpan({ cls: 'nr-due', text: `${toResearch} to research` });
    row.createSpan('nr-col nr-c-when');
    const acts = row.createDiv('nr-row-acts');
    button(acts, { icon: 'plus', cls: 'nd-icon-btn', title: 'Add a subtopic or a note', onClick: (e) => (e.stopPropagation(), this.addMenu(folder, e)) });
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'Rename, delete', onClick: (e) => (e.stopPropagation(), this.folderMenu(folder, e)) });
    const fill = () => {
      const kids = this.childrenOf(folder);
      const box = wrap.createDiv('nr-kids');
      box.style.setProperty('--depth', String(depth)); // its guide line sits under this folder's chevron
      for (const f of kids.folders) this.folderRow(box, f, depth + 1);
      for (const f of kids.notes) this.noteRow(box, f, depth + 1);
      return box;
    };
    // open/close right here, without redrawing the tree
    row.addEventListener('click', () => {
      const now = !p.isOpen(folder.path);
      p.setOpen(folder.path, now);
      row.toggleClass('is-open', now);
      setIcon(chev, now ? 'chevron-down' : 'chevron-right');
      setIcon(fico, now ? 'folder-open' : 'folder');
      const old = wrap.querySelector(':scope > .nr-kids');
      if (old) slide(old, false);
      if (now) slide(fill(), true);
      if (this.pattern && this.pattern.kick) this.pattern.kick();
    });
    row.addEventListener('contextmenu', (e) => (e.preventDefault(), this.folderMenu(folder, e)));
    if (open) fill();
  }
  noteRow(parent, file, depth) {
    const p = this.plugin;
    const row = parent.createDiv('nr-row is-note');
    row.style.setProperty('--depth', String(depth));
    row.createSpan('nr-chev-space');
    icon(row, 'file-text', 'nd-ico nr-note-ico');
    row.createSpan({ cls: 'nr-name', text: file.basename });
    const st = p.statusOf(file);
    row.createSpan('nr-col nr-c-count');
    const sc = row.createSpan('nr-col nr-c-due');
    if (st) sc.createSpan({ cls: `nr-status-pill is-${statusKind(st, p.doneStatuses())}`, text: st });
    const when = row.createSpan({ cls: 'nr-col nr-c-when', text: shortAgo(file.stat.mtime) });
    this.rows.set(file.path, when);
    tip(when, `Edited ${moment(file.stat.mtime).format('D MMM YYYY, HH:mm')}`);
    const acts = row.createDiv('nr-row-acts');
    acts.createSpan('nr-act-space'); // notes have one button: keep its column where folders have two
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'Rename, delete', onClick: (e) => (e.stopPropagation(), this.noteMenu(file, e)) });
    row.addEventListener('click', (e) => openFile(this.app, file, e));
    hoverPreview(this.app, row, file);
    row.addEventListener('contextmenu', (e) => (e.preventDefault(), this.noteMenu(file, e)));
  }
  addMenu(folder, e) {
    const m = new Menu();
    m.addItem((i) => i.setTitle('New subtopic').setIcon('folder-plus').onClick(() => this.plugin.newTopic(folder)));
    m.addItem((i) => i.setTitle('New note').setIcon('file-plus').onClick(() => this.plugin.newNote(folder)));
    m.showAtMouseEvent(e);
  }
  folderMenu(folder, e) {
    const p = this.plugin;
    const m = new Menu();
    m.addItem((i) => i.setTitle('New subtopic').setIcon('folder-plus').onClick(() => p.newTopic(folder)));
    m.addItem((i) => i.setTitle('New note').setIcon('file-plus').onClick(() => p.newNote(folder)));
    m.addSeparator();
    m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => p.rename(folder)));
    m.addItem((i) => i.setTitle('Delete topic…').setIcon('trash-2').setWarning(true).onClick(() => p.remove(folder)));
    m.showAtMouseEvent(e);
  }
  noteMenu(file, e) {
    const p = this.plugin;
    const m = new Menu();
    m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => this.app.workspace.getLeaf('tab').openFile(file)));
    m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => p.rename(file)));
    m.addItem((i) => i.setTitle('Delete note…').setIcon('trash-2').setWarning(true).onClick(() => p.remove(file)));
    m.showAtMouseEvent(e);
  }
}


/** Open (true) or close a folder's children with a short height slide; a closed box is removed. */
function slide(el, open) {
  if (prefersReducedMotion()) return open || el.remove();
  const h = el.scrollHeight;
  const a = el.animate(open ? [{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }] : [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: open ? 200 : 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  el.style.overflow = 'hidden';
  a.onfinish = () => (open ? (el.style.overflow = '') : el.remove());
}
/* @src src/research/settings.js */
/* ---- settings --------------------------------------------------------------- */
class NeonResearchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = () => p.saveSettings();
    containerEl.empty();
    containerEl.addClass('nd-settings');
    new Setting(containerEl)
      .setName('Sections')
      .setDesc('Each section is a folder shown as its own tree (folders are topics, notes are notes). Switch between them at the top of the tab. A * in the path stands for any one folder, so 1.Customers/*/Research gathers every customer’s Research folder into one section. Removing a section never touches its notes.');
    // only re-read notes once the user stops typing a folder path
    const rescan = debounce(async () => {
      s.root = s.roots.length ? s.roots[0].path : '';
      save();
      p.emitSoon();
      p.updateLinkHint();
    }, 600, true);
    s.roots.forEach((r, i) => {
      const row = new Setting(containerEl)
        .addText((t) => t.setPlaceholder('Name').setValue(r.name).onChange((v) => ((r.name = v.trim() || r.path.split('/').pop()), save(), p.emitSoon())))
        .addText((t) => suggestPaths(p.app, t.setPlaceholder('Folder, or a pattern like 1.Customers/*/Research').setValue(r.path).onChange((v) => ((r.path = normalizePath(v.trim() || r.path)), rescan())), 'folder'));
      row.addExtraButton((b) =>
          b.setIcon('trash-2').setTooltip('Remove this section (its notes stay)').onClick(() => {
            s.roots.splice(i, 1);
            if (s.activeRoot >= s.roots.length) s.activeRoot = 0;
            rescan();
            this.display();
          }),
        );
    });
    if (!s.roots.length) containerEl.createEl('p', { cls: 'setting-item-description', text: 'No sections yet: add one to see your research in the Research tab.' });
    // fork: pick an existing folder (or type a new path) instead of making Learning/Section N
    new Setting(containerEl).addButton((b) =>
      b.setButtonText('Add section').onClick(() => {
        const modal = new SectionPickModal(p);
        modal.after = () => this.display();
        modal.open();
      }),
    );

    new Setting(containerEl).setName('Status').setHeading();
    new Setting(containerEl)
      .setName('Status property')
      .setDesc('The note property that holds a research note’s status. Only read, never written (except for new notes made from the tab).')
      .addText((t) => t.setPlaceholder('status').setValue(s.statusProperty).onChange((v) => ((s.statusProperty = v.trim() || 'status'), save(), p.emitSoon())));
    new Setting(containerEl)
      .setName('Done statuses')
      .setDesc('Comma-separated values that count as researched. Any other value counts as still to research.')
      .addText((t) => t.setPlaceholder('completed, done, evergreen').setValue(s.doneStatuses).onChange((v) => ((s.doneStatuses = v), save(), p.emitSoon())));

    new Setting(containerEl).setName('New notes').setHeading();
    new Setting(containerEl)
      .setName('Template note')
      .setDesc('Optional: a note whose text new research notes start from. {{title}}, {{date}} and {{time}} are filled in. Empty: title, created, modified, status and tags properties.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('templates/research_template.md').setValue(s.noteTemplate).onChange((v) => ((s.noteTemplate = v.trim()), save())), 'file'));
    new Setting(containerEl)
      .setName('Status for new notes')
      .setDesc('Used when there is no template. Empty: no status property.')
      .addText((t) => t.setPlaceholder('init').setValue(s.newStatus).onChange((v) => ((s.newStatus = v.trim()), save())));
    new Setting(containerEl)
      .setName('Tags for new notes')
      .setDesc('Comma-separated. Used when there is no template.')
      .addText((t) => t.setPlaceholder('research').setValue(s.newNoteTags).onChange((v) => ((s.newNoteTags = v), save())));

    new Setting(containerEl).setName('Other').setHeading();
    new Setting(containerEl)
      .setName('Count research as work time')
      .setDesc('Off: new research notes (without a template) get “untracked: true”, so time tracking never counts them as work.')
      .addToggle((t) => t.setValue(s.countAsWork).onChange((v) => ((s.countAsWork = v), save())));
    new Setting(containerEl)
      .setName('Link suggestions')
      .setDesc('In research notes, the status bar offers to link words that match other research note titles.')
      .addToggle((t) => t.setValue(s.linkSuggest).onChange((v) => ((s.linkSuggest = v), save(), p.updateLinkHint())));
    madeWith(containerEl);
  }
}

/* @src src/research/plugin.js */
/* ---- plugin ------------------------------------------------------------------ */
class NeonResearch extends Plugin {
  async onload() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, NR_DEFAULTS, raw);
    if (!Array.isArray(this.settings.open)) this.settings.open = [];
    const s = this.settings;
    // fork: sections come only from settings; an old single `root` (1.x data) becomes the first section
    if (!Array.isArray(s.roots)) s.roots = s.root ? [{ name: 'Research', path: normalizePath(s.root) }] : [];
    s.roots = s.roots.filter((r) => r && typeof r.path === 'string' && r.path.trim()).map((r) => ({ name: String(r.name || r.path.split('/').pop()), path: normalizePath(r.path) }));
    if (!(s.activeRoot >= 0 && s.activeRoot < s.roots.length)) s.activeRoot = 0;
    s.root = s.roots.length ? s.roots[0].path : '';
    this.listeners = new Set();
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.registerHoverLinkSource(VIEW_RESEARCH, { display: `${appName()} research`, defaultMod: true }); // page previews (hoverPreview)
    this.addRibbonIcon('library', 'Research', () => this.openTab());
    this.addCommand({ id: 'open-research', name: 'Open the Research tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-topic', name: 'New topic', callback: () => (this.rootFolder() ? this.newTopic(this.rootFolder()) : this.pickSection()) });
    // old flashcard blocks (quizzes were removed in the fork) stay off the page
    this.registerMarkdownCodeBlockProcessor(CARD_BLOCK, (src, el) => {
      el.addClass('nr-cards-block');
      // its wrapper (Live Preview, reading view) is hidden too: marked once the block is on the page
      window.requestAnimationFrame(() => {
        const wrap = el.closest('.cm-preview-code-block, .cm-embed-block');
        if (wrap) wrap.addClass('nr-cards-hidden');
      });
    });
    this.addCommand({ id: 'link-suggestions', name: 'Suggest links in this note', callback: () => this.showLinkSuggestions(true) });
    this.addSettingTab(new NeonResearchSettingTab(this.app, this));

    // status bar: "N possible links" for the open research note
    this.linkEl = this.addStatusBarItem();
    this.linkEl.addClass('nd-status', 'nr-status', 'mod-clickable');
    this.linkEl.addEventListener('click', () => this.showLinkSuggestions(true));
    this.linkEl.hide();
    const hint = debounce(() => this.updateLinkHint(), 800, true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hint));
    // a research note changed (its status may have): redraw, and refresh the link hint
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (!this.inRoot(f)) return;
        this.emitSoon();
        hint();
      }),
    );
    const anyChange = (f) => (this.inRoot(f) || f instanceof TFolder) && this.emitSoon();
    this.registerEvent(this.app.vault.on('create', anyChange));
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        // forget the open state of deleted folders
        this.settings.open = this.settings.open.filter((x) => x !== f.path && !x.startsWith(f.path + '/'));
        this.saveSoon();
        this.emitSoon();
      }),
    );
    this.registerEvent(this.app.vault.on('rename', (f, old) => this.onRename(f, old)));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookDeck()));
    this.app.workspace.onLayoutReady(async () => {
      this.hookDeck();
      this.updateLinkHint();
      this.emitSoon();
    });
  }
  onunload() {
    if (this._save) (this._save.cancel(), this.saveData(this.settings)); // don't lose the last 1.5 s of changes
    const api = deckApi(this.app);
    if (api) api.unregisterAction('research');
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._save) this._save = debounce(() => this.saveData(this.settings), 1500, true);
    this._save();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit) this._emit = debounce(() => this.listeners.forEach((fn) => fn()), 120, true);
    this._emit();
  }
  hookDeck() {
    const api = deckApi(this.app);
    if (api) api.registerAction({ id: 'research', icon: 'library', label: 'Research', order: 45, view: VIEW_RESEARCH, run: () => this.openTab() });
  }
  openTab() {
    return activateView(this.app, VIEW_RESEARCH, 'tab');
  }

  /* ---- the tree ---- */
  /** Path of the root shown in the tab. */
  get root() {
    const r = this.settings.roots[this.settings.activeRoot];
    return r ? r.path : ''; // fork: no section chosen yet
  }
  /**
   * The section's folder. fork: a path with an asterisk standing for one folder name (for example
   * "1.Customers/ * /Research" without the spaces) is a pattern: its folder is a stand-in whose children
   * are every matching folder (one per customer), shown by the name the asterisk matched.
   */
  rootFolder(path = this.root) {
    if (!path) return null;
    if (path.includes('*')) {
      const kids = globFolders(this.app.vault.getRoot(), path);
      return kids.length ? { path, name: path.split('/').pop(), children: kids, isPattern: true } : null;
    }
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }
  /** The root a file lives in (any root, not only the shown one), or null. */
  rootOf(f) {
    if (!f) return null;
    return this.settings.roots.find((r) => (r.path.includes('*') ? !!patternBase(r.path, f.path) : f.path.startsWith(r.path + '/'))) || null;
  }
  /** fork: a folder's name in the tree — a pattern section shows the * part (e.g. the customer). */
  folderLabel(folder) {
    const r = this.settings.roots[this.settings.activeRoot];
    if (r && r.path.includes('*') && patternBase(r.path, folder.path + '/x') === folder.path) return patternStar(r.path, folder.path) || folder.name;
    return folder.name;
  }
  inRoot(f) {
    return !!this.rootOf(f);
  }
  setActiveRoot(i) {
    if (i === this.settings.activeRoot || !this.settings.roots[i]) return;
    this.settings.activeRoot = i;
    this.saveSoon();
    this.listeners.forEach((fn) => fn('now')); // a click: redraw now, skip the batching delays
  }
  notesUnder(folder) {
    if (!folder) return [];
    const out = [];
    const walk = (x) => {
      for (const c of x.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md' && !isIgnoredNote(this.app, c)) out.push(c); // fork: ignored tags
      }
    };
    walk(folder);
    return out;
  }
  researchNotes(path = this.root) {
    return this.notesUnder(this.rootFolder(path));
  }
  allNotes() {
    return this.settings.roots.flatMap((r) => this.researchNotes(r.path));
  }
  isOpen(path) {
    return this.settings.open.includes(path);
  }
  /** Remember a folder's open state without redrawing (the tree updates itself). */
  setOpen(path, open) {
    this.settings.open = this.settings.open.filter((x) => x !== path);
    if (open) this.settings.open.push(path);
    this.saveSoon();
  }
  toggleOpen(path, force) {
    const open = force != null ? force : !this.isOpen(path);
    this.settings.open = this.settings.open.filter((x) => x !== path);
    if (open) this.settings.open.push(path);
    this.saveSoon();
    this.emitSoon();
  }
}

/* ---- section patterns (fork) ---- */
/** Folders matching a path pattern where * stands for any one folder name (pure, vault tree in). */
function globFolders(root, pattern) {
  let level = [root];
  for (const seg of pattern.split('/').filter(Boolean)) {
    const next = [];
    for (const fd of level)
      for (const c of fd.children || []) if (c instanceof TFolder && (seg === '*' || c.name === seg)) next.push(c);
    level = next;
  }
  return level.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
}
/** The matching folder a path is inside, for a pattern (or ''). */
function patternBase(pattern, path) {
  const segs = pattern.split('/').filter(Boolean);
  const parts = path.split('/');
  if (parts.length <= segs.length) return '';
  for (let i = 0; i < segs.length; i++) if (segs[i] !== '*' && segs[i] !== parts[i]) return '';
  return parts.slice(0, segs.length).join('/');
}
/** The names the * parts matched, joined (e.g. the customer). */
function patternStar(pattern, folderPath) {
  const segs = pattern.split('/').filter(Boolean);
  const parts = folderPath.split('/');
  return segs.map((s, i) => (s === '*' ? parts[i] : null)).filter(Boolean).join(' · ');
}
/* @src src/research/sections.js */
/** Pick a folder for a new section: any vault folder, or a new one named by what you type. */
class SectionPickModal extends SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder('Folder for the new section (type to search, or a new folder path)');
  }
  getSuggestions(q) {
    const t = q.trim().toLowerCase();
    const folders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== '/' && f.path.toLowerCase().includes(t));
    const out = folders.slice(0, 100).map((f) => ({ path: f.path }));
    if (t && !folders.some((f) => f.path.toLowerCase() === t)) out.unshift({ path: normalizePath(q.trim()), create: true });
    return out;
  }
  renderSuggestion(s, el) {
    el.setText(s.path.includes('*') ? `Use the pattern “${s.path}” (${globFolders(this.app.vault.getRoot(), s.path).length} folders)` : s.create ? `Create folder “${s.path}”` : s.path);
  }
  onChooseSuggestion(s) {
    Promise.resolve(this.plugin.addSection(s.path)).then(() => this.after && this.after());
  }
}

Object.assign(NeonResearch.prototype, {
  /** + in the section switch: choose or create a folder, then switch to it. */
  pickSection() {
    new SectionPickModal(this).open();
  },
  async addSection(path) {
    const s = this.settings;
    path = normalizePath(path);
    const have = s.roots.findIndex((r) => r.path === path);
    if (have >= 0) return this.setActiveRoot(have); // already a section: just go there
    // nested sections would claim the same notes twice (quiz counts, history)
    const clash = s.roots.find((r) => path.startsWith(r.path + '/') || r.path.startsWith(path + '/'));
    if (clash) return new Notice(`“${path}” overlaps the section “${clash.name}” (${clash.path})`);
    if (!path.includes('*')) await ensureFolder(this.app, path); // fork: a pattern is not a folder to make
    s.roots.push({ name: path.split('/').pop(), path });
    s.activeRoot = s.roots.length - 1;
    s.root = s.roots[0].path;
    await this.saveSettings();
    this.emitSoon();
  },
  /** Right-click on a section: rename it, or take it out of the switch (its notes stay). */
  sectionMenu(i, e) {
    const s = this.settings;
    const r = s.roots[i];
    const m = new Menu();
    m.addItem((it) =>
      it.setTitle('Rename section…').setIcon('pencil').onClick(() =>
        new PromptModal(this.app, {
          title: 'Rename section',
          value: r.name,
          cta: 'Rename',
          onSubmit: async (v) => {
            if (!v.trim()) return;
            r.name = v.trim();
            await this.saveSettings();
            this.emitSoon();
          },
        }).open(),
      ),
    );
    m.addItem((it) =>
        it.setTitle('Remove from the switch (notes stay)').setIcon('x').onClick(async () => {
          s.roots.splice(i, 1);
          if (s.activeRoot >= s.roots.length || s.activeRoot === i) s.activeRoot = 0;
          else if (s.activeRoot > i) s.activeRoot--;
          s.root = s.roots.length ? s.roots[0].path : '';
          await this.saveSettings();
          this.emitSoon();
        }),
    );
    m.showAtMouseEvent(e);
  },
});
/* @src src/research/topics.js */
Object.assign(NeonResearch.prototype, {
  /** A topic (or a subtopic inside `parent`): a folder. */
  newTopic(parent) {
    new PromptModal(this.app, {
      title: parent && parent.path !== this.root ? `New subtopic in ${parent.name}` : 'New topic',
      placeholder: 'e.g. Biology',
      cta: 'Create',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name) return;
        const base = parent ? parent.path : this.root;
        if (!base) return new Notice('Choose a folder for this section first');
        if (base.includes('*')) return new Notice('This section covers several folders: use + on one of them (e.g. a customer) to add a topic there');
        await ensureFolder(this.app, base);
        const path = normalizePath(`${base}/${name}`);
        if (this.app.vault.getAbstractFileByPath(path)) return new Notice(`“${name}” already exists here`);
        await this.app.vault.createFolder(path);
        if (parent) this.toggleOpen(parent.path, true);
        this.toggleOpen(path, true);
      },
    }).open();
  },
  newNote(folder) {
    new PromptModal(this.app, {
      title: `New note in ${folder.name}`,
      placeholder: 'e.g. Cell membrane',
      cta: 'Create',
      onSubmit: async (v) => {
        if (!v.trim()) return;
        const f = await createUnique(this.app, folder.path, v, await this.newNoteBody(v.trim()));
        this.toggleOpen(folder.path, true);
        openNewNote(this.app, f);
      },
    }).open();
  },
  rename(item) {
    const isFile = item instanceof TFile;
    new PromptModal(this.app, {
      title: `Rename ${isFile ? 'note' : 'topic'}`,
      value: isFile ? item.basename : item.name,
      cta: 'Rename',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name || name === (isFile ? item.basename : item.name)) return;
        const dest = normalizePath(`${item.parent.path}/${name}${isFile ? '.' + item.extension : ''}`);
        if (this.app.vault.getAbstractFileByPath(dest)) return new Notice(`“${name}” already exists here`);
        await this.app.fileManager.renameFile(item, dest); // links to it are updated
      },
    }).open();
  },
  /** Delete a note or a topic (with everything inside) — to the system trash, after asking. */
  remove(item) {
    const isFile = item instanceof TFile;
    const n = isFile ? 1 : this.notesUnder(item).length;
    const subs = isFile ? 0 : (() => {
      let k = 0;
      const walk = (x) => (x.children || []).forEach((c) => c instanceof TFolder && (k++, walk(c)));
      walk(item);
      return k;
    })();
    new ConfirmModal(this.app, {
      title: isFile ? `Delete “${item.basename}”?` : `Delete topic “${item.name}”?`,
      text: isFile
        ? 'The note goes to the system trash; you can restore it from there.'
        : `It goes to the system trash with ${n} note${n === 1 ? '' : 's'}${subs ? ` and ${subs} subtopic${subs === 1 ? '' : 's'}` : ''} inside; you can restore it from there.`,
      cta: 'Delete',
      onConfirm: async () => {
        await this.app.vault.trash(item, true);
        new Notice(`Deleted “${isFile ? item.basename : item.name}” (system trash)`);
      },
    }).open();
  },
  onRename(f, old) {
    // open folders follow a rename or move (also of a parent folder)
    const move = (p) => (p === old ? f.path : p.startsWith(old + '/') ? f.path + p.slice(old.length) : p);
    this.settings.open = this.settings.open.map(move);
    this.saveSoon();
    this.emitSoon();
  },
  /**
   * Text of a note made from the Research tab (fork). With a template note set: its text, with
   * {{title}}, {{date}} and {{time}} filled in (Templater, if you use it, runs on the new file as usual).
   * Without one: properties in the vault's usual shape (title, created, modified, status, tags).
   */
  async newNoteBody(title) {
    const s = this.settings;
    const now = moment();
    if (s.noteTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.noteTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.noteTemplate));
      try {
        if (tf instanceof TFile) return applyTemplate(await this.app.vault.read(tf), now, title);
      } catch (e) {
        console.error(`${appName()} – Research: could not read the template`, e);
      }
      new Notice(`Research template “${s.noteTemplate}” not found: using the standard properties`);
    }
    return researchFrontmatter(title, now.format('YYYY-MM-DD'), s);
  },

});

/** Properties for a new research note without a template (fork). */
function researchFrontmatter(title, day, s) {
  const q = (v) => (/^[\w .-]+$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v));
  const lines = ['---', `title: ${q(title)}`, `created: ${day}`, `modified: ${day}`];
  if (s.newStatus) lines.push(`${s.statusProperty || 'status'}: ${q(s.newStatus)}`);
  const tags = statusList(s.newNoteTags);
  if (tags.length) lines.push('tags:', ...tags.map((t) => `  - ${q(t.replace(/^#/, ''))}`));
  if (!s.countAsWork) lines.push('untracked: true');
  lines.push('---', '');
  return lines.join('\n');
}
/* @src src/research/status.js */
/* ---- research status (fork): read from a property in each note, never written ----------------------
 * Replaces the old "research list" kept in plugin data. A note's status is the value of the status
 * property (setting, default `status`). Values listed in "Done statuses" count as researched; any other
 * value is still being researched; notes without the property are "no status". */
const NO_STATUS = '';

/** The setting's comma list as lower-case values. */
function statusList(text) {
  return String(text || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
/** A property value as one status: first item of a list, trimmed; '' when missing. */
function statusValue(v) {
  if (Array.isArray(v)) v = v[0];
  if (v == null || typeof v === 'object') return NO_STATUS;
  return String(v).trim();
}
/** 'done' | 'open' | 'none' for a status value. */
function statusKind(value, doneList) {
  if (!value) return 'none';
  return doneList.includes(value.toLowerCase()) ? 'done' : 'open';
}
/**
 * Notes grouped by status: open groups first (most notes first), then done groups, then "no status".
 * `entries` is [{ file, status }]. Returns { groups: [{ status, kind, files }], open, done, none }.
 */
function statusGroups(entries, doneList) {
  const by = new Map();
  for (const e of entries) {
    const key = e.status.toLowerCase();
    if (!by.has(key)) by.set(key, { status: e.status, kind: statusKind(e.status, doneList), files: [] });
    by.get(key).files.push(e.file);
  }
  const rank = { open: 0, done: 1, none: 2 };
  const groups = [...by.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || b.files.length - a.files.length || a.status.localeCompare(b.status));
  const count = (k) => groups.filter((g) => g.kind === k).reduce((n, g) => n + g.files.length, 0);
  return { groups, open: count('open'), done: count('done'), none: count('none') };
}
/** Hero line: "3 to research · 2 researched · 4 without status". */
function statusLine(sum) {
  const parts = [`${sum.open} to research`, `${sum.done} researched`];
  if (sum.none) parts.push(`${sum.none} without status`);
  return parts.join(' · ');
}

Object.assign(NeonResearch.prototype, {
  /** A note's status value (from the metadata cache; no file reads). */
  statusOf(file) {
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    return statusValue(fm[this.settings.statusProperty || 'status']);
  },
  doneStatuses() {
    return statusList(this.settings.doneStatuses);
  },
  /** Status summary of the notes under a folder (or of the shown section). */
  statusSummary(folder = this.rootFolder()) {
    return statusGroups(this.notesUnder(folder).map((file) => ({ file, status: this.statusOf(file) })), this.doneStatuses());
  },
});

Object.assign(ResearchView.prototype, {
  /** The "By status" tab: the section's notes grouped by their status property. */
  renderStatus(panel) {
    const p = this.plugin;
    const folder = p.rootFolder();
    const sum = p.statusSummary(folder);
    if (!sum.groups.length) return emptyState(panel, folder ? 'No notes in this section yet' : 'Choose a folder for this section in the settings');
    const prop = p.settings.statusProperty || 'status';
    for (const g of sum.groups) {
      const box = panel.createDiv(`nr-status-group is-${g.kind}`);
      const head = box.createDiv('nr-status-head');
      head.createSpan({ cls: `nr-status-pill is-${g.kind}`, text: g.status || `no ${prop}` });
      head.createSpan({ cls: 'nr-status-count', text: `${g.files.length} note${g.files.length === 1 ? '' : 's'}` });
      const list = box.createDiv('nr-tree');
      const sorted = g.files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
      for (const f of sorted) {
        const row = list.createDiv('nr-row is-note');
        row.style.setProperty('--depth', '0');
        row.createSpan('nr-chev-space');
        icon(row, 'file-text', 'nd-ico nr-note-ico');
        row.createSpan({ cls: 'nr-name', text: f.basename });
        // fork: in a pattern section the path starts at the matched folder, shown by its label (e.g. the customer)
        const base = folder && folder.isPattern ? patternBase(folder.path, f.path) : folder && folder.path;
        const rel = f.parent && base && f.parent.path !== base ? f.parent.path.slice(base.length + 1) : '';
        const where = folder && folder.isPattern ? [patternStar(folder.path, base), rel].filter(Boolean).join(' / ') : rel;
        row.createSpan({ cls: 'nr-col nr-c-count', text: where });
        const when = row.createSpan({ cls: 'nr-col nr-c-when', text: shortAgo(f.stat.mtime) });
        tip(when, `Edited ${moment(f.stat.mtime).format('D MMM YYYY, HH:mm')}`);
        row.addEventListener('click', (e) => openFile(this.app, f, e));
        hoverPreview(this.app, row, f);
        row.addEventListener('contextmenu', (e) => (e.preventDefault(), this.noteMenu(f, e)));
      }
    }
  },
});
/* @src src/research/links.js */
Object.assign(NeonResearch.prototype, {
  /* ---- link suggestions ---- */
  async linkHits(file) {
    const text = await this.app.vault.cachedRead(file);
    const mask = plainMask(text);
    const linked = this.app.metadataCache.resolvedLinks[file.path] || {};
    const r = this.rootOf(file);
    const targets = (r ? this.researchNotes(r.path) : []).filter((t) => t !== file && !linked[t.path] && t.basename.length >= 4);
    if (!targets.length) return [];
    // one pass over the note for all titles (longest first), instead of one regex per research note
    const byName = new Map();
    for (const t of targets) if (!byName.has(t.basename.toLowerCase())) byName.set(t.basename.toLowerCase(), t);
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escRe);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${names.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    const hits = [];
    for (const m of mask.matchAll(re)) {
      const t = byName.get(m[2].toLowerCase());
      if (!t || hits.some((h) => h.target === t)) continue;
      const at = m.index + m[1].length;
      const match = text.slice(at, at + m[2].length);
      hits.push({ target: t, at, match, before: text.slice(Math.max(0, at - 40), at).replace(/\s+/g, ' '), after: text.slice(at + match.length, at + match.length + 40).replace(/\s+/g, ' ') });
    }
    return hits;
  },
  async updateLinkHint() {
    const el = this.linkEl;
    if (!el) return;
    const f = this.app.workspace.getActiveFile();
    if (!this.settings.linkSuggest || !f || !this.inRoot(f)) return el.hide();
    const hits = await this.linkHits(f);
    if (this.app.workspace.getActiveFile() !== f) return;
    el.empty();
    if (!hits.length) return el.hide();
    setIcon(el.createSpan('nd-status-icon'), 'link');
    el.createSpan({ cls: 'nd-status-text', text: `${hits.length} possible link${hits.length === 1 ? '' : 's'}` });
    tip(el, 'Words that match other research notes — click to link them');
    el.show();
  },
  async showLinkSuggestions(fromUser) {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const hits = this.inRoot(f) ? await this.linkHits(f) : [];
    if (!hits.length) return fromUser && new Notice('No unlinked mentions of research notes here.');
    new LinkSuggestModal(this, f, hits).open();
  },
  async linkMention(file, target) {
    await writeNote(this.app, file, (text) => {
      const mask = plainMask(text);
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escRe(target.basename)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
      const m = re.exec(mask);
      if (!m) return text;
      const at = m.index + m[1].length;
      const as = text.slice(at, at + target.basename.length);
      const link = as === target.basename ? `[[${target.basename}]]` : `[[${target.basename}|${as}]]`;
      return text.slice(0, at) + link + text.slice(at + as.length);
    });
    window.setTimeout(() => this.updateLinkHint(), 600);
  },

});
return NeonResearch;
})();
/* ==== module neon-write ==== */
const NeonWriteModule = (() => {
/* @src src/write/constants.js */

/* =========================================================================
 * WRITE — nicer note writing: a rows × columns table picker, styled tables,
 * dividers, locked callouts and a barely-there pattern behind the note.
 * ========================================================================= */
const { MarkdownView, EditorSuggest } = obsidian;
// fork: the slash menu, the selection toolbar and image moving are removed
const NW_DEFAULTS = {
  liftedWindow: true,
  themeFonts: true,
  styledTables: true,
  notePattern: true,
  limeDividers: true, // --- dividers as a lime dotted line (item 27)
  patternOpacity: 35, // percent of the dashboard pattern's strength (already faint by design)
};
const GRID_COLS = 10;
const GRID_ROWS = 8;

/* @src src/write/editor-helpers.js */
/* ---- editor helpers ------------------------------------------------------ */
/** Empty Markdown table: the first of `rows` rows is the header. */
function tableMarkdown(rows, cols) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const blank = Array(cols).fill('   ');
  return [line(blank), line(Array(cols).fill('---')), ...Array(Math.max(0, rows - 1)).fill(line(blank))].join('\n');
}
/** Insert a table on its own lines (blank line around it) and put the cursor in the first cell. */
function insertTable(editor, rows, cols) {
  const cur = editor.getCursor();
  const text = editor.getLine(cur.line);
  let at;
  let prefix = '';
  if (text.trim()) {
    at = { line: cur.line, ch: text.length };
    prefix = '\n\n';
  } else {
    at = { line: cur.line, ch: 0 };
    if (cur.line > 0 && editor.getLine(cur.line - 1).trim()) prefix = '\n';
  }
  const next = at.line + 1 < editor.lineCount() ? editor.getLine(at.line + 1) : '';
  const suffix = next.trim() ? '\n\n' : '\n';
  editor.replaceRange(prefix + tableMarkdown(rows, cols) + suffix, at, text.trim() ? at : { line: cur.line, ch: text.length });
  editor.setCursor({ line: at.line + prefix.split('\n').length - 1, ch: 2 });
  editor.focus();
}
/** Is this line inside a ``` code block? */
function inCodeBlock(editor, line) {
  let open = false;
  for (let i = 0; i < line; i++) if (/^\s*(```|~~~)/.test(editor.getLine(i))) open = !open;
  return open;
}
/** Replace the current line's block marker (heading, list, quote, task) with `prefix`. */
function setLinePrefix(editor, prefix) {
  const l = editor.getCursor().line;
  const body = editor.getLine(l).replace(/^\s*(#{1,6}\s+|[-*+]\s+\[.\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/, '');
  editor.setLine(l, prefix + body);
  editor.setCursor({ line: l, ch: (prefix + body).length });
}
/** Where the caret is on screen (for placing popovers), or null. */
function caretRect(editor) {
  try {
    const cm = editor.cm;
    if (cm && cm.coordsAtPos) {
      const r = cm.coordsAtPos(cm.state.selection.main.head);
      if (r) return r;
    }
  } catch (e) {
    /* fall through */
  }
  return null;
}
/** Wrap the selection in a mark (or remove it when it's already there, inside or just outside the selection). */
/**
 * Toggle a symmetric marker (*, **, ~~, ==, `) around line[s..e]. For stars the run length decides
 * the state (1 italic, 2 bold, 3 both), so Italic never eats half of a bold. Returns the new line and selection.
 */
function toggleMark(line, s, e, mark) {
  while (s < e && line[s] === ' ') s++;
  while (e > s && line[e - 1] === ' ') e--;
  const run = (i, step) => {
    let n = 0;
    while (line[i + n * step] === '*') n++;
    return n;
  };
  const put = (k, markStr) => {
    const m = markStr.repeat(k);
    const out = line.slice(0, s - cut) + m + line.slice(s, e) + m + line.slice(e + cut);
    return { line: out, s: s - cut + m.length, e: e - cut + m.length };
  };
  let cut;
  if (mark === '*' || mark === '**') {
    // markers inside the selection count as outside
    const inner = Math.min(run(s, 1), run(e - 1, -1), Math.floor((e - s) / 2));
    s += inner;
    e -= inner;
    cut = Math.min(run(s - 1, -1), run(e, 1), 3);
    let bold = cut >= 2, italic = cut % 2 === 1;
    if (mark === '**') bold = !bold;
    else italic = !italic;
    return put((bold ? 2 : 0) + (italic ? 1 : 0), '*');
  }
  const n = mark.length;
  if (e - s >= 2 * n && line.slice(s, s + n) === mark && line.slice(e - n, e) === mark) (s += n), (e -= n);
  cut = line.slice(s - n, s) === mark && line.slice(e, e + n) === mark ? n : 0;
  return put(cut ? 0 : 1, mark);
}
function toggleWrap(editor, open, close = open) {
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
  if (open === close && from.line === to.line) {
    const r = toggleMark(editor.getLine(from.line), from.ch, to.ch, open);
    editor.replaceRange(r.line, { line: from.line, ch: 0 }, { line: from.line, ch: editor.getLine(from.line).length });
    editor.setSelection({ line: from.line, ch: r.s }, { line: from.line, ch: r.e });
    return;
  }
  const sel = editor.getSelection();
  const before = from.ch >= open.length ? editor.getRange({ line: from.line, ch: from.ch - open.length }, from) : '';
  const after = editor.getRange(to, { line: to.line, ch: to.ch + close.length });
  if (before === open && after === close) {
    editor.replaceRange('', to, { line: to.line, ch: to.ch + close.length });
    editor.replaceRange('', { line: from.line, ch: from.ch - open.length }, from);
    editor.setSelection({ line: from.line, ch: from.ch - open.length }, { line: to.line, ch: to.ch - (from.line === to.line ? open.length : 0) });
  } else if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    editor.replaceSelection(sel.slice(open.length, sel.length - close.length));
  } else {
    editor.replaceSelection(open + sel + close);
    const end = editor.getCursor('to');
    editor.setSelection({ line: from.line, ch: from.ch + open.length }, { line: end.line, ch: end.ch - close.length });
  }
}
/** A --- divider on its own line, with a blank line above so the text above can't turn into a heading. */
function insertDivider(ed) {
  const l = ed.getCursor().line;
  const cur = ed.getLine(l).trim() ? ed.getLine(l) + '\n\n' : ''; // a line with text stays, the divider goes below it
  const pre = !cur && l > 0 && ed.getLine(l - 1).trim() ? '\n' : '';
  const post = l + 1 <= ed.lastLine() && !ed.getLine(l + 1).trim() ? '' : '\n'; // no extra blank line when one follows
  ed.setLine(l, `${pre}${cur}---${post}`);
  ed.setCursor({ line: l + (pre ? 1 : 0) + (cur ? 2 : 0) + 1, ch: 0 });
}
/**
 * Typing --- under a line of text makes Markdown turn that text into a heading (setext).
 * After Enter on such a ---, put a blank line above it so it stays a divider (Ctrl+Z undoes it).
 */
function keepDivider(ed) {
  const c = ed.getCursor();
  const at = c.line - 1; // the --- line, with the cursor on the new empty line below
  if (at < 1 || ed.getLine(c.line).trim() || ed.getLine(at).trim() !== '---') return;
  const above = ed.getLine(at - 1);
  if (!above.trim() || /^\s*(\||---|```|~~~)/.test(above) || inCodeBlock(ed, at)) return;
  // the closing --- of the frontmatter
  if (ed.getLine(0).trim() === '---') {
    let close = -1;
    for (let i = 1; i < at; i++) if (ed.getLine(i).trim() === '---') (close = i), (i = at);
    if (close === -1) return;
  }
  ed.replaceRange('\n', { line: at, ch: 0 });
}
/** Small sub-title: the line becomes #### (any other heading level is replaced); again turns it back into text. */
function toggleSubtitle(ed) {
  const l = ed.getCursor('from').line;
  const text = ed.getLine(l);
  const m = text.match(/^(#{1,6})\s+/);
  const body = m ? text.slice(m[0].length) : text;
  ed.setLine(l, m && m[1] === '####' ? body : `#### ${body}`);
}
/** Page break for Export to PDF: the next content starts on a new page (inline style, so it works without the plugin too). */
function insertPageBreak(ed) {
  const l = ed.getCursor().line;
  const cur = ed.getLine(l).trim() ? ed.getLine(l) + '\n\n' : '';
  const pre = !cur && l > 0 && ed.getLine(l - 1).trim() ? '\n' : '';
  const post = l + 1 <= ed.lastLine() && !ed.getLine(l + 1).trim() ? '' : '\n\n';
  ed.setLine(l, `${pre}${cur}<div class="nw-pagebreak" style="break-after: page; page-break-after: always;"></div>${post}`);
  ed.setCursor({ line: l + (pre ? 1 : 0) + (cur ? 2 : 0) + 2, ch: 0 });
}
/** One flashcard line, or null when a side is empty; " :: " separates the sides, so it can't appear inside one. */
function cardLine(q, a) {
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').replace(/\s:::?\s/g, ' : ').trim();
  const qv = clean(q).replace(/^#+\s*/, '');
  const av = clean(a);
  return qv && av ? `${qv} :: ${av}` : null;
}
/** "q :: a" -> [q, a, true]; any other line -> [line, '', false]. */
function splitCard(line) {
  const i = String(line).indexOf(' :: ');
  return i < 0 ? [String(line).trim(), '', false] : [line.slice(0, i).trim(), line.slice(i + 4).trim(), true];
}
/** Where /flashcard's cards go: over the cursor line when it's blank or became one of the cards, else below it.
 *  now: the line's text at insert time. null = nothing to do (the line's own card came back unchanged). */
function placeCards(orig, cards, now = orig) {
  orig = String(orig);
  const [oq, oa] = splitCard(orig);
  if (cards.length === 1 && cards[0].fromLine && cards[0].line === cardLine(oq, oa)) return null;
  const indent = orig.match(/^\s*/)[0]; // an indented card line keeps its indent
  // the line changed while the popup was open (sync, another plugin): never overwrite it
  const replace = now === orig && (!orig.trim() || cards.some((k) => k.fromLine));
  return { replace, text: cards.map((k) => indent + k.line).join('\n') };
}
/* @src src/write/table-merge.js */
/* ---- merged table cells (item 36): a cell that is only "<" joins the cell on its left ---- */
/** Reading view / PDF: apply the merges in one rendered table; a merged first body row becomes a title above the header. */
function mergeTable(table) {
  const rows = [...table.querySelectorAll('tr')];
  for (const tr of rows) {
    const cells = [...tr.children];
    // a row with "<" in it: empty cells after the title also join, so a new column keeps the title full width
    const merging = cells.some((c) => c.textContent.trim() === '<');
    let keep = null;
    for (const c of cells) {
      const t = c.textContent.trim();
      if (keep && (t === '<' || (merging && !t && keep === cells[0]))) {
        keep.colSpan += 1;
        c.remove();
      } else keep = c;
    }
  }
  const body = table.tBodies[0];
  const first = body && body.rows[0];
  const head = table.tHead;
  if (first && head && first.cells.length === 1 && first.cells[0].colSpan > 1) {
    first.addClass('nw-title-row');
    head.prepend(first);
  }
}
/** Line with the table cell at `ch` turned into "<" (or back to empty). */
function toggleMergeCell(line, ch) {
  const bars = [...line].map((c, i) => (c === '|' && line[i - 1] !== '\\' ? i : -1)).filter((i) => i >= 0);
  const k = bars.findIndex((b, i) => b < ch && (bars[i + 1] ?? Infinity) >= ch);
  if (k < 0 || k >= bars.length - 1 || k === 0) return null; // outside the table, or the first cell (nothing on its left)
  const cell = line.slice(bars[k] + 1, bars[k + 1]);
  return line.slice(0, bars[k] + 1) + (cell.trim() === '<' ? '  ' : ' < ') + line.slice(bars[k + 1]);
}
/* @src src/write/callout-lock.js */
/* ---- lockable callouts (item 31): `> [!info|locked]`; the state lives in the note ---- */
let cmState = null;
let cmView = null;
try {
  cmState = require('@codemirror/state'); // provided by Obsidian at runtime
  cmView = require('@codemirror/view');
} catch (e) {
  console.error(`${appName()} – Write: callout lock needs @codemirror/state`, e);
}
const lockAnno = cmState ? cmState.Annotation.define() : null; // marks our own lock/unlock edits
const CALLOUT_HEAD_RE = /^(\s*>\s*\[!)([^\]|]+)(\|[^\]]*)?(\][+-]?)(.*)$/;
/** Header line with "locked" added to or removed from the callout metadata; null when it isn't a callout header. */
function toggleLockMeta(text) {
  const m = text.match(CALLOUT_HEAD_RE);
  if (!m) return null;
  const words = (m[3] || '').slice(1).split(/[\s|]+/).filter(Boolean);
  const next = words.includes('locked') ? words.filter((w) => w !== 'locked') : [...words, 'locked'];
  return `${m[1]}${m[2]}${next.length ? '|' + next.join(' ') : ''}${m[4]}${m[5]}`;
}
/* lockable math blocks (issue 34): `$$ % locked` (a TeX comment, so the formula renders the same) */
const MATH_OPEN_RE = /^(\s*\$\$)\s*(%\s*locked)?\s*$/;
const MATH_LOCKED_RE = /^\s*\$\$\s*%\s*locked\s*$/;
/** [open, close] line indexes (0-based) of each multi-line $$ block, outside code fences. */
function mathBlocks(lines) {
  const out = [];
  let fence = false;
  let open = -1;
  lines.forEach((t, i) => {
    if (open < 0 && /^\s*(```|~~~)/.test(t)) fence = !fence;
    if (fence) return;
    if (open < 0) {
      if (MATH_OPEN_RE.test(t)) open = i;
    } else if (/\$\$\s*$/.test(t)) {
      out.push([open, i]);
      open = -1;
    }
  });
  return out;
}
/** Opening `$$` line with "% locked" added or removed; null when it isn't one. */
function toggleMathLock(text) {
  const m = text.match(MATH_OPEN_RE);
  return m ? (m[2] ? m[1] : `${m[1]} % locked`) : null;
}
const lockCache = new WeakMap(); // doc -> locked ranges (a doc never changes, so its ranges don't either)
/** [from, to] of every locked callout (its header line and the > lines under it) and locked math block. */
function lockedRanges(doc) {
  if (lockCache.has(doc)) return lockCache.get(doc);
  // shortcut: one pass over the lines per changed doc; fine for notes, upgrade to the syntax tree if huge notes lag
  const out = [];
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const m = l.text.match(CALLOUT_HEAD_RE);
    if (!m || !/(^|[\s|])locked(\s|$)/.test((m[3] || '').slice(1))) continue;
    let end = l;
    while (end.number < doc.lines && /^\s*>/.test(doc.line(end.number + 1).text)) end = doc.line(end.number + 1);
    out.push([l.from, end.to]);
    i = end.number;
  }
  const lines = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  for (const [a, b] of mathBlocks(lines)) if (MATH_LOCKED_RE.test(lines[a])) out.push([doc.line(a + 1).from, doc.line(b + 1).to]);
  lockCache.set(doc, out);
  return out;
}
/** Heading on the selection's first line: none -> H1 -> H2 -> H3 -> none. */
function cycleHeading(editor) {
  const l = editor.getCursor('from').line;
  const text = editor.getLine(l);
  const m = text.match(/^(#{1,6})\s+/);
  const level = m ? m[1].length : 0;
  const body = m ? text.slice(m[0].length) : text;
  editor.setLine(l, level >= 3 ? body : `${'#'.repeat(level + 1)} ${body}`);
}
/** Turn the selected lines into a callout. */
function makeCallout(editor, type = 'note') {
  const a = editor.getCursor('from').line;
  const b = editor.getCursor('to').line;
  const lines = [];
  for (let i = a; i <= b; i++) lines.push(`> ${editor.getLine(i)}`);
  const text = `> [!${type}]\n${lines.join('\n')}`;
  editor.replaceRange(text, { line: a, ch: 0 }, { line: b, ch: editor.getLine(b).length });
  editor.setCursor({ line: a, ch: text.split('\n')[0].length });
}

/* @src src/write/table-picker.js */
/* ---- table picker ------------------------------------------------------- */
/** A rows × columns grid under the caret: hover or use the arrows, click or Enter inserts. */
class TablePicker {
  constructor(editor, rect) {
    this.editor = editor;
    this.r = 3;
    this.c = 3;
    const el = (this.el = document.body.createDiv('nw-table-picker nd-root'));
    el.createDiv({ cls: 'nw-tp-title', text: 'Insert table' });
    const grid = el.createDiv('nw-tp-grid');
    grid.style.setProperty('--cols', String(GRID_COLS));
    this.cells = [];
    for (let r = 1; r <= GRID_ROWS; r++) {
      for (let c = 1; c <= GRID_COLS; c++) {
        const cell = grid.createDiv('nw-tp-cell');
        cell.addEventListener('mouseenter', () => this.set(r, c));
        cell.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.set(r, c);
          this.insert();
        });
        this.cells.push({ r, c, cell });
      }
    }
    this.label = el.createDiv('nw-tp-label');
    el.createDiv({ cls: 'nw-tp-hint', text: 'first row is the header · arrows + Enter · Esc' });
    this.place(rect);
    this.set(this.r, this.c);
    this.onKey = (e) => {
      const k = e.key;
      const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
      if (moves[k]) this.set(clamp(this.r + moves[k][0], 1, GRID_ROWS), clamp(this.c + moves[k][1], 1, GRID_COLS));
      else if (k === 'Enter') this.insert();
      else if (k === 'Escape') this.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    this.onDown = (e) => {
      if (!el.contains(e.target)) this.close();
    };
    document.addEventListener('keydown', this.onKey, true);
    window.setTimeout(() => document.addEventListener('mousedown', this.onDown, true), 0);
  }
  place(rect) {
    const el = this.el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = rect ? rect.left : (window.innerWidth - w) / 2;
    let y = rect ? rect.bottom + 6 : (window.innerHeight - h) / 2;
    if (rect && y + h > window.innerHeight - 8) y = rect.top - h - 6; // no room below: open above
    el.style.left = `${clamp(x, 8, window.innerWidth - w - 8)}px`;
    el.style.top = `${clamp(y, 8, window.innerHeight - h - 8)}px`;
  }
  set(r, c) {
    this.r = r;
    this.c = c;
    for (const x of this.cells) {
      x.cell.toggleClass('is-on', x.r <= r && x.c <= c);
      x.cell.toggleClass('is-head', x.r === 1 && x.c <= c);
    }
    this.label.setText(`${r} × ${c}  ·  ${r} row${r === 1 ? '' : 's'}, ${c} column${c === 1 ? '' : 's'}`);
  }
  insert() {
    const { r, c, editor } = this;
    this.close();
    insertTable(editor, r, c);
  }
  close() {
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('mousedown', this.onDown, true);
    this.el.remove();
  }
}

/* @src src/write/settings.js */
/* ---- settings ---------------------------------------------------------- */
class NeonWriteSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    containerEl.empty();
    containerEl.addClass('nd-settings');
    new Setting(containerEl)
      .setName('Lifted writing window')
      .setDesc('The note sits on a rounded, slightly raised card, with the pattern around it.')
      .addToggle((t) => t.setValue(s.liftedWindow).onChange((v) => ((s.liftedWindow = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Theme fonts in notes')
      .setDesc('Body text, headings and code use the fonts of the theme you picked on the dashboard.')
      .addToggle((t) => t.setValue(s.themeFonts).onChange((v) => ((s.themeFonts = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Styled tables')
      .setDesc('Tables in notes get a rounded card, a tinted header and soft row lines in the theme colours.')
      .addToggle((t) => t.setValue(s.styledTables).onChange((v) => ((s.styledTables = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Lime dividers')
      .setDesc('A --- line in a note is drawn as a thin lime line that fades out at both ends. Also keeps --- typed under text a divider instead of a heading.')
      .addToggle((t) => t.setValue(s.limeDividers).onChange((v) => ((s.limeDividers = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Pattern behind notes')
      .setDesc('The dashboard pattern, dimmed right down, behind the note you are writing. Needs the Dashboard section on.')
      .addToggle((t) => t.setValue(s.notePattern).onChange((v) => ((s.notePattern = v), p.saveSettings(), p.mountNotePattern())));
    new Setting(containerEl)
      .setName('Pattern strength behind notes')
      .setDesc('Percent of the dashboard pattern. Low values are barely visible.')
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(s.patternOpacity).setDynamicTooltip().onChange((v) => ((s.patternOpacity = v), p.saveSettings(), p.applyPatternOpacity())));
    madeWith(containerEl);
  }
}

/* @src src/write/plugin.js */
/* ---- plugin ------------------------------------------------------------- */
class NeonWrite extends Plugin {
  async onload() {
    this.settings = Object.assign({}, NW_DEFAULTS, (await this.loadData()) || {});
    // fork: no slash menu, no selection toolbar and no image moving
    this.addCommand({ id: 'insert-table', name: 'Insert table…', editorCallback: (ed) => this.openTablePicker(ed) });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        menu.addItem((i) => i.setTitle('Insert table…').setIcon('table').onClick(() => this.openTablePicker(editor)));
      }),
    );

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountNotePattern()));
    this.app.workspace.onLayoutReady(() => this.mountNotePattern());
    if (cmState) {
      // locked callouts: refuse the user's own edits inside them (typing, delete, paste, drag, undo);
      // background writes from other plugins have no user event and pass, so editor and file never disagree
      this.registerEditorExtension(
        cmState.EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || tr.annotation(lockAnno)) return tr;
          const ev = tr.annotation(cmState.Transaction.userEvent);
          if (!ev || !/^(input|delete|move|undo|redo)/.test(ev)) return tr;
          const ranges = lockedRanges(tr.startState.doc);
          if (!ranges.length) return tr;
          let hit = false;
          tr.changes.iterChangedRanges((a, b) => (hit = hit || ranges.some(([f, t]) => a <= t && b >= f)));
          if (!hit) return tr;
          this.shakeLocks();
          return [];
        }),
      );
      // the cursor can't land in a locked callout (arrow keys, Home/End, Page Up/Down, clicks): it hops over it
      this.registerEditorExtension(
        cmState.EditorState.transactionFilter.of((tr) => {
          // untagged moves count too: Obsidian's own clicks on rendered widgets set the cursor without a user event (issue 47)
          if (!tr.selection || tr.docChanged || (tr.annotation(cmState.Transaction.userEvent) && !tr.isUserEvent('select'))) return tr;
          const ranges = lockedRanges(tr.newDoc);
          if (!ranges.length) return tr;
          const old = tr.startState.selection.main.head;
          let hit = false;
          const sel = tr.selection.ranges.map((r) => {
            const lock = ranges.find(([f, t]) => r.head >= f && r.head <= t);
            if (!lock) return r;
            hit = true;
            let h = r.head >= old ? lock[1] + 1 : lock[0] - 1; // past the callout, in the direction of the move
            // callout at the very start or end: a cursor stays put, a selection (Ctrl+A) still reaches the edge
            if (h < 0 || h > tr.newDoc.length) h = r.empty ? old : Math.max(0, Math.min(h, tr.newDoc.length));
            return cmState.EditorSelection.range(r.empty ? h : r.anchor, h);
          });
          return hit ? [tr, { selection: cmState.EditorSelection.create(sel, tr.selection.mainIndex), sequential: true }] : tr;
        }),
      );
      this.registerMarkdownPostProcessor((el, ctx) => {
        for (const c of el.matches('.callout') ? [el] : el.querySelectorAll('.callout')) this.addLock(c, ctx);
        for (const m of el.querySelectorAll('.math-block')) this.addMathLock(m, ctx, el);
      });
      // Live Preview draws math as widgets without post-processing; give each a lock as it appears
      if (cmView) this.registerEditorExtension(cmView.EditorView.updateListener.of((u) => u.view.contentDOM.querySelectorAll('.math-block').forEach((m) => this.addMathLock(m, null, null, u.view))));
      this.addCommand({
        id: 'toggle-callout-lock',
        name: 'Lock / unlock the callout or math block under the cursor',
        editorCallback: (ed) => {
          const doc = ed.cm.state.doc;
          const cur = ed.getCursor().line;
          let n = cur + 1;
          while (n > 1 && !CALLOUT_HEAD_RE.test(doc.line(n).text) && /^\s*>/.test(doc.line(n - 1).text)) n--;
          if (CALLOUT_HEAD_RE.test(doc.line(n).text)) return void this.lockLine(ed.cm, doc.line(n));
          // a locked block can't hold the cursor, so the line just above or below it counts too
          const blk = mathBlocks(doc.toString().split('\n')).find(([a, b]) => cur >= a - 1 && cur <= b + 1);
          if (!blk || !this.lockLine(ed.cm, doc.line(blk[0] + 1))) new Notice('The cursor is not in a callout or math block');
        },
      });
    }
    this.registerMarkdownPostProcessor((el) => {
      for (const t of el.querySelectorAll('table')) if (t.textContent.includes('<')) mergeTable(t);
    });
    this.addCommand({
      id: 'table-title-row',
      name: 'Table: add a title row',
      editorCallback: (ed) => {
        let a = ed.getCursor().line;
        if (!ed.getLine(a).trim().startsWith('|')) return new Notice('Put the cursor in a table first');
        while (a > 0 && ed.getLine(a - 1).trim().startsWith('|')) a--;
        const cols = ed.getLine(a).trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).length;
        // after the header and the --- row: the first body row, shown above the header as one wide title
        ed.replaceRange(`| Title |${' < |'.repeat(cols - 1)}\n`, { line: a + 2, ch: 0 });
        ed.setSelection({ line: a + 2, ch: 2 }, { line: a + 2, ch: 7 });
      },
    });
    this.addCommand({
      id: 'table-merge-left',
      name: 'Table: merge cell with the one on its left (again to split)',
      editorCallback: (ed) => {
        const c = ed.getCursor();
        const next = toggleMergeCell(ed.getLine(c.line), c.ch);
        if (next == null) return new Notice('Put the cursor in a table cell that has a cell on its left');
        ed.setLine(c.line, next);
      },
    });
    this.addCommand({ id: 'insert-divider', name: 'Insert divider', editorCallback: (ed) => insertDivider(ed) });
    this.addCommand({ id: 'make-subtitle', name: 'Make sub-title (toggle)', editorCallback: (ed) => toggleSubtitle(ed) });
    this.addCommand({ id: 'insert-page-break', name: 'Insert page break (PDF)', editorCallback: (ed) => insertPageBreak(ed) });
    // --- typed under a line of text stays a divider
    this.registerDomEvent(document, 'keyup', (e) => {
      if (e.key !== 'Enter' || !this.settings.limeDividers || NEON_GUARD.readOnly) return; // fork: no automatic edits while read-only
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (v && v.getMode() === 'source' && v.editor.hasFocus()) keepDivider(v.editor);
    });
    this.applyLook();
    this.addSettingTab(new NeonWriteSettingTab(this.app, this));
  }
  onunload() {
    if (this.picker) this.picker.close(); // its document listeners go with it
    this.unmountNotePattern();
    document.body.removeClass('nw-lifted', 'nw-fonts', 'nw-tables', 'nw-hr');
  }
  /** A small lock at the right of a callout's title; locked = lime. */
  addLock(c, ctx) {
    const title = c.querySelector(':scope > .callout-title');
    if (!title || title.querySelector('.nw-lock')) return;
    const locked = /(^|[\s|])locked(\s|$)/.test(c.getAttribute('data-callout-metadata') || '');
    c.toggleClass('is-locked', locked);
    // Live Preview: the callout's container (with Obsidian's edit button) is marked too, once on the page
    window.requestAnimationFrame(() => {
      const host = c.parentElement;
      if (host && host.hasClass('cm-callout')) host.toggleClass('nw-locked', locked);
    });
    const b = title.createDiv('nw-lock' + (locked ? ' is-locked' : ''));
    setIcon(b, locked ? 'lock' : 'lock-open');
    b.setAttr('aria-label', locked ? 'Locked · click to unlock' : 'Click to lock this block');
    // mousedown, not click: in Live Preview a click would first open the callout's source
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const view = this.app.workspace.getLeavesOfType('markdown').map((l) => l.view).find((v) => v.contentEl.contains(c));
      if (view && view.getMode() === 'source') {
        const cm = view.editor.cm;
        this.lockLine(cm, cm.state.doc.lineAt(cm.posAtDOM(c)));
        return;
      }
      const info = ctx.getSectionInfo(c);
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!info || !(file instanceof TFile)) return;
      writeNote(this.app, file, (d) => {
        const lines = d.split('\n');
        const t = toggleLockMeta(lines[info.lineStart] || '');
        if (t != null) lines[info.lineStart] = t;
        return lines.join('\n');
      });
    });
    b.addEventListener('click', (e) => e.stopPropagation());
    // a locked callout in Live Preview: clicks on it don't open its source (links and the lock still work)
    const guard = (e) => {
      if (!c.hasClass('is-locked') || !c.closest('.cm-callout') || e.target.closest('a, .nw-lock')) return;
      if (e.type === 'mousedown') e.preventDefault();
      e.stopPropagation();
    };
    c.addEventListener('mousedown', guard);
    c.addEventListener('click', guard);
  }
  /** Lock button on a rendered math block: reading view (ctx + its section) or a Live Preview widget (cm). */
  addMathLock(m, ctx, sec, cm) {
    const info = cm ? null : ctx.getSectionInfo(sec);
    if (!cm && !info) return;
    const locked = MATH_LOCKED_RE.test(cm ? cm.state.doc.lineAt(cm.posAtDOM(m)).text : info.text.split('\n')[info.lineStart] || '');
    let b = m.querySelector(':scope > .nw-lock');
    // Live Preview keeps the drawn formula when only the "% locked" line changes, so an existing lock re-syncs
    if (b && b.hasClass('is-locked') === locked) return;
    if (!b) {
      b = m.createDiv('nw-lock');
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (cm) return void this.lockLine(cm, cm.state.doc.lineAt(cm.posAtDOM(m)));
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) return;
        writeNote(this.app, file, (d) => {
          const lines = d.split('\n');
          const t = toggleMathLock(lines[info.lineStart] || '');
          if (t != null) lines[info.lineStart] = t;
          return lines.join('\n');
        });
      });
      b.addEventListener('click', (e) => e.stopPropagation());
      // a locked formula in Live Preview: clicks on it don't open its source (issue 47, same as locked callouts)
      if (cm) {
        const guard = (e) => {
          if (!m.hasClass('is-locked') || e.target.closest('.nw-lock')) return;
          if (e.type === 'mousedown') e.preventDefault();
          e.stopPropagation();
        };
        // capture phase: Obsidian's own handler on the formula would otherwise select the block first
        m.addEventListener('mousedown', guard, true);
        m.addEventListener('click', guard, true);
      }
    }
    m.addClass('nw-math-lock');
    m.toggleClass('is-locked', locked);
    b.toggleClass('is-locked', locked);
    setIcon(b, locked ? 'lock' : 'lock-open');
    b.setAttr('aria-label', locked ? 'Locked · click to unlock' : 'Click to lock this block');
  }
  /** Toggle the lock on a callout header line in an open editor (our own edit, so the lock lets it through). */
  lockLine(cm, line) {
    const t = toggleLockMeta(line.text) ?? toggleMathLock(line.text);
    if (t == null) return false;
    if (NEON_GUARD.readOnly) return void NEON_GUARD.block('change', this.app.workspace.getActiveFile()?.path); // fork: read-only guard
    cm.dispatch({ changes: { from: line.from, to: line.to, insert: t }, annotations: lockAnno.of(true) });
    return true;
  }
  /** A blocked edit: the locks in view give a short shake. */
  shakeLocks() {
    // the callout's lock when it's drawn; while its source is shown, the line being edited flashes instead
    const els = [...document.querySelectorAll('.workspace-leaf.mod-active .nw-lock.is-locked')];
    // (CodeMirror redraws its own line elements, so the class goes on the scroller around them)
    const sc = document.querySelector('.workspace-leaf.mod-active .cm-scroller');
    for (const el of els.length ? els : sc ? [sc] : []) {
      el.removeClass('is-shake');
      void el.offsetWidth;
      el.addClass('is-shake');
      window.setTimeout(() => el.removeClass('is-shake'), 450);
    }
  }
  applyLook() {
    document.body.toggleClass('nw-lifted', this.settings.liftedWindow);
    document.body.toggleClass('nw-fonts', this.settings.themeFonts);
    document.body.toggleClass('nw-tables', this.settings.styledTables);
    document.body.toggleClass('nw-hr', this.settings.limeDividers);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  openTablePicker(editor) {
    if (this.picker) this.picker.close();
    this.picker = new TablePicker(editor, caretRect(editor));
  }


  /* pattern behind the active note --------------------------------------- */
  mountNotePattern() {
    const v = this.app.workspace.getActiveViewOfType(MarkdownView);
    const mode = v ? v.getMode() : '';
    // already on this note in this mode: nothing to do
    if (this.pat && v && this.pat.view === v && this.pat.mode === mode && this.pat.layer) return;
    this.unmountNotePattern();
    const api = deckApi(this.app);
    if (!this.settings.notePattern || !api || !api.mountPattern || !v) return;
    const host = v.contentEl;
    const scroller = host.querySelector(mode === 'preview' ? '.markdown-preview-view' : '.cm-scroller') || host;
    host.addClass('nw-pattern-host');
    // cards selector that matches nothing: the whole note gets the (dimmed) outside strength
    const layer = api.mountPattern(host, scroller, '.nw-no-cards');
    this.pat = { view: v, mode, host, layer };
    this.applyPatternOpacity();
  }
  unmountNotePattern() {
    const p = this.pat;
    this.pat = null;
    if (!p) return;
    try {
      if (p.layer) p.layer.destroy();
    } catch (e) {
      console.error(`${appName()} – Write: pattern`, e);
    }
    p.host.removeClass('nw-pattern-host', 'nd-has-pattern');
  }
  applyPatternOpacity() {
    if (this.pat) this.pat.host.style.setProperty('--nw-pattern-opacity', String(this.settings.patternOpacity / 100));
  }
}
return NeonWrite;
})();
const NEON_MODULES = [
  { id: 'neon-deck', name: 'Dashboard', old: 'Neon Deck', desc: 'Dashboard, card explorer, graph, themes', cls: NeonDeckModule },
  { id: 'neon-tasks', name: 'Tasks', old: 'Neon Tasks', desc: 'Tasks and global tasks', cls: NeonTasksModule },
  { id: 'neon-time', name: 'Time', old: 'Neon Time', desc: 'Time tracking and work day', cls: NeonTimeModule },
  { id: 'neon-tickets', name: 'Projects', old: 'Neon Tickets', desc: 'Projects tab and card: your project notes by customer and status', cls: NeonProjectsModule },
  { id: 'neon-research', name: 'Research', old: 'Neon Research', desc: 'Research tab: topic trees from your folders, notes by status, link suggestions', cls: NeonResearchModule },
  { id: 'neon-write', name: 'Write', old: 'Neon Write', desc: 'Table picker, styled tables, dividers, locked callouts, the pattern behind notes', cls: NeonWriteModule },
];
/* @src src/kernel/mother.js */
/* ---- the kernel: one plugin; each module is a child Plugin ------------------------
 * The former six plugins run unchanged as children (same command ids, view types and data).
 * Obsidian's own Plugin/Component lifecycle removes everything a child registered when it
 * stops, so a module can be switched off at runtime without leaks. NEON_MODULES is filled
 * in by the build (tools/build.mjs). */
const KERNEL_FILE = 'modules.json'; // { off: { 'neon-time': true }, readOnly: bool, baseFolder } — synced with the vault
// fork: start-up checks and safe mode are per device (this vault's local storage on this device), never synced:
// a phone and a laptop sharing .obsidian must not put each other into safe mode.
const LOCAL_KEYS = { unfinished: 'neon-work-unfinished-starts', safe: 'neon-work-safe-mode', error: 'neon-work-last-error', section: 'neon-work-settings-section', stoppedAt: 'neon-work-stopped-at', timing: 'neon-work-start-timing', step: 'neon-work-start-step' };
const UNFINISHED_LIMIT = 2; // two starts in a row that never finished (closing the app once is not a crash)

class NeonMother extends Plugin {
  async onload() {
    this.modules = new Map(); // id -> running child plugin
    this.moduleTabs = new Map(); // fork: id -> the module's settings tab, shown inside this plugin's one settings page
    neonMother = this;
    this.failed = new Map(); // id -> error message
    this.t0 = Date.now(); // fork: start-up timing, kept per device and shown in settings
    this.timing = [];
    NEON_APP.name = this.manifest.name; // fork: the UI names the plugin by its manifest name
    NEON_APP.app = this.app;
    this.state = Object.assign({ off: {}, readOnly: true }, await this.readState());
    // fork: modules get a write-guarded app; only the plugin's own folder may be written while read-only
    NEON_GUARD.allowDir = normalizePath(this.manifest.dir);
    NEON_GUARD.readOnly = this.state.readOnly !== false;
    NEON_BASE.folder = this.state.baseFolder || ''; // fork: asked on first start (see BaseFolderModal)
    this.guardedApp = guardApp(this.app);
    // fork: one shared, event-kept list of notes for every module (src/shared/note-index.js)
    neonIndex = new NoteIndex(this.app);
    this.registerEvent(this.app.metadataCache.on('changed', (f) => neonIndex && neonIndex.changed(f)));
    this.registerEvent(this.app.vault.on('delete', (f) => neonIndex && neonIndex.deleted(f)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => neonIndex && neonIndex.renamed(f, old)));
    const resolved = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(resolved);
      if (neonIndex) neonIndex.map = null; // the first full index: rebuild once from it
    });
    this.registerEvent(resolved);
    const gesture = () => (NEON_GUARD.lastGesture = Date.now());
    this.registerDomEvent(document, 'pointerdown', gesture, true);
    this.registerDomEvent(document, 'keydown', gesture, true);
    if (NEON_MOBILE.on) installLongPress(this); // fork: long press opens the row menus on phones and tablets
    // fork: count starts that never finished on this device; two in a row turn on safe mode here only
    const unfinished = Number(this.local('unfinished')) || 0;
    this.setLocal('unfinished', unfinished + 1);
    const crashed = unfinished >= UNFINISHED_LIMIT && !this.safeMode();
    if (unfinished) this.setLocal('stoppedAt', this.local('step')); // where the last unfinished start got to
    this.step('starting');
    if (crashed) this.setLocal('safe', true); // stays on (on this device) until turned off in settings
    // enabled community plugins, from the public config file (old 1.x copies must not run twice)
    try {
      this.enabled = new Set(JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/community-plugins.json`)));
    } catch (e) {
      this.enabled = new Set();
    }
    // fork: upstream Neon Deck uses the same views, commands and module ids, so the two must never run together
    if (this.manifest.id !== 'neon-deck' && this.enabled.has('neon-deck')) {
      new Notice(`${this.manifest.name}: the original Neon Deck plugin is also on. Turn one of them off in Community plugins, then reload.`, 0);
      await this.startDone(); // not a crash: no safe mode next time
      return;
    }
    await readDailyOpts(this.app);
    this.addSettingTab(new NeonModulesTab(this.app, this));
    this.addCommand({ id: 'safe-mode', name: 'Restart in safe mode (modules off)', callback: () => this.setSafe(true) });
    this.registerLinks(); // obsidian://neon-work?open=projects in notes, and "Copy a link to this tab" (links.js)
    if (this.safeMode()) {
      const err = this.local('error');
      new Notice(
        crashed
          ? `${appName()} did not finish starting twice in a row on this device, so its modules are off here (safe mode).${this.local('stoppedAt') ? ` It stopped during: ${this.local('stoppedAt')}.` : ''}${err ? ` Last error: ${err}.` : ''} Turn safe mode off in the plugin’s settings.`
          : `${appName()} safe mode on this device: modules are off. Turn it off in the plugin’s settings.`,
        0,
      );
    } else for (const m of NEON_MODULES) await this.start(m);
    // modules finish starting asynchronously: only call the start done once the workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.step('workspace ready, opening views');
      this.doneTimer = window.setTimeout(() => this.startDone(), 3000);
      // fork: first start — ask where the plugin may keep what it makes for itself
      if (this.state.baseFolder === undefined) new BaseFolderModal(this).open();
    });
  }
  /** fork: the base folder for everything the plugin makes for itself ('' = vault root). */
  async setBaseFolder(path) {
    const v = String(path || '').trim().replace(/^\/+|\/+$/g, '');
    this.state.baseFolder = v ? normalizePath(v) : '';
    NEON_BASE.folder = this.state.baseFolder;
    await this.writeState();
  }
  onunload() {
    // a normal unload (quit, reload, switched off) is not a crash, however soon after the start
    window.clearTimeout(this.doneTimer);
    this.startDone();
    if (neonMother === this) neonMother = null;
    neonIndex = null;
  }
  /** fork: the start-up step reached, kept on the device so a hang can be traced afterwards (no console on phones). */
  step(what) {
    if (this.startedUp) return; // only while starting
    this.setLocal('step', `${what} (${((Date.now() - this.t0) / 1000).toFixed(1)} s)`);
  }
  startDone() {
    this.startedUp = true;
    this.setLocal('unfinished', 0);
    this.setLocal('step', null);
    if (this.timing) this.setLocal('timing', `${this.timing.join(' · ')}${this.timing.length ? ' · ' : ''}ready after ${((Date.now() - this.t0) / 1000).toFixed(1)} s (${moment().format('D MMM HH:mm')})`);
  }
  /* fork: per-device values (Obsidian keeps them per vault on this device; not in .obsidian, so not synced) */
  local(key) {
    const k = LOCAL_KEYS[key];
    try {
      return this.app.loadLocalStorage ? this.app.loadLocalStorage(k) : null; // Obsidian's API; older ones: not remembered
    } catch (e) {
      return null;
    }
  }
  setLocal(key, value) {
    const k = LOCAL_KEYS[key];
    try {
      if (this.app.saveLocalStorage) this.app.saveLocalStorage(k, value == null ? null : value);
    } catch (e) {
      /* storage unavailable: start-up checks just don't persist */
    }
  }
  safeMode() {
    return this.local('safe') === true || this.local('safe') === 'true';
  }
  /** The last start-up error on this device, shown in settings (phones have no console). */
  noteError(where, e) {
    this.setLocal('error', `${where}: ${String((e && e.message) || e).slice(0, 300)} (${moment().format('D MMM HH:mm')})`);
  }
  /** Core API for the modules (the same object as upstream Neon Deck 1.x). */
  get api() {
    const deck = this.modules.get('neon-deck');
    return (deck && deck.api) || null;
  }
  isOn(id) {
    if (NEON_MOBILE.on && DESKTOP_ONLY_MODULES.has(id)) return false; // fork: not on phones and tablets (the saved switch is kept)
    return !this.state.off[id];
  }
  async start(m) {
    if (this.modules.has(m.id) || !this.isOn(m.id)) return;
    // the old separate plugin is still on: never run two copies
    if (m.id !== 'neon-deck' && this.enabled.has(m.id)) {
      this.failed.set(m.id, `turn off the old "${m.old}" plugin, then reload`);
      new Notice(`${m.name} is now part of ${appName()}. Turn off the old ${m.old} plugin in Community plugins, then reload.`, 0);
      return;
    }
    const dir = m.id === 'neon-deck' ? this.manifest.dir : `${this.manifest.dir}/${m.id.replace('neon-', '')}`;
    try {
      await this.adoptData(m.id, dir);
      // fork: a module is named "<plugin name> – <section>" (command palette, notices)
      const child = new m.cls(this.guardedApp, { ...this.manifest, id: m.id, name: `${this.manifest.name} – ${SECTION_LABEL[m.id] || m.name}`, dir });
      // fork: a module's settings appear as a section of this plugin's settings page, not a page of their own
      child.addSettingTab = (tab) => {
        this.moduleTabs.set(m.id, tab);
        child.register(() => this.moduleTabs.get(m.id) === tab && this.moduleTabs.delete(m.id));
      };
      const types = new Set(); // fork: its view types, to reopen tabs left as placeholders (src/kernel/views.js)
      this.hookViews(child, types);
      // a failing start stops only this module
      const load = child.onload;
      child.onload = async () => {
        const t = Date.now();
        const label = SECTION_LABEL[m.id] || m.name;
        try {
          this.step(`${label} starting`);
          await load.call(child);
          this.step(`${label} started`);
          this.app.workspace.onLayoutReady(() => this.reviveViews(types));
          this.timing.push(`${label} ${Date.now() - t} ms`);
        } catch (e) {
          console.error(`${appName()}: ${m.name} failed to start`, e);
          this.failed.set(m.id, String((e && e.message) || e));
          this.noteError(m.name, e);
          new Notice(`${appName()}: ${m.name} failed to start and was stopped. Details in the console.`);
          window.setTimeout(() => this.stop(m.id), 0);
        }
      };
      this.modules.set(m.id, child);
      this.failed.delete(m.id);
      this.addChild(child); // runs child.load() -> onload()
    } catch (e) {
      console.error(`${appName()}: ${m.name} failed to start`, e);
      this.failed.set(m.id, String((e && e.message) || e));
      this.noteError(m.name, e);
    }
  }
  stop(id) {
    const child = this.modules.get(id);
    if (!child) return;
    this.modules.delete(id);
    this.removeChild(child); // runs child.unload() -> onunload() + every register() cleanup
  }
  async setOn(id, on) {
    if (on) delete this.state.off[id];
    else this.state.off[id] = true;
    await this.writeState();
    const m = NEON_MODULES.find((x) => x.id === id);
    if (on) await this.start(m);
    else this.stop(id);
  }
  async setReadOnly(on) {
    this.state.readOnly = on;
    NEON_GUARD.readOnly = on;
    await this.writeState();
    new Notice(on ? `${appName()}: read-only on. Nothing in your vault will be changed.` : `${appName()}: read-only off. Features that write to notes now work.`);
  }
  async setSafe(on) {
    this.setLocal('safe', on ? true : null);
    if (!on) this.setLocal('unfinished', 0);
    new Notice(on ? `${appName()}: safe mode on for this device. Reload Obsidian (or the plugin) to apply.` : `${appName()}: safe mode off for this device. Reload to start the modules.`);
  }
  /** First start of a module: copy the settings of the old separate plugin (never move or delete it). */
  async adoptData(id, dir) {
    const fs = this.app.vault.adapter;
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
    if (id === 'neon-deck' || (await fs.exists(`${dir}/data.json`))) return;
    const old = normalizePath(`${this.app.vault.configDir}/plugins/${id}/data.json`);
    if (await fs.exists(old)) {
      await fs.write(`${dir}/data.json`, await fs.read(old));
    }
  }
  async readState() {
    try {
      return JSON.parse(await this.app.vault.adapter.read(`${this.manifest.dir}/${KERNEL_FILE}`));
    } catch (e) {
      return {};
    }
  }
  async writeState() {
    // fork: older versions kept starting / safe / settingsSection here, so they synced between devices
    const { starting, safe, settingsSection, ...keep } = this.state;
    void starting, void safe, void settingsSection;
    await this.app.vault.adapter.write(`${this.manifest.dir}/${KERNEL_FILE}`, JSON.stringify(keep, null, 2));
  }
}
/* @src src/kernel/views.js */
/* ---- module views after a restart (fork) -------------------------------------------------------------------
 * Switching the plugin (or a module) off and on again left its open tabs as Obsidian's placeholder for a view
 * nobody provides: titled with the internal view type (e.g. "neon-deck-cards") and a ghost icon, and Obsidian
 * saves that title. The kernel notes the view types each module registers, marks the views they build, and once a
 * module has started rebuilds any loaded tab of one of its types still showing a placeholder. Background tabs that
 * Obsidian hasn't loaded yet (deferred) load with the registered view when opened, but until then lists such as the
 * mobile open-files list show their saved title: one saved as the placeholder ("neon-deck-tickets" for Projects) is
 * loaded now, so the tab gets its real name and icon and Obsidian saves those. Other deferred tabs stay deferred. */
Object.assign(NeonMother.prototype, {
  /** Wrap a module's registerView: remember the type, mark the views it builds. */
  hookViews(child, types) {
    const register = child.registerView;
    child.registerView = (type, make) => {
      types.add(type);
      return register.call(child, type, (leaf) => {
        const view = make(leaf);
        if (view) view.neonView = true;
        return view;
      });
    };
  },
  /** Rebuild loaded tabs of these view types that still show Obsidian's placeholder, and load deferred ones saved
   * under a placeholder title. Returns how many. */
  reviveViews(types) {
    if (!types || !types.size) return 0;
    const stale = [];
    const named = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!leaf.view || leaf.view.neonView) return;
      const state = leaf.getViewState();
      if (!state || !types.has(state.type)) return;
      if (!leaf.isDeferred) return void stale.push(leaf);
      // deferred: its saved title and icon are what the tab lists show until it is opened
      const title = (leaf.view.getDisplayText && leaf.view.getDisplayText()) || '';
      const icon = (leaf.view.getIcon && leaf.view.getIcon()) || '';
      if ((!title || title === state.type || /ghost/.test(icon)) && typeof leaf.loadIfDeferred === 'function') named.push(leaf);
    });
    const fail = (leaf) => (e) => console.error(`${appName()}: could not reopen a ${leaf.getViewState().type} tab`, e);
    for (const leaf of stale) leaf.rebuildView().catch(fail(leaf));
    for (const leaf of named) Promise.resolve(leaf.loadIfDeferred()).catch(fail(leaf));
    return stale.length + named.length;
  },
});
/* @src src/kernel/links.js */
/* ---- links to the plugin's tabs (fork) ---------------------------------------------------------------------------
 * A note can link to a tab with an Obsidian URL, as a Markdown link: [Projects](obsidian://neon-work?open=projects).
 *   open: dashboard, projects, tasks, research, time, inbox, cards, graph, or planning (with &project=<note path or
 *         name>, and &mode=gantt, board, graph or list)
 * The command "Copy a link to this tab" puts such a link for the tab in front on the clipboard, ready to paste.
 * neonLinkFor / neonLinkParams are pure (tested). */

// the tabs a link can open: name → [module id, view type]
const NEON_LINK_TABS = {
  dashboard: ['neon-deck', 'neon-deck-dashboard'],
  inbox: ['neon-deck', 'neon-inbox-view'],
  cards: ['neon-deck', 'neon-deck-cards'],
  graph: ['neon-deck', 'neon-deck-graph'],
  projects: ['neon-tickets', 'neon-deck-tickets'],
  planning: ['neon-tickets', 'neon-plan'],
  tasks: ['neon-tasks', 'neon-tasks-view'],
  research: ['neon-research', 'neon-research'],
  time: ['neon-time', 'neon-time'],
};
const NEON_LINK_MODES = ['gantt', 'board', 'graph', 'list'];

/** The link to a tab (pure): view type and, for Planning, the plan's path and mode; '' for a tab no link opens. */
function neonLinkFor(type, state = {}) {
  const name = Object.keys(NEON_LINK_TABS).find((k) => NEON_LINK_TABS[k][1] === type);
  if (!name) return '';
  let url = `obsidian://neon-work?open=${name}`;
  if (name === 'planning') {
    if (!state.path) return '';
    url += `&project=${encodeURIComponent(state.path)}`;
    if (NEON_LINK_MODES.includes(state.mode) && state.mode !== 'gantt') url += `&mode=${state.mode}`;
  }
  return url;
}
/** What a link asks for (pure): { name, tab: [module, view] | null, project, mode }. */
function neonLinkParams(params) {
  const name = String((params && (params.open || params.view)) || 'dashboard').trim().toLowerCase();
  return { name, tab: NEON_LINK_TABS[name] || null, project: String((params && params.project) || '').trim(), mode: NEON_LINK_MODES.includes(params && params.mode) ? params.mode : 'gantt' };
}

Object.assign(NeonMother.prototype, {
  /** The obsidian://neon-work handler and the "Copy a link to this tab" command. */
  registerLinks() {
    this.registerObsidianProtocolHandler('neon-work', (params) => this.openFromLink(params).catch((e) => console.error(`${appName()}: link`, e)));
    this.addCommand({
      id: 'copy-tab-link',
      name: 'Copy a link to this tab',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        const url = view ? neonLinkFor(view.getViewType(), view.plan || {}) : '';
        if (!url) return false;
        if (!checking) {
          const md = `[${view.getDisplayText()}](${url})`;
          navigator.clipboard.writeText(md).then(
            () => new Notice(`Copied: ${md}`),
            () => new Notice(`Couldn't copy. The link is: ${md}`, 10000),
          );
        }
        return true;
      },
    });
  },
  /** Open the tab a link asks for. */
  async openFromLink(params) {
    const { name, tab, project, mode } = neonLinkParams(params);
    if (!tab) return void new Notice(`${appName()}: no tab called "${name}". Links can open ${Object.keys(NEON_LINK_TABS).join(', ')}.`);
    const [id, type] = tab;
    const mod = this.modules.get(id);
    if (!mod) return void new Notice(`${appName()}: ${SECTION_LABEL[id] || id} is switched off (Settings → ${appName()}).`);
    if (name !== 'planning') return void (await activateView(this.app, type, 'tab'));
    const f = project ? this.app.metadataCache.getFirstLinkpathDest(project.replace(/\.md$/i, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(project)) : null;
    const scope = f ? planScopeOf(this.app, f) || (f instanceof TFolder ? { kind: 'folder', path: f.path } : null) : null;
    if (!scope) return void new Notice(`${appName()}: no project "${project || '?'}" to plan. Use &project= with the project note's name or path.`);
    if (mod.openPlan) await mod.openPlan(scope, mode);
  },
});
/* @src src/kernel/settings-page.js */
/* ---- fork: one settings page ----------------------------------------------------
 * The plugin has a single page in Settings, with a section per module (Overview, Dashboard, Tasks,
 * Projects, Research, Time, Write). Each module's own settings tab is drawn inside its section, so
 * the modules keep their code; they no longer add pages of their own to the sidebar. */
const SECTION_LABEL = { 'neon-deck': 'Dashboard', 'neon-tasks': 'Tasks', 'neon-tickets': 'Projects', 'neon-research': 'Research', 'neon-time': 'Time', 'neon-write': 'Write' };

class NeonModulesTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // Obsidian finds a plugin's settings by the plugin's own id
    this.id = plugin.manifest.id;
    this.name = plugin.manifest.name;
  }
  display() {
    const p = this.plugin;
    const el = this.containerEl;
    el.empty();
    el.addClass('nd-settings', 'nd-settings-page');
    const sections = [['overview', 'Overview'], ...NEON_MODULES.map((m) => [m.id, SECTION_LABEL[m.id] || m.name])];
    let cur = p.local('section') || 'overview'; // fork: per device, not in the synced modules.json
    if (!sections.some(([k]) => k === cur)) cur = 'overview';
    const bar = el.createDiv('nd-pills nd-settings-sections');
    for (const [k, label] of sections) {
      const off = k !== 'overview' && !p.modules.has(k);
      const b = bar.createEl('button', { cls: 'nd-pill-btn' + (k === cur ? ' is-on' : '') + (off ? ' is-off' : ''), text: label });
      if (off) b.setAttr('aria-label', `${label} is off (switch it on in Overview)`);
      b.addEventListener('click', () => {
        p.setLocal('section', k);
        this.display();
      });
    }
    const box = el.createDiv('nd-settings-section');
    if (cur === 'overview') return this.overview(box);
    const tab = p.moduleTabs.get(cur);
    const m = NEON_MODULES.find((x) => x.id === cur);
    if (!p.modules.has(cur) || !tab) {
      box.createEl('p', { cls: 'setting-item-description', text: `${m ? m.name : cur} is off. Switch it on in Overview to see its settings.` });
      return;
    }
    // the module's own tab draws into this section (and redraws there when it calls this.display())
    tab.containerEl = box;
    try {
      tab.display();
    } catch (e) {
      console.error(`${appName()}: ${cur} settings`, e);
      box.createEl('p', { text: 'These settings could not be shown. Details in the console.' });
    }
  }
  overview(el) {
    const p = this.plugin;
    new Setting(el).setName('Protect my notes').setHeading();
    new Setting(el)
      .setName('Read-only')
      .setDesc('On: the plugin only reads your vault. It never creates, changes, moves, renames or deletes notes, folders or images; features that would write show a notice instead. Its own settings are still saved.')
      .addToggle((t) => t.setValue(p.state.readOnly !== false).onChange((v) => p.setReadOnly(v)));

    new Setting(el).setName('Base folder').setHeading();
    new Setting(el)
      .setName('Base folder')
      .setDesc('Where the plugin keeps what it makes for itself when a location is left empty: Projects (without a customer), Reviews, Time Log, the Todo note, the pin board and graph bridges. Empty: the vault root.')
      .addText((t) =>
        suggestPaths(
          p.app,
          t.setPlaceholder('e.g. 2.Resources').setValue(p.state.baseFolder || '').onChange(debounce((v) => p.setBaseFolder(v), 500, true)),
          'folder',
        ),
      );

    new Setting(el).setName('Modules').setHeading();
    for (const m of NEON_MODULES) {
      const why = p.failed.get(m.id);
      const desktopOnly = NEON_MOBILE.on && DESKTOP_ONLY_MODULES.has(m.id);
      const state = desktopOnly ? 'desktop only' : p.modules.has(m.id) ? 'running' : why ? `stopped: ${why}` : p.safeMode() ? 'off (safe mode)' : 'off';
      new Setting(el)
        .setName(SECTION_LABEL[m.id] || m.name)
        .setDesc(`${m.desc} · ${state}`)
        .addToggle((t) =>
          t
            .setValue(p.isOn(m.id))
            .setDisabled(desktopOnly)
            .onChange(async (v) => {
              await p.setOn(m.id, v);
              this.display();
            }),
        );
    }
    new Setting(el)
      .setName('Safe mode on this device')
      .setDesc('Start with every module off, on this device only. Turns on by itself if the plugin twice in a row did not finish starting here.')
      .addToggle((t) => t.setValue(p.safeMode()).onChange((v) => p.setSafe(v)));
    const stopped = p.local('stoppedAt');
    if (stopped) new Setting(el).setName('Last unfinished start on this device stopped during').setDesc(stopped).addButton((b) => b.setButtonText('Clear').onClick(() => (p.setLocal('stoppedAt', null), this.display())));
    const timing = p.local('timing');
    if (timing) new Setting(el).setName('Last start-up on this device').setDesc(timing);
    const err = p.local('error');
    if (err)
      new Setting(el)
        .setName('Last start-up error on this device')
        .setDesc(err)
        .addButton((b) => b.setButtonText('Clear').onClick(() => (p.setLocal('error', null), this.display())));
    madeWith(el, p.manifest.name);
  }
}

/** First start: where may the plugin keep what it makes for itself? */
class BaseFolderModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(`${p.manifest.name}: base folder`);
    const c = this.contentEl;
    c.createEl('p', { text: 'The plugin can keep the notes it makes for itself (projects without a customer, weekly reviews, time logs, the Todo note, the pin board) in one folder of your choice. Nothing is created until you use a feature that needs it, and every location can be changed later in the settings.' });
    const input = c.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. 2.Resources (empty: the vault root)' } });
    input.style.width = '100%';
    if (PathSuggestBase) new PathSuggest(this.app, input, 'folder');
    const row = c.createDiv('modal-button-container');
    button(row, { text: 'Use the vault root', onClick: () => this.save('') });
    button(row, { text: 'Use this folder', cls: 'mod-cta', onClick: () => this.save(input.value) });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && this.save(input.value));
    window.setTimeout(() => input.focus(), 20);
  }
  async save(v) {
    await this.plugin.setBaseFolder(v);
    this.saved = true;
    new Notice(`${appName()} base folder: ${this.plugin.state.baseFolder || 'the vault root'}`);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    // closed without choosing: ask again next start
  }
}
module.exports = NeonMother;
