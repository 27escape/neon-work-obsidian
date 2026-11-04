'use strict';
/*
 * Neon Tickets — ticket tracker, compact ticket view, self-writing log, done folder, monthly counter.
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

/* ------------------------------------------------------------------ */
/* Neon Tickets                                                        */
/* ------------------------------------------------------------------ */

const VIEW_TICKETS = 'neon-deck-tickets';
const VIEW_TICKET = 'neon-ticket';
const TICKET_STATUS = ['open', 'in-progress', 'waiting', 'done'];
const TICKET_STATUS_LABEL = { open: 'Open', 'in-progress': 'In progress', waiting: 'Waiting', done: 'Done' };
const TICKET_PRIOS = ['low', 'normal', 'high', 'urgent'];
const TICKET_PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const TICKET_BUCKETS = [
  ['followup', 'Follow up'],
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['week', 'Next 7 days'],
  ['later', 'Later'],
  ['nodate', 'No due date'],
  ['done', 'Done'],
];
const TICKETS_DEFAULTS = {
  ticketFolder: 'Core/Tickets',
  doneFolder: 'Done',
  autoFile: true,
  openInTicketView: true,
  popup: true,
  defaultDays: 7,
  defaultCategory: 'operations',
  reminders: true,
  remindDays: 1,
  autoFollowUpDays: 3,
  notified: {},
  migrated: false,
  // ticket templates: { id, name, steps[], description, priority, dueDays } — kept here, never as notes
  templates: [],
  tabSort: 'due', // Tickets tab sort / group (TICKET_SORTS)
  statusLog: [], // { t, id, title, status, path }: tickets set to a status below (Recently done on the dashboard)
  activityStatuses: ['done', 'waiting'],
};
const DUE_CHIPS = [[1, '1d'], [3, '3d'], [7, '1w'], [14, '2w'], [30, '1m']];
const SEC = {
  description: { re: /^#{1,6}\s+(description|summary)\s*$/i, head: '## Description' },
  steps: { re: /^#{1,6}\s+(next steps|steps|first steps)\s*$/i, head: '## Next steps' },
  log: { re: /^#{1,6}\s+log\s*$/i, head: '## Log' },
  time: { re: /^#{1,6}\s+time( logged)?\s*$/i, head: '## Time' },
  shots: { re: /^#{1,6}\s+(screenshots|images|attachments)\s*$/i, head: '## Screenshots' },
};
const SEC_ORDER = ['description', 'steps', 'shots', 'log', 'time'];
const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const STAMP = () => moment().format('YYYY-MM-DD HH:mm');

function normTicketStatus(v) {
  const s = String(v || 'open').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (/^(done|closed|resolved|completed?|cancell?ed|erledigt)$/.test(s)) return 'done';
  if (/^(in-?progress|doing|active|wip|started)$/.test(s)) return 'in-progress';
  if (/^(waiting|blocked|on-?hold|pending|wartet)$/.test(s)) return 'waiting';
  return 'open';
}
function normTicketPrio(v) {
  const s = String(v || 'normal').trim().toLowerCase();
  if (/^(urgent|critical|p0|p1|asap)$/.test(s)) return 'urgent';
  if (/^(high|p2)$/.test(s)) return 'high';
  if (/^(low|p4|p5)$/.test(s)) return 'low';
  return 'normal';
}
const daysFromToday = (m) => m.clone().startOf('day').diff(moment().startOf('day'), 'days');
function ticketDueText(t) {
  if (t.status === 'done') return t.completed ? `done ${t.completed.format('D MMM')}` : 'done';
  if (t.bucket === 'followup') return 'follow up';
  if (!t.due) return 'no date';
  const d = t.daysLeft;
  if (d < -1) return `${-d}d late`;
  if (d === -1) return '1d late';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 14) return `in ${d}d`;
  return `in ${Math.round(d / 7)}w`;
}
function ticketSort(a, b) {
  if ((a.bucket === 'followup') !== (b.bucket === 'followup')) return a.bucket === 'followup' ? -1 : 1;
  const ad = a.due ? a.due.valueOf() : null;
  const bd = b.due ? b.due.valueOf() : null;
  if (ad !== bd) {
    if (ad === null) return 1;
    if (bd === null) return -1;
    return ad - bd;
  }
  return TICKET_PRIO_RANK[a.priority] - TICKET_PRIO_RANK[b.priority] || a.title.localeCompare(b.title);
}

/** Sort / group options of the Tickets tab (item 38); 'due' is the original due-date buckets. */
const TICKET_SORTS = [
  ['due', 'Due date'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['changed', 'Recently changed'],
  ['title', 'Title A–Z'],
  ['id', 'Ticket ID'],
  ['jira', 'Jira key'],
];
const byText = (k) => (a, b) => (a[k] || '').localeCompare(b[k] || '', undefined, { numeric: true, sensitivity: 'base' }) || a.title.localeCompare(b.title);
/** Tickets in sections for a sort mode: [[key, label, tickets]], from data already in memory. */
function ticketGroups(items, mode) {
  const label = (s) => s[0].toUpperCase() + s.slice(1);
  if (mode === 'status') return TICKET_STATUS.map((st) => [`status-${st}`, TICKET_STATUS_LABEL[st], items.filter((t) => t.status === st).sort(ticketSort)]);
  if (mode === 'priority') return [...TICKET_PRIOS].reverse().map((pr) => [`prio-${pr}`, label(pr), items.filter((t) => t.priority === pr).sort(ticketSort)]);
  const flat = {
    newest: ['Newest first', (a, b) => b.created.valueOf() - a.created.valueOf()],
    oldest: ['Oldest first', (a, b) => a.created.valueOf() - b.created.valueOf()],
    changed: ['Recently changed', (a, b) => b.file.stat.mtime - a.file.stat.mtime],
    title: ['Title A–Z', byText('title')],
    id: ['Ticket ID', byText('id')],
    jira: ['Jira key', (a, b) => (!a.jira - !b.jira) || byText('jira')(a, b)],
  }[mode];
  if (flat) return [['flat', flat[0], items.slice().sort(flat[1])]];
  return TICKET_BUCKETS.map(([bucket, l]) => {
    const g = items.filter((t) => t.bucket === bucket);
    if (bucket === 'done') g.sort((a, b) => (b.completed ? b.completed.valueOf() : b.file.stat.mtime) - (a.completed ? a.completed.valueOf() : a.file.stat.mtime));
    return [bucket, l, g];
  });
}

/* ---- ticket note body -------------------------------------------------- */
function findSection(lines, key) {
  const start = lines.findIndex((l) => SEC[key].re.test(l.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}
/** Append `line` to section `key` (created in canonical order when missing); log lines go on top. */
function addToSection(text, key, line) {
  const lines = text.split('\n');
  let sec = findSection(lines, key);
  if (!sec) {
    // insert before the first later section, else at the end
    let at = lines.length;
    for (const k of SEC_ORDER.slice(SEC_ORDER.indexOf(key) + 1)) {
      const s = findSection(lines, k);
      if (s) {
        at = s[0];
        break;
      }
    }
    const block = [SEC[key].head, line, ''];
    while (at > 0 && lines[at - 1] === '' && at === lines.length) at--;
    if (at > 0 && lines[at - 1] !== '') block.unshift('');
    lines.splice(at, 0, ...block);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  if (key === 'log') {
    // newest log line on top, so the note reads like every view
    let at = sec[0] + 1;
    while (at < sec[1] && lines[at].trim() === '') at++;
    lines.splice(at === sec[1] ? sec[0] + 1 : at, 0, line);
    return lines.join('\n');
  }
  let end = sec[1];
  while (end - 1 > sec[0] && lines[end - 1].trim() === '') end--;
  // an empty "- [ ]" placeholder from old templates is replaced instead of kept
  if (key === 'steps' && end - 1 > sec[0] && /^\s*[-*]\s+\[[ xX]\]\s*(✅[^\n]*)?$/.test(lines[end - 1]) && !lines[end - 1].replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').replace(/✅.*/, '').trim()) {
    lines[end - 1] = line;
  } else lines.splice(end, 0, line);
  return lines.join('\n');
}
function parseTicketBody(text) {
  const lines = text.split('\n');
  const out = { description: [], steps: [], log: [], time: [], shots: [] };
  const sec = (k) => findSection(lines, k);
  const d = sec('description');
  if (d) for (let i = d[0] + 1; i < d[1]; i++) if (lines[i].trim()) out.description.push(lines[i].replace(/^\s*[-*]\s+/, ''));
  const s = sec('steps');
  if (s) {
    for (let i = s[0] + 1; i < s[1]; i++) {
      const m = lines[i].match(/^\s*[-*+]\s+\[(.)\]\s*(.*)$/);
      if (!m) continue;
      let txt = m[2];
      const stamp = txt.match(/\s*✅\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*$/u);
      if (stamp) txt = txt.slice(0, stamp.index);
      if (!txt.trim()) continue;
      out.steps.push({ line: i, done: m[1] !== ' ', text: txt.trim(), at: stamp ? stamp[2] || moment(stamp[1]).format('D MMM') : '' });
    }
  }
  const lg = sec('log');
  if (lg) {
    for (let i = lg[0] + 1; i < lg[1]; i++) {
      const m = lines[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\s*[—–-]+\s*(.*)$/);
      if (m) out.log.push({ when: moment(`${m[1]} ${m[2] || '00:00'}`, 'YYYY-MM-DD HH:mm'), hasTime: !!m[2], text: m[3] });
      else if (/^\s*[-*]\s+\S/.test(lines[i])) out.log.push({ when: null, text: lines[i].replace(/^\s*[-*]\s+/, '') });
    }
  }
  const sh = sec('shots');
  if (sh) {
    for (let i = sh[0] + 1; i < sh[1]; i++) {
      // ![[path]] or ![alt](path)
      const m = lines[i].match(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/) || lines[i].match(/!\[[^\]]*\]\(([^)]+)\)/);
      if (m) out.shots.push({ line: i, link: m[1].trim() });
    }
  }
  const tm = sec('time');
  if (tm) {
    for (let i = tm[0] + 1; i < tm[1]; i++) {
      const m = lines[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\s*·\s*(\d+)\s*m(?:in)?\s*(?:·\s*(.*))?$/);
      if (m) out.time.push({ date: m[1], start: m[2] || '', min: Number(m[3]), note: (m[4] || '').trim() });
    }
  }
  return out;
}

/* ---- modals ------------------------------------------------------------- */
class NewTicketModal extends Modal {
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal', 'tk-form-modal');
    this.titleEl.empty();
    const tchip = this.titleEl.createSpan('tk-form-icon');
    setIcon(tchip, 'ticket');
    this.titleEl.createSpan({ text: 'New ticket' });
    const c = this.contentEl.createDiv('tk-form');
    const field = (parent, label, note, req) => {
      const f = parent.createDiv('tk-field');
      const l = f.createDiv('tk-label');
      l.createSpan({ text: label });
      if (note) l.createSpan({ cls: req ? 'tk-req' : 'tk-opt', text: note });
      return f;
    };
    const row = () => c.createDiv('tk-row');
    // template picker (only when there are templates): fills in steps, description, priority and due
    const tpls = p.settings.templates || [];
    let tplPick = null;
    if (tpls.length) tplPick = pills(field(c, 'Template', 'optional'), [['', 'None'], ...tpls.map((x) => [x.id, x.name])], '', (v) => applyTemplate(v), 'tk-chips tk-tpl-pick');
    const r1 = row();
    const title = field(r1, 'Title', 'required', true).createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'What is it about?' } });
    title.value = this.opts.title || '';
    const id = field(r1, 'Ticket ID', 'optional').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. INC-4821' } });
    const descF = field(c, 'Description', 'required', true);
    const desc = descF.createEl('textarea', { cls: 'nd-input', attr: { rows: '3', placeholder: 'What’s wrong, who’s affected, since when?' } });
    const ready = c.createDiv('tk-ready');
    const r2 = row();
    const prio = pills(field(r2, 'Priority'), TICKET_PRIOS.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), 'normal', null, 'tk-seg tk-prio');
    const cat = pills(field(r2, 'Time category'), CATS.map((k) => [k, CAT_SHORT[k]]), this.opts.category || p.settings.defaultCategory, null, 'tk-seg tk-cat');
    for (const k of CATS) cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
    const r3 = row();
    const dueF = field(r3, 'Due');
    const due = dueF.createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    const dueTxt = dueF.createDiv('tk-date-text');
    const chips = dueF.createDiv('nd-pills tk-chips');
    const chipBtns = DUE_CHIPS.map(([n, label]) => {
      const b = chips.createEl('button', { cls: 'nd-pill-btn', text: label, attr: { type: 'button' } });
      b.addEventListener('click', () => {
        due.value = moment().add(n, 'days').format('YYYY-MM-DD');
        syncDue();
      });
      return [n, b];
    });
    const remF = field(r3, 'Remind', 'optional');
    const remPick = remF.createEl('input', { cls: 'nd-input', attr: { type: 'datetime-local' } });
    const remTxt = remF.createDiv('tk-date-text');
    const rem = pills(remF, [['none', 'None'], ['before', 'Day before'], ['pick', 'Pick']], 'before', () => syncRem(), 'tk-chips');
    const stepsF = field(c, 'First steps', 'optional · Enter adds another');
    const stepsList = stepsF.createDiv('tk-steps');
    const steps = [];
    // the step list is always what the rows show, in order (template steps and your own mixed)
    const syncSteps = () => steps.splice(0, steps.length, ...[...stepsList.children].map((r) => r.textContent));
    const addStepRow = (v, fromTpl) => {
      steps.push(v);
      const r = stepsList.createDiv('tk-step-row' + (fromTpl ? ' is-from-tpl' : ''));
      r.createSpan('tk-box');
      r.createSpan({ text: v });
      const x = r.createSpan('tk-step-x');
      setIcon(x, 'x');
      x.addEventListener('click', () => {
        r.remove();
        syncSteps();
      });
    };
    const stepIn = stepsF.createEl('input', { cls: 'nd-input tk-step-input', attr: { type: 'text', placeholder: 'Add a step…' } });
    stepIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        const v = stepIn.value.trim();
        if (!v) return;
        addStepRow(v);
        stepIn.value = '';
      }
    });
    let tplDesc = '';
    let base = null; // priority and due from before the first template, restored by None
    const applyTemplate = (tid) => {
      const tpl = tpls.find((x) => x.id === tid);
      // what a previous template filled in is replaced; steps and text you typed yourself stay
      for (const r of [...stepsList.querySelectorAll('.tk-step-row.is-from-tpl')]) r.remove();
      syncSteps();
      if (tplDesc && desc.value.trim() === tplDesc) desc.value = '';
      tplDesc = '';
      if (!base) base = { prio: prio.get(), due: due.value };
      if (!tpl) {
        prio.set(base.prio);
        due.value = base.due;
        base = null;
        syncDue();
        return syncValid();
      }
      // template steps go first, your own after them
      const own = [...stepsList.children];
      for (const s of tpl.steps) addStepRow(s, true);
      for (const r of own) stepsList.appendChild(r);
      syncSteps();
      if (!desc.value.trim() && tpl.description) desc.value = tplDesc = tpl.description;
      prio.set(tpl.priority || base.prio);
      due.value = tpl.dueDays != null ? moment().add(tpl.dueDays, 'days').format('YYYY-MM-DD') : base.due;
      syncDue();
      syncValid();
    };
    const r4 = row();
    const jira = field(r4, 'Jira key', 'optional').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. OPS-311' } });
    r4.createDiv('tk-field');

    const foot = this.contentEl.createDiv('tk-form-foot');
    foot.createDiv({ cls: 'tk-keys', text: 'Ctrl+Enter to create · Esc to cancel' });
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const create = button(foot, { text: 'Create ticket', cls: 'mod-cta', onClick: () => submit() });

    const fmtDay = (v) => (v ? moment(v).format('ddd D MMM') : '—');
    const syncDue = () => {
      const days = due.value ? moment(due.value).startOf('day').diff(moment().startOf('day'), 'days') : null;
      for (const [n, b] of chipBtns) b.toggleClass('is-on', days === n);
      dueTxt.setText(due.value ? `${fmtDay(due.value)} · ${days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${-days}d ago`}` : 'No due date');
      syncRem();
    };
    const remValue = () => {
      const mode = rem.get();
      if (mode === 'before') return due.value ? moment(due.value).subtract(1, 'day').format('YYYY-MM-DD') + ' 09:00' : '';
      if (mode === 'pick') return remPick.value ? remPick.value.replace('T', ' ') : '';
      return '';
    };
    const syncRem = () => {
      remPick.toggle(rem.get() === 'pick');
      const v = remValue();
      remTxt.setText(v ? moment(v, 'YYYY-MM-DD HH:mm').format('ddd D MMM · HH:mm') : rem.get() === 'before' ? 'Set a due date first' : 'No reminder');
    };
    const valid = () => title.value.trim() && desc.value.trim();
    const syncValid = () => {
      const ok = valid();
      create.toggleClass('is-disabled', !ok);
      descF.toggleClass('is-ok', !!desc.value.trim());
      ready.toggleClass('is-ok', !!ok);
      ready.setText(ok ? '✓ ready to create' : !title.value.trim() && !desc.value.trim() ? 'Title and description are needed' : !title.value.trim() ? 'Title is needed' : 'A short description is needed');
    };
    const submit = async () => {
      if (!valid()) {
        (title.value.trim() ? desc : title).focus();
        (title.value.trim() ? desc : title).addClass('is-invalid');
        return;
      }
      const pending = stepIn.value.trim();
      if (pending) steps.push(pending);
      this.close();
      await p.createTicket({
        title: title.value.trim(),
        id: id.value.trim(),
        description: desc.value.trim(),
        priority: prio.get(),
        category: cat.get(),
        due: due.value,
        remind: remValue(),
        steps,
        jira: jira.value.trim(),
      });
    };
    for (const el of [title, desc]) el.addEventListener('input', () => (el.removeClass('is-invalid'), syncValid()));
    due.addEventListener('input', syncDue);
    remPick.addEventListener('input', syncRem);
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    due.value = p.settings.defaultDays ? moment().add(p.settings.defaultDays, 'days').format('YYYY-MM-DD') : '';
    syncDue();
    if (tplPick && this.opts.template && tpls.some((x) => x.id === this.opts.template)) {
      tplPick.set(this.opts.template);
      applyTemplate(this.opts.template);
    }
    syncValid();
    window.setTimeout(() => (title.value ? desc : title).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

const newTemplateId = () => `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Add or edit a ticket template: a name and a list of steps, plus optional description, priority and due date. */
class TemplateModal extends Modal {
  constructor(plugin, tpl) {
    super(plugin.app);
    this.plugin = plugin;
    this.isNew = !tpl;
    this.tpl = tpl ? { ...tpl, steps: [...tpl.steps] } : { id: newTemplateId(), name: '', steps: [], description: '', priority: 'normal', dueDays: null };
  }
  onOpen() {
    const t = this.tpl;
    this.modalEl.addClass('nd-modal', 'tk-form-modal', 'tk-tpl-modal');
    this.titleEl.empty();
    setIcon(this.titleEl.createSpan('tk-form-icon'), 'layout-template');
    this.titleEl.createSpan({ text: this.isNew ? 'New template' : 'Edit template' });
    const c = this.contentEl.createDiv('tk-form');
    const field = (label, note) => {
      const f = c.createDiv('tk-field');
      const l = f.createDiv('tk-label');
      l.createSpan({ text: label });
      if (note) l.createSpan({ cls: 'tk-opt', text: note });
      return f;
    };
    const name = field('Name', 'required').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. New laptop setup' } });
    name.value = t.name;

    // steps: edit in place, move up / down, remove; Enter in the last box adds the next
    const stepsF = field('Steps', 'Enter adds another');
    const list = stepsF.createDiv('tk-tpl-edit-steps');
    const draw = () => {
      list.empty();
      t.steps.forEach((s, i) => {
        const r = list.createDiv('tk-tpl-step');
        r.createSpan('tk-box');
        const inp = r.createEl('input', { cls: 'nd-input', attr: { type: 'text' } });
        inp.value = s;
        inp.addEventListener('input', () => (t.steps[i] = inp.value));
        const move = (d) => {
          const j = i + d;
          if (j < 0 || j >= t.steps.length) return;
          [t.steps[i], t.steps[j]] = [t.steps[j], t.steps[i]];
          draw();
        };
        button(r, { icon: 'arrow-up', cls: 'nd-icon-btn', title: 'Move up', onClick: () => move(-1) });
        button(r, { icon: 'arrow-down', cls: 'nd-icon-btn', title: 'Move down', onClick: () => move(1) });
        button(r, { icon: 'x', cls: 'nd-icon-btn', title: 'Remove step', onClick: () => (t.steps.splice(i, 1), draw()) });
      });
    };
    draw();
    const add = stepsF.createEl('input', { cls: 'nd-input tk-step-input', attr: { type: 'text', placeholder: 'Add a step…' } });
    add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        const v = add.value.trim();
        if (!v) return;
        t.steps.push(v);
        add.value = '';
        draw();
      }
    });

    const desc = field('Description', 'optional · filled in when empty').createEl('textarea', { cls: 'nd-input', attr: { rows: '2', placeholder: 'Text the ticket starts with' } });
    desc.value = t.description || '';
    const row = c.createDiv('tk-row');
    const pf = row.createDiv('tk-field');
    pf.createDiv({ cls: 'tk-label', text: 'Priority' });
    const prio = pills(pf, TICKET_PRIOS.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), t.priority || 'normal', null, 'tk-seg tk-prio');
    const df = row.createDiv('tk-field');
    const dl = df.createDiv('tk-label');
    dl.createSpan({ text: 'Due in (days)' });
    dl.createSpan({ cls: 'tk-opt', text: 'optional' });
    const dueDays = df.createEl('input', { cls: 'nd-input', attr: { type: 'number', min: '0', max: '365', placeholder: 'form default' } });
    dueDays.value = t.dueDays == null ? '' : String(t.dueDays);

    const foot = this.contentEl.createDiv('tk-form-foot');
    foot.createDiv({ cls: 'tk-keys', text: 'Ctrl+Enter to save · Esc to cancel' });
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const save = async () => {
      const n = name.value.trim();
      if (!n) return name.addClass('is-invalid'), name.focus();
      const pending = add.value.trim();
      if (pending) t.steps.push(pending);
      const dd = dueDays.value.trim() === '' ? null : clamp(Math.round(Number(dueDays.value)), 0, 365);
      this.close();
      await this.plugin.saveTemplate({ ...t, name: n, steps: t.steps.map((s) => s.trim()).filter(Boolean), description: desc.value.trim(), priority: prio.get() || 'normal', dueDays: Number.isFinite(dd) ? dd : null });
      new Notice(`Template “${n}” saved`);
    };
    button(foot, { text: this.isNew ? 'Create template' : 'Save', cls: 'mod-cta', onClick: save });
    name.addEventListener('input', () => name.removeClass('is-invalid'));
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => (t.name ? add : name).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Clear done tickets: all of them, or only those finished before this month. They go to the system trash. */
class ClearDoneModal extends Modal {
  constructor(plugin, done) {
    super(plugin.app);
    this.plugin = plugin;
    this.done = done;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal', 'tk-clear-modal');
    this.titleEl.setText('Clear done tickets');
    const c = this.contentEl;
    const monthStart = moment().startOf('month');
    const finished = (t) => (t.completed ? t.completed : moment(t.file.stat.mtime));
    const sets = {
      before: this.done.filter((t) => finished(t).isBefore(monthStart)),
      all: this.done,
    };
    const what = c.createDiv('tk-field');
    what.createDiv({ cls: 'tk-label', text: 'Which tickets' });
    const choice = pills(
      what,
      [
        ['before', `Finished before ${monthStart.format('MMMM')} (${sets.before.length})`],
        ['all', `All done (${sets.all.length})`],
      ],
      sets.before.length ? 'before' : 'all',
      () => sync(),
      'tk-chips',
    );
    const extra = c.createEl('label', { cls: 'tk-clear-extra' });
    const withFiles = extra.createEl('input', { attr: { type: 'checkbox' } });
    withFiles.checked = true;
    extra.appendText(' Also their screenshots and exported reports');
    const info = c.createEl('p', { cls: 'tk-faint' });
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const go = button(row, {
      text: 'Move to trash',
      cls: 'mod-warning',
      onClick: async () => {
        const list = sets[choice.get()] || [];
        if (!list.length) return;
        this.close();
        await p.clearDone(list, withFiles.checked);
      },
    });
    const sync = () => {
      const n = (sets[choice.get()] || []).length;
      go.toggleClass('is-disabled', !n);
      info.setText(n ? `${n} ticket${n === 1 ? '' : 's'} go${n === 1 ? 'es' : ''} to the system trash (you can restore them from there). The “done in …” counter counts them no more; time logged in Neon Time stays.` : 'Nothing to clear for this choice.');
    };
    sync();
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** A screenshot at full size. */
class ShotModal extends Modal {
  constructor(app, file) {
    super(app);
    this.file = file;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'tk-shot-modal');
    this.titleEl.setText(this.file.name);
    this.contentEl.createEl('img', { attr: { src: this.app.vault.getResourcePath(this.file), alt: this.file.basename } });
  }
  onClose() {
    this.contentEl.empty();
  }
}

class WaitingModal extends Modal {
  constructor(plugin, t, onDone) {
    super(plugin.app);
    this.plugin = plugin;
    this.t = t;
    this.onDone = onDone;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'tk-wait-modal');
    this.titleEl.setText(`Waiting · ${this.t.id || this.t.title}`);
    const c = this.contentEl;
    c.createDiv({ cls: 'tk-label', text: 'Waiting on who or what?' });
    const who = c.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. vendor support, Anna from finance' } });
    who.value = this.t.waitingOn || '';
    c.createDiv({ cls: 'tk-label', text: 'Follow up' });
    const pick = c.createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    const when = pills(c, [['1', 'Tomorrow'], ['3', '3d'], ['7', '1w'], ['pick', 'Pick']], '3', () => pick.toggle(when.get() === 'pick'), 'tk-chips');
    pick.toggle(false);
    pick.value = moment().add(3, 'days').format('YYYY-MM-DD');
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const save = () => {
      const w = when.get();
      const date = w === 'pick' ? pick.value : moment().add(Number(w), 'days').format('YYYY-MM-DD');
      this.close();
      this.onDone({ who: who.value.trim(), followUp: date });
    };
    button(row, { text: 'Set waiting', cls: 'mod-cta', onClick: save });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => who.focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

class TimeEntryModal extends Modal {
  constructor(plugin, t, onDone) {
    super(plugin.app);
    Object.assign(this, { plugin, t, onDone });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'tk-time-modal');
    this.titleEl.setText(`Log time · ${this.t.id || this.t.title}`);
    const c = this.contentEl;
    c.createDiv({ cls: 'tk-label', text: 'Minutes' });
    const min = c.createEl('input', { cls: 'nd-input', attr: { type: 'number', min: '1', max: '960', value: '30' } });
    const quick = c.createDiv('nd-pills tk-chips');
    for (const n of [15, 30, 45, 60, 90]) {
      const b = quick.createEl('button', { cls: 'nd-pill-btn', text: fmtMin(n), attr: { type: 'button' } });
      b.addEventListener('click', () => {
        min.value = String(n);
        quick.querySelectorAll('.is-on').forEach((x) => x.removeClass('is-on'));
        b.addClass('is-on');
      });
    }
    c.createDiv({ cls: 'tk-label', text: 'What did you do?' });
    const note = c.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. call with vendor' } });
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const save = () => {
      const n = Math.round(Number(min.value));
      if (!(n > 0 && n <= 960)) return min.addClass('is-invalid');
      this.close();
      this.onDone({ min: n, note: note.value.trim() });
    };
    button(row, { text: 'Log time', cls: 'mod-cta', onClick: save });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => min.select(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

function ticketMenu(plugin, t, m) {
  m.addItem((i) => i.setTitle('Open').setIcon('ticket').onClick(() => plugin.showTicket(t.file)));
  m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => plugin.openTicket(t.file, true)));
  m.addItem((i) => i.setTitle('Edit as note').setIcon('file-text').onClick(() => plugin.openRaw(t.file)));
  m.addSeparator();
  if (t.status === 'done') m.addItem((i) => i.setTitle('Reopen').setIcon('rotate-ccw').onClick(() => plugin.setStatus(t, 'open')));
  else m.addItem((i) => i.setTitle('Mark done').setIcon('check').onClick(() => plugin.setStatus(t, 'done')));
  for (const s of TICKET_STATUS) {
    if (s === 'done') continue;
    m.addItem((i) => i.setTitle(`Status: ${TICKET_STATUS_LABEL[s]}`).setChecked(t.status === s).onClick(() => plugin.setStatus(t, s)));
  }
  m.addSeparator();
  for (const p of [...TICKET_PRIOS].reverse()) m.addItem((i) => i.setTitle(`Priority: ${p}`).setChecked(t.priority === p).onClick(() => plugin.setPriority(t, p)));
  m.addSeparator();
  for (const [n, label] of [[1, '+1 day'], [3, '+3 days'], [7, '+1 week'], [14, '+2 weeks']]) m.addItem((i) => i.setTitle(`Postpone ${label}`).setIcon('calendar-clock').onClick(() => plugin.postpone(t, n)));
  m.addItem((i) => i.setTitle('Set due date…').setIcon('calendar').onClick(() => plugin.promptDate(t, 'due')));
  m.addItem((i) => i.setTitle('Remind me on…').setIcon('bell').onClick(() => plugin.promptDate(t, 'remind')));
}

/* ---- ticket view (a normal note underneath) ----------------------------------- */
class TicketView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
  }
  getViewType() {
    return VIEW_TICKET;
  }
  getIcon() {
    return 'ticket';
  }
  getDisplayText() {
    return this.file ? this.file.basename : 'Ticket';
  }
  canAcceptExtension(ext) {
    return ext === 'md';
  }
  async onOpen() {
    this.contentEl.addClass('nd-root', 'tk-view');
    this.card = new TicketCard(this.plugin, this.contentEl, { popup: false, file: () => this.file, raw: (f) => this.plugin.openRaw(f, this.leaf) });
    this.register(this.card.attachInputs(() => this.app.workspace.activeLeaf === this.leaf && !document.querySelector('.modal-container')));
    this.addAction('file-down', 'Export as PDF', () => this.file && this.plugin.ticketFor(this.file) && this.plugin.exportTicket(this.plugin.ticketFor(this.file)));
    this.card.mountPattern();
    this.register(() => this.card.unmountPattern());
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.card.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.card.unmountPattern()));
    this.addAction('file-text', 'Edit as note', () => this.file && this.plugin.openRaw(this.file, this.leaf));
    const re = debounce(() => this.render(), 250, true);
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (this.file && f.path === this.file.path) re();
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f) => {
        if (this.file && f.path === this.file.path) re();
      }),
    );
    // a screenshot file added, deleted or renamed outside the ticket: redraw so thumbnails stay true
    const shotChange = (f, old) => {
      const dir = this.plugin.shotFolder() + '/';
      if (f.path.startsWith(dir) || (old && old.startsWith(dir))) re();
    };
    this.registerEvent(this.app.vault.on('delete', shotChange));
    this.registerEvent(this.app.vault.on('rename', shotChange));
    this.registerEvent(this.app.vault.on('create', shotChange));
  }
  async onLoadFile(file) {
    await this.render();
  }
  async onUnloadFile() {
    this.card.scroll.empty();
  }
  async onRename() {
    await this.render();
  }
  render() {
    return this.card.render();
  }
}

/** The ticket UI itself; used by the tab view and by the pop-up. */
class TicketCard {
  constructor(plugin, el, host) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.el = el;
    this.host = host;
    el.addClass('tk-host');
    this.scroll = el.createDiv('tk-scroll');
  }
  /** The live pattern from Neon Deck behind the card (same theme, pattern and strength as the dashboard). */
  mountPattern() {
    this.unmountPattern();
    const api = deckApi(this.app);
    if (api && api.mountPattern) this.pattern = api.mountPattern(this.el, this.scroll, this.host.popup ? '.tk-tile' : '.tk-card');
  }
  unmountPattern() {
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }
  kickPattern() {
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  get file() {
    return this.host.file();
  }
  async render() {
    const file = this.file;
    if (!file) return;
    // editing a step in place: wait until it's saved or cancelled
    const live = this.scroll.querySelector('.tk-inline input:focus');
    if (live && live.closest('.tk-step-edit')) {
      this.pendingRender = true;
      return;
    }
    // a + box that is open stays open (same text, same focus) across the redraw
    const liveRow = live && live.closest('.tk-inline');
    const reopen = liveRow && liveRow.tkInline ? { ...liveRow.tkInline, value: live.value } : null;
    this.pendingRender = false;
    const t = this.plugin.ticketFor(file);
    const text = await this.app.vault.cachedRead(file);
    if (file !== this.file) return;
    const b = parseTicketBody(stripFrontmatter(text));
    const root = this.scroll;
    const scroll = root.scrollTop;
    root.empty();
    if (!t) {
      const e = root.createDiv('tk-empty');
      e.createDiv({ text: 'This note isn’t a ticket (no “type: ticket”).' });
      button(e, { text: 'Open as note', cls: 'mod-cta', onClick: () => this.host.raw(file) });
      return;
    }
    const card = root.createDiv(`tk-card status-${t.status} prio-${t.priority}`);
    const kick = card.createDiv('tk-kicker');
    kick.createSpan({ cls: 'tk-k', text: 'Ticket' });
    if (t.id) kick.createSpan({ cls: 'tk-id', text: t.id });
    if (t.jira) kick.createSpan({ cls: 'tk-jira', text: t.jira });
    kick.createSpan({ cls: 'tk-path', text: `· ${file.parent && file.parent.path !== '/' ? file.parent.path + '/' : ''}` });
    const corner = kick.createSpan('tk-corner tk-corner-btns');
    button(corner, {
      icon: 'file-down',
      cls: 'nd-icon-btn',
      title: 'Export as PDF (steps, screenshots, log)',
      onClick: () => {
        // close the pop-up first, or it would sit on top of the report and the PDF dialog
        if (this.host.popup) this.host.close();
        this.plugin.exportTicket(t);
      },
    });
    if (this.host.popup) {
      button(corner, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open as a tab', onClick: () => this.host.tab(file) });
      button(corner, { icon: 'x', cls: 'nd-icon-btn', title: 'Close (Esc)', onClick: () => this.host.close() });
    }
    card.createDiv({ cls: 'tk-title', text: t.title });

    const st = card.createDiv('nd-pills tk-status');
    for (const s of TICKET_STATUS) {
      const btn = st.createEl('button', { cls: `nd-pill-btn s-${s}` + (t.status === s ? ' is-on' : ''), text: TICKET_STATUS_LABEL[s] });
      btn.addEventListener('click', () => t.status !== s && this.plugin.setStatus(t, s));
    }

    const tiles = card.createDiv('tk-tiles');
    const tile = (label, value, cls, onPlus, plusTitle) => {
      const tl = tiles.createDiv(`tk-tile ${cls || ''}`);
      tl.createDiv({ cls: 'tk-tile-k', text: label });
      const v = tl.createDiv({ cls: 'tk-tile-v', text: value });
      if (onPlus) {
        const pb = button(tl, { icon: 'plus', cls: 'tk-plus', title: plusTitle, onClick: onPlus });
        pb.addClass('tk-tile-plus');
      }
      return { tl, v };
    };
    const pr = tile('Priority', t.priority[0].toUpperCase() + t.priority.slice(1), `is-prio p-${t.priority}`);
    pr.tl.addClass('is-clickable');
    pr.tl.addEventListener('click', (e) => {
      const m = new Menu();
      for (const p of [...TICKET_PRIOS].reverse()) m.addItem((i) => i.setTitle(p).setChecked(t.priority === p).onClick(() => this.plugin.setPriority(t, p)));
      m.showAtMouseEvent(e);
    });
    tile('Due', t.due ? `${t.due.format('ddd D MMM')}` : 'No date', t.bucket === 'overdue' ? 'is-late' : '', (e) => {
      const m = new Menu();
      for (const [n, label] of [[1, 'Push back 1d'], [3, 'Push back 3d'], [7, 'Push back 1w']]) m.addItem((i) => i.setTitle(label).onClick(() => this.plugin.postpone(t, n)));
      m.addItem((i) => i.setTitle('Pick a date…').onClick(() => this.plugin.promptDate(t, 'due')));
      m.showAtMouseEvent(e);
    }, 'Move the due date');
    tile('Remind', t.remind ? t.remind.format(t.remindHasTime ? 'ddd D MMM · HH:mm' : 'ddd D MMM') : 'None', '', (e) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle('Tomorrow 09:00').onClick(() => this.plugin.setRemind(t, moment().add(1, 'day').format('YYYY-MM-DD') + ' 09:00')));
      if (t.due) m.addItem((i) => i.setTitle('Day before due, 09:00').onClick(() => this.plugin.setRemind(t, t.due.clone().subtract(1, 'day').format('YYYY-MM-DD') + ' 09:00')));
      m.addItem((i) => i.setTitle('Pick…').onClick(() => this.plugin.promptDate(t, 'remind')));
      if (t.remind) m.addItem((i) => i.setTitle('Clear reminder').onClick(() => this.plugin.setRemind(t, '')));
      m.showAtMouseEvent(e);
    }, 'Add a reminder');
    const total = b.time.reduce((s, x) => s + x.min, 0);
    tile('Time logged', `${total ? fmtMin(total) : '0m'} · ${CAT_LABEL[t.category] || 'Operations'}`, '', () => new TimeEntryModal(this.plugin, t, (v) => this.plugin.logTime(t, v)).open(), 'Add time by hand');
    if (t.status === 'waiting') {
      const w = card.createDiv('tk-waiting');
      icon(w, 'hourglass');
      w.createSpan({ text: `Waiting on ${t.waitingOn || '—'}` });
      if (t.followUp) w.createSpan({ cls: 'tk-wait-fu' + (t.bucket === 'followup' ? ' is-due' : ''), text: ` · follow up ${t.followUp.format('ddd D MMM')}` });
    }

    // description
    const sec = (label, extra, onPlus, plusTitle, hot) => {
      const s = card.createDiv('tk-sec');
      s.dataset.sec = label;
      const h = s.createDiv('tk-sec-head');
      h.createSpan('tk-mark');
      h.createSpan({ cls: 'tk-sec-k', text: label + (extra ? ` · ${extra}` : '') });
      if (onPlus) {
        const pb = button(h, { icon: 'plus', cls: 'tk-plus' + (hot ? ' is-hot' : ''), title: plusTitle, onClick: () => onPlus(s) });
        pb.addClass('tk-sec-plus');
      }
      return s;
    };
    const ds = sec('Description', '', (s) => this.inline(s, 'Add a line…', (v) => this.plugin.addDescription(t, v), false), 'Add a line');
    if (b.description.length) for (const l of b.description) ds.createDiv({ cls: 'tk-desc', text: l });
    else ds.createDiv({ cls: 'tk-faint', text: 'No description yet.' });

    const done = b.steps.filter((x) => x.done).length;
    const ss = sec('Next steps', b.steps.length ? `${done} of ${b.steps.length}` : '', (s) => this.inline(s, 'New step…', (v) => this.plugin.addStep(t, v), true), 'Add a step', true);
    for (const step of b.steps) {
      const r = ss.createDiv('tk-step' + (step.done ? ' is-done' : ''));
      const box = r.createDiv('tk-box');
      r.createSpan({ cls: 'tk-step-text', text: step.text });
      if (step.done && step.at) r.createSpan({ cls: 'tk-step-at', text: step.at });
      const tick = () => {
        this.plugin.toggleStep(t, step);
        r.toggleClass('is-done', step.done); // show it now; the file write follows
      };
      box.addEventListener('click', tick);
      r.querySelector('.tk-step-text').addEventListener('click', tick);
      const acts = r.createDiv('tk-step-acts');
      button(acts, { icon: 'pencil', cls: 'tk-step-act', title: 'Edit step', onClick: (e) => (e.stopPropagation(), this.editStepInline(r, t, step)) });
      button(acts, {
        icon: 'trash-2',
        cls: 'tk-step-act is-danger',
        title: 'Remove step',
        onClick: (e) => {
          e.stopPropagation();
          new ConfirmModal(this.app, { title: 'Remove step?', text: step.text, cta: 'Remove', onConfirm: () => this.plugin.removeStep(t, step) }).open();
        },
      });
    }
    if (!b.steps.length) ss.createDiv({ cls: 'tk-faint', text: 'No steps yet — the + adds one, Enter adds the next.' });

    // screenshots: paste (Ctrl+V), drop files on the ticket, or + to pick; saved in Core/Images/Tickets
    const shs = sec('Screenshots', b.shots.length ? String(b.shots.length) : '', () => this.pickShots(t), 'Add screenshots');
    if (b.shots.length) {
      const grid = shs.createDiv('tk-shots');
      for (const shot of b.shots) {
        const f = this.app.metadataCache.getFirstLinkpathDest(shot.link, file.path);
        const tile = grid.createDiv('tk-shot' + (f ? '' : ' is-missing'));
        if (f) {
          tile.createEl('img', { attr: { src: this.app.vault.getResourcePath(f), alt: f.basename, loading: 'lazy' } });
          tile.addEventListener('click', () => new ShotModal(this.app, f).open());
          tip(tile, f.name);
        } else tile.createDiv({ cls: 'tk-faint', text: `Missing: ${shot.link}` });
        button(tile, {
          icon: 'x',
          cls: 'nd-icon-btn tk-shot-x',
          title: 'Remove screenshot',
          onClick: (e) => {
            e.stopPropagation();
            new ConfirmModal(this.app, { title: 'Remove screenshot?', text: 'It leaves the ticket and the image goes to the system trash.', cta: 'Remove', onConfirm: () => this.plugin.removeScreenshot(t, shot) }).open();
          },
        });
      }
    } else shs.createDiv({ cls: 'tk-faint', text: 'No screenshots yet — paste one (Ctrl+V), drop image files here, or use the +.' });

    const ls = sec('Log', '', (s) => this.inline(s, 'Write a log line…', (v) => this.plugin.addLog(t, v), false, true), 'Write your own log line');
    const log = b.log.slice().sort((x, y) => (y.when ? y.when.valueOf() : 0) - (x.when ? x.when.valueOf() : 0));
    log.forEach((e, i) => {
      const r = ls.createDiv('tk-log' + (i === 0 ? ' is-latest' : ''));
      r.createSpan({ cls: 'tk-log-at', text: e.when ? e.when.format(e.hasTime ? 'DD MMM HH:mm' : 'DD MMM') : '' });
      r.createSpan({ cls: 'tk-log-text', text: e.text });
    });
    if (!log.length) ls.createDiv({ cls: 'tk-faint', text: 'Nothing logged yet.' });

    if (b.time.length) {
      const ts = sec('Time', fmtMin(total), () => new TimeEntryModal(this.plugin, t, (v) => this.plugin.logTime(t, v)).open(), 'Add time');
      for (const e of b.time.slice().reverse()) {
        const r = ts.createDiv('tk-log');
        r.createSpan({ cls: 'tk-log-at', text: moment(e.date).format('DD MMM') + (e.start ? ' ' + e.start : '') });
        r.createSpan({ cls: 'tk-log-text', text: `${fmtMin(e.min)}${e.note ? ' · ' + e.note : ''}` });
      }
    }

    const foot = card.createDiv('tk-foot');
    button(foot, { text: 'Edit as note', onClick: () => this.host.raw(file) });
    const dest = this.plugin.doneDest(t, moment());
    if (t.status === 'done') button(foot, { icon: 'rotate-ccw', text: 'Reopen', cls: 'tk-reopen', onClick: () => this.plugin.setStatus(t, 'open') });
    else button(foot, { text: dest ? `Mark done → ${dest}` : 'Mark done', cls: 'mod-cta tk-done', onClick: () => this.plugin.setStatus(t, 'done') });
    if (reopen) {
      const sec = root.querySelector(`.tk-sec[data-sec="${reopen.key}"]`);
      if (sec) {
        const input = this.inline(sec, reopen.placeholder, reopen.onSubmit, reopen.keep, reopen.top);
        if (input) input.value = reopen.value;
      }
    }
    root.scrollTop = scroll;
    this.kickPattern();
  }
  /** Edit a step's text in place. Saving does not write to the log. */
  editStepInline(r, t, step) {
    const row = createDiv('tk-inline tk-step-edit');
    row.createSpan('tk-box' + (step.done ? ' is-done' : ''));
    const input = row.createEl('input', { attr: { type: 'text' } });
    input.value = step.text;
    row.createSpan({ cls: 'tk-inline-hint', text: 'Enter to save · Esc to cancel' });
    r.replaceWith(row);
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (save && v && v !== step.text) await this.plugin.editStep(t, step, v);
      row.remove();
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        finish(true);
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => document.activeElement !== input && finish(false), 150));
    input.focus();
    input.select();
  }
  /** Inline input at the end of a section. keep: Enter keeps it open for another. */
  /** + on Screenshots: pick image files. */
  pickShots(t) {
    const input = createEl('input', { attr: { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: '' } });
    input.addEventListener('change', () => this.plugin.addScreenshots(t, [...input.files]));
    input.click();
  }
  /** Paste and drop of images onto the ticket. isActive says whether this card is the one in front. Returns a cleanup function. */
  attachInputs(isActive) {
    const images = (list) => [...(list || [])].filter((f) => IMG_TYPES[f.type]);
    const onPaste = (e) => {
      if (!this.el.isConnected || !isActive()) return;
      const files = images(e.clipboardData && e.clipboardData.files);
      if (!files.length) return; // plain text pastes into + boxes as usual
      const t = this.file && this.plugin.ticketFor(this.file);
      if (!t) return;
      e.preventDefault();
      this.plugin.addScreenshots(t, files);
    };
    const onOver = (e) => {
      if (e.dataTransfer && [...e.dataTransfer.items].some((i) => i.kind === 'file')) {
        e.preventDefault();
        this.el.addClass('is-dropping');
      }
    };
    const onLeave = (e) => {
      if (!this.el.contains(e.relatedTarget)) this.el.removeClass('is-dropping');
    };
    const onDrop = (e) => {
      this.el.removeClass('is-dropping');
      const files = images(e.dataTransfer && e.dataTransfer.files);
      if (!files.length) return;
      const t = this.file && this.plugin.ticketFor(this.file);
      if (!t) return;
      e.preventDefault();
      this.plugin.addScreenshots(t, files);
    };
    document.addEventListener('paste', onPaste, true);
    this.el.addEventListener('dragover', onOver);
    this.el.addEventListener('dragleave', onLeave);
    this.el.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      this.el.removeEventListener('dragover', onOver);
      this.el.removeEventListener('dragleave', onLeave);
      this.el.removeEventListener('drop', onDrop);
    };
  }
  inline(sec, placeholder, onSubmit, keep, top) {
    const old = sec.querySelector('.tk-inline');
    if (old) {
      old.querySelector('input').focus();
      return;
    }
    const row = createDiv('tk-inline');
    row.tkInline = { key: sec.dataset.sec, placeholder, onSubmit, keep, top };
    if (top) sec.querySelector('.tk-sec-head').after(row);
    else sec.appendChild(row);
    row.createSpan('tk-box is-new');
    const input = row.createEl('input', { attr: { type: 'text', placeholder } });
    row.createSpan({ cls: 'tk-inline-hint', text: keep ? 'Enter to add · Esc to cancel' : 'Enter to save · Esc to cancel' });
    const close = () => {
      row.remove();
      if (this.pendingRender) this.render();
    };
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return close();
        input.value = '';
        if (keep) {
          // show the new step straight away; the save runs in the background and the redraw replaces this draft
          if (sec.dataset.sec === 'Next steps') {
            const d = createDiv('tk-step is-pending');
            d.createDiv('tk-box');
            d.createSpan({ cls: 'tk-step-text', text: v });
            row.before(d);
          }
          onSubmit(v);
          return;
        }
        await onSubmit(v);
        close();
        // keep: the redraw that follows the save shows the new entry and keeps this box open
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => !input.value.trim() && row.isConnected && document.activeElement !== input && close(), 150));
    input.focus();
    return input;
  }
}

/** The same ticket card as an in-app pop-up, on top of whatever is open. */
class TicketPopup extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.refs = [];
  }
  onOpen() {
    this.containerEl.addClass('tk-popup-wrap');
    this.modalEl.addClass('nd-root', 'tk-popup');
    if (this.titleEl) this.titleEl.remove();
    this.contentEl.addClass('tk-view', 'is-popup');
    this.card = new TicketCard(this.plugin, this.contentEl, {
      popup: true,
      file: () => this.file,
      raw: (f) => {
        this.close();
        this.plugin.openRaw(f);
      },
      tab: (f) => {
        this.close();
        this.plugin.openTicket(f);
      },
      close: () => this.close(),
    });
    const re = debounce(() => this.card.render(), 250, true);
    const mc = this.app.metadataCache;
    const v = this.app.vault;
    this.refs.push([mc, mc.on('changed', (f) => f === this.file && re())]);
    this.refs.push([v, v.on('rename', (f) => f === this.file && re())]);
    this.refs.push([v, v.on('delete', (f) => f === this.file && this.close())]);
    const shotChange = (f, old) => {
      const dir = this.plugin.shotFolder() + '/';
      if (f.path.startsWith(dir) || (old && old.startsWith(dir))) re();
    };
    for (const ev of ['delete', 'rename', 'create']) this.refs.push([v, v.on(ev, shotChange)]);
    this.card.render();
    this.card.mountPattern();
    // the pop-up is in front while it's open: it takes pasted and dropped images
    this.detachInputs = this.card.attachInputs(() => true);
    this.refs.push([this.app.workspace, this.app.workspace.on('neon-deck:core-ready', () => this.card.mountPattern())]);
    this.refs.push([this.app.workspace, this.app.workspace.on('neon-deck:core-unloaded', () => this.card.unmountPattern())]);
  }
  close() {
    // Esc while typing in a + box only closes that box
    const a = document.activeElement;
    const row = a && a.closest && a.closest('.tk-popup .tk-inline');
    if (row) {
      row.remove();
      return;
    }
    super.close();
  }
  onClose() {
    for (const [src, ref] of this.refs) src.offref(ref);
    this.refs = [];
    if (this.detachInputs) this.detachInputs();
    this.card.unmountPattern();
    this.contentEl.empty();
  }
}

/* ---- tracker -------------------------------------------------------------- */
class TicketsView extends ItemView {
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
    return 'Tickets';
  }
  getIcon() {
    return 'ticket';
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'tk-tracker', 'tk-host');
    const sc = root.createDiv('tk-scroll');
    // dynamic island: one panel that grows and shrinks with the tickets in it
    this.island = sc.createDiv('tk-island');
    const inner = this.island.createDiv('tk-island-inner');
    const bar = inner.createDiv('tk-bar');
    const head = bar.createDiv('tk-bar-head');
    head.createDiv({ cls: 'tk-k', text: 'Ticket tracker' });
    this.dateEl = head.createDiv({ cls: 'tk-bar-date' });
    this.counterEl = bar.createDiv('tk-counter');
    this.summary = bar.createDiv('tk-summary');
    const tools = bar.createDiv('tk-tools');
    const seg = tools.createDiv('nd-seg');
    this.segBtns = {};
    for (const [k, label] of [['active', 'Active'], ['waiting', 'Waiting'], ['done', 'Done'], ['all', 'All'], ['templates', 'Templates']]) {
      const b = seg.createEl('button', { cls: 'nd-seg-btn', text: label });
      b.addEventListener('click', () => {
        if (this.filter !== k) this.filterChanged = true; // rows rise in again for the new filter
        this.filter = k;
        this.render();
      });
      this.segBtns[k] = b;
    }
    // sort / group (remembered; the dashboard card keeps its own order)
    const sort = tools.createEl('select', { cls: 'dropdown tk-sort', attr: { 'aria-label': 'Sort or group tickets' } });
    for (const [k, label] of TICKET_SORTS) sort.createEl('option', { value: k, text: label });
    sort.value = this.plugin.settings.tabSort;
    sort.addEventListener('change', () => {
      this.plugin.settings.tabSort = sort.value;
      this.plugin.saveSettings();
      this.filterChanged = true; // rows rise in for the new order
      this.render();
    });
    const search = tools.createEl('input', { cls: 'nd-input tk-search', attr: { type: 'search', placeholder: 'Filter tickets…' } });
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    });
    button(tools, { icon: 'plus', text: 'New ticket', cls: 'mod-cta', onClick: () => this.plugin.newTicket() });
    this.listEl = inner.createDiv('tk-list');
    this.fitIsland = () => {
      const h = Math.ceil(inner.offsetHeight);
      if (Math.abs(h - (parseFloat(this.island.style.height) || 0)) < 1) return;
      this.island.style.height = `${h}px`;
      // let the pattern follow the panel while it moves
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
    // the same live pattern as the dashboard, stats and rows are its windows
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
    const all = p.collectTickets();
    const active = all.filter((t) => t.status !== 'done');
    if (this.island) {
      const n = active.length;
      if (this.lastCount !== undefined && n !== this.lastCount) {
        const cls = n > this.lastCount ? 'is-grow' : 'is-shrink';
        this.island.removeClass('is-grow', 'is-shrink');
        void this.island.offsetWidth;
        this.island.addClass(cls);
      }
      this.lastCount = n;
    }
    const count = (b) => active.filter((t) => t.bucket === b).length;
    this.dateEl.setText(`${moment().format('dddd D MMM YYYY')} · week ${moment().isoWeek()}`);
    // numbers count from what they showed last (0 on first open); tiles rise in on first open only
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
    stat(count('followup'), 'follow up', 'is-followup');
    stat(count('overdue'), 'overdue', 'is-overdue');
    stat(count('today'), 'due today', 'is-today');
    stat(count('week'), 'next 7 days', 'is-week');
    stat(active.length, 'active', 'is-active');
    stat(active.filter((t) => t.status === 'waiting').length, 'waiting', 'is-waiting', () => ((this.filter = 'waiting'), this.render()));
    for (const [k, b] of Object.entries(this.segBtns)) b.toggleClass('is-active', k === this.filter);
    if (this.filter === 'templates') {
      this.filterChanged = false;
      this.rendered = true;
      return this.renderTemplates();
    }
    let items = all;
    if (this.filter === 'active') items = active;
    else if (this.filter === 'waiting') items = active.filter((t) => t.status === 'waiting');
    else if (this.filter === 'done') items = all.filter((t) => t.status === 'done');
    if (this.query) items = items.filter((t) => `${t.id} ${t.title} ${t.file.path} ${t.status} ${t.priority} ${t.jira}`.toLowerCase().includes(this.query));
    this.listEl.empty();
    // calm = a refresh: only new or changed rows move. A first open or a new filter animates the list.
    const calm = !!this.rendered && !this.filterChanged;
    this.listEl.toggleClass('is-calm', calm);
    this.listEl.toggleClass('is-refilter', !!this.filterChanged);
    this.filterChanged = false;
    this.rendered = true;
    const before = this.rowState || null;
    this.rowState = new Map();
    this.rowCalm = calm ? before : null;
    if (this.filter === 'done' && items.length) {
      const bar = this.listEl.createDiv('tk-clear-bar');
      bar.createSpan({ cls: 'tk-faint', text: `${items.length} done ticket${items.length === 1 ? '' : 's'}` });
      button(bar, { icon: 'trash-2', text: 'Clear done…', cls: 'tk-clear-btn', onClick: () => new ClearDoneModal(p, all.filter((t) => t.status === 'done')).open() });
    }
    if (!items.length) {
      const e = this.listEl.createDiv('tk-empty');
      e.createDiv({ text: all.length ? 'Nothing matches this filter.' : 'No tickets yet.' });
      if (!all.length) button(e, { icon: 'plus', text: 'Create your first ticket', cls: 'mod-cta', onClick: () => p.newTicket() });
      return;
    }
    let idx = 0;
    for (const [bucket, label, group] of ticketGroups(items, p.settings.tabSort)) {
      if (!group.length) continue;
      const sec = this.listEl.createDiv(`tk-group is-${bucket}`);
      const gh = sec.createDiv('tk-group-head');
      gh.createSpan({ cls: 'tk-group-title', text: label });
      gh.createSpan({ cls: 'tk-group-count', text: String(group.length).padStart(2, '0') });
      for (const t of group) this.renderRow(sec, t, idx++);
    }
  }
  /** Templates tab: the ticket blueprints, kept in Neon Tickets' own data. */
  renderTemplates() {
    const p = this.plugin;
    const el = this.listEl;
    const list = p.settings.templates;
    const q = this.query;
    const shown = q ? list.filter((x) => `${x.name} ${x.steps.join(' ')}`.toLowerCase().includes(q)) : list;
    el.empty();
    el.removeClass('is-calm', 'is-refilter');
    const head = el.createDiv('tk-group-head tk-tpl-head');
    head.createSpan({ cls: 'tk-group-title', text: 'Templates' });
    head.createSpan({ cls: 'tk-group-count', text: String(list.length).padStart(2, '0') });
    button(head, { icon: 'plus', text: 'New template', cls: 'mod-cta tk-tpl-new', onClick: () => new TemplateModal(p).open() });
    if (!shown.length) {
      el.createDiv({ cls: 'tk-empty', text: list.length ? 'No template matches the filter.' : 'No templates yet. A template is a ready-made ticket: pick it in New ticket and its steps (plus an optional description, priority and due date) are filled in.' });
      return;
    }
    shown.forEach((tpl, i) => {
      const r = el.createDiv('tk-row tk-tpl');
      r.style.setProperty('--i', String(Math.min(i, 20)));
      setIcon(r.createDiv('tk-tpl-icon'), 'layout-template');
      const main = r.createDiv('tk-row-main');
      main.createDiv({ cls: 'tk-tpl-name', text: tpl.name });
      const meta = [`${tpl.steps.length} step${tpl.steps.length === 1 ? '' : 's'}`];
      if (tpl.priority && tpl.priority !== 'normal') meta.push(tpl.priority);
      if (tpl.dueDays != null) meta.push(tpl.dueDays === 0 ? 'due today' : `due in ${tpl.dueDays}d`);
      main.createDiv({ cls: 'tk-tpl-meta', text: meta.join(' · ') });
      if (tpl.steps.length) main.createDiv({ cls: 'tk-tpl-steps', text: tpl.steps.slice(0, 4).join(' · ') + (tpl.steps.length > 4 ? ' …' : '') });
      const acts = r.createDiv('tk-tpl-acts');
      const stop = (fn) => (e) => (e.stopPropagation(), fn());
      button(acts, { icon: 'plus', text: 'Use', cls: 'mod-cta', title: 'New ticket from this template', onClick: stop(() => p.newTicket({ template: tpl.id })) });
      button(acts, { icon: 'pencil', cls: 'nd-icon-btn', title: 'Edit template', onClick: stop(() => new TemplateModal(p, tpl).open()) });
      button(acts, { icon: 'copy', cls: 'nd-icon-btn', title: 'Duplicate', onClick: stop(() => p.duplicateTemplate(tpl.id)) });
      button(acts, { icon: 'trash-2', cls: 'nd-icon-btn', title: 'Delete template', onClick: stop(() => new ConfirmModal(this.app, { title: 'Delete template?', text: tpl.name, cta: 'Delete', onConfirm: () => p.deleteTemplate(tpl.id) }).open()) });
      r.addEventListener('click', () => new TemplateModal(p, tpl).open());
    });
  }
  renderRow(parent, t, i) {
    const p = this.plugin;
    const row = parent.createDiv(`tk-row is-${t.bucket} prio-${t.priority} status-${t.status}`);
    row.style.setProperty('--i', String(Math.min(i, 20)));
    // on a refresh: a ticket that wasn't listed slides in, one whose status or due bucket changed flashes
    const state = `${t.status}|${t.bucket}`;
    if (this.rowState) this.rowState.set(t.file.path, state);
    if (this.rowCalm) {
      const was = this.rowCalm.get(t.file.path);
      if (was === undefined) row.addClass('is-new');
      else if (was !== state) row.addClass('is-changed');
    }
    const check = row.createDiv('tk-row-check');
    tip(check, t.status === 'done' ? 'Reopen' : 'Mark done');
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      if (t.status !== 'done') row.addClass('is-completing');
      p.setStatus(t, t.status === 'done' ? 'open' : 'done');
    });
    const main = row.createDiv('tk-row-main');
    const top = main.createDiv('tk-row-top');
    if (t.id) top.createSpan({ cls: 'tk-id', text: t.id });
    top.createSpan({ cls: 'tk-row-title', text: t.title });
    const meta = main.createDiv('tk-row-meta');
    const st = meta.createSpan({ cls: `tk-st s-${t.status}`, text: TICKET_STATUS_LABEL[t.status] });
    tip(st, 'Click to cycle status');
    st.addEventListener('click', (e) => {
      e.stopPropagation();
      const order = ['open', 'in-progress', 'waiting'];
      p.setStatus(t, t.status === 'done' ? 'open' : order[(order.indexOf(t.status) + 1) % order.length]);
    });
    if (t.priority !== 'normal') meta.createSpan({ cls: `tk-pr p-${t.priority}`, text: t.priority });
    meta.createSpan({ cls: 'tk-age', text: `opened ${t.created.format('D MMM')} · ${t.age}d` });
    if (t.status === 'waiting' && t.waitingOn) meta.createSpan({ cls: 'tk-age', text: `waiting on ${t.waitingOn}` });
    if (t.remind && t.status !== 'done') meta.createSpan({ cls: 'tk-age', text: `🔔 ${t.remind.format('D MMM')}` });
    if (t.due && t.status !== 'done') {
      const prog = main.createDiv('tk-progress');
      prog.createDiv('tk-progress-fill').style.width = `${Math.round(t.progress * 100)}%`;
      tip(prog, `${Math.round(t.progress * 100)}% of the time between created and due has passed`);
    }
    const due = row.createDiv('tk-row-due');
    due.createDiv({ cls: 'tk-row-due-main', text: ticketDueText(t) });
    if (t.due) due.createDiv({ cls: 'tk-row-due-date', text: t.due.format('ddd D MMM') });
    const acts = row.createDiv('tk-row-acts');
    button(acts, {
      icon: 'more-horizontal',
      cls: 'nd-icon-btn',
      title: 'More',
      onClick: (e) => {
        e.stopPropagation();
        const m = new Menu();
        ticketMenu(p, t, m);
        m.showAtMouseEvent(e);
      },
    });
    row.addEventListener('click', (e) => p.showTicket(t.file, e));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const m = new Menu();
      ticketMenu(p, t, m);
      m.showAtMouseEvent(e);
    });
  }
}

class NeonTicketsSettingTab extends PluginSettingTab {
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
    new Setting(containerEl).setName('Tickets').setHeading();
    new Setting(containerEl)
      .setName('Ticket folder')
      .setDesc('Where new tickets go. Any note with “type: ticket” or the #ticket tag counts as a ticket, wherever it lives.')
      .addText((t) => t.setValue(s.ticketFolder).onChange((v) => ((s.ticketFolder = v.trim() || 'Core/Tickets'), save())));
    new Setting(containerEl)
      .setName('File done tickets')
      .setDesc('Done tickets move to <ticket folder>/Done/YYYY-MM/, and back when reopened. Links keep working.')
      .addToggle((t) => t.setValue(s.autoFile).onChange((v) => ((s.autoFile = v), save())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('File all done tickets now').onClick(() => p.fileAllDone(true)));
    new Setting(containerEl)
      .setName('Open tickets in the ticket view')
      .setDesc('Off: tickets open as plain notes. “Edit as note” always shows the text.')
      .addToggle((t) => t.setValue(s.openInTicketView).onChange((v) => ((s.openInTicketView = v), save())));
    new Setting(containerEl)
      .setName('Open tickets as a pop-up')
      .setDesc('Clicking a ticket on the dashboard, in the tracker or in the card explorer opens it on top of what you are doing. Ctrl+click opens a tab.')
      .addToggle((t) => t.setValue(s.popup).onChange((v) => ((s.popup = v), save())));
    // which status changes show in the dashboard's Recently done / touched card
    for (const st of TICKET_STATUS)
      new Setting(containerEl)
        .setName(`Recently done: ${TICKET_STATUS_LABEL[st]}`)
        .setDesc(st === 'done' ? 'Tickets set to this status appear in the dashboard’s Recently done / touched card.' : '')
        .addToggle((t) =>
          t.setValue(s.activityStatuses.includes(st)).onChange((v) => {
            s.activityStatuses = v ? [...new Set([...s.activityStatuses, st])] : s.activityStatuses.filter((x) => x !== st);
            save();
          }),
        );
    numSetting(new Setting(containerEl).setName('Default due in (days)').setDesc('Pre-filled in the New ticket form. 0 = no date.'), s, 'defaultDays', 0, 365, save);
    new Setting(containerEl)
      .setName('Default time category')
      .addDropdown((d) => d.addOptions(Object.fromEntries(CATS.map((c) => [c, CAT_LABEL[c]]))).setValue(s.defaultCategory).onChange((v) => ((s.defaultCategory = v), save())));
    new Setting(containerEl).setName('Reminders').setHeading();
    new Setting(containerEl)
      .setName('Reminders')
      .setDesc('Once a day per ticket (checked at startup and every 15 min): overdue, due soon, past its remind time, or a follow-up day.')
      .addToggle((t) => t.setValue(s.reminders).onChange((v) => ((s.reminders = v), save())))
      .addExtraButton((b) => b.setIcon('bell').setTooltip('Check now').onClick(() => p.checkReminders(true)));
    numSetting(new Setting(containerEl).setName('Remind this many days before due').setDesc('0 = only on the due day.'), s, 'remindDays', 0, 30, save);
    numSetting(new Setting(containerEl).setName('Waiting without a follow-up date: follow up after (days)'), s, 'autoFollowUpDays', 1, 60, save);
    madeWith(containerEl, 'Neon Tickets');
  }
}

module.exports = class NeonTickets extends Plugin {
  async onload() {
    this.moving = new Set();
    const raw = await this.loadData();
    this.settings = Object.assign({}, TICKETS_DEFAULTS, raw || {});
    this.settings.defaultCategory = normCat(this.settings.defaultCategory);
    if (!raw) await this.migrateFromDeck();
    if (!this.settings.notified || typeof this.settings.notified !== 'object') this.settings.notified = {};
    // templates: keep only well-formed ones (a name and a list of text steps)
    this.settings.templates = (Array.isArray(this.settings.templates) ? this.settings.templates : [])
      .filter((x) => x && typeof x === 'object' && String(x.name || '').trim())
      .map((x) => ({
        id: String(x.id || newTemplateId()),
        name: String(x.name).trim(),
        steps: Array.isArray(x.steps) ? x.steps.map((v) => String(v).trim()).filter(Boolean) : [],
        description: String(x.description || ''),
        priority: TICKET_PRIOS.includes(x.priority) ? x.priority : 'normal',
        dueDays: Number.isFinite(x.dueDays) ? x.dueDays : null,
      }));
    // own copies, never the arrays in TICKETS_DEFAULTS
    this.settings.statusLog = Array.isArray(this.settings.statusLog) ? this.settings.statusLog.slice(-200) : [];
    if (!TICKET_SORTS.some(([k]) => k === this.settings.tabSort)) this.settings.tabSort = 'due';
    this.settings.activityStatuses = Array.isArray(this.settings.activityStatuses) ? this.settings.activityStatuses.slice() : ['done', 'waiting'];
    await this.saveSettings();
    this.rawPaths = new Set();
    this.listeners = new Set();
    this.cache = null;

    this.registerView(VIEW_TICKETS, (leaf) => new TicketsView(leaf, this));
    this.registerView(VIEW_TICKET, (leaf) => new TicketView(leaf, this));
    this.registerHoverLinkSource(VIEW_TICKETS, { display: 'Neon tickets', defaultMod: true });
    this.addRibbonIcon('ticket', 'Ticket tracker', () => this.openTracker());
    this.patchLeaf();

    this.addCommand({ id: 'open-tickets', name: 'Open ticket tracker', callback: () => this.openTracker() });
    this.addCommand({ id: 'new-ticket', name: 'New ticket', callback: () => this.newTicket() });
    this.addCommand({ id: 'ticket-reminders', name: 'Show tickets that need attention', callback: () => this.checkReminders(true) });
    this.addCommand({ id: 'file-done', name: 'File all done tickets into Done/YYYY-MM', callback: () => this.fileAllDone(true) });
    const cur = (id, name, fn) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const f = this.app.workspace.getActiveFile();
          const t = f && this.ticketFor(f);
          if (!t) return false;
          if (!checking) fn(t);
          return true;
        },
      });
    cur('ticket-done', 'Ticket: mark current ticket done', (t) => this.setStatus(t, 'done'));
    cur('ticket-postpone-1', 'Ticket: postpone current ticket by 1 day', (t) => this.postpone(t, 1));
    cur('ticket-postpone-7', 'Ticket: postpone current ticket by 1 week', (t) => this.postpone(t, 7));
    cur('ticket-due', 'Ticket: set due date of current ticket', (t) => this.promptDate(t, 'due'));
    cur('ticket-view', 'Ticket: toggle ticket view / note', (t) => {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf.view.getViewType() === VIEW_TICKET) this.openRaw(t.file, leaf);
      else this.openTicket(t.file, false, leaf);
    });
    this.addSettingTab(new NeonTicketsSettingTab(this.app, this));
    this.buildStatus();

    // Only ticket notes invalidate the list: typing in other notes costs nothing.
    const dirty = () => {
      this.cache = null;
      this.emitSoon();
    };
    const known = (path) => !!(this.cache && this.cache.paths.has(path));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, _d, cache) => {
        if (!isTicketCache(cache) && !known(f.path)) return;
        dirty();
        if (isTicketCache(cache)) this.fileSoon(f);
      }),
    );
    this.registerEvent(this.app.vault.on('delete', (f) => known(f.path) && dirty()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (known(old) || f instanceof TFolder || isTicketCache(this.app.metadataCache.getFileCache(f))) && dirty()));
    // the first full index after startup
    const ref = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(ref);
      dirty();
    });
    this.registerEvent(ref);
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.decorateMarkdown(leaf)));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.hookCore();
      window.setTimeout(async () => {
        if (!this.settings.migrated) {
          this.settings.migrated = true;
          await this.saveSettings();
        }
        // file any done tickets that were left in the ticket folder
        if (this.settings.autoFile) await this.fileAllDone(false);
        this.checkReminders();
      }, 4000);
      this.registerInterval(window.setInterval(() => this.checkReminders(), 15 * 60 * 1000));
    });
  }
  onunload() {
    if (this.fileTimers) for (const id of this.fileTimers.values()) window.clearTimeout(id);
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tickets');
      api.unregisterCapture('ticket');
      api.unregisterFacts('tickets');
      api.unregisterActivity && api.unregisterActivity('tickets');
      api.unregisterAction('tickets');
      api.unprovide('ticketClick');
      api.unregisterWeekLine('tickets');
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** First run: take the ticket settings from Neon Deck 1.2's data. */
  async migrateFromDeck() {
    try {
      const path = normalizePath(`${this.app.vault.configDir}/plugins/neon-deck/data.json`);
      if (!(await this.app.vault.adapter.exists(path))) return;
      const old = JSON.parse(await this.app.vault.adapter.read(path));
      const map = { ticketFolder: 'ticketFolder', ticketDefaultDays: 'defaultDays', ticketReminders: 'reminders', ticketRemindDays: 'remindDays', ticketNotified: 'notified' };
      for (const [a, b] of Object.entries(map)) if (old[a] !== undefined) this.settings[b] = old[a];
    } catch (e) {
      console.warn('Neon Tickets: could not read Neon Deck 1.2 settings', e);
    }
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
  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tickets', slot: 'tickets', title: 'Tickets', icon: 'ticket', mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'ticket', label: 'Ticket', short: 'Ticket', icon: 'ticket', order: 20, allowEmpty: true, run: (v) => this.newTicket({ title: v }) });
    api.registerAction({ id: 'tickets', icon: 'ticket', label: 'Tickets', order: 20, view: VIEW_TICKETS, run: () => this.openTracker() });
    api.provide('ticketClick', (f) => {
      if (!this.settings.popup || !this.ticketFor(f)) return false;
      new TicketPopup(this, f).open();
      return true;
    });
    if (api.registerActivity)
      api.registerActivity('tickets', () =>
        this.settings.statusLog.map((x) => ({
          t: x.t,
          kind: 'ticket',
          text: x.title,
          src: x.id || '',
          status: x.status,
          open: () => {
            const f = this.app.vault.getAbstractFileByPath(x.path);
            if (f instanceof TFile) this.showTicket(f);
          },
        })),
      );
    api.registerFacts('tickets', () => {
      const act = this.activeTickets();
      const week = act.filter((t) => t.due && t.daysLeft >= 0 && t.daysLeft <= 7).length;
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const out = [{ v: week, l: week === 1 ? 'ticket due this week' : 'tickets due this week' }];
      if (over) out.push({ v: over, l: 'overdue' });
      const n = this.doneIn(moment());
      if (n) out.push({ v: n, l: `done in ${moment().format('MMMM')}` });
      return out;
    });
    api.registerWeekLine('tickets', (start, end) => {
      const n = this.collectTickets().filter((t) => t.completed && !t.completed.isBefore(start) && t.completed.isBefore(end)).length;
      return n ? [`${n} ticket${n === 1 ? '' : 's'} closed`] : [];
    });
  }

  /* routing: tickets open in the ticket view ----------------------------- */
  patchLeaf() {
    const proto = obsidian.WorkspaceLeaf.prototype;
    const orig = proto.setViewState;
    const self = this;
    proto.setViewState = function (state, eState) {
      try {
        if (self.settings.openInTicketView && state && state.type === 'markdown' && state.state && typeof state.state.file === 'string' && !self.rawPaths.has(state.state.file)) {
          const f = self.app.vault.getAbstractFileByPath(state.state.file);
          if (f instanceof TFile && isTicketCache(self.app.metadataCache.getFileCache(f))) state = Object.assign({}, state, { type: VIEW_TICKET });
        }
      } catch (e) {
        console.error('Neon Tickets routing', e);
      }
      return orig.call(this, state, eState);
    };
    this.register(() => {
      if (proto.setViewState !== orig) proto.setViewState = orig;
    });
  }
  /** A click on a ticket: pop-up by default, Ctrl/Cmd+click opens a tab. */
  showTicket(file, e) {
    if (e && (e.ctrlKey || e.metaKey)) return this.openTicket(file, true);
    if (e && e.shiftKey) return this.openTicket(file, 'split');
    if (!this.settings.popup) return this.openTicket(file);
    new TicketPopup(this, file).open();
  }
  async openTicket(file, newTab, leaf) {
    this.rawPaths.delete(file.path);
    leaf = leaf || (newTab ? this.app.workspace.getLeaf(newTab === 'split' ? 'split' : 'tab') : reusableLeaf(this.app));
    await leaf.setViewState({ type: this.settings.openInTicketView ? VIEW_TICKET : 'markdown', state: { file: file.path }, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
  async openRaw(file, leaf) {
    this.rawPaths.add(file.path);
    leaf = leaf || reusableLeaf(this.app);
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true });
  }
  decorateMarkdown(leaf) {
    const view = leaf && leaf.view;
    if (!view || view.getViewType() !== 'markdown' || !view.file || view.ntAction) return;
    if (!this.ticketFor(view.file)) return;
    view.ntAction = view.addAction('ticket', 'Ticket view', () => view.file && this.openTicket(view.file, false, view.leaf));
  }
  openTracker() {
    return activateView(this.app, VIEW_TICKETS, 'tab');
  }

  /* collecting ------------------------------------------------------------- */
  collectTickets() {
    if (this.cache && this.cache.day === dayKey(Date.now())) return this.cache.list;
    const out = [];
    const today = moment().startOf('day');
    const deck = neonPlugin(this.app, 'neon-deck');
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      if (!isTicketCache(cache)) continue;
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      out.push(this.toTicket(f, cache, today));
    }
    out.sort(ticketSort);
    this.cache = { day: dayKey(Date.now()), list: out, paths: new Set(out.map((t) => t.file.path)) };
    return out;
  }
  toTicket(f, cache, today) {
    const fm = (cache && cache.frontmatter) || {};
    const created = parseDay(fm.created) || moment(f.stat.ctime);
    const due = parseDay(fm.due);
    const remindRaw = fm.remind != null ? String(fm.remind) : '';
    const t = {
      file: f,
      title: String(fm.title || f.basename),
      id: fm.ticket != null && fm.ticket !== '' ? String(fm.ticket) : fm.id != null ? String(fm.id) : '',
      status: normTicketStatus(fm.status),
      priority: normTicketPrio(fm.priority),
      category: noteCategory(cache) || 'operations',
      created,
      due,
      remind: parseDay(remindRaw),
      remindHasTime: /\d{1,2}:\d{2}/.test(remindRaw),
      completed: parseDay(fm.completed),
      waitingOn: fm.waiting_on ? String(fm.waiting_on) : '',
      followUp: parseDay(fm.follow_up),
      waitingSince: parseDay(fm.waiting_since),
      jira: fm.jira ? String(fm.jira) : '',
      daysLeft: due ? daysFromToday(due) : null,
      age: Math.max(0, today.diff(created.clone().startOf('day'), 'days')),
      progress: 0,
    };
    if (t.id && t.title.startsWith(t.id)) t.title = t.title.slice(t.id.length).replace(/^[\s·:\-–—]+/, '') || t.title;
    if (due) {
      const span = due.clone().endOf('day').diff(created, 'minutes');
      t.progress = span > 0 ? clamp(moment().diff(created, 'minutes') / span, 0, 1) : 1;
    }
    const followDue = t.status === 'waiting' && t.followUp && !t.followUp.isAfter(today, 'day');
    t.bucket = t.status === 'done' ? 'done' : followDue ? 'followup' : !due ? 'nodate' : t.daysLeft < 0 ? 'overdue' : t.daysLeft === 0 ? 'today' : t.daysLeft <= 7 ? 'week' : 'later';
    return t;
  }
  activeTickets() {
    return this.collectTickets().filter((t) => t.status !== 'done');
  }
  ticketFor(file) {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return isTicketCache(cache) ? this.toTicket(file, cache, moment().startOf('day')) : null;
  }
  doneIn(m) {
    return this.collectTickets().filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
  }
  renderCounter(el, all) {
    el.empty();
    const now = moment();
    const last = now.clone().subtract(1, 'month');
    const done = (m) => all.filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
    el.createSpan({ cls: 'tk-counter-n', text: String(done(now)) });
    el.createSpan({ cls: 'tk-counter-l', text: `done in ${now.format('MMMM')} · ${done(last)} in ${last.format('MMMM')}` });
  }

  /* writing ------------------------------------------------------------------ */
  async patch(t, patch) {
    await this.app.fileManager.processFrontMatter(t.file, (fm) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') delete fm[k];
        else fm[k] = v;
      }
    });
  }
  async log(t, text) {
    await this.app.vault.process(t.file, (d) => addToSection(d, 'log', `- ${STAMP()} — ${text}`));
    this.app.workspace.trigger('neon:ticket-changed', { file: t.file, id: t.id, title: t.title, change: text });
  }
  async setStatus(t, status) {
    if (status === t.status) return;
    if (status === 'waiting') {
      return new WaitingModal(this, t, async ({ who, followUp }) => {
        const wait = { status: 'waiting', waiting_on: who || null, follow_up: followUp || null, waiting_since: moment().format('YYYY-MM-DD') };
        if (t.status === 'done') wait.completed = null;
        await this.patch(t, wait);
        this.logStatus(t, 'waiting');
        await this.log(t, `Waiting${who ? ' on ' + who : ''}${followUp ? ` · follow up ${moment(followUp).format('ddd D MMM')}` : ''}`);
      }).open();
    }
    const patch = { status, waiting_on: null, follow_up: null, waiting_since: null };
    if (status === 'done') patch.completed = moment().format('YYYY-MM-DD');
    else if (t.status === 'done') patch.completed = null;
    await this.patch(t, patch);
    this.logStatus(t, status);
    await this.log(t, status === 'done' ? 'Done' : t.status === 'done' ? 'Reopened' : `Status: ${TICKET_STATUS_LABEL[t.status]} → ${TICKET_STATUS_LABEL[status]}`);
    if (status === 'done') {
      new Notice(`✓ ${t.id ? t.id + ' · ' : ''}${t.title} — done`);
      if (this.settings.autoFile) await this.moveDone(t.file, moment());
    } else if (t.status === 'done' && this.settings.autoFile) await this.moveBack(t.file);
  }
  /** Remember a status change for the dashboard's Recently done log (only the statuses chosen in settings). */
  logStatus(t, status) {
    if (!this.settings.activityStatuses.includes(status)) return;
    const log = this.settings.statusLog;
    log.push({ t: Date.now(), id: t.id || '', title: t.title, status, path: t.file.path });
    if (log.length > 200) log.splice(0, log.length - 200);
    this.saveSettings();
    const api = deckApi(this.app);
    if (api && api.activityChanged) api.activityChanged();
  }
  async setPriority(t, p) {
    if (p === t.priority) return;
    await this.patch(t, { priority: p });
    await this.log(t, `Priority: ${t.priority} → ${p}`);
  }
  async postpone(t, days) {
    const today = moment().startOf('day');
    const base = t.due && !t.due.isBefore(today) ? t.due.clone() : today;
    await this.setDue(t, base.add(days, 'days').format('YYYY-MM-DD'));
  }
  async setDue(t, v) {
    await this.patch(t, { due: v || null });
    await this.log(t, v ? `Due moved${t.due ? ` from ${t.due.format('D MMM')}` : ''} to ${moment(v).format('ddd D MMM')}` : 'Due date cleared');
    if (v) new Notice(`${t.id || t.title} → due ${moment(v).format('ddd D MMM')}`);
  }
  async setRemind(t, v) {
    await this.patch(t, { remind: v || null });
    await this.log(t, v ? `Reminder set for ${moment(v, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD']).format('ddd D MMM HH:mm')}` : 'Reminder cleared');
    delete this.settings.notified[t.file.path];
    await this.saveSettings();
  }
  promptDate(t, key) {
    const cur = t[key];
    new DatePromptModal(this.app, {
      title: key === 'due' ? `Due date · ${t.id || t.title}` : `Remind me · ${t.id || t.title}`,
      time: key === 'remind',
      value: cur ? cur.format(key === 'remind' ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD') : '',
      onSubmit: (v) => (key === 'due' ? this.setDue(t, v) : this.setRemind(t, v)),
    }).open();
  }
  /** Add a step. No log line (only checking a step is logged). Writes per ticket are queued so fast Enters never clash. */
  addStep(t, text) {
    if (!this.writeQ) this.writeQ = new Map();
    const key = t.file.path;
    const next = (this.writeQ.get(key) || Promise.resolve())
      .then(() => this.app.vault.process(t.file, (d) => addToSection(d, 'steps', `- [ ] ${text}`)))
      .catch((e) => console.error('Neon Tickets: could not add step', e));
    this.writeQ.set(key, next);
    return next;
  }
  /**
   * Tick or untick a step: one queued write flips the box and (for a finished step) adds the log line.
   * step.done flips at once, so the row can update before the write and a quick second click toggles back.
   */
  toggleStep(t, step) {
    const wasDone = step.done;
    step.done = !wasDone;
    if (!this.writeQ) this.writeQ = new Map();
    const key = t.file.path;
    let ok = false;
    const next = (this.writeQ.get(key) || Promise.resolve())
      .then(() =>
        this.app.vault.process(t.file, (d) => {
          const lines = d.split('\n');
          const fmLen = d.length - stripFrontmatter(d).length;
          const offset = d.slice(0, fmLen).split('\n').length - 1;
          const i = step.line + offset;
          const l = lines[i];
          if (l === undefined || !l.includes(step.text)) return d;
          ok = true;
          if (wasDone) lines[i] = l.replace(/\[[^ ]\]/, '[ ]').replace(/\s*✅\s*\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2})?\s*$/u, '');
          else lines[i] = l.replace('[ ]', '[x]').replace(/\s*$/, '') + ` ✅ ${STAMP()}`;
          const out = lines.join('\n');
          // only finished steps go in the log; reopening one stays quiet
          return wasDone ? out : addToSection(out, 'log', `- ${STAMP()} — Step done: ${step.text}`);
        }),
      )
      .then(() => {
        if (!ok) {
          step.done = wasDone;
          new Notice('That step changed in the meantime — refreshed');
        } else if (!wasDone) this.app.workspace.trigger('neon:ticket-changed', { file: t.file, id: t.id, title: t.title, change: `Step done: ${step.text}` });
      })
      .catch((e) => {
        step.done = wasDone;
        console.error('Neon Tickets: could not change step', e);
        new Notice('Could not save the step');
      });
    this.writeQ.set(key, next);
    return next;
  }
  /** Change the line a step lives on. fn gets the line and returns the new line, or null to delete it. No log entry. */
  async changeStepLine(t, step, fn) {
    let ok = false;
    await this.app.vault.process(t.file, (d) => {
      const lines = d.split('\n');
      const fmLen = d.length - stripFrontmatter(d).length;
      const offset = d.slice(0, fmLen).split('\n').length - 1;
      const i = step.line + offset;
      const l = lines[i];
      if (l === undefined || !l.includes(step.text)) return d;
      ok = true;
      const nl = fn(l);
      if (nl === null) lines.splice(i, 1);
      else lines[i] = nl;
      return lines.join('\n');
    });
    if (!ok) new Notice('That step changed in the meantime — refreshed');
    return ok;
  }
  async editStep(t, step, text) {
    return this.changeStepLine(t, step, (l) => {
      const m = l.match(/^(\s*[-*+]\s+\[.\]\s*)(.*?)(\s*✅\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\s*)?$/u);
      return m ? m[1] + text + (m[3] || '') : l;
    });
  }
  async removeStep(t, step) {
    return this.changeStepLine(t, step, () => null);
  }
  async addLog(t, text) {
    await this.log(t, text);
  }
  async addDescription(t, text) {
    await this.app.vault.process(t.file, (d) => addToSection(d, 'description', text));
    await this.log(t, 'Description updated');
  }
  async logTime(t, { min, note }) {
    const start = moment().subtract(min, 'minutes');
    await this.app.vault.process(t.file, (d) => addToSection(d, 'time', `- ${start.format('YYYY-MM-DD HH:mm')} · ${min}m${note ? ' · ' + note : ''}`));
    await this.log(t, `Time logged: ${fmtMin(min)}${note ? ' — ' + note : ''}`);
    this.app.workspace.trigger('neon:time-entry', {
      start: start.valueOf(),
      min,
      cat: t.category,
      note: note ? `${t.id ? t.id + ' ' : ''}${note}` : `${t.id ? t.id + ' · ' : ''}${t.title}`,
      path: t.file.path,
      jira: t.jira,
      source: 'ticket',
    });
  }

  /* filing done tickets ----------------------------------------------------- */
  ticketRoot() {
    return normalizePath(this.settings.ticketFolder || 'Core/Tickets');
  }
  doneRoot() {
    return normalizePath(`${this.ticketRoot()}/${this.settings.doneFolder || 'Done'}`);
  }
  /** Where a done ticket goes, or null when it lives outside the ticket folder. */
  doneDest(t, when) {
    if (!this.settings.autoFile) return null;
    const p = t.file.path;
    const root = this.ticketRoot();
    if (!p.startsWith(root + '/')) return null;
    return `${this.doneRoot()}/${(t.completed || when).format('YYYY-MM')}`;
  }
  async moveTo(file, folder) {
    let dest = normalizePath(`${folder}/${file.name}`);
    if (dest === file.path) return;
    if (this.moving.has(file)) return;
    this.moving.add(file);
    try {
      await ensureFolder(this.app, folder);
      // a note with the same name is already there: add a number instead of leaving the ticket behind
      if (this.app.vault.getAbstractFileByPath(dest)) dest = uniquePath(this.app, folder, file.basename, file.extension);
      await this.app.fileManager.renameFile(file, dest);
    } catch (e) {
      console.error('Neon Tickets: move failed', e);
      new Notice(`Couldn’t move “${file.basename}” to ${folder}`);
    } finally {
      this.moving.delete(file);
    }
  }
  /** Tickets marked done (or reopened) by editing the note get filed too. */
  fileSoon(f) {
    if (!this.settings.autoFile || !(f instanceof TFile)) return;
    this.fileTimers = this.fileTimers || new Map();
    window.clearTimeout(this.fileTimers.get(f));
    this.fileTimers.set(
      f,
      window.setTimeout(async () => {
        this.fileTimers.delete(f);
        const t = this.ticketFor(f);
        if (!t) return;
        if (t.status === 'done') await this.moveDone(f, moment());
        else await this.moveBack(f);
      }, 1500),
    );
  }
  async moveDone(file, when) {
    const t = this.ticketFor(file) || { file, completed: null };
    const dest = this.doneDest(t, when);
    if (dest && !file.path.startsWith(dest + '/')) await this.moveTo(file, dest);
  }
  async moveBack(file) {
    if (file.path.startsWith(this.doneRoot() + '/')) await this.moveTo(file, this.ticketRoot());
  }
  async fileAllDone(notify) {
    let n = 0;
    for (const t of this.collectTickets().filter((x) => x.status === 'done')) {
      const dest = this.doneDest(t, moment(t.file.stat.mtime));
      if (dest && !t.file.path.startsWith(dest + '/')) {
        await this.moveTo(t.file, dest);
        n++;
      }
    }
    if (notify || n) new Notice(n ? `✦ Filed ${n} done ticket${n === 1 ? '' : 's'} into ${this.doneRoot()}/` : 'All done tickets are already filed');
  }

  /* creating ------------------------------------------------------------------ */
  newTicket(opts) {
    new NewTicketModal(this, opts || {}).open();
  }

  /* ---- screenshots ---- */
  shotFolder() {
    const deck = neonPlugin(this.app, 'neon-deck');
    const core = (deck && deck.settings && deck.settings.coreFolder) || 'Core';
    return normalizePath(`${core}/Images/Tickets`);
  }
  /** Save image files into Core/Images/Tickets and link them under ## Screenshots. */
  async addScreenshots(t, files) {
    if (!files.length) return;
    const dir = this.shotFolder();
    await ensureFolder(this.app, dir);
    const links = [];
    for (const [i, f] of files.entries()) {
      const ext = IMG_TYPES[f.type];
      if (!ext) continue;
      const base = safeName(`${t.id || t.title} ${moment().format('YYYY-MM-DD HH-mm-ss')}${files.length > 1 ? ` ${i + 1}` : ''}`);
      const created = await this.app.vault.createBinary(uniquePath(this.app, dir, base, ext), await f.arrayBuffer());
      links.push(`![[${created.path}]]`);
    }
    if (!links.length) return;
    await this.app.vault.process(t.file, (d) => links.reduce((acc, l) => addToSection(acc, 'shots', l), d));
    await this.log(t, links.length === 1 ? 'Screenshot added' : `${links.length} screenshots added`);
    new Notice(`${links.length === 1 ? 'Screenshot' : `${links.length} screenshots`} saved to ${dir}`);
  }
  /** Take a screenshot off the ticket; the image itself goes to the system trash. */
  async removeScreenshot(t, shot) {
    const f = this.app.metadataCache.getFirstLinkpathDest(shot.link, t.file.path);
    await this.app.vault.process(t.file, (d) => {
      const lines = d.split('\n');
      const sec = findSection(lines, 'shots');
      if (!sec) return d;
      const i = lines.findIndex((l, n) => n > sec[0] && n < sec[1] && l.includes(shot.link));
      if (i !== -1) lines.splice(i, 1);
      return lines.join('\n');
    });
    if (f) await this.app.vault.trash(f, true);
  }

  /** Move done tickets (and optionally their screenshots and reports) to the system trash; tidy empty Done folders. */
  async clearDone(list, withFiles) {
    const reportsDir = normalizePath(`${this.ticketRoot()}/Exports`) + '/';
    const files = new Set();
    for (const t of list) {
      if (withFiles) {
        const b = parseTicketBody(stripFrontmatter(await this.app.vault.cachedRead(t.file)));
        for (const shot of b.shots) {
          const f = this.app.metadataCache.getFirstLinkpathDest(shot.link, t.file.path);
          if (f) files.add(f);
        }
        for (const f of this.app.vault.getMarkdownFiles()) {
          if (!f.path.startsWith(reportsDir)) continue;
          const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
          if (fm.ticket === t.file.path) files.add(f);
        }
      }
      files.add(t.file);
    }
    let n = 0;
    for (const f of files) {
      try {
        await this.app.vault.trash(f, true);
        n++;
      } catch (e) {
        console.error('Neon Tickets: could not trash', f.path, e);
      }
    }
    // empty month folders under Done/ go too
    const done = this.app.vault.getAbstractFileByPath(this.doneRoot());
    if (done && done.children) for (const d of [...done.children]) if (d.children && !d.children.length) await this.app.vault.trash(d, true);
    this.cache = null;
    this.emitSoon();
    new Notice(`Cleared ${list.length} done ticket${list.length === 1 ? '' : 's'}${n > list.length ? ` and ${n - list.length} file${n - list.length === 1 ? '' : 's'}` : ''} (system trash)`);
  }

  /* ---- export ---- */
  /** Build a report note for the ticket (Core/Tickets/Exports) and open Obsidian's PDF export for it. */
  async exportTicket(t) {
    const text = await this.app.vault.read(t.file);
    const b = parseTicketBody(stripFrontmatter(text));
    const day = (m) => (m ? moment(m).format('D MMM YYYY') : '—');
    const done = b.steps.filter((x) => x.done).length;
    const total = b.time.reduce((sum, x) => sum + x.min, 0);
    const facts = [
      ['Ticket', t.id || '—'],
      ['Jira', t.jira || '—'],
      ['Status', TICKET_STATUS_LABEL[t.status] || t.status],
      ['Priority', t.priority],
      ['Opened', day(t.created)],
      ['Due', day(t.due)],
      ['Completed', day(t.completed)],
      ['Time logged', total ? fmtMin(total) : '—'],
    ];
    const md = [
      '---',
      'type: ticket-report',
      'untracked: true', // reading a report is not work on the ticket
      `ticket: ${JSON.stringify(t.file.path)}`,
      `exported: ${moment().format('YYYY-MM-DD HH:mm')}`,
      'cssclasses: [tk-report]',
      '---',
      `# ${t.title}`,
      '',
      '| Detail | Value |',
      '| --- | --- |',
      ...facts.map(([k, v]) => `| **${k}** | ${String(v).replace(/\|/g, '\\|')} |`),
      '',
      '## Description',
      ...(b.description.length ? b.description : ['_No description._']),
      '',
      `## Steps (${done} of ${b.steps.length} done)`,
      ...(b.steps.length ? b.steps.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}${x.done && x.at ? ` — done ${x.at}` : ''}`) : ['_No steps._']),
      '',
      '## Screenshots',
      ...(b.shots.length ? b.shots.flatMap((x) => [`![[${x.link}]]`, '']) : ['_No screenshots._', '']),
      '## Time logged',
      ...(b.time.length ? b.time.map((x) => `- ${x.date}${x.start ? ' ' + x.start : ''} · ${fmtMin(x.min)}${x.note ? ` · ${x.note}` : ''}`) : ['_No time logged._']),
      '',
      '## Log',
      ...(b.log.length ? b.log.slice().sort((x, y) => (y.when ? y.when.valueOf() : 0) - (x.when ? x.when.valueOf() : 0)).map((x) => `- ${x.when ? x.when.format(x.hasTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD') + ' — ' : ''}${x.text}`) : ['_Nothing logged._']),
      '',
      `_Exported ${moment().format('D MMM YYYY, HH:mm')} from Neon Tickets._`,
      '',
    ].join('\n');
    const dir = normalizePath(`${this.settings.ticketFolder || 'Core/Tickets'}/Exports`);
    await ensureFolder(this.app, dir);
    const path = normalizePath(`${dir}/${safeName(`${t.id ? t.id + ' ' : ''}${t.title}`) || 'Ticket'} report.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const report = existing instanceof TFile ? (await this.app.vault.process(existing, () => md), existing) : await this.app.vault.create(path, md);
    // open the report in reading mode (reusing its tab if it's already open) and hand it to Obsidian's PDF export
    const open = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === report);
    const leaf = open || this.app.workspace.getLeaf('tab');
    await leaf.openFile(report, { active: true, state: { mode: 'preview' } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    window.setTimeout(() => {
      if (!this.app.commands.executeCommandById('workspace:export-pdf')) new Notice('Report ready — use “Export to PDF” from the note menu to save it.');
    }, 400);
    return report;
  }

  /* ---- ticket templates (local: stored in this plugin's data) ---- */
  async saveTemplate(tpl) {
    const list = this.settings.templates;
    const i = list.findIndex((x) => x.id === tpl.id);
    if (i === -1) list.push(tpl);
    else list[i] = tpl;
    await this.saveSettings();
    this.emitSoon();
  }
  async deleteTemplate(id) {
    this.settings.templates = this.settings.templates.filter((x) => x.id !== id);
    await this.saveSettings();
    this.emitSoon();
  }
  async duplicateTemplate(id) {
    const tpl = this.settings.templates.find((x) => x.id === id);
    if (!tpl) return;
    const copy = { ...tpl, steps: [...tpl.steps], id: newTemplateId(), name: `${tpl.name} copy` };
    const list = this.settings.templates;
    list.splice(list.indexOf(tpl) + 1, 0, copy);
    await this.saveSettings();
    this.emitSoon();
  }
  async createTicket({ title, id, description, priority, category, due, remind, steps, jira }) {
    const q = (v) => JSON.stringify(String(v || ''));
    const yaml = [
      '---',
      'type: ticket',
      ...(id ? [`ticket: ${q(id)}`] : []),
      'status: open',
      `priority: ${priority || 'normal'}`,
      'tags:',
      '  - ticket',
      `${CATS.includes(category) ? category : 'operations'}: true`,
      `created: ${moment().format('YYYY-MM-DD')}`,
      ...(due ? [`due: ${due}`] : []),
      ...(remind ? [`remind: ${remind}`] : []),
      ...(jira ? [`jira: ${q(jira)}`] : []),
      '---',
      '',
    ].join('\n');
    const body = [
      `# ${id ? id + ' · ' : ''}${title}`,
      '',
      '## Description',
      description,
      '',
      '## Next steps',
      ...(steps && steps.length ? steps.map((s) => `- [ ] ${s}`) : []),
      '',
      '## Log',
      `- ${STAMP()} — Ticket opened`,
      '',
    ].join('\n');
    const f = await createUnique(this.app, this.ticketRoot(), `${id ? id + ' ' : ''}${title}`, yaml + body);
    this.app.workspace.trigger('neon:ticket-changed', { file: f, id, title, change: 'Ticket opened' });
    await this.showTicket(f);
    new Notice(`🎫 Ticket created${due ? ` · due ${moment(due).format('ddd D MMM')}` : ''}`);
  }

  /* dashboard widget ------------------------------------------------------------ */
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'New ticket', onClick: () => p.newTicket() });
    button(card.actions, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open ticket tracker', onClick: () => p.openTracker() });
    const counter = card.body.createDiv('tk-counter is-mini');
    const list = card.body.createDiv('tk-mini-list');
    let renders = 0;
    const render = () => {
      if (!list.isConnected) return;
      list.toggleClass('is-calm', renders++ > 0); // animate on first open only
      const all = p.collectTickets();
      const act = all.filter((t) => t.status !== 'done');
      card.badge.setText(act.length ? String(act.length) : '');
      card.w.toggleClass('has-overdue', act.some((t) => t.bucket === 'overdue' || t.bucket === 'followup'));
      p.renderCounter(counter, all);
      list.empty();
      if (!act.length) {
        emptyState(list, 'No open tickets ✦');
        return;
      }
      act.slice(0, 30).forEach((t, i) => {
        const r = list.createDiv(`tk-mini is-${t.bucket} prio-${t.priority}`);
        r.style.setProperty('--i', String(Math.min(i, 20)));
        r.createSpan({ cls: 'tk-mini-due', text: ticketDueText(t) });
        const txt = r.createDiv('tk-mini-text');
        if (t.id) txt.createSpan({ cls: 'tk-id', text: t.id });
        txt.createSpan({ cls: 'tk-mini-title', text: t.title });
        if (t.status === 'waiting' && t.bucket !== 'followup') r.createSpan({ cls: 'tk-tag-wait', text: 'waiting' });
        r.addEventListener('click', (e) => p.showTicket(t.file, e));
        r.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const m = new Menu();
          ticketMenu(p, t, m);
          m.showAtMouseEvent(e);
        });
      });
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  }

  /* reminders --------------------------------------------------------------------- */
  async checkReminders(force) {
    if (!this.settings.reminders && !force) return;
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    // waiting tickets without a follow-up date get one after N days
    for (const t of this.activeTickets()) {
      if (t.status === 'waiting' && !t.followUp) {
        const since = t.waitingSince || moment(t.file.stat.mtime);
        if (now.diff(since, 'days') >= this.settings.autoFollowUpDays) {
          await this.patch(t, { follow_up: today });
          await this.log(t, `No answer for ${this.settings.autoFollowUpDays} days — follow up today`);
        }
      }
    }
    this.cache = null;
    const seen = this.settings.notified;
    for (const k of Object.keys(seen)) if (seen[k] !== today) delete seen[k];
    const ahead = this.settings.remindDays;
    const due = this.activeTickets().filter((t) => t.bucket === 'followup' || (t.due && t.daysLeft <= ahead) || (t.remind && !t.remind.isAfter(now)));
    const fresh = force ? due : due.filter((t) => seen[t.file.path] !== today);
    if (!fresh.length) {
      if (force) new Notice('No tickets need attention right now ✦');
      return;
    }
    for (const t of fresh) seen[t.file.path] = today;
    await this.saveSettings();
    const frag = createFragment((d) => {
      d.createDiv({ cls: 'tk-notice-title', text: `🎫 ${fresh.length} ticket${fresh.length === 1 ? '' : 's'} need${fresh.length === 1 ? 's' : ''} attention` });
      for (const t of fresh.slice(0, 6)) {
        const line = d.createDiv({ cls: `tk-notice-line is-${t.bucket}` });
        line.createSpan({ cls: 'tk-notice-due', text: ticketDueText(t) });
        line.createSpan({ text: ` ${t.id ? t.id + ' · ' : ''}${t.title}` });
      }
      if (fresh.length > 6) d.createDiv({ text: `+${fresh.length - 6} more` });
      d.createDiv({ cls: 'tk-notice-hint', text: 'Click to open the tracker' });
    });
    const n = new Notice(frag, 0);
    const el = n.noticeEl || n.messageEl;
    if (el) {
      el.addClass('tk-notice');
      el.addEventListener('click', () => this.openTracker());
    }
    // reminders stay inside Obsidian: a system notification froze Obsidian's main process for minutes on Linux
  }
  buildStatus() {
    const el = this.addStatusBarItem();
    el.addClass('nd-status', 'tk-statusbar', 'mod-clickable');
    setIcon(el.createSpan('nd-status-icon'), 'ticket');
    const txt = el.createSpan('nd-status-text');
    tip(el, 'Tickets — click to open the tracker');
    el.addEventListener('click', () => this.openTracker());
    const update = () => {
      const act = this.activeTickets();
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const fu = act.filter((t) => t.bucket === 'followup').length;
      const today = act.filter((t) => t.bucket === 'today').length;
      el.toggle(act.length > 0);
      const parts = [];
      if (over) parts.push(`${over} overdue`);
      if (fu) parts.push(`${fu} follow up`);
      if (today) parts.push(`${today} today`);
      txt.setText(parts.length ? parts.join(' · ') : `${act.length} open`);
      el.toggleClass('is-alert', over > 0);
      el.toggleClass('is-warn', !over && today + fu > 0);
    };
    this.register(this.onChange(update));
    this.registerInterval(window.setInterval(update, 5 * 60 * 1000));
    this.app.workspace.onLayoutReady(update);
  }
};
