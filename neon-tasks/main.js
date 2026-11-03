'use strict';
/*
 * Neon Tasks — tasks from tagged notes and your daily note, Global tasks, New note card, Fix properties.
 * Version 1.6.1 · made by yobzz + Claude.
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

const ND_VERSION = '1.6.1';
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

/* ------------------------------------------------------------------ */
/* Neon Tasks                                                          */
/* ------------------------------------------------------------------ */

const TASKS_DEFAULTS = {
  quickTasksPath: 'Core/Quick tasks.md',
  backupPath: 'Core/Neon/Global tasks backup.md',
  askOnCreate: true,
  stampDone: true,
  carryDays: 14,
  showNoCategoryBar: true,
  installedAt: 0,
  globalTasks: [],
  doneLog: [],
  lastBackup: '',
};
const SYSTEM_FOLDERS = ['Time Log', 'Neon', 'Templates', 'Core/Time Log', 'Core/Neon', 'Core/Templates'];
const PROP_ORDER = [
  'type', 'title', 'ticket', 'status', 'priority', 'tags', 'aliases',
  'projects', 'school', 'admin', 'operations', 'untracked',
  'created', 'due', 'remind', 'completed', 'waiting_on', 'follow_up', 'waiting_since', 'jira', 'cover',
];
const TASK_LINE_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.*)$/;

/** Clean display text of a task line (Tasks-plugin emoji stripped). */
function taskDisplay(raw) {
  return excerptOf(
    raw
      .replace(/(?:📅|⏳|🛫|✅|➕)\s*\d{4}-\d{2}-\d{2}/gu, '')
      .replace(/🔁[^📅⏳🛫✅➕]*/gu, '')
      .replace(/[⏫🔼🔽🔺⏬]/gu, ''),
    140,
  );
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
    if (this.plugin.ticketService()) kinds.push(['ticket', 'Ticket']);
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
      folderField.toggle(!t);
      note.setText(t ? 'Opens the New ticket form with this name as the title.' : 'You can close this and just type — the note keeps a small “No category yet” reminder.');
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
    if (!file) await reusableLeaf(this.app).openFile(target, { active: true, state: { mode: 'source' } });
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
    new Setting(containerEl).setName('Tasks widget').setHeading();
    new Setting(containerEl)
      .setDesc('Shows open tasks from notes with “tasks” in their tags property, today’s daily note and the quick-add note. Ticket notes are always skipped.');
    new Setting(containerEl)
      .setName('Quick tasks note')
      .setDesc('Where the quick-add box writes. Items stay until you tick them.')
      .addText((t) => t.setValue(s.quickTasksPath).onChange((v) => ((s.quickTasksPath = v.trim() || 'Core/Quick tasks.md'), save())));
    numSetting(new Setting(containerEl).setName('Carry over unfinished daily tasks (days)').setDesc('Open tasks from earlier daily notes show under Today. 0 = only today’s note.'), s, 'carryDays', 0, 90, save);
    new Setting(containerEl)
      .setName('Stamp completion date')
      .setDesc('Adds ✅ YYYY-MM-DD when you tick a task on the dashboard (Tasks-plugin compatible).')
      .addToggle((t) => t.setValue(s.stampDone).onChange((v) => ((s.stampDone = v), save())));
    new Setting(containerEl).setName('Global tasks').setHeading();
    new Setting(containerEl)
      .setName('Backup note')
      .setDesc('Global tasks live in plugin data. A read-only copy is written here daily and when they change.')
      .addText((t) => t.setValue(s.backupPath).onChange((v) => ((s.backupPath = v.trim() || TASKS_DEFAULTS.backupPath), save())))
      .addExtraButton((b) => b.setIcon('save').setTooltip('Back up now').onClick(() => p.writeBackup(true)));
    new Setting(containerEl).setName('New notes').setHeading();
    new Setting(containerEl)
      .setName('Ask a few questions when I create a note')
      .setDesc('Name, kind and category. Close the card to skip it.')
      .addToggle((t) => t.setValue(s.askOnCreate).onChange((v) => ((s.askOnCreate = v), save())));
    new Setting(containerEl)
      .setName('“No category yet” reminder')
      .setDesc('A small bar on new notes without a category. Only notes created since Neon Tasks was installed.')
      .addToggle((t) => t.setValue(s.showNoCategoryBar).onChange((v) => ((s.showNoCategoryBar = v), save(), p.updateBar())));
    madeWith(containerEl, 'Neon Tasks');
  }
}

module.exports = class NeonTasks extends Plugin {
  async onload() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, TASKS_DEFAULTS, raw || {});
    const s = this.settings;
    if (!Array.isArray(s.globalTasks)) s.globalTasks = [];
    if (!Array.isArray(s.doneLog)) s.doneLog = [];
    if (!s.installedAt) s.installedAt = Date.now();
    this.freshData = !raw;
    await this.saveSettings();
    this.selfCreated = new Set();
    this.listeners = new Set();

    this.addCommand({ id: 'new-note', name: 'New note', callback: () => this.newNote(this.currentFolder()) });
    this.addCommand({
      id: 'fix-properties',
      name: 'Fix properties of current note',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== 'md') return false;
        if (!checking) this.fixProps(f).then((ch) => new Notice(ch ? '✦ Properties fixed' : 'Properties already tidy'));
        return true;
      },
    });
    this.addCommand({ id: 'fix-properties-folder', name: 'Fix properties in a folder…', callback: () => this.pickFolderToFix() });
    this.addCommand({ id: 'add-global-task', name: 'Add a Global task', callback: () => new PromptModal(this.app, { title: 'Global task', placeholder: 'Important · not tied to notes', cta: 'Add', onSubmit: (v) => this.addGlobal(v) }).open() });
    this.addCommand({ id: 'uncategorised', name: 'Show new notes without a category', callback: () => new UncategorisedModal(this, this.uncategorised()).open() });
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) menu.addItem((i) => i.setTitle('Fix properties in folder').setIcon('wand-2').onClick(() => this.fixFolder(file)));
        else if (file instanceof TFile && file.extension === 'md') menu.addItem((i) => i.setTitle('Fix properties').setIcon('wand-2').onClick(() => this.fixProps(file).then((ch) => new Notice(ch ? '✦ Properties fixed' : 'Properties already tidy'))));
      }),
    );
    this.addSettingTab(new NeonTasksSettingTab(this.app, this));
    this.buildStatus();

    const changed = debounce(() => this.emit(), 700, true);
    // Only notes that feed the Tasks widget trigger a refresh.
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, _d, cache) => {
        if (!this.sourcePaths || this.sourcePaths.has(f.path) || this.isTaskSource(f, cache) || f.path === this.quickPath() || dailyDateOf(this.app, f)) changed();
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
      this.maybeRestore();
      // after Obsidian has read every note's properties
      window.setTimeout(() => this.migrateCategories(), 5000);
      this.dailyBackup();
      this.registerInterval(window.setInterval(() => this.dailyBackup(), 60 * 60 * 1000));
    });
  }
  onunload() {
    this.writeBackup();
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tasks');
      api.unregisterWidget('global');
      api.unregisterCapture('task');
      api.unregisterCapture('global');
      api.unregisterFacts('tasks');
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
  currentFolder() {
    const f = this.app.workspace.getActiveFile();
    return f && f.parent ? f.parent.path : '/';
  }
  ticketService() {
    const t = neonPlugin(this.app, 'neon-tickets');
    return t && t.newTicket ? (opts) => t.newTicket(opts) : null;
  }

  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tasks', slot: 'tasks', title: 'Tasks', icon: 'list-checks', sub: 'Tagged notes · today · quick', mount: (card) => this.mountTasks(card) });
    api.registerWidget({ id: 'global', slot: 'global', title: 'Global tasks', icon: 'star', sub: 'Important · not tied to notes', mount: (card) => this.mountGlobal(card) });
    api.registerCapture({ id: 'task', label: 'Task', short: 'Task', icon: 'square-check', order: 10, run: (v) => this.addQuickTask(v) });
    api.registerCapture({ id: 'global', label: 'Global task', short: 'Global', icon: 'star', order: 11, run: (v) => this.addGlobal(v) });
    api.registerFacts('tasks', () => {
      const out = [];
      if (this.openCount != null) out.push({ v: this.openCount, l: 'open tasks' });
      const n = this.doneOn(moment());
      if (n) out.push({ v: n, l: n === 1 ? 'task done' : 'tasks done' });
      return out;
    });
    api.registerWeekLine('tasks', (start, end) => {
      const n = this.settings.doneLog.filter((d) => d.t >= start.valueOf() && d.t < end.valueOf()).length;
      return n ? [`${n} task${n === 1 ? '' : 's'} done`] : [];
    });
    api.provide('newNote', (folder) => this.newNote(folder));
    api.registerExcluded('tasks', () => [this.settings.backupPath]);
  }
  doneOn(m) {
    const k = m.format('YYYY-MM-DD');
    return this.settings.doneLog.filter((d) => dayKey(d.t) === k).length;
  }
  logDone(text, src) {
    const log = this.settings.doneLog;
    log.push({ t: Date.now(), text, src });
    const cut = Date.now() - 120 * 864e5;
    while (log.length && log[0].t < cut) log.shift();
    this.saveSettings();
    this.app.workspace.trigger('neon:task-done', { text, src });
  }

  /* collecting tasks ----------------------------------------------------- */
  isTaskSource(f, cache) {
    if (isTicketCache(cache)) return false;
    return fmTags(cache && cache.frontmatter).includes('tasks');
  }
  async collectTasks() {
    const app = this.app;
    const today = moment().startOf('day');
    const todayKey = today.format('YYYY-MM-DD');
    const sources = new Map();
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(f);
      if (!cache || !cache.listItems) continue;
      if (isTicketCache(cache)) continue;
      if (this.isTaskSource(f, cache) || f.path === this.quickPath()) {
        sources.set(f.path, { f, cache, daily: null });
        continue;
      }
      const d = dailyDateOf(app, f);
      if (d && !d.isAfter(today) && today.diff(d, 'days') <= this.settings.carryDays) sources.set(f.path, { f, cache, daily: d });
    }
    const out = [];
    for (const { f, cache, daily } of sources.values()) {
      const lis = cache.listItems.filter((li) => li.task === ' ');
      if (!lis.length) continue;
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of lis) {
        const line = (lines[li.position.start.line] || '').replace(/\r$/, '');
        const m = line.match(TASK_LINE_RE);
        if (!m || !m[1].trim()) continue;
        const raw = m[1];
        const due = (raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/u) || [])[1] || null;
        let group = 'later';
        if (due) group = due < todayKey ? 'overdue' : due === todayKey ? 'today' : 'later';
        else if (daily) group = 'today';
        out.push({
          file: f,
          line: li.position.start.line,
          raw,
          due,
          group,
          carried: daily && !daily.isSame(today, 'day') ? daily : null,
          display: taskDisplay(raw),
          quick: f.path === this.quickPath(),
        });
      }
    }
    out.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.file.stat.mtime - a.file.stat.mtime || a.line - b.line);
    this.sourcePaths = new Set(sources.keys());
    return out;
  }
  quickPath() {
    const p = this.settings.quickTasksPath;
    return normalizePath(p.endsWith('.md') ? p : p + '.md');
  }
  async addQuickTask(text) {
    text = String(text || '').trim();
    if (!text) return;
    const path = this.quickPath();
    let f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      await ensureFolder(this.app, path.split('/').slice(0, -1).join('/'));
      f = await this.app.vault.create(path, `---\ntags:\n  - tasks\n---\n# Quick tasks\n\nAdded from the dashboard. Stays until ticked.\n\n`);
    }
    await this.app.vault.process(f, (d) => d.replace(/\s*$/, '') + `\n- [ ] ${text}\n`);
    new Notice('✦ Task added');
  }
  async completeTask(t) {
    const stamp = this.settings.stampDone ? ` ✅ ${moment().format('YYYY-MM-DD')}` : '';
    let ok = false;
    await this.app.vault.process(t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      // the line must still be this open task (the note may have changed since the list was drawn)
      if (l === undefined || !/\[ \]/.test(l) || !l.includes(t.raw)) return data;
      const cr = l.endsWith('\r') ? '\r' : '';
      const body = cr ? l.slice(0, -1) : l;
      lines[t.line] = body.replace('[ ]', '[x]') + stamp + cr;
      ok = true;
      return lines.join('\n');
    });
    if (ok) this.logDone(t.display, t.file.path);
    else new Notice('That task changed in the meantime — refreshed');
  }

  /* tasks widget --------------------------------------------------------- */
  mountTasks(card) {
    const body = card.body;
    const list = body.createDiv('nt-list');
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add a task… (Enter → Quick tasks)' } });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
        const v = input.value;
        input.value = '';
        await this.addQuickTask(v);
      }
    });
    button(card.actions, { icon: 'calendar-days', cls: 'nd-icon-btn', title: 'Open today’s note', onClick: async () => openFile(this.app, await ensureToday(this.app)) });
    let token = 0;
    let seen = null; // keys shown last time, so newly added tasks can animate in
    const render = async () => {
      const my = ++token;
      const items = await this.collectTasks();
      if (my !== token || !list.isConnected) return;
      this.openCount = items.length;
      card.badge.setText(items.length ? String(items.length) : '');
      list.empty();
      if (!items.length) {
        const e = emptyState(list, 'All clear ✦ no open tasks');
        e.createDiv({ cls: 'nt-empty-hint', text: 'Tasks come from notes tagged “tasks”, today’s daily note and the box below.' });
        return;
      }
      let i = 0;
      const now = new Set();
      for (const [g, label] of [['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later']]) {
        const group = items.filter((t) => t.group === g);
        if (!group.length) continue;
        list.createDiv({ cls: `nt-group is-${g}`, text: `${label} · ${group.length}` });
        for (const t of group.slice(0, 40)) {
          const row = this.taskRow(list, t, i++);
          const key = `${t.file.path}|${t.raw}`;
          now.add(key);
          if (seen && !seen.has(key)) row.addClass('is-new');
        }
      }
      seen = now;
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  }
  taskRow(list, t, i) {
    const row = list.createDiv('nt-task');
    row.style.setProperty('--i', String(Math.min(i, 20)));
    const box = row.createDiv('nt-check');
    tip(box, 'Done');
    const txt = row.createDiv({ cls: 'nt-text', text: t.display || t.raw });
    if (t.due) {
      const d = moment(t.due);
      row.createSpan({ cls: `nt-due is-${t.group}`, text: t.group === 'today' ? 'today' : d.format('D MMM') });
    } else if (t.carried) row.createSpan({ cls: 'nt-due is-carried', text: `from ${t.carried.format('ddd')}` });
    const src = row.createSpan({ cls: 'nt-src', text: t.quick ? 'quick' : t.file.basename });
    tip(src, t.file.path);
    box.addEventListener('click', async () => {
      if (row.hasClass('is-done')) return;
      row.addClass('is-done');
      await this.completeTask(t);
    });
    txt.addEventListener('click', (e) => openFile(this.app, t.file, e, t.line));
    src.addEventListener('click', (e) => openFile(this.app, t.file, e, t.line));
    return row;
  }

  /* global tasks ---------------------------------------------------------- */
  async addGlobal(text) {
    text = String(text || '').trim();
    if (!text) return;
    this.settings.globalTasks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, created: Date.now() });
    await this.globalChanged();
    new Notice('✦ Global task added');
  }
  async globalChanged() {
    await this.saveSettings();
    this.emit();
    if (!this._backupSoon) this._backupSoon = debounce(() => this.writeBackup(), 15000, true);
    this._backupSoon();
  }
  mountGlobal(card) {
    const body = card.body;
    const list = body.createDiv('nt-list nt-global');
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add a global task… (Enter)' } });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
        const v = input.value;
        input.value = '';
        await this.addGlobal(v);
      }
    });
    let dragId = null;
    let seen = null;
    const render = () => {
      if (!list.isConnected) return;
      const items = this.settings.globalTasks;
      const prev = seen;
      seen = new Set(items.map((t) => t.id));
      card.badge.setText(items.length ? String(items.length) : '');
      list.empty();
      if (!items.length) emptyState(list, 'Nothing here — add the big things you shouldn’t forget');
      items.forEach((t, i) => {
        const row = list.createDiv('nt-task nt-gtask' + (prev && !prev.has(t.id) ? ' is-new' : ''));
        row.style.setProperty('--i', String(Math.min(i, 20)));
        row.setAttr('draggable', 'true');
        icon(row, 'grip-vertical', 'nt-grip');
        const box = row.createDiv('nt-check');
        tip(box, 'Done');
        const txt = row.createDiv({ cls: 'nt-text', text: t.text });
        tip(txt, 'Double-click to edit · drag to reorder');
        const del = row.createDiv('nt-del');
        setIcon(del, 'x');
        tip(del, 'Delete');
        box.addEventListener('click', () => {
          if (row.hasClass('is-done')) return;
          row.addClass('is-done');
          window.setTimeout(async () => {
            const idx = this.settings.globalTasks.findIndex((x) => x.id === t.id);
            if (idx >= 0) this.settings.globalTasks.splice(idx, 1);
            this.logDone(t.text, 'global');
            await this.globalChanged();
          }, 900);
        });
        del.addEventListener('click', async () => {
          const idx = this.settings.globalTasks.findIndex((x) => x.id === t.id);
          if (idx < 0) return;
          const [removed] = this.settings.globalTasks.splice(idx, 1);
          await this.globalChanged();
          const n = new Notice(createFragment((f) => {
            f.appendText('Global task deleted · ');
            f.createEl('a', { text: 'Undo', href: '#' }).addEventListener('click', async (e) => {
              e.preventDefault();
              this.settings.globalTasks.splice(Math.min(idx, this.settings.globalTasks.length), 0, removed);
              await this.globalChanged();
              n.hide();
            });
          }), 6000);
        });
        txt.addEventListener('dblclick', () => {
          const inp = createEl('input', { cls: 'nd-input nt-edit', attr: { type: 'text' } });
          inp.value = t.text;
          txt.replaceWith(inp);
          inp.focus();
          inp.select();
          const done = async (save) => {
            if (!inp.isConnected) return;
            const v = inp.value.trim();
            if (save && v && v !== t.text) {
              t.text = v;
              await this.globalChanged();
            } else render();
          };
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') {
              e.stopPropagation();
              done(false);
            }
          });
          inp.addEventListener('blur', () => done(true));
        });
        row.addEventListener('dragstart', (e) => {
          dragId = t.id;
          row.addClass('is-dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.text);
          }
        });
        row.addEventListener('dragend', () => {
          dragId = null;
          row.removeClass('is-dragging');
          list.querySelectorAll('.is-drop-above, .is-drop-below').forEach((el) => el.removeClass('is-drop-above', 'is-drop-below'));
        });
        row.addEventListener('dragover', (e) => {
          if (!dragId || dragId === t.id) return;
          e.preventDefault();
          const r = row.getBoundingClientRect();
          const below = e.clientY > r.top + r.height / 2;
          row.toggleClass('is-drop-below', below);
          row.toggleClass('is-drop-above', !below);
        });
        row.addEventListener('dragleave', () => row.removeClass('is-drop-above', 'is-drop-below'));
        row.addEventListener('drop', async (e) => {
          if (!dragId || dragId === t.id) return;
          e.preventDefault();
          const arr = this.settings.globalTasks;
          const from = arr.findIndex((x) => x.id === dragId);
          if (from < 0) return;
          const [moved] = arr.splice(from, 1);
          const r = row.getBoundingClientRect();
          let to = arr.findIndex((x) => x.id === t.id);
          if (e.clientY > r.top + r.height / 2) to++;
          arr.splice(to, 0, moved);
          dragId = null;
          await this.globalChanged();
        });
      });
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  }

  /* backup ---------------------------------------------------------------- */
  backupFile() {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.backupPath));
    return f instanceof TFile ? f : null;
  }
  async writeBackup(notify) {
    try {
      const path = normalizePath(this.settings.backupPath);
      const items = this.settings.globalTasks;
      const body = [
        '---',
        'neon: global-tasks-backup',
        `updated: ${moment().format('YYYY-MM-DD HH:mm')}`,
        `count: ${items.length}`,
        '---',
        '# Global tasks backup',
        '',
        '> [!info] Read-only copy',
        '> Written by Neon Tasks. Edits here are ignored. If the plugin data is ever lost, Neon Tasks offers to restore from this note.',
        '',
        ...items.map((t) => `- [ ] ${t.text.replace(/\n/g, ' ')}`),
        '',
      ].join('\n');
      const f = this.backupFile();
      if (f) {
        const cur = await this.app.vault.read(f);
        if (stripFrontmatter(cur).trim() !== stripFrontmatter(body).trim()) await this.app.vault.modify(f, body);
      } else {
        await ensureFolder(this.app, path.split('/').slice(0, -1).join('/'));
        await this.app.vault.create(path, body);
      }
      this.settings.lastBackup = moment().format('YYYY-MM-DD');
      await this.saveSettings();
      if (notify) new Notice('✦ Global tasks backed up');
    } catch (e) {
      console.error('Neon Tasks backup', e);
    }
  }
  dailyBackup() {
    if (this.settings.lastBackup !== moment().format('YYYY-MM-DD')) this.writeBackup();
  }
  async maybeRestore() {
    if (!this.freshData || this.settings.globalTasks.length) return;
    const f = this.backupFile();
    if (!f) return;
    const items = (await this.app.vault.read(f))
      .split('\n')
      .map((l) => l.match(/^- \[ \] (.+)$/))
      .filter(Boolean)
      .map((m) => m[1].trim());
    if (!items.length) return;
    new ConfirmModal(this.app, {
      title: 'Restore Global tasks?',
      text: `Neon Tasks has no saved data, but its backup note has ${items.length} global task${items.length === 1 ? '' : 's'}. Restore them?`,
      cta: 'Restore',
      warning: false,
      onConfirm: async () => {
        this.settings.globalTasks = items.map((text, i) => ({ id: `r${Date.now().toString(36)}${i}`, text, created: Date.now() }));
        await this.globalChanged();
        new Notice(`✦ Restored ${items.length} global tasks`);
      },
    }).open();
  }

  /* new notes ------------------------------------------------------------- */
  newNote(folder) {
    new NewNoteModal(this, { folder }).open();
  }
  /** Folders the plugins write to themselves (log notes, reviews, backups): never asked about. */
  isSystemPath(path) {
    const deck = neonPlugin(this.app, 'neon-deck');
    const time = neonPlugin(this.app, 'neon-time');
    const dirs = [...SYSTEM_FOLDERS, deck && deck.settings && deck.settings.reviewFolder, time && time.settings && time.settings.logFolder].filter(Boolean);
    return dirs.some((p) => path === p || path.startsWith(p + '/'));
  }
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
      new NewNoteModal(this, { file: cur }).open();
    }, 350);
  }
  needsCategory(f) {
    if (!(f instanceof TFile) || f.extension !== 'md') return false;
    if (f.stat.ctime < this.settings.installedAt || this.isSystemPath(f.path) || dailyDateOf(this.app, f)) return false;
    if (f.path === this.quickPath() || f.path === normalizePath(this.settings.backupPath)) return false;
    return noteCategory(this.app.metadataCache.getFileCache(f)) === null;
  }
  uncategorised() {
    return this.app.vault.getMarkdownFiles().filter((f) => this.needsCategory(f)).sort((a, b) => b.stat.ctime - a.stat.ctime);
  }
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
      el.toggle(n > 0);
      txt.setText(`${n} no category`);
    };
    this.register(this.onChange(update));
    this.app.workspace.onLayoutReady(update);
  }
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
  }

  /* fix properties ---------------------------------------------------------- */
  /** One time: notes still using the old `ops` category get `operations` instead. */
  async migrateCategories() {
    if (this.settings.catMigrated) return;
    const old = Object.keys(CAT_ALIAS);
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache && cache.frontmatter) || {};
      const tags = cache && cache.frontmatter ? fmTags(fm).map((t) => String(t).toLowerCase()) : [];
      const hit = old.some((o) => fm[o] != null || tags.includes(o) || (typeof fm.category === 'string' && fm.category.toLowerCase() === o));
      if (hit && (await this.fixProps(f))) n++;
    }
    this.settings.catMigrated = true;
    await this.saveSettings();
    if (n) new Notice(`✦ Renamed the Ops category to Operations in ${n} note${n === 1 ? '' : 's'}`);
  }
  async fixProps(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const ticket = isTicketCache(cache);
    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const before = JSON.stringify(fm);
      // tags: always a clean list
      if (fm.tags != null) {
        const tags = [...new Set(fmTags(fm))];
        if (tags.length) fm.tags = tags;
        else delete fm.tags;
      }
      if (fm.tag != null && fm.tags == null) {
        const tags = fmTags({ tags: fm.tag });
        if (tags.length) fm.tags = tags;
        delete fm.tag;
      }
      // old category names (ops -> operations), as property, category value or tag
      for (const [old, c] of Object.entries(CAT_ALIAS)) {
        if (fm[old] != null) {
          if (isTrue(fm[old])) fm[c] = true;
          delete fm[old];
        }
      }
      if (Array.isArray(fm.tags)) fm.tags = [...new Set(fm.tags.map((t) => (CAT_ALIAS[String(t).toLowerCase()] ? CAT_ALIAS[String(t).toLowerCase()] : t)))];
      // "category: school" -> school: true
      if (typeof fm.category === 'string' && CATS.includes(normCat(fm.category.toLowerCase()))) {
        fm[normCat(fm.category.toLowerCase())] = true;
        delete fm.category;
      }
      for (const c of [...CATS, 'untracked']) {
        if (fm[c] === 'true' || fm[c] === 'yes') fm[c] = true;
        if (fm[c] === false || fm[c] === 'false' || fm[c] === 'no') delete fm[c];
      }
      if (!fm.created) fm.created = moment(file.stat.ctime).format('YYYY-MM-DD');
      if (ticket) {
        if (!fm.type) fm.type = 'ticket';
        if (!fm.status) fm.status = 'open';
        if (!fm.priority) fm.priority = 'normal';
      }
      for (const [k, v] of Object.entries(fm)) {
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete fm[k];
      }
      reorderProps(fm);
      changed = JSON.stringify(fm) !== before;
    });
    return changed;
  }
  async fixFolder(folder) {
    const files = [];
    const walk = (fd) => fd.children.forEach((c) => (c instanceof TFolder ? walk(c) : c instanceof TFile && c.extension === 'md' && files.push(c)));
    walk(folder);
    new ConfirmModal(this.app, {
      title: `Fix properties in “${folder.path === '/' ? this.app.vault.getName() : folder.name}”?`,
      text: `${files.length} note${files.length === 1 ? '' : 's'}: adds a created date, turns “category: x” into the checkbox, removes empty properties and puts them in a fixed order. Note text is not touched.`,
      cta: 'Fix properties',
      warning: false,
      onConfirm: async () => {
        let n = 0;
        for (const f of files) if (await this.fixProps(f)) n++;
        new Notice(`✦ Fixed ${n} of ${files.length} notes`);
      },
    }).open();
  }
  pickFolderToFix() {
    const plugin = this;
    class FolderPick extends SuggestModal {
      getSuggestions(q) {
        return this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
      }
      renderSuggestion(f, el) {
        el.setText(f.path === '/' ? '/ (whole vault)' : f.path);
      }
      onChooseSuggestion(f) {
        plugin.fixFolder(f);
      }
    }
    const m = new FolderPick(this.app);
    m.setPlaceholder('Fix properties in which folder?');
    m.open();
  }
};
