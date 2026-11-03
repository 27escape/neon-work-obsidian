'use strict';
/*
 * Neon Time — active-time tracking per category, manual entries, overtime, Time Log notes.
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
 * NEON TIME — active time per category, manual entries, overtime and one
 * log note per day for your AI agent. Never talks to Jira or the network.
 * ========================================================================= */
const VIEW_TIME = 'neon-time';
const TIME_CATS = [...CATS, 'other'];
const TIME_DEFAULTS = {
  tracking: true,
  logFolder: 'Core/Time Log',
  writeNotes: true,
  dayHours: 8,
  idleMin: 2,
  wrapLead: 30,
  installedAt: 0,
  days: {}, // 'YYYY-MM-DD' -> { entries: [], done: [], tomorrow, wrapped }
};
const SOURCES = ['auto', 'manual', 'ticket'];
let entrySeq = 0;
const newId = () => `${Date.now().toString(36)}${(entrySeq++).toString(36)}`;
const entryMin = (e) => Math.round(e.ms / 60000);
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/* ---- manual entry / edit -------------------------------------------------- */
class EntryModal extends Modal {
  /** entry: existing entry to edit (with .day), or a partial one for a new entry */
  constructor(plugin, entry, isNew) {
    super(plugin.app);
    Object.assign(this, { plugin, entry, isNew });
  }
  onOpen() {
    const p = this.plugin;
    const e = this.entry;
    this.modalEl.addClass('nd-modal', 'tm-modal');
    this.titleEl.setText(this.isNew ? 'Add time' : 'Edit time entry');
    const c = this.contentEl;
    const field = (label, parent = c) => {
      const f = parent.createDiv('tm-field');
      f.createDiv({ cls: 'tm-label', text: label });
      return f;
    };
    const row = c.createDiv('tm-row');
    const start = moment(e.start || Date.now());
    const date = field('Date', row).createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    date.value = start.format('YYYY-MM-DD');
    const time = field('Start', row).createEl('input', { cls: 'nd-input', attr: { type: 'time' } });
    time.value = e.start ? start.format('HH:mm') : '';
    time.placeholder = 'optional';
    const minF = field('Minutes', row);
    const min = minF.createEl('input', { cls: 'nd-input', attr: { type: 'number', min: '1', max: '960' } });
    min.value = e.ms ? String(entryMin(e)) : '30';
    const quick = c.createDiv('nd-pills tm-chips');
    for (const n of [15, 30, 45, 60, 90, 120]) {
      const b = quick.createEl('button', { cls: 'nd-pill-btn', text: fmtMin(n), attr: { type: 'button' } });
      b.addEventListener('click', () => (min.value = String(n)));
    }
    const cat = pills(field('Category'), TIME_CATS.map((k) => [k, CAT_LABEL[k]]), normCat(e.cat) || 'operations', null, 'tm-cats');
    for (const k of TIME_CATS) cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
    const note = field('What did you do?').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. CRM ticket 8812' } });
    note.value = e.note || '';
    const jira = field('Jira key (optional)').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. OPS-311' } });
    jira.value = e.jira || '';

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
      const n = Math.round(Number(min.value));
      if (!(n > 0 && n <= 960)) return min.addClass('is-invalid');
      const d = moment(date.value, 'YYYY-MM-DD', true);
      if (!d.isValid()) return date.addClass('is-invalid');
      // no start time: place it so it ends now (today) or at 09:00 (other days)
      let s;
      if (time.value) s = moment(`${date.value} ${time.value}`, 'YYYY-MM-DD HH:mm');
      else if (d.isSame(moment(), 'day')) s = moment().subtract(n, 'minutes');
      else s = d.clone().hour(9);
      if (!s.isSame(d, 'day')) s = d.clone().startOf('day');
      this.close();
      const v = { start: s.valueOf(), ms: n * 60000, cat: cat.get() || 'other', note: note.value.trim(), jira: jira.value.trim() };
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
    window.setTimeout(() => (this.isNew && !e.note ? note : min).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

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
    fact(new Set(day.done.filter((d) => d.kind === 'ticket').map((d) => d.ref)).size, 'tickets moved');
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
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'tm-view');
    this.scroller = this.contentEl.createDiv('tm-scroll');
    this.first = true;
    this.mountPattern();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountPattern()));
    this.register(this.plugin.onChange(debounce(() => this.render(), 300, true)));
    this.registerInterval(window.setInterval(() => this.render(), 60 * 1000));
    this.render();
  }
  async onClose() {
    this.unmountPattern();
    this.contentEl.empty();
  }
  /** The dashboard's dot pattern behind the cards, when Neon Deck is on. */
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
      for (const k of TIME_CATS) {
        if (!s.by[k]) continue;
        const seg = bar.createDiv('tm-col-seg');
        seg.style.height = `${(s.by[k] / max) * 100}%`;
        seg.style.background = catColor(k);
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
    const entries = p.entriesOf(key, isToday);
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
      if (e.jira) r.createSpan({ cls: 'tm-entry-jira', text: e.jira });
      r.createSpan({ cls: `tm-entry-src s-${e.source}`, text: e.live ? 'live' : e.source });
      const a = r.createDiv('tm-entry-acts');
      if (!e.live) button(a, { icon: 'pencil', cls: 'nd-icon-btn', title: 'Edit', onClick: () => new EntryModal(p, e, false).open() });
      button(a, { icon: 'trash-2', cls: 'nd-icon-btn', title: e.live ? 'Discard live time' : 'Delete', onClick: () => p.deleteEntry(e) });
    });
    const day = p.days[key];
    if (day && day.tomorrow) {
      const t = this.card(root, 'tm-tomorrow', 'Note for tomorrow', 'sunrise').body;
      t.createDiv({ text: day.tomorrow });
    }
    madeWith(root.createDiv('tm-foot'), 'Neon Time');
    sc.scrollTop = scroll;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  go(n) {
    this.cursor.add(n, 'days');
    this.render();
  }
}

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
    numSetting(new Setting(containerEl).setName('Idle cutoff (minutes)').setDesc('Time stops after this long without typing, scrolling or clicking.'), s, 'idleMin', 1, 30, () => (save(), p.readmeSoon()));
    numSetting(new Setting(containerEl).setName('Workday (hours)').setDesc('Weekday target. Time past it counts as overtime. Weekend time is all overtime.'), s, 'dayHours', 1, 16, () => (save(), p.emit(), p.readmeSoon()));
    numSetting(new Setting(containerEl).setName('Wrap up shows (minutes before the target)'), s, 'wrapLead', 0, 240, save);
    new Setting(containerEl).setName('Log notes').setHeading();
    new Setting(containerEl)
      .setName('Write a log note per day')
      .setDesc('Totals, a Done today list and a table of entries, for your AI agent to send to Jira. Neon Time itself never connects to Jira or the network.')
      .addToggle((t) => t.setValue(s.writeNotes).onChange((v) => ((s.writeNotes = v), save())));
    new Setting(containerEl)
      .setName('Log folder')
      .addText((t) => t.setValue(s.logFolder).onChange((v) => ((s.logFolder = normalizePath(v.trim() || 'Core/Time Log')), save())))
      .addExtraButton((b) => b.setIcon('refresh-cw').setTooltip('Write today’s note now').onClick(() => p.writeDay(moment().format('YYYY-MM-DD'), true)));
    madeWith(containerEl, 'Neon Time');
  }
}

/* ---- plugin ------------------------------------------------------------- */
module.exports = class NeonTime extends Plugin {
  async onload() {
    this.listeners = new Set();
    this.dirty = new Set();
    this.session = null;
    // short bits of work per note (under a minute so far); they add up instead of being dropped
    this.pending = new Map();
    await this.loadSettings();
    this.days = this.settings.days;
    // old saved entries: ops -> operations
    for (const d of Object.values(this.days || {})) for (const e of d.entries || []) e.cat = normCat(e.cat);

    this.registerView(VIEW_TIME, (leaf) => new TimeView(leaf, this));
    this.addRibbonIcon('clock', 'Neon Time', () => this.openTab());
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
    const touch = (e) => this.touch(e);
    this.registerDomEvent(document, 'keydown', touch, true);
    this.registerDomEvent(document, 'mousedown', touch, true);
    this.registerDomEvent(document, 'wheel', touch, { capture: true, passive: true });
    this.registerDomEvent(document, 'scroll', touch, { capture: true, passive: true });
    this.registerDomEvent(window, 'blur', () => this.closeSession());
    this.registerDomEvent(document, 'visibilitychange', () => document.hidden && this.closeSession());
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
      this.app.workspace.on('neon:ticket-changed', (v) => {
        if (!v) return;
        // keyed by ticket id so a ticket that moves to Done/ and back stays one line
        const path = (v.file && v.file.path) || '';
        this.addDone({ kind: 'ticket', ref: v.id || path || v.title, path, text: `${v.id ? v.id + ' ' : ''}${v.title || ''}`.trim(), change: v.change });
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
      api.unregisterAction('time');
      api.unregisterExcluded('time');
    }
  }
  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, TIME_DEFAULTS, data);
    if (!this.settings.days || typeof this.settings.days !== 'object') this.settings.days = {};
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
  emit() {
    for (const fn of this.listeners) fn();
    this.updateStatus();
    const api = deckApi(this.app);
    if (api) api.factsChanged();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Something changed on a day: save, refresh, and rewrite its log note soon. */
  changed(key) {
    this.saveSoon();
    this.dirty.add(key);
    if (!this._write) this._write = debounce(() => this.flush(), 20 * 1000, true);
    this._write();
    this.emit();
  }
  async flush() {
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const k of keys) await this.writeDay(k);
  }

  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'time', slot: 'time', title: 'Time today', icon: 'clock', sub: this.widgetSub(), mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'time', label: 'Time entry', short: 'Time', icon: 'clock', order: 30, allowEmpty: true, run: (v) => this.newEntry({ note: v }) });
    api.registerAction({ id: 'time', icon: 'clock', label: 'Time', order: 40, view: VIEW_TIME, run: () => this.openTab() });
    api.registerExcluded('time', () => [this.settings.logFolder || 'Core/Time Log']);
    api.registerFacts('time', () => {
      const s = this.summary(moment().format('YYYY-MM-DD'), true);
      const out = [];
      const top = TIME_CATS.filter((k) => s.by[k]).sort((a, b) => s.by[b] - s.by[a]);
      for (const k of top.slice(0, 2)) out.push({ v: fmtMin(s.by[k]), l: `${CAT_LABEL[k].toLowerCase()} today` });
      const wk = this.balance(moment().startOf('isoWeek'), moment().endOf('isoWeek'));
      if (wk.over) out.push({ v: fmtMin(wk.over), l: 'overtime this week' });
      return out;
    });
    api.registerWeekLine('time', (start, end) => {
      const by = {};
      let over = 0;
      for (let d = start.clone(); d.isBefore(end); d.add(1, 'day')) {
        const s = this.summary(d.format('YYYY-MM-DD'), false);
        for (const k of TIME_CATS) by[k] = (by[k] || 0) + s.by[k];
        over += s.over;
      }
      const top = TIME_CATS.filter((k) => by[k]).sort((a, b) => by[b] - by[a])[0];
      const out = [];
      if (top) out.push(`mostly ${CAT_LABEL[top]}`);
      if (over) out.push(`${fmtMin(over)} overtime`);
      return out;
    });
  }

  widgetSub() {
    return `Active time · ${fmtMin(Math.round(this.settings.dayHours * 60))} day`;
  }

  /* ---- tracking -------------------------------------------------------- */
  isLogFile(f) {
    const folder = normalizePath(this.settings.logFolder || 'Core/Time Log');
    return !!f && (f.path === folder || f.path.startsWith(folder + '/'));
  }
  /** Category a file's time goes to, or null when it must not be logged. */
  trackCat(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.isLogFile(file)) return null;
    const c = fileCategory(this.app, file);
    if (c === 'untracked') return null;
    return c || 'other';
  }
  touch(e) {
    if (!this.settings.tracking || document.hidden) return;
    const now = Date.now();
    // cheap throttle: one check every 3 s is plenty for minute-level time
    if (this.session && now - this.session.last < 3000) return;
    const view = this.activeFileView();
    if (!view || !view.file || (e && e.target instanceof Node && !view.containerEl.contains(e.target))) return;
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
  }
  /** The focused note's view (markdown, ticket view, …), or null. */
  activeFileView() {
    const ws = this.app.workspace;
    const v = ws.getActiveViewOfType(FileView);
    if (v && v.file) return v;
    const leaf = ws.activeLeaf;
    return leaf && leaf.view && leaf.view.file instanceof TFile ? leaf.view : null;
  }
  tick() {
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
  }
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
  }
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
  }

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
  }
  /** Turn automatic tracking on or off. Pausing saves what was tracked so far. */
  setTracking(on) {
    this.settings.tracking = on;
    if (!on) {
      this.closeSession();
      for (const k of this.flushPending()) this.dirty.add(k);
      this.changed(moment().format('YYYY-MM-DD'));
    } else this.emit();
    this.saveSettings();
  }
  /** Throw away time not saved yet for a note (it was set to untracked). */
  dropTracking(path) {
    if (this.session && this.session.path === path) this.session = null;
    this.pending.delete(path);
    this.emit();
  }

  /* ---- data ------------------------------------------------------------- */
  day(key) {
    let d = this.days[key];
    if (!d) d = this.days[key] = { entries: [], done: [], tomorrow: '', wrapped: false };
    return d;
  }
  /** Entries of a day, sorted, with the running session added when live. */
  entriesOf(key, live) {
    const d = this.days[key];
    const out = d ? [...d.entries] : [];
    if (live) for (const [path, pd] of this.pending) if (pd.key === key) out.push({ start: pd.start, ms: pd.ms, cat: pd.cat, note: '', path, jira: pd.jira, source: 'auto', live: true, pendingPath: path });
    const s = this.session;
    if (live && s && dayKey(s.start) === key && s.last - s.start >= 1000) {
      const prev = out[out.length - 1];
      const liveMs = s.last - s.start;
      // the live row continues a saved entry: show them as one, but without the saved id so
      // "Discard live time" only drops the running part
      if (prev && prev.source === 'auto' && prev.path === s.path && prev.cat === s.cat && s.start - prev.end <= this.settings.idleMin * 60000)
        out[out.length - 1] = { ...prev, id: undefined, ms: prev.ms + liveMs, liveMs, live: true, sessionLive: true };
      else out.push({ start: s.start, ms: liveMs, liveMs, cat: s.cat, note: '', path: s.path, jira: s.jira, source: 'auto', live: true, sessionLive: true });
    }
    return out.sort((a, b) => a.start - b.start);
  }
  targetMin(m) {
    const wd = (m || moment()).isoWeekday();
    return wd <= 5 ? Math.round(this.settings.dayHours * 60) : 0;
  }
  summary(key, live) {
    const by = Object.fromEntries(TIME_CATS.map((k) => [k, 0]));
    for (const e of this.entriesOf(key, live)) by[TIME_CATS.includes(e.cat) ? e.cat : 'other'] += e.ms / 60000;
    for (const k of TIME_CATS) by[k] = Math.round(by[k]);
    const total = TIME_CATS.reduce((s, k) => s + by[k], 0);
    const target = this.targetMin(moment(key, 'YYYY-MM-DD'));
    return { key, by, total, target, over: Math.max(0, total - target) };
  }
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
  }
  addEntry(v, quiet) {
    const e = { id: newId(), start: v.start, end: v.start + v.ms, ms: v.ms, cat: v.cat, note: v.note || '', path: v.path || '', jira: v.jira || '', source: v.source || 'manual' };
    const key = dayKey(e.start);
    const day = this.day(key);
    day.entries.push(e);
    day.entries.sort((a, b) => a.start - b.start);
    this.changed(key);
    if (!quiet) new Notice(`⏱ ${fmtMin(entryMin(e))} ${CAT_LABEL[e.cat] || 'Other'} logged`);
  }
  findEntry(e) {
    for (const [key, d] of Object.entries(this.days)) {
      const i = d.entries.findIndex((x) => x.id === e.id);
      if (i !== -1) return { key, d, i };
    }
    return null;
  }
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
  }
  deleteEntry(e) {
    // live rows: drop the running session and/or the short bits not saved yet
    if (e.live) {
      if (e.sessionLive) this.session = null;
      if (e.pendingPath) this.pending.delete(e.pendingPath);
      if (!e.id) {
        new Notice(`Discarded ${fmtMin((e.liveMs || e.ms) / 60000)} of live time`);
        return this.emit();
      }
    }
    const hit = this.findEntry(e);
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
  }
  addDone(item, quiet, key = moment().format('YYYY-MM-DD')) {
    const d = this.day(key);
    if (item.kind === 'note' && d.done.some((x) => x.kind === 'note' && x.ref === item.ref)) return;
    d.done.push({ t: Date.now(), ...item });
    if (d.done.length > 300) d.done.splice(0, d.done.length - 300);
    if (!quiet) this.changed(key);
  }
  newEntry(partial) {
    new EntryModal(this, { cat: 'operations', ...partial }, true).open();
  }

  /* ---- log notes --------------------------------------------------------- */
  dayNotePath(key) {
    return normalizePath(`${this.settings.logFolder || 'Core/Time Log'}/${key}.md`);
  }
  async openDayNote(key) {
    await this.writeDay(key, true);
    const f = this.app.vault.getAbstractFileByPath(this.dayNotePath(key));
    if (f instanceof TFile) openFile(this.app, f);
    else new Notice('Nothing logged on this day yet.');
  }
  dayNote(key, synced) {
    const d = this.days[key] || { entries: [], done: [] };
    const s = this.summary(key, false);
    const m = moment(key, 'YYYY-MM-DD');
    const lines = ['---', `date: ${key}`, `total_min: ${s.total}`];
    for (const k of TIME_CATS) lines.push(`${k}_min: ${s.by[k]}`);
    lines.push(`target_min: ${s.target}`, `overtime_min: ${s.over}`, `synced: ${synced ? 'true' : 'false'}`, '---', '');
    lines.push(`# Time log · ${m.format('ddd D MMM YYYY')}`, '');
    const split = TIME_CATS.filter((k) => s.by[k]).map((k) => `${CAT_LABEL[k]} ${fmtMin(s.by[k])}`);
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
    lines.push('## Entries', '| Start | Min | Category | Note | Jira | Source |', '| --- | --- | --- | --- | --- | --- |');
    for (const e of [...d.entries].sort((a, b) => a.start - b.start)) {
      const note = e.note || (e.path ? `[[${e.path.split('/').pop().replace(/\.md$/, '')}]]` : '');
      lines.push(`| ${moment(e.start).format('HH:mm')} | ${entryMin(e)} | ${e.cat} | ${cell(note)} | ${cell(e.jira)} | ${e.source} |`);
    }
    return lines.join('\n') + '\n';
  }
  /** Write (or update) a day's log note. Keeps `synced: true` unless the entries changed. */
  async writeDay(key, force) {
    if (!this.settings.writeNotes && !force) return;
    const d = this.days[key];
    const path = this.dayNotePath(key);
    const f = this.app.vault.getAbstractFileByPath(path);
    const empty = !d || (!d.entries.length && !d.done.length && !d.tomorrow);
    // nothing to write for a new day; an existing note is still rewritten so deleted time disappears from it
    if (empty && !(f instanceof TFile)) return;
    const table = (t) => (t.split(/\n## Entries\n/)[1] || '').trim();
    try {
      if (f instanceof TFile) {
        await this.app.vault.process(f, (old) => {
          const wasSynced = /^synced:\s*true\s*$/m.test(old.split(/\n---/)[0] || '');
          const fresh = this.dayNote(key, false);
          const next = wasSynced && table(old) === table(fresh) ? this.dayNote(key, true) : fresh;
          return next === old ? old : next;
        });
      } else {
        await ensureFolder(this.app, this.settings.logFolder);
        await this.app.vault.create(path, this.dayNote(key, false));
      }
    } catch (e) {
      console.error('Neon Time: could not write log note', e);
    }
  }
  readmeSoon() {
    if (!this._readme) this._readme = debounce(() => this.ensureReadme(), 2000, true);
    this._readme();
  }
  async ensureReadme() {
    if (!this.settings.writeNotes) return;
    const path = normalizePath(`${this.settings.logFolder}/README.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const target = Math.round(this.settings.dayHours * 60);
    const idle = this.settings.idleMin;
    const text = [
      '# Time Log — format',
      '',
      'Neon Time writes one note per day here, named `YYYY-MM-DD.md`. It never connects to Jira or the network; an AI agent reads these notes and sends them on.',
      '',
      '## Properties',
      '- `date` — the day.',
      '- `total_min`, `projects_min`, `school_min`, `admin_min`, `operations_min`, `other_min` — active minutes per category (`other` = notes without a category).',
      `- \`target_min\` — ${target} on weekdays (${fmtMin(target)}), 0 on weekends. \`overtime_min\` — time past the target.`,
      '- `synced` — set to `true` once the day has been sent to Jira. Neon Time keeps it, unless entries change afterwards, then it goes back to `false`.',
      '',
      '## Body',
      '- **Done today** — notes worked on, tasks ticked and ticket changes.',
      '- **Tomorrow** — the line written in Wrap up, if any.',
      '- **Entries** — one row per block of work:',
      '',
      '| Start | Min | Category | Note | Jira | Source |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 09:12 | 47 | projects | [[API migration]] | PROJ-142 | auto |',
      '| 10:05 | 30 | operations | CRM ticket 8812 |  | manual |',
      '',
      '`Source` is `auto` (counted while you worked in the note), `manual` (added by hand) or `ticket` (logged from a ticket’s + Time).',
      'The Jira key comes from the note’s `jira` property, or was typed in by hand.',
      '',
      `Auto time counts only while a note is the focused tab and you type, scroll or click; it stops after ${idle} minute${idle === 1 ? '' : 's'} idle. Short bits of work on the same note add up and become an entry once they reach a minute; bits still under a minute are saved when tracking is paused or Obsidian closes. Back-to-back sessions on the same note are merged, and a session past midnight is split between the two days. Notes with \`untracked: true\` are never logged.`,
      '',
      'These notes are rewritten by Neon Time; edits to them are overwritten (except `synced`). Change entries in the Time tab instead. This README is rewritten too when the Neon Time settings change.',
      '',
    ].join('\n');
    try {
      if (existing instanceof TFile) {
        // keep it in step with the settings, as long as it's still the generated README
        await this.app.vault.process(existing, (old) => (old.startsWith('# Time Log — format') ? text : old));
      } else if (!existing) {
        await ensureFolder(this.app, this.settings.logFolder);
        await this.app.vault.create(path, text);
      }
    } catch (e) {
      console.error('Neon Time: README', e);
    }
  }

  /* ---- UI --------------------------------------------------------------- */
  async openTab() {
    await activateView(this.app, VIEW_TIME, 'tab');
  }
  /** SVG donut: categories against the day target, overtime as an accent slice. */
  /** intro: segments draw in one after another and the total counts up (first paint only). */
  donut(parent, sum, size, intro = false) {
    const wrap = parent.createDiv('tm-donut' + (intro ? ' is-intro' : ''));
    wrap.style.setProperty('--size', `${size}px`);
    const svg = wrap.createSvg('svg', { attr: { viewBox: '0 0 120 120', width: String(size), height: String(size) } });
    const R = 50;
    const C = 2 * Math.PI * R;
    svg.createSvg('circle', { cls: 'tm-donut-track', attr: { cx: '60', cy: '60', r: String(R) } });
    const base = Math.max(sum.target || sum.total, sum.total) || 1;
    const within = Math.min(sum.total, sum.target || sum.total);
    const scale = sum.total ? within / sum.total : 0;
    const slices = TIME_CATS.filter((k) => sum.by[k]).map((k) => [catColor(k), sum.by[k] * scale]);
    if (sum.over && sum.target) slices.push(['var(--nd-accent)', sum.over, true]);
    const gap = slices.length > 1 ? 1.2 : 0;
    let off = 0;
    let i = 0;
    for (const [color, v, isOver] of slices) {
      const len = (v / base) * C;
      if (len > gap) {
        // createSvg takes one class per string (a space throws), so add is-over separately
        const c = svg.createSvg('circle', { cls: 'tm-donut-seg', attr: { cx: '60', cy: '60', r: String(R) } });
        if (isOver) c.classList.add('is-over');
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
  }
  legend(el, sum) {
    for (const k of TIME_CATS) {
      if (!sum.by[k] && k === 'other') continue;
      const r = el.createDiv('tm-leg' + (sum.by[k] ? '' : ' is-zero'));
      r.style.setProperty('--cat', catColor(k));
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: CAT_LABEL[k] });
      r.createSpan({ cls: 'tm-leg-v', text: sum.by[k] ? fmtMin(sum.by[k]) : '—' });
    }
    if (sum.over && sum.target) {
      const r = el.createDiv('tm-leg is-over');
      r.style.setProperty('--cat', 'var(--nd-accent)');
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: 'Overtime' });
      r.createSpan({ cls: 'tm-leg-v', text: fmtMin(sum.over) });
    }
  }
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'Add time by hand', onClick: () => p.newEntry({}) });
    button(card.actions, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open the Time tab', onClick: () => p.openTab() });
    const body = card.body;
    body.addClass('tm-widget');
    // motion: everything rises in on first paint; after that only rows that weren't there before slide in
    let shown = false;
    let seen = new Set();
    const rowKey = (e) => e.id || `live:${e.pendingPath || e.path}:${e.start}`;
    const render = () => {
      if (!body.isConnected) return;
      body.empty();
      const key = moment().format('YYYY-MM-DD');
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
            title: e.live ? 'Discard live time' : 'Delete entry',
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
    const off = p.onChange(debounce(render, 300, true));
    const iv = window.setInterval(render, 60 * 1000);
    render();
    return {
      destroy() {
        off();
        window.clearInterval(iv);
      },
    };
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
};
