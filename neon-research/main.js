'use strict';
/*
 * Neon Research — a topic tree for learning: topics, subtopics and notes, quiz cards, link hints.
 * Version 1.6.5 · made by yobzz + Claude.
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

const ND_VERSION = '1.6.5';
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
const isTrue = (v) => v === true || v === 1 || /^(true|yes)$/i.test(v);
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
  const tags = cache ? (getAllTags(cache) || []).map((t) => normCat(t.slice(1).toLowerCase())) : [];
  if (isTrue(fm.untracked) || isTrue(fm.Untracked) || tags.includes('untracked')) return 'untracked';
  for (const c of CATS) if (isTrue(fm[c])) return c;
  for (const [old, c] of Object.entries(CAT_ALIAS)) if (isTrue(fm[old])) return c;
  if (typeof fm.category === 'string') {
    const c = normCat(fm.category.toLowerCase());
    if (CATS.includes(c)) return c;
  }
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
 * NEON RESEARCH — one tree: topics (folders) → subtopics (folders) → notes,
 * inside the research folder. Its own Research tab, separate from work.
 * ========================================================================= */
const VIEW_RESEARCH = 'neon-research';
const NR_DEFAULTS = {
  root: 'Learning/Core-topics', // first root's path, kept for older versions
  roots: null, // [{ name, path }]: each is its own tree, quiz and history (filled on load)
  activeRoot: 0, // index of the root shown in the tab
  countAsWork: false, // false: new notes get `untracked: true`, so Neon Time never counts them as work
  linkSuggest: true,
  open: [], // folder paths expanded in the tree
  cards: {}, // quiz card id -> { due, ivl }
};
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
const CARD_RE = /^\s*(?:[-*+]\s+)?(.+?)\s+::\s+(.+?)\s*$/;
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

/* ---- quiz ------------------------------------------------------------------- */
class QuizModal extends Modal {
  constructor(plugin, cards, label) {
    super(plugin.app);
    this.plugin = plugin;
    this.queue = cards.slice();
    this.label = label;
    this.done = 0;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-study');
    this.titleEl.setText(`Quiz · ${this.label}`);
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
      c.createDiv({
        cls: 'nr-study-done',
        text: this.done ? `✦ Done — ${this.done} card${this.done === 1 ? '' : 's'} reviewed.` : 'Nothing to quiz right now ✦',
      });
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
    try {
      await this.plugin.gradeCard(card, how);
    } catch (e) {
      console.error('Neon Research: could not save grade', e);
      new Notice('Could not save this grade');
    } finally {
      this.grading = false;
    }
    if (!this.containerEl.isConnected) return; // closed during the save
    this.done++;
    if (how === 'again') this.queue.push(card); // seen again in this session
    this.next();
  }
  onClose() {
    this.contentEl.empty();
    this.plugin.emitSoon();
  }
}

/** Quiz me: pick which topic (or all) to quiz, and whether only due cards or all of them. */
/** Add `question :: answer` cards to a note; stays open to add several. */
class FlashcardModal extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.added = 0;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-card-modal');
    this.titleEl.setText(`Flashcards · ${this.file.basename}`);
    const c = this.contentEl;
    const field = (label, ph) => {
      const w = c.createDiv('nr-card-field');
      w.createDiv({ cls: 'nr-card-label', text: label });
      return w.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: ph } });
    };
    const q = field('Question', 'e.g. What does the mitochondrion do?');
    const a = field('Answer', 'e.g. Makes energy (ATP) for the cell');
    const foot = c.createDiv('nd-modal-row');
    const info = foot.createSpan({ cls: 'nr-card-info', text: 'Enter adds the card · Esc closes' });
    const add = async () => {
      // one line per card, and " :: " is the separator, so neither may appear inside
      const clean = (v) => v.replace(/\s+/g, ' ').replace(/\s::\s/g, ' : ').trim();
      const qv = clean(q.value).replace(/^#+\s*/, '');
      const av = clean(a.value);
      if (!qv || !av) return (qv ? a : q).focus();
      try {
        await this.plugin.appendCard(this.file, `${qv} :: ${av}`);
      } catch (e) {
        console.error('Neon Research: could not add card', e);
        return new Notice('Could not add the card');
      }
      this.added++;
      info.setText(`✦ ${this.added} card${this.added === 1 ? '' : 's'} added · Enter adds another · Esc closes`);
      q.value = a.value = '';
      q.focus();
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), a.value.trim() ? add() : a.focus()));
    a.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), add()));
    button(foot, { text: 'Done', onClick: () => this.close() });
    button(foot, { text: 'Add card', cls: 'mod-cta', onClick: add });
    window.setTimeout(() => q.focus(), 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}

class QuizPickModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.onlyDue = true;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-pick');
    this.titleEl.setText('Quiz me');
    const top = this.contentEl.createDiv('nr-pick-top');
    const sw = top.createEl('label', { cls: 'nr-pick-switch' });
    const box = sw.createEl('input', { attr: { type: 'checkbox' } });
    box.checked = this.onlyDue;
    sw.appendText(' Only cards that are due');
    box.addEventListener('change', () => ((this.onlyDue = box.checked), this.draw()));
    this.list = this.contentEl.createDiv('nr-pick-list');
    this.draw();
  }
  draw() {
    const p = this.plugin;
    const list = this.list;
    list.empty();
    const root = p.rootFolder();
    const row = (folder, label, depth) => {
      const all = p.cardsUnder(folder);
      const due = p.dueCards(all);
      const n = this.onlyDue ? due.length : all.length;
      const r = list.createDiv('nr-pick-row' + (n ? '' : ' is-empty'));
      r.style.setProperty('--depth', String(depth));
      icon(r, depth < 0 ? 'library' : 'folder', 'nd-ico nr-folder-ico');
      r.createSpan({ cls: 'nr-name', text: label });
      r.createSpan({ cls: 'nr-pick-n', text: `${all.length} card${all.length === 1 ? '' : 's'}` });
      r.createSpan({ cls: 'nr-pick-due' + (due.length ? ' has-due' : ''), text: `${due.length} due` });
      if (n)
        r.addEventListener('click', () => {
          this.close();
          p.quiz(folder, label, !this.onlyDue);
        });
    };
    if (!root) return;
    row(root, 'All topics', -1);
    const walk = (f, depth) => {
      const subs = (f.children || []).filter((c) => c instanceof TFolder).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const c of subs) {
        row(c, c.name, depth);
        walk(c, depth + 1);
      }
    };
    walk(root, 0);
  }
  onClose() {
    this.contentEl.empty();
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

/* ---- the Research tab: one topic tree ------------------------------------------ */
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
    // f: one note's text changed but not its cards, so only its row's "edited" time moves
    this.register(this.plugin.onChange((f) => (f ? this.touchRow(f) : soon())));
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
    const rootFolder = p.rootFolder();
    const hero = root.createDiv('nd-hero nr-hero');
    const l = hero.createDiv('nr-hero-l');
    const roots = p.settings.roots;
    l.createDiv({ cls: 'nd-hero-greet', text: roots[p.settings.activeRoot].name });
    const nTopics = rootFolder ? rootFolder.children.filter((c) => c instanceof TFolder).length : 0;
    const nNotes = p.researchNotes().length;
    l.createDiv({ cls: 'nr-hero-sub', text: `${nTopics} topic${nTopics === 1 ? '' : 's'} · ${nNotes} note${nNotes === 1 ? '' : 's'}` });
    const acts = hero.createDiv('nr-acts');
    const due = p.dueCards(p.cardsUnder(rootFolder)).length;
    button(acts, { icon: 'graduation-cap', text: due ? `Quiz me (${due})` : 'Quiz me', title: 'Choose a topic to quiz', onClick: () => new QuizPickModal(p).open() });
    button(acts, { icon: 'folder-plus', text: 'Topic', cls: 'mod-cta', title: 'New topic', onClick: () => p.newTopic(rootFolder) });
    // section switch on its own row under the title (only with more than one section)
    if (roots.length > 1) pills(hero, roots.map((r, i) => [i, r.name]), p.settings.activeRoot, (i) => p.setActiveRoot(i), 'nr-roots');

    // the tree sits in one panel (a "window" for the pattern, like the dashboard cards)
    const panel = root.createDiv('nd-card nr-panel');
    const kids = rootFolder ? this.childrenOf(rootFolder) : { folders: [], notes: [] };
    if (!kids.folders.length && !kids.notes.length) {
      const e = panel.createDiv('nr-empty');
      button(e, { icon: 'folder-plus', text: 'Add your first topic', cls: 'mod-cta', onClick: () => p.newTopic(rootFolder) });
    } else {
      const tree = panel.createDiv('nr-tree');
      for (const f of kids.folders) this.folderRow(tree, f, 0);
      for (const f of kids.notes) this.noteRow(tree, f, 0);
    }
    madeWith(root.createDiv('nr-foot'), 'Neon Research');
    sc.scrollTop = top;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  childrenOf(folder) {
    const folders = [];
    const notes = [];
    for (const c of folder.children || []) {
      if (c instanceof TFolder) folders.push(c);
      else if (c instanceof TFile && c.extension === 'md') notes.push(c);
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
    row.createSpan({ cls: 'nr-name', text: folder.name });
    // right-hand columns have fixed widths so they line up from row to row
    const n = p.notesUnder(folder).length;
    row.createSpan({ cls: 'nr-col nr-c-count', text: `${n} note${n === 1 ? '' : 's'}` });
    const due = p.dueCards(p.cardsUnder(folder)).length;
    const dc = row.createSpan('nr-col nr-c-due');
    if (due) dc.createSpan({ cls: 'nr-due', text: `${due} to quiz` });
    row.createSpan('nr-col nr-c-when');
    const acts = row.createDiv('nr-row-acts');
    button(acts, { icon: 'plus', cls: 'nd-icon-btn', title: 'Add a subtopic or a note', onClick: (e) => (e.stopPropagation(), this.addMenu(folder, e)) });
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'Rename, quiz, delete', onClick: (e) => (e.stopPropagation(), this.folderMenu(folder, e)) });
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
    const cards = p.cardsIn(file).length;
    row.createSpan({ cls: 'nr-col nr-c-count', text: cards ? `${cards} card${cards === 1 ? '' : 's'}` : '' });
    row.createSpan('nr-col nr-c-due');
    const when = row.createSpan({ cls: 'nr-col nr-c-when', text: shortAgo(file.stat.mtime) });
    this.rows.set(file.path, when);
    tip(when, `Edited ${moment(file.stat.mtime).format('D MMM YYYY, HH:mm')}`);
    const acts = row.createDiv('nr-row-acts');
    acts.createSpan('nr-act-space'); // notes have one button: keep its column where folders have two
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'Rename, delete', onClick: (e) => (e.stopPropagation(), this.noteMenu(file, e)) });
    row.addEventListener('click', (e) => openFile(this.app, file, e));
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
    m.addItem((i) => i.setTitle('Quiz this topic').setIcon('graduation-cap').onClick(() => p.quiz(folder, folder.name)));
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
      .setDesc('Each section is a folder shown as its own tree (folders are topics, notes are notes) with its own quiz and history. Switch between them at the top of the tab.');
    // only re-read notes once the user stops typing a folder path
    const rescan = debounce(async () => {
      s.root = s.roots[0].path;
      save();
      await p.refreshCardText();
      p.emitSoon();
      p.updateLinkHint();
    }, 600, true);
    s.roots.forEach((r, i) => {
      const row = new Setting(containerEl)
        .addText((t) => t.setPlaceholder('Name').setValue(r.name).onChange((v) => ((r.name = v.trim() || r.path.split('/').pop()), save(), p.emitSoon())))
        .addText((t) => t.setPlaceholder('Folder, e.g. Learning/School').setValue(r.path).onChange((v) => ((r.path = normalizePath(v.trim() || r.path)), rescan())));
      if (s.roots.length > 1)
        row.addExtraButton((b) =>
          b.setIcon('trash-2').setTooltip('Remove this section (its notes stay)').onClick(() => {
            s.roots.splice(i, 1);
            if (s.activeRoot >= s.roots.length) s.activeRoot = 0;
            rescan();
            this.display();
          }),
        );
    });
    new Setting(containerEl).addButton((b) =>
      b.setButtonText('Add section').onClick(async () => {
        const path = `Learning/Section ${s.roots.length + 1}`;
        s.roots.push({ name: `Section ${s.roots.length + 1}`, path });
        await ensureFolder(p.app, path);
        rescan();
        this.display();
      }),
    );
    new Setting(containerEl)
      .setName('Count research as work time')
      .setDesc('Off: new research notes get “untracked: true”, so Neon Time never counts them as work.')
      .addToggle((t) => t.setValue(s.countAsWork).onChange((v) => ((s.countAsWork = v), save())));
    new Setting(containerEl)
      .setName('Link suggestions')
      .setDesc('In research notes, the status bar offers to link words that match other research note titles.')
      .addToggle((t) => t.setValue(s.linkSuggest).onChange((v) => ((s.linkSuggest = v), save(), p.updateLinkHint())));
    madeWith(containerEl, 'Neon Research');
  }
}

/* ---- plugin ------------------------------------------------------------------ */
module.exports = class NeonResearch extends Plugin {
  async onload() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, NR_DEFAULTS, raw);
    if (!Array.isArray(this.settings.open)) this.settings.open = [];
    if (!this.settings.cards || typeof this.settings.cards !== 'object') this.settings.cards = {};
    const s = this.settings;
    if (!Array.isArray(s.roots) || !s.roots.length) s.roots = [{ name: 'Research', path: normalizePath(s.root || NR_DEFAULTS.root) }, { name: 'School', path: 'Learning/School' }];
    s.roots = s.roots.filter((r) => r && typeof r.path === 'string' && r.path.trim()).map((r) => ({ name: String(r.name || r.path.split('/').pop()), path: normalizePath(r.path) }));
    if (!s.roots.length) s.roots = [{ name: 'Research', path: NR_DEFAULTS.root }];
    if (!(s.activeRoot >= 0 && s.activeRoot < s.roots.length)) s.activeRoot = 0;
    s.root = s.roots[0].path;
    this.cardCache = new Map(); // path -> { text, cards }: each note is parsed once per change
    this.listeners = new Set();
    this.cardText = new Map();
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.addRibbonIcon('library', 'Research', () => this.openTab());
    this.addCommand({ id: 'open-research', name: 'Open the Research tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-topic', name: 'New topic', callback: () => this.newTopic(this.rootFolder()) });
    this.addCommand({ id: 'quiz-all', name: 'Quiz me…', callback: () => new QuizPickModal(this).open() });
    this.addCommand({
      id: 'add-flashcard',
      name: 'Add flashcard to this note',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== 'md' || !this.inRoot(f)) return false;
        if (!checking) new FlashcardModal(this, f).open();
        return true;
      },
    });
    // a Flashcards button in the header of notes inside a section
    const syncButtons = () => this.app.workspace.getLeavesOfType('markdown').forEach((l) => this.syncCardButton(l.view));
    this.registerEvent(this.app.workspace.on('file-open', syncButtons));
    this.registerEvent(this.app.workspace.on('active-leaf-change', syncButtons));
    this.app.workspace.onLayoutReady(syncButtons);
    this.register(() => this.app.workspace.getLeavesOfType('markdown').forEach((l) => l.view.nrCardBtn && (l.view.nrCardBtn.remove(), (l.view.nrCardBtn = null))));
    this.addCommand({ id: 'link-suggestions', name: 'Suggest links in this note', callback: () => this.showLinkSuggestions(true) });
    this.addSettingTab(new NeonResearchSettingTab(this.app, this));

    // status bar: "N possible links" for the open research note
    this.linkEl = this.addStatusBarItem();
    this.linkEl.addClass('nd-status', 'nr-status', 'mod-clickable');
    this.linkEl.addEventListener('click', () => this.showLinkSuggestions(true));
    this.linkEl.hide();
    const hint = debounce(() => this.updateLinkHint(), 800, true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hint));
    // quiz-card text cache, kept current from the change event (it hands over the note's text)
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, data) => {
        if (!this.inRoot(f)) return;
        this.noteText(f, data);
        hint();
      }),
    );
    const anyChange = (f) => (this.inRoot(f) || f instanceof TFolder) && this.emitSoon();
    this.registerEvent(this.app.vault.on('create', anyChange));
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        for (const p of [...this.cardText.keys()]) if (p === f.path || p.startsWith(f.path + '/')) (this.cardText.delete(p), this.cardCache.delete(p));
        // forget quiz history of deleted notes, and the open state of deleted folders
        for (const id of Object.keys(this.settings.cards)) if (id.startsWith(f.path + '|') || id.startsWith(f.path + '/')) delete this.settings.cards[id];
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
      await this.refreshCardText();
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
    return this.settings.roots[this.settings.activeRoot].path;
  }
  rootFolder(path = this.root) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }
  /** The root a file lives in (any root, not only the shown one), or null. */
  rootOf(f) {
    return (f && this.settings.roots.find((r) => f.path.startsWith(r.path + '/'))) || null;
  }
  inRoot(f) {
    return !!this.rootOf(f);
  }
  setActiveRoot(i) {
    if (i === this.settings.activeRoot || !this.settings.roots[i]) return;
    this.settings.activeRoot = i;
    this.saveSoon();
    this.emitSoon();
  }
  notesUnder(folder) {
    if (!folder) return [];
    const out = [];
    const walk = (x) => {
      for (const c of x.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') out.push(c);
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
        await ensureFolder(this.app, base);
        const path = normalizePath(`${base}/${name}`);
        if (this.app.vault.getAbstractFileByPath(path)) return new Notice(`“${name}” already exists here`);
        await this.app.vault.createFolder(path);
        if (parent) this.toggleOpen(parent.path, true);
        this.toggleOpen(path, true);
      },
    }).open();
  }
  newNote(folder) {
    new PromptModal(this.app, {
      title: `New note in ${folder.name}`,
      placeholder: 'e.g. Cell membrane',
      cta: 'Create',
      onSubmit: async (v) => {
        if (!v.trim()) return;
        const body = this.settings.countAsWork ? '' : '---\nuntracked: true\n---\n';
        const f = await createUnique(this.app, folder.path, v, body);
        this.toggleOpen(folder.path, true);
        openFile(this.app, f);
      },
    }).open();
  }
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
  }
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
  }
  onRename(f, old) {
    if (this.cardText.has(old)) (this.cardText.set(f.path, this.cardText.get(old)), this.cardText.delete(old));
    // quiz history and open folders follow a rename or move (also of a parent folder)
    const move = (p) => (p === old ? f.path : p.startsWith(old + '/') ? f.path + p.slice(old.length) : p);
    const cards = this.settings.cards;
    for (const id of Object.keys(cards)) {
      const [path, ...q] = id.split('|');
      const np = move(path);
      if (np !== path) ((cards[[np, ...q].join('|')] = cards[id]), delete cards[id]);
    }
    for (const k of [...this.cardText.keys()]) {
      const nk = move(k);
      if (nk !== k) (this.cardText.set(nk, this.cardText.get(k)), this.cardText.delete(k));
    }
    this.settings.open = this.settings.open.map(move);
    this.saveSoon();
    this.emitSoon();
  }

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
  }
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
  }
  async showLinkSuggestions(fromUser) {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const hits = this.inRoot(f) ? await this.linkHits(f) : [];
    if (!hits.length) return fromUser && new Notice('No unlinked mentions of research notes here.');
    new LinkSuggestModal(this, f, hits).open();
  }
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

  syncCardButton(view) {
    const want = !!(view && view.file && this.inRoot(view.file));
    if (want && !view.nrCardBtn) view.nrCardBtn = view.addAction('layers', 'Add flashcards', () => view.file && new FlashcardModal(this, view.file).open());
    else if (!want && view && view.nrCardBtn) (view.nrCardBtn.remove(), (view.nrCardBtn = null));
  }
  /** Append one card line to a note: through the editor when it's open (keeps cursor and undo), else in the file. */
  async appendCard(file, line) {
    const leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === file && l.view.editor);
    if (leaf) {
      const ed = leaf.view.editor;
      const last = ed.lastLine();
      const end = { line: last, ch: ed.getLine(last).length };
      ed.replaceRange((ed.getLine(last).trim() ? '\n' : '') + line + '\n', end);
      return;
    }
    await this.app.vault.process(file, (d) => d.replace(/\s*$/, '') + `\n${line}\n`);
  }

  /* ---- quiz cards ---- */
  parseCards(f, text) {
    const out = [];
    let fence = false;
    for (const line of stripFrontmatter(text).split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence || /^\s*%%/.test(line)) continue;
      // a "::" inside inline code doesn't make a card
      if (!/\s::\s/.test(line.replace(/`[^`]*`/g, (c) => ' '.repeat(c.length)))) continue;
      const m = line.match(CARD_RE);
      if (!m || /^#/.test(m[1])) continue;
      const q = m[1].trim();
      // the same question twice in a note: each keeps its own history
      const n = out.filter((c) => c.q === q).length;
      out.push({ file: f, q, a: m[2].trim(), id: `${f.path}|${q}${n ? `#${n + 1}` : ''}` });
    }
    return out;
  }
  cardsIn(file) {
    const text = this.cardText.get(file.path);
    if (text == null) return [];
    const c = this.cardCache.get(file.path);
    if (c && c.text === text && c.file === file) return c.cards;
    const cards = this.parseCards(file, text);
    this.cardCache.set(file.path, { text, file, cards });
    return cards;
  }
  /** New text of a research note: keep quiz history when a question was edited; redraw only if the cards changed. */
  noteText(f, text) {
    const before = this.cardsIn(f).map((c) => c.id);
    this.cardText.set(f.path, text);
    const after = this.cardsIn(f).map((c) => c.id);
    if (before.join('\n') === after.join('\n')) return this.listeners.forEach((fn) => fn(f)); // light update
    // edited questions: unchanged cards keep their history; changed ones are paired in order
    const h = this.settings.cards;
    const gone = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    if (gone.length && gone.length === added.length) {
      const old = gone.map((id) => h[id]);
      gone.forEach((id) => delete h[id]);
      added.forEach((id, i) => old[i] && !h[id] && (h[id] = old[i]));
      this.saveSoon();
    }
    this.emitSoon();
  }
  cardsUnder(folder) {
    return this.notesUnder(folder).flatMap((f) => this.cardsIn(f));
  }
  async refreshCardText() {
    const notes = this.allNotes();
    const texts = await Promise.all(notes.map((f) => this.app.vault.cachedRead(f).catch(() => '')));
    notes.forEach((f, i) => this.cardText.set(f.path, texts[i]));
  }
  dueCards(cards) {
    const now = Date.now();
    return cards.filter((c) => {
      const s = this.settings.cards[c.id];
      return !s || s.due <= now;
    });
  }
  async quiz(folder, label, allCards = false) {
    // card text is kept current by the 'changed' event; no need to re-read every note here
    const cards = folder ? this.cardsUnder(folder) : [];
    new QuizModal(this, allCards ? cards : this.dueCards(cards), label).open();
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
