'use strict';
/*
 * Neon Research — research kept apart from work: sources, concepts, topics, links, revisit, flashcards.
 * Version 1.6.4 · made by yobzz + Claude.
 *
 * Everything runs locally: no network requests, no telemetry, no eval,
 * no shell access. Files are only written when you do something that writes.
 * The shared helpers at the top are copied into every Neon plugin; keep the copies identical.
 */
/* ---- shared helpers (same copy in every Neon plugin) ---------------- */
const obsidian = require('obsidian');
const {
  Plugin, ItemView, FileView, Modal, SuggestModal, Notice, Menu, TFile, TFolder,
  PluginSettingTab, Setting, setIcon, normalizePath, moment, debounce, getAllTags,
} = obsidian;

const ND_VERSION = '1.6.4';
const CATS = ['projects', 'school', 'admin', 'operations'];
/** Old category names still read from notes and saved data. */
const CAT_ALIAS = { ops: 'operations' };
const normCat = (c) => (c == null ? c : CAT_ALIAS[String(c).toLowerCase()] || c);
const CAT_LABEL = { projects: 'Projects', school: 'School', admin: 'Admin', operations: 'Operations', other: 'Other', untracked: 'Untracked' };
const CAT_SHORT = { projects: 'Proj', school: 'School', admin: 'Admin', operations: 'Operations' };
const catColor = (c) => `var(--nd-cat-${CATS.includes(c) ? c : 'other'})`;

const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dayKey = (ts) => moment(ts).format('YYYY-MM-DD');
const prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
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
/** Insert `line` at the end of the section under the first heading matching re (or append a new section). */
function insertUnderHeading(text, re, line, newHeading) {
  const m = re.exec(text);
  if (!m) {
    const base = text.replace(/\s*$/, '');
    return (base ? base + '\n\n' : '') + (newHeading ? newHeading + '\n' : '') + line + '\n';
  }
  const after = m.index + m[0].length;
  const rest = text.slice(after);
  const next = rest.search(/\n#{1,6} /);
  const end = next === -1 ? text.length : after + next;
  const section = text.slice(after, end).replace(/\s*$/, '');
  const tail = next === -1 ? '' : '\n' + text.slice(end).replace(/^\n+/, '');
  return text.slice(0, after) + section + '\n' + line + '\n' + tail;
}
function applyTemplate(text, m, title) {
  return text
    .replace(/{{\s*date(?::([^}]+))?\s*}}/g, (_, f) => m.format(f ? f.trim() : 'YYYY-MM-DD'))
    .replace(/{{\s*time(?::([^}]+))?\s*}}/g, (_, f) => moment().format(f ? f.trim() : 'HH:mm'))
    .replace(/{{\s*title\s*}}/g, title);
}
function parseDay(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return moment(v);
  const m = moment(String(v).trim(), ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm', 'DD.MM.YYYY', 'D.M.YYYY'], true);
  return m.isValid() ? m : null;
}
const isTrue = (v) => v === true || v === 'true' || v === 'yes' || v === 1;
function fmTags(fm) {
  if (!fm) return [];
  const raw = fm.tags != null ? fm.tags : fm.tag;
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  return arr.filter(Boolean).map((t) => String(t).replace(/^#/, '').toLowerCase());
}
function isTicketCache(cache) {
  if (!cache) return false;
  const fm = cache.frontmatter;
  if (fm && /^ticket$/i.test(String(fm.type || '').trim())) return true;
  const tags = getAllTags(cache) || [];
  return tags.some((t) => /^#ticket(\/|$)/i.test(t));
}
/**
 * Time category of a note: first checked checkbox property (projects, school,
 * admin, operations; old `ops` still counts), else a short tag with the same name,
 * else Operations for tickets.
 * Returns 'untracked' for `untracked: true`, or null when nothing is set.
 */
function noteCategory(cache) {
  const fm = (cache && cache.frontmatter) || {};
  if (isTrue(fm.untracked)) return 'untracked';
  for (const c of CATS) if (isTrue(fm[c])) return c;
  for (const [old, c] of Object.entries(CAT_ALIAS)) if (isTrue(fm[old])) return c;
  if (typeof fm.category === 'string') {
    const c = normCat(fm.category.toLowerCase());
    if (CATS.includes(c)) return c;
  }
  const tags = cache ? (getAllTags(cache) || []).map((t) => normCat(t.slice(1).toLowerCase())) : [];
  for (const c of CATS) if (tags.includes(c)) return c;
  if (isTicketCache(cache)) return 'operations';
  return null;
}
function fileCategory(app, file) {
  return file instanceof TFile && file.extension === 'md' ? noteCategory(app.metadataCache.getFileCache(file)) : null;
}

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
 * Never a pinned tab.
 */
function reusableLeaf(app) {
  const ws = app.workspace;
  const recent = ws.getMostRecentLeaf(ws.rootSplit);
  if (recent && !recent.pinned) return recent;
  const cands = [];
  ws.iterateRootLeaves((l) => {
    if (!l.pinned) cands.push(l);
  });
  cands.sort((a, b) => (b.activeTime || 0) - (a.activeTime || 0));
  return cands[0] || ws.getLeaf('tab');
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
function dailyOpts(app) {
  const dn = app.internalPlugins && app.internalPlugins.getPluginById && app.internalPlugins.getPluginById('daily-notes');
  const o = (dn && dn.instance && dn.instance.options) || {};
  return { folder: (o.folder || '').trim(), format: o.format || 'YYYY-MM-DD', template: (o.template || '').trim() };
}
function dailyPath(app, m) {
  const o = dailyOpts(app);
  return normalizePath(`${o.folder ? o.folder + '/' : ''}${(m || moment()).format(o.format)}.md`);
}
function dailyFile(app, m) {
  const f = app.vault.getAbstractFileByPath(dailyPath(app, m));
  return f instanceof TFile ? f : null;
}
/** Date of a daily note, or null when the file isn't one. */
function dailyDateOf(app, file) {
  const o = dailyOpts(app);
  const folder = o.folder ? normalizePath(o.folder) : '';
  const parent = file.parent && file.parent.path !== '/' ? file.parent.path : '';
  if (folder && parent !== folder && !parent.startsWith(folder + '/')) return null;
  const m = moment(file.basename, o.format, true);
  return m.isValid() ? m : null;
}
async function ensureToday(app) {
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

/* ---- cross-plugin glue ------------------------------------------------ */
/** The Neon Deck core API, or null when the core plugin is off. */
function deckApi(app) {
  const p = app.plugins && app.plugins.getPlugin && app.plugins.getPlugin('neon-deck');
  return (p && p.api) || null;
}
function neonPlugin(app, id) {
  const p = app.plugins && app.plugins.getPlugin && app.plugins.getPlugin(id);
  return p || null;
}
/** A small "made with Claude" line for settings tabs. */
function madeWith(el, name) {
  const d = el.createDiv('nd-madewith');
  d.setText(`${name} ${ND_VERSION} · made with Claude`);
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
/* ---- end shared ------------------------------------------------------- */

/* =========================================================================
 * NEON RESEARCH — its own Research tab, separate from work.
 * Note types live in frontmatter: `research: source | concept | topic`.
 * ========================================================================= */
const { MarkdownView } = obsidian;
const VIEW_RESEARCH = 'neon-research';
const NR_DEFAULTS = {
  // everything Neon Research shows and creates lives in this folder (Sources/ and Topics/ inside it)
  root: 'Learning/Core-topics',
  countAsWork: false, // false: research notes get `untracked: true`, so they never count as work time
  revisitDays: 14,
  linkSuggest: true,
  lastOpen: {}, // path -> ms, for resurfacing
  cards: {}, // flashcard id -> { due, ivl }
};
const KINDS = ['book', 'article', 'paper', 'video', 'website', 'other'];
const READ = [['to-read', 'To read'], ['reading', 'Reading'], ['done', 'Read']];
const STATUS = [['seed', 'Seed'], ['growing', 'Growing'], ['done', 'Done']];
const TYPE_LABEL = { source: 'Source', concept: 'Concept', topic: 'Topic' };
const TYPE_ICON = { source: 'book-open', concept: 'lightbulb', topic: 'network' };
const DAY = 86400000;
const CARD_RE = /^\s*(?:[-*+]\s+)?(.+?)\s+::\s+(.+?)\s*$/;

const fmOf = (app, f) => ((f && app.metadataCache.getFileCache(f)) || {}).frontmatter || {};
/** The research type of a note inside the research folder: its `research` property, else by subfolder. */
function rtypeIn(app, f, root) {
  if (!(f instanceof TFile) || f.extension !== 'md' || !f.path.startsWith(root + '/')) return null;
  const t = String(fmOf(app, f).research || '').toLowerCase();
  if (TYPE_LABEL[t]) return t;
  const rel = f.path.slice(root.length + 1);
  if (rel.startsWith('Topics/')) return 'topic';
  if (rel.startsWith('Sources/')) return 'source';
  return 'concept'; // a plain note dropped into the folder counts as a concept
}
/** "[[Biology]]", "[[Biology|bio]]" or "Biology" -> the link text */
const linkText = (v) => String(v || '').trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const yamlStr = (v) => JSON.stringify(String(v));
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

/* ---- new research note ---------------------------------------------------- */
class NewResearchModal extends Modal {
  /** opts: { type, title, topic (TFile), onCreated(file) } */
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal', 'nr-modal');
    this.titleEl.setText('New research note');
    const c = this.contentEl;
    const field = (label, note, parent = c) => {
      const f = parent.createDiv('nr-field');
      const l = f.createDiv('nr-label');
      l.createSpan({ text: label });
      if (note) l.createSpan({ cls: 'nr-opt', text: note });
      return f;
    };
    const type = pills(field('Type'), Object.keys(TYPE_LABEL).map((k) => [k, TYPE_LABEL[k]]), this.opts.type || 'concept', () => sync(), 'nr-type');
    const title = field('Title', 'required').createEl('input', { cls: 'nd-input', attr: { type: 'text' } });
    title.value = this.opts.title || '';
    // source fields
    const src = c.createDiv('nr-group');
    const kind = pills(field('Kind', '', src), KINDS.map((k) => [k, k[0].toUpperCase() + k.slice(1)]), 'book', null, 'nr-chips');
    const row = src.createDiv('nr-row');
    const author = field('Author', 'optional', row).createEl('input', { cls: 'nd-input', attr: { type: 'text' } });
    const year = field('Year', 'optional', row).createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. 2021' } });
    const link = field('Link', 'optional', src).createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'https://…' } });
    const read = pills(field('Read', '', src), READ, 'to-read', null, 'nr-chips');
    // concept fields
    const con = c.createDiv('nr-group');
    const status = pills(field('Status', '', con), STATUS, 'seed', null, 'nr-chips');
    const sources = p.notesOfType('source').sort((a, b) => a.basename.localeCompare(b.basename));
    const srcSel = field('Source', 'optional', con).createEl('select', { cls: 'dropdown' });
    srcSel.createEl('option', { value: '', text: '—' });
    for (const s of sources) srcSel.createEl('option', { value: s.path, text: s.basename });
    // topics (concepts and sources): toggle chips of existing topics
    const topF = field('Topics', 'optional');
    const topics = p.notesOfType('topic').sort((a, b) => a.basename.localeCompare(b.basename));
    const picked = new Set(this.opts.topic ? [this.opts.topic.path] : []);
    const chips = topF.createDiv('nd-pills nr-chips');
    if (!topics.length) topF.createDiv({ cls: 'nr-hint', text: 'No topics yet — create a Topic note first, then tag notes with it.' });
    for (const t of topics) {
      const b = chips.createEl('button', { cls: 'nd-pill-btn' + (picked.has(t.path) ? ' is-on' : ''), text: t.basename, attr: { type: 'button' } });
      b.addEventListener('click', () => {
        if (picked.has(t.path)) picked.delete(t.path);
        else picked.add(t.path);
        b.toggleClass('is-on', picked.has(t.path));
      });
    }
    const sync = () => {
      const t = type.get();
      src.toggle(t === 'source');
      con.toggle(t === 'concept');
      topF.toggle(t !== 'topic');
    };
    sync();
    const foot = c.createDiv('nd-modal-row');
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const create = async () => {
      const name = title.value.trim();
      if (!name) return title.addClass('is-invalid'), title.focus();
      this.close();
      const f = await p.createNote(type.get(), {
        title: name,
        topics: topics.filter((t) => picked.has(t.path)),
        kind: kind.get(),
        author: author.value.trim(),
        year: year.value.trim(),
        link: link.value.trim(),
        read: read.get(),
        status: status.get(),
        source: sources.find((s) => s.path === srcSel.value) || null,
      });
      if (f && this.opts.onCreated) this.opts.onCreated(f);
      else if (f) openFile(this.app, f);
    };
    button(foot, { text: 'Create', cls: 'mod-cta', onClick: create });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        create();
      }
    });
    title.addEventListener('input', () => title.removeClass('is-invalid'));
    window.setTimeout(() => title.focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

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

/* ---- flashcards ------------------------------------------------------------- */
class StudyModal extends Modal {
  constructor(plugin, cards, label) {
    super(plugin.app);
    this.plugin = plugin;
    this.queue = cards.slice();
    this.label = label;
    this.done = 0;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-study');
    this.titleEl.setText(`Study · ${this.label}`);
    // keys through the modal's scope: they work wherever focus is, and space never also presses a button
    this.scope.register([], ' ', () => (this.showBtn && this.showBtn.click(), false));
    ['1', '2', '3'].forEach((k, i) => this.scope.register([], k, () => (this.answerShown && this.grade(['again', 'hard', 'easy'][i]), false)));
    this.next();
  }
  next() {
    const c = this.contentEl;
    c.empty();
    this.answerShown = false;
    this.showBtn = null;
    const card = (this.card = this.queue.shift());
    if (!card) {
      c.createDiv({ cls: 'nr-study-done', text: this.done ? `✦ Done — ${this.done} card${this.done === 1 ? '' : 's'} reviewed.` : 'Nothing due right now ✦' });
      const r = c.createDiv('nd-modal-row');
      button(r, { text: 'Close', cls: 'mod-cta', onClick: () => this.close() });
      return;
    }
    c.createDiv({ cls: 'nr-study-meta', text: `${card.file.basename} · ${this.queue.length + 1} left` });
    c.createDiv({ cls: 'nr-study-q', text: card.q });
    const a = c.createDiv({ cls: 'nr-study-a', text: card.a });
    a.hide();
    const r = c.createDiv('nd-modal-row');
    this.showBtn = button(r, {
      text: 'Show answer (space)',
      cls: 'mod-cta',
      onClick: () => {
        a.show();
        this.answerShown = true;
        r.empty();
        button(r, { text: 'Again (1)', cls: 'nr-again', onClick: () => this.grade('again') });
        button(r, { text: 'Hard (2)', onClick: () => this.grade('hard') });
        button(r, { text: 'Easy (3)', cls: 'mod-cta', onClick: () => this.grade('easy') });
        this.showBtn = null;
      },
    });
  }
  async grade(how) {
    const card = this.card;
    if (!card || this.grading) return;
    this.grading = true; // a quick double key press grades once
    this.card = null;
    await this.plugin.gradeCard(card, how);
    this.done++;
    if (how === 'again') this.queue.push(card); // seen again in this session
    this.grading = false;
    this.next();
  }
  onClose() {
    this.contentEl.empty();
    this.plugin.emitSoon();
  }
}

/* ---- the Research tab -------------------------------------------------------- */
class ResearchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.topic = null; // path of the open topic page, or null for the overview
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
  getState() {
    return { topic: this.topic };
  }
  async setState(state, result) {
    if (state && 'topic' in state) {
      const next = state.topic || null;
      // a topic change is a step Back / Forward can return to
      if (next !== this.topic && result) result.history = true;
      this.topic = next;
    }
    await super.setState(state, result);
    if (this.scroller) this.render();
  }
  async onOpen() {
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
    this.register(this.plugin.onChange(debounce(() => this.render(), 400, true)));
    // the open topic page follows its topic note when it's renamed or moved
    this.registerEvent(this.app.vault.on('rename', (f, old) => this.topic === old && ((this.topic = f.path), this.render())));
    this.first = true;
    this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  card(parent, cls, title, ic, sub) {
    const w = widget(parent, `nr-card ${cls}`, title, ic, sub);
    return w;
  }
  go(topicPath) {
    // through the leaf so Back / Forward step between the overview and topic pages
    this.leaf.setViewState({ type: VIEW_RESEARCH, state: { topic: topicPath }, active: true });
  }
  render() {
    const sc = this.scroller;
    if (!sc) return;
    const top = sc.scrollTop;
    sc.empty();
    const root = sc.createDiv('nr-inner' + (this.first ? ' is-entering' : ''));
    if (this.first) {
      this.first = false;
      window.setTimeout(() => root.removeClass('is-entering'), 900);
    }
    const t = this.topic && this.app.vault.getAbstractFileByPath(this.topic);
    if (t instanceof TFile) this.renderTopic(root, t);
    else this.renderOverview(root);
    sc.scrollTop = top;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  hero(root, title, sub, back) {
    const p = this.plugin;
    const h = root.createDiv('nd-hero nr-hero');
    const l = h.createDiv('nr-hero-l');
    if (back) button(l, { icon: 'arrow-left', cls: 'nd-icon-btn', title: 'All topics', onClick: () => this.go(null) });
    l.createDiv({ cls: 'nd-hero-greet', text: 'Research' });
    l.createDiv({ cls: 'nd-hero-date nr-hero-title', text: title });
    if (sub) l.createDiv({ cls: 'nr-hero-sub', text: sub });
    const acts = h.createDiv('nr-acts');
    return { h, acts };
  }
  renderOverview(root) {
    const p = this.plugin;
    const topics = p.topicStats();
    const due = p.dueCards(p.allCards());
    const { acts } = this.hero(root, p.root.split('/').pop(), [[topics.length, 'topic'], [p.notesOfType('concept').length, 'concept'], [p.notesOfType('source').length, 'source']].map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`).join(' · '));
    button(acts, { icon: 'graduation-cap', text: due.length ? `Study (${due.length})` : 'Study', cls: due.length ? 'mod-cta' : '', onClick: () => p.study(p.allCards(), 'all topics') });
    for (const k of ['concept', 'source', 'topic']) button(acts, { icon: TYPE_ICON[k], text: `New ${TYPE_LABEL[k].toLowerCase()}`, onClick: () => new NewResearchModal(p, { type: k }).open() });

    // topics
    const tc = this.card(root, 'nr-topics', 'Topics', 'network', 'click a topic to open it');
    if (!topics.length) emptyState(tc.body, `No topics yet. A topic is a hub note (e.g. “Biology”) in ${p.root}/Topics; concepts and sources join it.`);
    const grid = tc.body.createDiv('nr-topic-grid');
    topics.forEach((s, i) => {
      const tile = grid.createDiv('nr-topic');
      tile.style.setProperty('--i', String(i));
      tile.createDiv({ cls: 'nr-topic-name', text: s.file.basename });
      const m = tile.createDiv('nr-topic-meta');
      m.createSpan({ text: `${s.notes.length} note${s.notes.length === 1 ? '' : 's'}` });
      if (s.seeds) m.createSpan({ cls: 'nr-seed', text: `${s.seeds} seed${s.seeds === 1 ? '' : 's'}` });
      if (s.cardsDue) m.createSpan({ cls: 'nr-due', text: `${s.cardsDue} due` });
      tile.createDiv({ cls: 'nr-topic-when', text: s.touched ? `touched ${moment(s.touched).fromNow()}` : 'not touched yet' });
      tile.addEventListener('click', () => this.go(s.file.path));
    });

    const row = root.createDiv('nr-row2');
    // revisit
    const rv = this.card(row, 'nr-revisit', 'Revisit', 'rotate-ccw', `not opened for ${p.settings.revisitDays}+ days`);
    const rlist = p.revisitList().slice(0, 8);
    if (!rlist.length) emptyState(rv.body, 'Nothing to revisit — every research note was opened recently.');
    for (const f of rlist) this.noteRow(rv.body, f);
    // sources
    const so = this.card(row, 'nr-sources', 'Sources', 'book-open', 'newest first');
    const srcs = p.notesOfType('source').sort((a, b) => b.stat.ctime - a.stat.ctime).slice(0, 8);
    if (!srcs.length) emptyState(so.body, 'No sources yet — books, articles, videos and papers you learn from.');
    for (const f of srcs) this.noteRow(so.body, f);
    madeWith(root.createDiv('nr-foot'), 'Neon Research');
  }
  renderTopic(root, t) {
    const p = this.plugin;
    const s = p.topicStats().find((x) => x.file === t) || { notes: [], seeds: 0 };
    const cards = p.cardsIn([t, ...s.notes]);
    const due = p.dueCards(cards);
    const { acts } = this.hero(root, t.basename, `${s.notes.length} note${s.notes.length === 1 ? '' : 's'} · ${s.seeds} seed${s.seeds === 1 ? '' : 's'} · ${cards.length} flashcard${cards.length === 1 ? '' : 's'}`, true);
    button(acts, { icon: 'graduation-cap', text: due.length ? `Study (${due.length})` : 'Study', cls: due.length ? 'mod-cta' : '', onClick: () => p.study(cards, t.basename) });
    button(acts, { icon: 'lightbulb', text: 'New concept', onClick: () => new NewResearchModal(p, { type: 'concept', topic: t }).open() });
    button(acts, { icon: 'book-open', text: 'New source', onClick: () => new NewResearchModal(p, { type: 'source', topic: t }).open() });
    button(acts, { icon: 'file-text', text: 'Hub note', onClick: () => openFile(this.app, t) });

    const nc = this.card(root, 'nr-notes', 'In this topic', TYPE_ICON.topic, 'tagged with it, linking to it, or linked from its hub note');
    if (!s.notes.length) emptyState(nc.body, 'No notes in this topic yet — use New concept / New source above.');
    for (const f of s.notes.sort((a, b) => b.stat.mtime - a.stat.mtime)) this.noteRow(nc.body, f);
    // mentions: read on demand (it scans note text)
    const mc = this.card(root, 'nr-mentions', 'Mentions', 'at-sign', `research notes that mention “${t.basename}” without linking it`);
    const box = mc.body.createDiv();
    box.createDiv({ cls: 'nr-hint', text: 'Looking…' });
    p.mentionsOf(t, new Set(s.notes)).then((list) => {
      if (!box.isConnected) return;
      box.empty();
      if (!list.length) return emptyState(box, 'No unlinked mentions.');
      for (const f of list) {
        const r = this.noteRow(box, f);
        button(r, {
          icon: 'link',
          text: 'Link',
          cls: 'nr-row-act',
          onClick: async (e) => {
            e.stopPropagation();
            await p.linkMention(f, t);
            r.remove();
          },
        });
      }
    });
  }
  noteRow(parent, f) {
    const p = this.plugin;
    const fm = fmOf(this.app, f);
    const type = p.typeOf(f);
    const r = parent.createDiv('nr-note');
    icon(r, TYPE_ICON[type] || 'file-text', 'nd-ico nr-note-ico');
    const m = r.createDiv('nr-note-main');
    m.createDiv({ cls: 'nr-note-title', text: f.basename });
    const meta = [];
    if (type) meta.push(TYPE_LABEL[type]);
    if (type === 'source') {
      if (fm.kind) meta.push(String(fm.kind));
      if (fm.author) meta.push(String(fm.author));
      if (fm.year) meta.push(String(fm.year));
    }
    meta.push(`edited ${moment(f.stat.mtime).fromNow()}`);
    m.createDiv({ cls: 'nr-note-meta', text: meta.join(' · ') });
    const pill = type === 'source' ? READ.find(([k]) => k === fm.read) : STATUS.find(([k]) => k === fm.status);
    if (pill) r.createSpan({ cls: `nr-pill is-${pill[0]}`, text: pill[1] });
    r.addEventListener('click', (e) => openFile(this.app, f, e));
    return r;
  }
}

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
      .setName('Research folder')
      .setDesc('The Research tab only shows notes in this folder. New sources go in Sources/, topics in Topics/, concepts in the folder itself.')
      .addText((t) => t.setValue(s.root).onChange((v) => ((s.root = normalizePath(v.trim() || NR_DEFAULTS.root)), save(), p.emitSoon(), p.updateLinkHint())));
    new Setting(containerEl).setName('Behaviour').setHeading();
    new Setting(containerEl)
      .setName('Count research as work time')
      .setDesc('Off: new research notes get “untracked: true”, so Neon Time never counts them as work.')
      .addToggle((t) => t.setValue(s.countAsWork).onChange((v) => ((s.countAsWork = v), save())));
    numSetting(new Setting(containerEl).setName('Revisit after (days)').setDesc('Research notes you haven’t opened for this long show in Revisit.'), s, 'revisitDays', 1, 365, () => (save(), p.emitSoon()));
    new Setting(containerEl)
      .setName('Link suggestions')
      .setDesc('In research notes, the status bar offers to link mentions of other research note titles.')
      .addToggle((t) => t.setValue(s.linkSuggest).onChange((v) => ((s.linkSuggest = v), save(), p.updateLinkHint())));
    madeWith(containerEl, 'Neon Research');
  }
}

/* ---- plugin ------------------------------------------------------------------ */
module.exports = class NeonResearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, NR_DEFAULTS, (await this.loadData()) || {});
    if (!this.settings.lastOpen || typeof this.settings.lastOpen !== 'object') this.settings.lastOpen = {};
    if (!this.settings.cards || typeof this.settings.cards !== 'object') this.settings.cards = {};
    this.listeners = new Set();
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.addRibbonIcon('library', 'Research', () => this.openTab());
    this.addCommand({ id: 'open-research', name: 'Open the Research tab', callback: () => this.openTab() });
    for (const k of Object.keys(TYPE_LABEL)) this.addCommand({ id: `new-${k}`, name: `New ${TYPE_LABEL[k].toLowerCase()}`, callback: () => new NewResearchModal(this, { type: k }).open() });
    this.addCommand({ id: 'study-all', name: 'Study flashcards (all topics)', callback: () => this.study(this.allCards(), 'all topics') });
    this.addCommand({ id: 'link-suggestions', name: 'Suggest links in this note', callback: () => this.showLinkSuggestions(true) });
    this.addSettingTab(new NeonResearchSettingTab(this.app, this));

    // status bar: "N possible links" for the open research note
    this.linkEl = this.addStatusBarItem();
    this.linkEl.addClass('nd-status', 'nr-status', 'mod-clickable');
    this.linkEl.addEventListener('click', () => this.showLinkSuggestions(true));
    this.linkEl.hide();
    const hint = debounce(() => this.updateLinkHint(), 800, true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hint));
    // keep the flashcard text cache current (the event hands over the note's text)
    this.cardText = new Map();
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, data) => {
        if (!this.typeOf(f)) {
          if (this.cardText.delete(f.path)) this.emitSoon(); // no longer a research note
          return;
        }
        this.cardText.set(f.path, data);
        hint();
        this.emitSoon();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        this.cardText.delete(f.path);
        // forget its revisit time and flashcard history
        if (this.settings.lastOpen[f.path] != null) delete this.settings.lastOpen[f.path];
        for (const id of Object.keys(this.settings.cards)) if (id.startsWith(f.path + '|')) delete this.settings.cards[id];
        this.saveSoon();
        this.emitSoon();
      }),
    );
    this.registerEvent(this.app.vault.on('rename', (f, old) => this.onRename(f, old)));
    // resurfacing: remember when research notes are opened
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (f && this.typeOf(f)) {
          this.settings.lastOpen[f.path] = Date.now();
          this.saveSoon();
        }
      }),
    );
    // Research in the sidebar nav (Neon Deck) and /source /concept /topic in Neon Write's slash menu
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookDeck()));
    this.registerEvent(this.app.workspace.on('neon-write:ready', () => this.hookWrite()));
    this.app.workspace.onLayoutReady(async () => {
      this.hookDeck();
      this.hookWrite();
      this.updateLinkHint();
      await this.refreshCardText();
      this.emitSoon();
    });
  }
  onunload() {
    const api = deckApi(this.app);
    if (api) api.unregisterAction('research');
    const w = neonPlugin(this.app, 'neon-write');
    if (w && w.removeSlashItem) for (const k of Object.keys(TYPE_LABEL)) w.removeSlashItem(`research-${k}`);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._save) this._save = debounce(() => this.saveData(this.settings), 2000, true);
    this._save();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit) this._emit = debounce(() => this.listeners.forEach((fn) => fn()), 300, true);
    this._emit();
  }
  hookDeck() {
    const api = deckApi(this.app);
    if (api) api.registerAction({ id: 'research', icon: 'library', label: 'Research', order: 45, view: VIEW_RESEARCH, run: () => this.openTab() });
  }
  hookWrite() {
    const w = neonPlugin(this.app, 'neon-write');
    if (!w || !w.addSlashItem) return;
    for (const k of Object.keys(TYPE_LABEL)) {
      w.addSlashItem({
        id: `research-${k}`,
        icon: TYPE_ICON[k],
        label: `${TYPE_LABEL[k]} (research)`,
        hint: 'new note + link',
        keys: [k, 'research'],
        // create the note, then put a link to it where the / was
        run: (ed) => new NewResearchModal(this, { type: k, onCreated: (f) => ed.replaceSelection(`[[${f.basename}]]`) }).open(),
      });
    }
  }
  openTab() {
    return activateView(this.app, VIEW_RESEARCH, 'tab');
  }

  /* ---- notes ---- */
  get root() {
    return normalizePath(this.settings.root || NR_DEFAULTS.root);
  }
  typeOf(f) {
    return rtypeIn(this.app, f, this.root);
  }
  folderFor(type) {
    return type === 'source' ? `${this.root}/Sources` : type === 'topic' ? `${this.root}/Topics` : this.root;
  }
  notesOfType(type) {
    return this.app.vault.getMarkdownFiles().filter((f) => this.typeOf(f) === type);
  }
  researchNotes() {
    return this.app.vault.getMarkdownFiles().filter((f) => this.typeOf(f));
  }
  /** topics listed in a note's `topics` property, as files */
  topicsOf(f) {
    return asList(fmOf(this.app, f).topics)
      .map((v) => this.app.metadataCache.getFirstLinkpathDest(linkText(v), f.path))
      .filter((x) => x instanceof TFile);
  }
  /** Each topic with its notes: tagged with it (topics property), linking to it, or linked from its hub note. */
  topicStats() {
    const topics = this.notesOfType('topic');
    const links = this.app.metadataCache.resolvedLinks;
    const notes = this.researchNotes().filter((f) => this.typeOf(f) !== 'topic');
    const tagged = new Map(notes.map((f) => [f, this.topicsOf(f)])); // each note's topics property, read once
    return topics
      .map((t) => {
        const out = new Set();
        for (const f of notes) {
          if (tagged.get(f).includes(t) || (links[f.path] && links[f.path][t.path]) || (links[t.path] && links[t.path][f.path])) out.add(f);
        }
        const list = [...out];
        const touched = Math.max(t.stat.mtime, ...list.map((f) => f.stat.mtime));
        return { file: t, notes: list, seeds: list.filter((f) => this.typeOf(f) === 'concept' && (fmOf(this.app, f).status || 'seed') === 'seed').length, touched, cardsDue: this.dueCards(this.cardsInSync([t, ...list])).length };
      })
      .sort((a, b) => b.touched - a.touched);
  }
  /** Notes (anywhere) whose text mentions the topic name without linking to it. */
  async mentionsOf(t, skip) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(t.basename)}(?=$|[^\\p{L}\\p{N}])`, 'iu');
    const out = [];
    for (const f of this.researchNotes()) {
      if (f === t || skip.has(f)) continue;
      const text = await this.app.vault.cachedRead(f);
      if (re.test(plainMask(text))) out.push(f);
    }
    return out;
  }
  async createNote(type, o) {
    const folder = this.folderFor(type);
    const fm = ['---', `research: ${type}`];
    if (!this.settings.countAsWork) fm.push('untracked: true');
    if (type !== 'topic' && o.topics && o.topics.length) {
      fm.push('topics:');
      for (const t of o.topics) fm.push(`  - ${yamlStr(`[[${t.basename}]]`)}`);
    }
    if (type === 'source') {
      fm.push(`kind: ${o.kind || 'other'}`);
      if (o.author) fm.push(`author: ${yamlStr(o.author)}`);
      if (o.year) fm.push(`year: ${yamlStr(o.year)}`);
      if (o.link) fm.push(`link: ${yamlStr(o.link)}`);
      fm.push(`read: ${o.read || 'to-read'}`);
    }
    if (type === 'concept') {
      fm.push(`status: ${o.status || 'seed'}`);
      if (o.source) fm.push(`source: ${yamlStr(`[[${o.source.basename}]]`)}`);
    }
    fm.push(`created: ${moment().format('YYYY-MM-DD')}`, '---', '');
    const body = {
      source: ['## Summary', '', '## Notes', '', '## Quotes', ''],
      concept: ['## Idea', '', '## Why it matters', '', '## Flashcards', '%% Lines like “Question :: Answer” become flashcards. %%', ''],
      topic: ['## Summary', '', '## Key ideas', '', '## Open questions', ''],
    }[type];
    if (type === 'concept' && o.source) body.unshift(`Source: [[${o.source.basename}]]`, '');
    try {
      const f = await createUnique(this.app, folder, o.title, fm.join('\n') + body.join('\n'));
      this.settings.lastOpen[f.path] = Date.now();
      this.saveSoon();
      this.emitSoon();
      return f;
    } catch (e) {
      console.error('Neon Research: could not create note', e);
      new Notice('Could not create the note — see console');
      return null;
    }
  }
  onRename(f, old) {
    if (this.cardText.has(old)) (this.cardText.set(f.path, this.cardText.get(old)), this.cardText.delete(old));
    const lo = this.settings.lastOpen;
    if (lo[old] != null) ((lo[f.path] = lo[old]), delete lo[old]);
    const cards = this.settings.cards;
    for (const id of Object.keys(cards)) if (id.startsWith(old + '|')) ((cards[f.path + id.slice(old.length)] = cards[id]), delete cards[id]);
    this.saveSoon();
    this.emitSoon();
  }

  /* ---- resurfacing ---- */
  revisitList() {
    const cut = Date.now() - this.settings.revisitDays * DAY;
    return this.researchNotes()
      .map((f) => ({ f, at: this.settings.lastOpen[f.path] || f.stat.ctime }))
      .filter((x) => x.at < cut)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.f);
  }

  /* ---- link suggestions ---- */
  /** Mentions of other research note titles in a note, not yet linked. */
  async linkHits(file) {
    const text = await this.app.vault.cachedRead(file);
    const mask = plainMask(text);
    const linked = this.app.metadataCache.resolvedLinks[file.path] || {};
    const hits = [];
    for (const t of this.researchNotes()) {
      if (t === file || linked[t.path] || t.basename.length < 4) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escRe(t.basename)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
      const m = re.exec(mask);
      if (!m) continue;
      const at = m.index + m[1].length;
      const match = text.slice(at, at + t.basename.length);
      hits.push({ target: t, at, match, before: text.slice(Math.max(0, at - 40), at).replace(/\s+/g, ' '), after: text.slice(at + match.length, at + match.length + 40).replace(/\s+/g, ' ') });
    }
    return hits;
  }
  async updateLinkHint() {
    const el = this.linkEl;
    if (!el) return;
    const f = this.app.workspace.getActiveFile();
    if (!this.settings.linkSuggest || !f || !this.typeOf(f)) return el.hide();
    const hits = await this.linkHits(f);
    if (this.app.workspace.getActiveFile() !== f) return;
    el.empty();
    if (!hits.length) return el.hide();
    setIcon(el.createSpan('nd-status-icon'), 'link');
    el.createSpan({ cls: 'nd-status-text', text: `${hits.length} possible link${hits.length === 1 ? '' : 's'}` });
    tip(el, 'Mentions of other research notes that aren’t linked yet — click to review');
    el.show();
  }
  async showLinkSuggestions(fromUser) {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const hits = await this.linkHits(f);
    if (!hits.length) return fromUser && new Notice('No unlinked mentions of research notes here.');
    new LinkSuggestModal(this, f, hits).open();
  }
  /** Turn the first plain mention of target in file into a link (keeping the text as written). */
  async linkMention(file, target) {
    await this.app.vault.process(file, (text) => {
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
  }

  /* ---- flashcards ---- */
  parseCards(f, text) {
    const out = [];
    let fence = false;
    for (const line of stripFrontmatter(text).split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence || /^\s*%%/.test(line)) continue;
      // a "::" inside inline code doesn't make a card
      if (!/\s::\s/.test(line.replace(/`[^`]*`/g, (c) => ' '.repeat(c.length)))) continue;
      const m = line.match(CARD_RE);
      if (m && !/^#/.test(m[1])) out.push({ file: f, q: m[1].trim(), a: m[2].trim(), id: `${f.path}|${m[1].trim()}` });
    }
    return out;
  }
  /** Cards from notes, using the cached text (fast; fine for counts). */
  cardsInSync(files) {
    const out = [];
    for (const f of files) {
      const text = this.cardText && this.cardText.get(f.path);
      if (text != null) out.push(...this.parseCards(f, text));
    }
    return out;
  }
  async refreshCardText() {
    for (const f of this.researchNotes()) this.cardText.set(f.path, await this.app.vault.cachedRead(f));
  }
  cardsIn(files) {
    return this.cardsInSync(files);
  }
  allCards() {
    return this.cardsInSync(this.researchNotes());
  }
  dueCards(cards) {
    const now = Date.now();
    return cards.filter((c) => {
      const s = this.settings.cards[c.id];
      return !s || s.due <= now;
    });
  }
  async study(cards, label) {
    await this.refreshCardText();
    const fresh = this.cardsInSync([...new Set(cards.map((c) => c.file))]);
    const due = this.dueCards(fresh.length ? fresh : cards);
    new StudyModal(this, due, label).open();
  }
  async gradeCard(card, how) {
    const cur = this.settings.cards[card.id] || { ivl: 0 };
    let ivl = cur.ivl || 0;
    let due;
    if (how === 'again') {
      ivl = 0;
      due = Date.now() + 10 * 60000;
    } else if (how === 'hard') {
      ivl = Math.max(1, Math.round(ivl * 1.2));
      due = Date.now() + ivl * DAY;
    } else {
      ivl = ivl ? Math.round(ivl * 2.5) : 3;
      due = Date.now() + ivl * DAY;
    }
    this.settings.cards[card.id] = { ivl, due };
    await this.saveSettings();
  }
};
