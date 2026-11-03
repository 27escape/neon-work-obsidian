'use strict';
/*
 * Neon Write — table picker, slash menu, selection toolbar and a faint pattern behind notes.
 * Version 1.6.5 · made by yobzz + Claude.
 *
 * Everything runs locally: no network requests, no telemetry, no eval,
 * no shell access. It only edits the note you're typing in.
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
 * NEON WRITE — nicer note writing: a rows × columns table picker, a / menu,
 * a toolbar on selected text and a barely-there pattern behind the note.
 * ========================================================================= */
const { MarkdownView, EditorSuggest } = obsidian;
const NW_DEFAULTS = {
  slashMenu: true,
  toolbar: true,
  liftedWindow: true,
  themeFonts: true,
  styledTables: true,
  moveImages: true,
  notePattern: true,
  patternOpacity: 35, // percent of the dashboard pattern's strength (already faint by design)
};
const GRID_COLS = 10;
const GRID_ROWS = 8;

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
function toggleWrap(editor, open, close = open) {
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
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

/* ---- slash menu ------------------------------------------------------- */
const SLASH_ITEMS = [
  { id: 'table', icon: 'table', label: 'Table', hint: 'pick rows × columns', keys: ['table', 'grid'], run: (ed, p) => p.openTablePicker(ed) },
  { id: 'h1', icon: 'heading-1', label: 'Heading 1', hint: '#', keys: ['h1', 'heading', 'title'], run: (ed) => setLinePrefix(ed, '# ') },
  { id: 'h2', icon: 'heading-2', label: 'Heading 2', hint: '##', keys: ['h2', 'heading'], run: (ed) => setLinePrefix(ed, '## ') },
  { id: 'h3', icon: 'heading-3', label: 'Heading 3', hint: '###', keys: ['h3', 'heading'], run: (ed) => setLinePrefix(ed, '### ') },
  { id: 'todo', icon: 'check-square', label: 'Checklist', hint: '- [ ]', keys: ['todo', 'task', 'check'], run: (ed) => setLinePrefix(ed, '- [ ] ') },
  { id: 'bullet', icon: 'list', label: 'Bullet list', hint: '-', keys: ['bullet', 'list', 'ul'], run: (ed) => setLinePrefix(ed, '- ') },
  { id: 'number', icon: 'list-ordered', label: 'Numbered list', hint: '1.', keys: ['number', 'ol', 'list'], run: (ed) => setLinePrefix(ed, '1. ') },
  { id: 'quote', icon: 'quote', label: 'Quote', hint: '>', keys: ['quote'], run: (ed) => setLinePrefix(ed, '> ') },
  { id: 'callout', icon: 'message-square-quote', label: 'Callout', hint: '> [!note]', keys: ['callout', 'note', 'info'], run: (ed) => makeCallout(ed) },
  {
    id: 'code',
    icon: 'code-2',
    label: 'Code block',
    hint: '```',
    keys: ['code', 'snippet'],
    run: (ed) => {
      const l = ed.getCursor().line;
      ed.setLine(l, '```\n\n```');
      ed.setCursor({ line: l + 1, ch: 0 });
    },
  },
  {
    id: 'divider',
    icon: 'minus',
    label: 'Divider',
    hint: '---',
    keys: ['divider', 'line', 'hr'],
    run: (ed) => {
      const l = ed.getCursor().line;
      // a blank line first, or the text above would turn into a heading
      const pre = l > 0 && ed.getLine(l - 1).trim() ? '\n' : '';
      ed.setLine(l, `${pre}---\n`);
      ed.setCursor({ line: l + (pre ? 2 : 1), ch: 0 });
    },
  },
  { id: 'link', icon: 'link', label: 'Link to note', hint: '[[', keys: ['link', 'note', 'wiki'], run: (ed) => ed.replaceSelection('[[') },
  { id: 'date', icon: 'calendar', label: 'Today’s date', hint: moment().format('YYYY-MM-DD'), keys: ['date', 'today'], run: (ed) => ed.replaceSelection(moment().format('YYYY-MM-DD')) },
];
class SlashSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.limit = 20;
  }
  onTrigger(cursor, editor) {
    if (!this.plugin.settings.slashMenu) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    // a / at the start of a line or after a space, so paths and URLs don't open the menu
    const m = before.match(/(?:^|\s)\/([\w-]{0,20})$/);
    if (!m || inCodeBlock(editor, cursor.line)) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] };
  }
  getSuggestions(ctx) {
    const q = ctx.query.toLowerCase();
    // other Neon plugins (e.g. Neon Research) add their own items through addSlashItem
    const items = [...SLASH_ITEMS, ...this.plugin.slashExtras.values()];
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.keys.some((k) => k.startsWith(q)));
  }
  renderSuggestion(item, el) {
    el.addClass('nw-slash-item');
    icon(el, item.icon, 'nw-slash-ico');
    el.createSpan({ cls: 'nw-slash-label', text: item.label });
    el.createSpan({ cls: 'nw-slash-hint', text: item.hint });
  }
  selectSuggestion(item) {
    const ctx = this.context;
    if (!ctx) return;
    const ed = ctx.editor;
    ed.replaceRange('', ctx.start, ctx.end);
    ed.setCursor(ctx.start);
    this.close();
    item.run(ed, this.plugin);
  }
}

/* ---- selection toolbar -------------------------------------------------- */
const TOOLBAR = [
  { icon: 'bold', title: 'Bold', run: (ed) => toggleWrap(ed, '**') },
  { icon: 'italic', title: 'Italic', run: (ed) => toggleWrap(ed, '*') },
  { icon: 'strikethrough', title: 'Strikethrough', run: (ed) => toggleWrap(ed, '~~') },
  { icon: 'highlighter', title: 'Highlight', run: (ed) => toggleWrap(ed, '==') },
  { icon: 'code', title: 'Inline code', run: (ed) => toggleWrap(ed, '`') },
  { icon: 'link', title: 'Link to note', run: (ed) => toggleWrap(ed, '[[', ']]') },
  { sep: true },
  { icon: 'heading', title: 'Heading (H1 → H2 → H3 → none)', run: (ed) => cycleHeading(ed) },
  { icon: 'message-square-quote', title: 'Callout', run: (ed) => makeCallout(ed) },
];
class SelectionToolbar {
  constructor(plugin) {
    this.plugin = plugin;
    const el = (this.el = document.body.createDiv('nw-toolbar nd-root'));
    for (const b of TOOLBAR) {
      if (b.sep) {
        el.createDiv('nw-tb-sep');
        continue;
      }
      const btn = el.createEl('button', { cls: 'nw-tb-btn', attr: { type: 'button', 'aria-label': b.title } });
      setIcon(btn, b.icon);
      tip(btn, b.title);
      // mousedown, not click: the selection in the note must survive the press
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const ed = this.editor();
        if (!ed) return;
        b.run(ed);
        window.setTimeout(() => this.update(), 0);
      });
    }
  }
  editor() {
    const v = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return v && v.getMode() === 'source' ? v.editor : null;
  }
  /** Show above the selection when there is one in the active note; hide otherwise. */
  update() {
    const v = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const ed = v && v.getMode() === 'source' ? v.editor : null;
    const sel = window.getSelection();
    if (!this.plugin.settings.toolbar || !ed || !ed.somethingSelected() || !sel || !sel.rangeCount || !v.contentEl.contains(sel.anchorNode)) return this.hide();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return this.hide();
    const el = this.el;
    el.addClass('is-shown');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8; // no room above: sit below
    el.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
    el.style.top = `${y}px`;
  }
  hide() {
    this.el.removeClass('is-shown');
  }
  destroy() {
    this.el.remove();
  }
}

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
    new Setting(containerEl).setName('Slash menu').setDesc('Type / at the start of a line or after a space: table, headings, lists, callout, code, divider, date.').addToggle((t) => t.setValue(s.slashMenu).onChange((v) => ((s.slashMenu = v), p.saveSettings())));
    new Setting(containerEl).setName('Toolbar on selected text').setDesc('Bold, italic, strikethrough, highlight, code, link, heading and callout.').addToggle((t) => t.setValue(s.toolbar).onChange((v) => ((s.toolbar = v), p.saveSettings(), p.toolbar && p.toolbar.hide())));
    new Setting(containerEl)
      .setName('Move new images to Core/Images')
      .setDesc('New .png, .jpg and .jpeg files (pasted, dragged or copied in) move to the Images folder inside your Core folder. Links to them keep working.')
      .addToggle((t) => t.setValue(s.moveImages).onChange((v) => ((s.moveImages = v), p.saveSettings())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('Move existing images there now').onClick(() => p.moveExistingImages()));
    new Setting(containerEl)
      .setName('Lifted writing window')
      .setDesc('The note sits on a rounded, slightly raised card, with the pattern around it.')
      .addToggle((t) => t.setValue(s.liftedWindow).onChange((v) => ((s.liftedWindow = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Theme fonts in notes')
      .setDesc('Body text, headings and code use the fonts of the Neon theme you picked on the dashboard.')
      .addToggle((t) => t.setValue(s.themeFonts).onChange((v) => ((s.themeFonts = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Styled tables')
      .setDesc('Tables in notes get a rounded card, a tinted header and soft row lines in the theme colours.')
      .addToggle((t) => t.setValue(s.styledTables).onChange((v) => ((s.styledTables = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Pattern behind notes')
      .setDesc('The dashboard pattern, dimmed right down, behind the note you are writing. Needs Neon Deck.')
      .addToggle((t) => t.setValue(s.notePattern).onChange((v) => ((s.notePattern = v), p.saveSettings(), p.mountNotePattern())));
    new Setting(containerEl)
      .setName('Pattern strength behind notes')
      .setDesc('Percent of the dashboard pattern. Low values are barely visible.')
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(s.patternOpacity).setDynamicTooltip().onChange((v) => ((s.patternOpacity = v), p.saveSettings(), p.applyPatternOpacity())));
    madeWith(containerEl, 'Neon Write');
  }
}

/* ---- plugin ------------------------------------------------------------- */
module.exports = class NeonWrite extends Plugin {
  async onload() {
    this.settings = Object.assign({}, NW_DEFAULTS, (await this.loadData()) || {});
    this.slashExtras = new Map();
    this.registerEditorSuggest(new SlashSuggest(this));
    // tell other Neon plugins they can add slash items now (they also check on their own load)
    this.app.workspace.onLayoutReady(() => this.app.workspace.trigger('neon-write:ready', this));
    this.addCommand({ id: 'insert-table', name: 'Insert table…', editorCallback: (ed) => this.openTablePicker(ed) });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        menu.addItem((i) => i.setTitle('Insert table…').setIcon('table').onClick(() => this.openTablePicker(editor)));
      }),
    );

    this.toolbar = new SelectionToolbar(this);
    this.register(() => this.toolbar.destroy());
    const later = () => window.setTimeout(() => this.toolbar.update(), 10);
    this.registerDomEvent(document, 'mouseup', later);
    this.registerDomEvent(document, 'keyup', (e) => (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && e.key === 'a') ? later() : this.toolbar.hide()));
    this.registerDomEvent(document, 'scroll', () => this.toolbar.hide(), true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.toolbar.hide()));

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountNotePattern()));
    this.app.workspace.onLayoutReady(() => {
      this.mountNotePattern();
      // registered after startup: Obsidian fires 'create' for every file while it loads the vault
      this.registerEvent(this.app.vault.on('create', (f) => this.onCreate(f)));
    });
    this.addCommand({ id: 'move-images', name: 'Move existing images to Core/Images', callback: () => this.moveExistingImages() });
    this.applyLook();
    this.addSettingTab(new NeonWriteSettingTab(this.app, this));
  }
  onunload() {
    this.unmountNotePattern();
    document.body.removeClass('nw-lifted', 'nw-fonts', 'nw-tables');
  }
  applyLook() {
    document.body.toggleClass('nw-lifted', this.settings.liftedWindow);
    document.body.toggleClass('nw-fonts', this.settings.themeFonts);
    document.body.toggleClass('nw-tables', this.settings.styledTables);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** For other Neon plugins: add or remove a slash-menu item ({ id, icon, label, hint, keys, run(editor) }). */
  addSlashItem(item) {
    this.slashExtras.set(item.id, item);
  }
  removeSlashItem(id) {
    this.slashExtras.delete(id);
  }
  openTablePicker(editor) {
    new TablePicker(editor, caretRect(editor));
  }

  /* images into Core/Images ------------------------------------------------ */
  imageFolder() {
    const deck = neonPlugin(this.app, 'neon-deck');
    const core = (deck && deck.settings && deck.settings.coreFolder) || 'Core';
    return normalizePath(`${core}/Images`);
  }
  isLooseImage(f) {
    const dir = this.imageFolder();
    return f instanceof TFile && /^(png|jpe?g)$/i.test(f.extension) && !f.path.startsWith(dir + '/');
  }
  onCreate(f) {
    if (!this.settings.moveImages || !this.isLooseImage(f)) return;
    // give Obsidian a moment to write the ![[link]] into the note, so the rename updates it too
    window.setTimeout(async () => {
      if (this.app.vault.getAbstractFileByPath(f.path) !== f || !this.isLooseImage(f)) return;
      try {
        await this.moveImage(f);
        new Notice(`Image moved to ${this.imageFolder()}`);
      } catch (e) {
        console.error('Neon Write: could not move image', e);
      }
    }, 1500);
  }
  /** Move one image into the Images folder (renamed with a number if the name is taken). Links follow. */
  async moveImage(f) {
    const dir = this.imageFolder();
    await ensureFolder(this.app, dir);
    let dest = normalizePath(`${dir}/${f.name}`);
    if (this.app.vault.getAbstractFileByPath(dest)) dest = uniquePath(this.app, dir, f.basename, f.extension);
    await this.app.fileManager.renameFile(f, dest);
  }
  moveExistingImages() {
    const loose = this.app.vault.getFiles().filter((f) => this.isLooseImage(f));
    if (!loose.length) return new Notice(`No .png or .jpg images outside ${this.imageFolder()}.`);
    new ConfirmModal(this.app, {
      title: 'Move images',
      text: `Move ${loose.length} image${loose.length === 1 ? '' : 's'} into ${this.imageFolder()}? Links to them are updated.`,
      cta: 'Move',
      warning: false,
      onConfirm: async () => {
        let n = 0;
        for (const f of loose) {
          try {
            await this.moveImage(f);
            n++;
          } catch (e) {
            console.error('Neon Write: could not move image', f.path, e);
          }
        }
        new Notice(`Moved ${n} image${n === 1 ? '' : 's'} to ${this.imageFolder()}`);
      },
    }).open();
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
      console.error('Neon Write pattern', e);
    }
    p.host.removeClass('nw-pattern-host', 'nd-has-pattern');
  }
  applyPatternOpacity() {
    if (this.pat) this.pat.host.style.setProperty('--nw-pattern-opacity', String(this.settings.patternOpacity / 100));
  }
};
