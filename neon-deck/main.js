'use strict';
/*
 * Neon Deck — dashboard, themes, live patterns, card explorer and concept graph.
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
/* Neon Deck core: constants                                           */
/* ------------------------------------------------------------------ */
const VIEW_DASH = 'neon-deck-dashboard';
const VIEW_CARDS = 'neon-deck-cards';
const VIEW_GRAPH = 'neon-deck-graph';
/** Neon views that live in the main pane (folded into one pane once, see foldNeonTabs). */
const MAIN_VIEWS = [VIEW_DASH, VIEW_CARDS, VIEW_GRAPH, 'neon-deck-tickets', 'neon-time'];

const PALETTE = ['#c6e651', '#e5506a', '#7fb3c9', '#d9c56a', '#e4e6ea', '#b9a0d6', '#5fcf96', '#e08a5a', '#8f86b8', '#8f95a0'];
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

const THEMES = ['marathon', 'cyberpunk', 'brutal', 'calm', 'paper', 'night', 'phosphor', 'blueprint'];
const THEME_LABEL = {
  marathon: 'Marathon', cyberpunk: 'Cyberpunk', brutal: 'Brutal', calm: 'Calm', paper: 'Paper', night: 'Night shift', phosphor: 'Phosphor', blueprint: 'Blueprint',
};
const THEME_PATTERN = {
  marathon: 'damascus', cyberpunk: 'circuit', brutal: 'hex', calm: 'none', paper: 'topo', night: 'circuit', phosphor: 'datastream', blueprint: 'radar',
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
  'Small steps still move tickets',
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
  coreFolder: 'Core',
  coreTidied: false,
  reviewFolder: 'Core/Reviews',
  inboxPath: 'Core/Inbox.md',
  bridgeFolder: 'Core/Bridges',
  excludeFolders: 'Core/Templates',
  cardsInSidebar: true,
  replaceFileExplorer: true,
  cardSort: 'modified',
  cardMode: 'cards',
  revisitDays: 14,
  seen: {},
  graphMaxNodes: 120,
  graphWindow: 4,
  extraStopwords: '',
};
/** 1.2 keys that moved to Neon Tickets / were removed; dropped after migration. */
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

/* ------------------------------------------------------------------ */
/* Live pattern background (WebGL)                                     */
/* One canvas behind a view. Cards are solid in the middle, so the     */
/* pattern only shows at card edges and, very faintly, in the gaps.    */
/* ------------------------------------------------------------------ */

const PATTERNS = ['damascus', 'meteorite', 'topo', 'circuit', 'hex', 'datastream', 'radar', 'none'];
const PATTERN_LABEL = {
  damascus: 'Damascus', meteorite: 'Meteorite', topo: 'Topo', circuit: 'Circuit', hex: 'Hex mesh',
  datastream: 'Datastream', radar: 'Radar', none: 'None',
};
const PATTERN_MODE = { damascus: 0, meteorite: 1, topo: 2, hex: 3, circuit: 4, datastream: 5, radar: 6 };
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
  // two levels of folding (big slow ones, then smaller ones) so the layers never repeat the same way
  float wx=c.x+60.*sin(c.y/170.+.3*sin(c.x/410.))+22.*sin(c.y/97.+c.x/530.);
  float wy=c.y+40.*sin(c.x/230.+.4*sin(c.y/350.))+18.*sin(c.x/131.-c.y/470.);
  wx+=8.*sin(ph+c.y/300.);wy+=6.*cos(ph+c.x/280.);
  // a slow zone field: tight straight layers in some places, loose twisted ones in others
  float zone=.5+.5*sin(wx/520.+.7*sin(wy/610.))*cos(wy/450.-ph*.25);
  float w=wy+22.*sin(wx/53.+ph)+30.*sin(wx/310.+wy/260.)+(6.+14.*zone)*sin(wx/17.+wy/41.-ph*2.)+5.*sin((wx+wy)/9.+ph)+7.5*ph;
  float band=sin(w/(5.5+4.*zone));
  // raindrop rings where the zone peaks
  float drop=sin(length(mod(vec2(wx,wy),180.)-90.)/6.-ph);
  band=mix(band,drop,smoothstep(.75,.97,zone)*.65);
  return pow(max(0.,band),1.2+.8*zone);
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
float circuit(vec2 p,float ph){
  float s=30.;vec2 cell=floor(p/s);vec2 f=p-cell*s-s*.5;float hs=h21(cell);float hs2=h21(cell+7.31);
  float v=0.;
  if(hs<.35)v=1.-smoothstep(.6,1.8,abs(f.y));
  else if(hs<.7)v=1.-smoothstep(.6,1.8,abs(f.x));
  else if(hs<.82){v=max(1.-smoothstep(.6,1.8,abs(f.y))*step(0.,f.x),1.-smoothstep(.6,1.8,abs(f.x))*step(0.,f.y));v*=step(-1.5,min(f.x,f.y));}
  float via=step(.78,hs2)*(1.-smoothstep(1.,2.,abs(length(f)-4.)));
  float pulse=.55+.45*pow(max(0.,sin(ph-(cell.x+cell.y)*.35)),6.);
  return max(v*pulse,via);
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
float radar(vec2 p,float ph){
  vec2 c=vec2(uRes.x/uDpr*.78,420.);vec2 d=p-c;float r=length(d);float ang=atan(d.y,d.x);
  float rings=1.-smoothstep(.8,2.,abs(mod(r,90.)-45.)*1.);
  float spokes=(1.-smoothstep(.6,1.6,abs(mod(ang+PI,PI/6.)-PI/12.)*r))*step(30.,r);
  float sw=mod(ph-ang,2.*PI);float sweep=exp(-sw*2.2)*step(r,520.);
  return max(max(rings*.9,spokes*.45),sweep*.7);
}
float field(vec2 c,float ph){
  if(uMode<.5)return damascus(c,ph);
  if(uMode<1.5)return meteorite(c,ph);
  return topo(c,ph);
}
void main(){
  vec2 px=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;
  vec2 p=px+vec2(0.,uOff);
  float ph=uT*2.*PI;float a=0.;
  if(uMode<2.5){
    float g=6.;float rowH=g*.866;float r0=floor(p.y/rowH);float best=1e9;vec2 bc=vec2(0.);
    for(int k=0;k<2;k++){float rr=r0+float(k);float off=mod(rr,2.)*g*.5;vec2 cc=vec2(floor((p.x-off)/g+.5)*g+off,rr*rowH);
      float dd=distance(p,cc);if(dd<best){best=dd;bc=cc;}}
    // dots fade in as they grow instead of popping on at a size cutoff (that popping looked like glitches)
    float v=field(bc,ph);float rad=v*g*.44;a=(1.-smoothstep(rad-.6,rad+.6,best))*smoothstep(.15,.7,rad);
  } else if(uMode<3.5) a=hexmesh(p,ph);
  else if(uMode<4.5) a=circuit(p,ph);
  else if(uMode<5.5) a=datastream(p,ph);
  else a=radar(p,ph);
  float inside=0.;
  for(int i=0;i<${MAX_RECTS};i++){if(float(i)>=uN)break;float d=sdRR(px,uRects[i],uRad);inside=max(inside,1.-smoothstep(-1.,1.,d));}
  float al=a*mix(uAOut,uAIn,inside);
  gl_FragColor=vec4(uCol*al,al);
}`;

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
        console.warn('Neon Deck pattern shader', gl.getShaderInfoLog(s));
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
      this.contentEl.createDiv({ cls: 'nd-muted', text: 'Turn on Neon Tasks, Tickets or Time to capture into them.' });
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
        console.error('Neon Deck capture', e);
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

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/** Default 4×4 layout; satellite slots fall back to their neighbours. */
const DASH_LAYOUT = [
  ['totals', 'pulse', 'pulse', 'tickets'],
  ['totals', 'tasks', 'global', 'tickets'],
  ['capture', 'tasks', 'global', 'time'],
  ['recent', 'activity', 'activity', 'time'],
];
/** Smallest grid height: the row minimums in styles.css (120 + 150 + 150 + 140) plus 3 gaps of 14. */
const DASH_GRID_MIN = 602;
const SLOT_FALLBACK = { tasks: 'global', global: 'tasks', tickets: 'time', time: 'tickets' };

function dashAreas(present) {
  const resolve = (name) => {
    const seen = new Set();
    let n = name;
    while (n && !present.has(n) && !seen.has(n)) {
      seen.add(n);
      n = SLOT_FALLBACK[n] || null;
    }
    if (n && present.has(n)) return n;
    if (name === 'tasks' || name === 'tickets') return 'activity';
    return null;
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
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-dash', 'nd-pattern-host');
    this.scroller = root.createDiv('nd-dash-scroll');
    const inner = this.scroller.createDiv('nd-dash-inner');
    this.buildHero(inner);
    this.tickerEl = inner.createDiv('nd-ticker');
    this.grid = inner.createDiv('nd-dash-grid is-entering');
    window.setTimeout(() => this.grid && this.grid.removeClass('is-entering'), 900);
    this.totals = this.place(widget(this.grid, 'nd-w-totals', 'Totals', 'sigma', 'everything tracked so far'), 'totals');
    this.stats = this.place(widget(this.grid, 'nd-w-stats', 'Vault pulse', 'activity'), 'pulse');
    this.buildCapture(this.grid);
    this.recent = this.place(widget(this.grid, 'nd-w-recent', 'Recently touched', 'history'), 'recent');
    this.heat = this.place(widget(this.grid, 'nd-w-heat', 'Activity', 'flame'), 'activity');
    this.footEl = inner.createDiv('nd-dash-foot');
    this.mountSlots();

    this.pattern = new PatternLayer(this.plugin, root, this.scroller, '.nd-card, .nd-hero');
    this.register(() => this.pattern && this.pattern.destroy());
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(root);
    ro.observe(this.heroEl); // the hero wraps to more lines on narrow widths
    if (this.heat) ro.observe(this.heat.body);
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
    this.registerEvent(this.app.workspace.on('neon-deck:captures-changed', () => this.capRow && this.renderCaptureTargets()));
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
    this.grid.toggleClass('is-narrow', w < 880);
    this.fitGrid();
    const fit = this.heatFit();
    if (fit.key !== this.lastHeatKey && this.lastData) this.renderHeat(this.lastData);
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
      console.error('Neon Deck widget', e);
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
      let handle = null;
      try {
        handle = def.mount(card, this) || null;
      } catch (e) {
        console.error(`Neon Deck widget ${def.id}`, e);
        emptyState(card.body, 'This widget failed to load — see console');
      }
      this.slotCards.set(def.id, { def, card, handle });
    }
    const present = new Set(['totals', 'pulse', 'capture', 'recent', 'activity', ...[...defs.values()].map((d) => d.slot)]);
    const { areas, cols } = dashAreas(present);
    this.grid.style.gridTemplateAreas = areas;
    this.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
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
    const looks = hero.createDiv('nd-hero-looks');
    const sel = (label, opts, get, set) => {
      const wrap = looks.createEl('label', { cls: 'nd-look-select' });
      wrap.createSpan({ cls: 'nd-look-k', text: label });
      const s = wrap.createEl('select', { cls: 'dropdown' });
      for (const [v, l] of opts) s.createEl('option', { value: v, text: l });
      s.value = get();
      s.addEventListener('change', () => set(s.value));
      return s;
    };
    const p = this.plugin;
    this.themeSel = sel('Theme', THEMES.map((t) => [t, THEME_LABEL[t]]), () => p.settings.theme, (v) => p.setLook({ theme: v }));
    this.patSel = sel(
      'Pattern',
      [['auto', 'Theme default'], ...PATTERNS.map((x) => [x, PATTERN_LABEL[x]])],
      () => p.settings.pattern,
      (v) => p.setLook({ pattern: v }),
    );
    this.strSel = sel('Strength', STRENGTHS.map((x) => [x, STRENGTH_LABEL[x]]), () => p.settings.patternStrength, (v) => p.setLook({ patternStrength: v }));
    this.modeBtn = button(looks, { cls: 'nd-icon-btn nd-mode-toggle', title: 'Light / dark', onClick: () => p.toggleLightDark() });
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
      ...[...p.actions.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
      { icon: 'layout-grid', label: 'Cards', run: () => p.activate(VIEW_CARDS, 'tab') },
      { icon: 'waypoints', label: 'Graph', run: () => p.activate(VIEW_GRAPH, 'tab') },
      { icon: 'search', label: 'Search', run: () => p.openSearch('') },
    ];
    for (const a of acts) button(el, { icon: a.icon, text: a.label, cls: 'nd-action', onClick: () => a.run() });
  }
  syncLook() {
    const s = this.plugin.settings;
    if (this.themeSel) this.themeSel.value = s.theme;
    if (this.patSel) this.patSel.value = s.pattern;
    if (this.strSel) this.strSel.value = s.patternStrength;
    if (this.modeBtn) {
      this.modeBtn.empty();
      icon(this.modeBtn, this.plugin.isDark() ? 'sun' : 'moon');
    }
    if (this.footEl) {
      this.footEl.empty();
      const pat = this.plugin.activePattern();
      this.footEl.createSpan({ text: `Neon Deck ${ND_VERSION} · ${THEME_LABEL[s.theme]}${pat !== 'none' && s.patternStrength !== 'off' ? ' · ' + PATTERN_LABEL[pat] : ''}` });
      this.footEl.createSpan({ cls: 'nd-madewith', text: 'Made with Claude' });
    }
  }
  updateClock() {
    const m = moment();
    const h = m.hour();
    const g = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const name = this.plugin.settings.name;
    this.greetEl.setText(`${g}${name ? ', ' + name : ''} ✦`);
    this.dateEl.setText(m.format('dddd D MMM'));
    this.clockEl.setText(m.format('HH:mm:ss') + ` · week ${m.isoWeek()}`);
  }

  /* capture ------------------------------------------------------------ */
  buildCapture(grid) {
    const { body } = this.place(widget(grid, 'nd-w-capture', 'Quick capture', 'zap'), 'capture');
    this.capInput = body.createEl('textarea', { cls: 'nd-input nd-capture', attr: { placeholder: 'Dump a thought…', rows: '3' } });
    this.capRow = body.createDiv('nd-pills nd-capture-row');
    this.capInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Ctrl+Enter sends to the first target (Task when Neon Tasks is on)
        this.sendCapture(this.plugin.captureTargets()[0]);
      }
    });
    this.renderCaptureTargets();
  }
  renderCaptureTargets() {
    const row = this.capRow;
    row.empty();
    const targets = this.plugin.captureTargets();
    this.capInput.setAttr('placeholder', targets.length ? `Dump a thought… (Ctrl+Enter → ${targets[0].label})` : 'Dump a thought… (turn on Neon Tasks, Tickets or Time to send it somewhere)');
    targets.forEach((t, i) => {
      const b = row.createEl('button', { cls: 'nd-pill-btn' + (i === 0 ? ' is-on' : ''), text: t.short || t.label });
      tip(b, t.label);
      b.addEventListener('click', () => this.sendCapture(t));
    });
  }
  async sendCapture(t) {
    const ta = this.capInput;
    const v = ta.value.trim();
    if (!t || (!v && !t.allowEmpty)) {
      ta.focus();
      return;
    }
    try {
      await t.run(v);
    } catch (e) {
      console.error('Neon Deck capture', e);
      new Notice('Capture failed — see console');
      return;
    }
    ta.value = '';
    ta.addClass('nd-flash');
    window.setTimeout(() => ta.removeClass('nd-flash'), 600);
  }

  /* data widgets -------------------------------------------------------- */
  async renderData() {
    const token = ++this.dataToken;
    const d = this.plugin.collectVaultData();
    this.lastData = d;
    this.renderStats(d);
    this.renderRecent(d);
    this.renderHeat(d);
    this.renderCaptureTargets();
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
    const b = this.stats.body;
    b.empty();
    // first paint: sparklines draw in and tiles rise one after another
    const tiles = b.createDiv('nd-tiles' + (this.statsShown ? '' : ' is-intro'));
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
    tile(d.md.length, 'notes', 'var(--nd-text)', () => this.plugin.activate(VIEW_CARDS, 'tab'), 'Open the card explorer · line: notes created per day', this.perDay(d.md, (f) => f.stat.ctime));
    this.wordsEl = tile('…', 'words', 'var(--nd-text)');
    tile(d.links, 'links', 'var(--nd-info)', () => this.plugin.openGraph('notes'), 'Open the note graph');
    tile(d.orphans.length, 'orphans', 'var(--nd-accent)', () => new FileListModal(this.plugin, d.orphans, 'Orphan notes — no links in or out').open(), 'Notes with no links in or out');
    tile(d.editedToday.length, 'edited today', 'var(--nd-go)', () => new FileListModal(this.plugin, d.editedToday, 'Edited today').open(), 'Line: notes edited per day', this.perDay(d.md, (f) => f.stat.mtime));
  }
  renderRecent(d) {
    const b = this.recent.body;
    b.empty();
    const list = b.createDiv('nd-mini-list');
    const recent = d.md.slice().sort((a, b2) => b2.stat.mtime - a.stat.mtime).slice(0, 8);
    if (!recent.length) emptyState(list, 'No notes yet — create your first one ✦');
    recent.forEach((f, i) => {
      const c = list.createDiv('nd-mini');
      c.style.setProperty('--i', String(i));
      const cat = fileCategory(this.app, f);
      c.style.setProperty('--row-accent', cat && cat !== 'untracked' ? catColor(cat) : 'var(--nd-line-strong)');
      c.createDiv({ cls: 'nd-mini-title', text: f.basename });
      const folder = f.parent && f.parent.path !== '/' ? f.parent.path + ' · ' : '';
      c.createDiv({ cls: 'nd-mini-meta', text: folder + moment(f.stat.mtime).fromNow() });
      this.plugin.bindFileMouse(c, f, this);
    });
  }
  /** Dot size and week count that fit inside the Activity card, both ways. */
  heatFit() {
    const b = this.heat ? this.heat.body : null;
    const gap = 4;
    const pad = 12; // body padding, so the today ring, glow and hover zoom aren't clipped
    const foot = 26; // footer line plus the gap above it
    const w = b ? b.clientWidth - pad : 0;
    const h = b ? b.clientHeight - pad - foot : 0;
    const cell = h > 0 ? clamp(Math.floor((h - 6 * gap) / 7), 7, 14) : 12;
    const weeks = w > 0 ? clamp(Math.floor((w + gap) / (cell + gap)), 4, 53) : 12;
    return { cell, weeks, gap, key: `${cell}x${weeks}` };
  }
  renderHeat(d) {
    const b = this.heat.body;
    b.empty();
    const fit = this.heatFit();
    const weeks = fit.weeks;
    this.lastHeatKey = fit.key;
    const start = moment().startOf('isoWeek').subtract(weeks - 1, 'weeks');
    const todayKey = dayKey(Date.now());
    const counts = new Map();
    const byDay = new Map();
    const bump = (k, f) => {
      counts.set(k, (counts.get(k) || 0) + 1);
      if (f) {
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(f);
      }
    };
    for (const f of d.md) {
      const c = dayKey(f.stat.ctime);
      const m = dayKey(f.stat.mtime);
      bump(c, f);
      if (m !== c) bump(m, f);
    }
    // first paint: the dots fade in week by week, left to right
    const grid = b.createDiv('nd-heat' + (this.heatShown ? '' : ' is-intro'));
    this.heatShown = true;
    grid.style.gridTemplateColumns = `repeat(${weeks}, ${fit.cell}px)`;
    grid.style.gridTemplateRows = `repeat(7, ${fit.cell}px)`;
    grid.style.gap = `${fit.gap}px`;
    let active = 0;
    const day = start.clone();
    for (let i = 0; i < weeks * 7; i++) {
      const k = day.format('YYYY-MM-DD');
      const n = counts.get(k) || 0;
      if (n) active++;
      const lvl = n === 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 7 ? 3 : 4;
      const cell = grid.createDiv(`nd-heat-cell lvl-${lvl}` + (k > todayKey ? ' is-future' : '') + (k === todayKey ? ' is-today' : ''));
      cell.style.gridColumn = String(Math.floor(i / 7) + 1);
      cell.style.setProperty('--c', String(Math.floor(i / 7)));
      cell.style.gridRow = String((i % 7) + 1);
      cell.createDiv('nd-heat-dot');
      tip(cell, `${day.format('ddd D MMM')} · ${n} event${n === 1 ? '' : 's'}`);
      const files = byDay.get(k);
      if (files) {
        cell.addClass('is-clickable');
        const label = day.format('ddd D MMM');
        cell.addEventListener('click', () => new FileListModal(this.plugin, files, `Notes created or edited · ${label}`).open());
      }
      day.add(1, 'day');
    }
    const foot = b.createDiv('nd-heat-foot');
    foot.createSpan({ text: `${active} active days · last ${weeks} weeks` });
    const legend = foot.createSpan('nd-heat-legend');
    legend.createSpan({ text: 'less' });
    for (let l = 0; l <= 4; l++) legend.createDiv(`nd-heat-cell lvl-${l}`).createDiv('nd-heat-dot');
    legend.createSpan({ text: 'more' });
  }
  renderTicker(d) {
    d = d || this.lastData || this.plugin.collectVaultData();
    const p = this.plugin;
    const items = [];
    for (const fn of p.facts.values()) {
      try {
        items.push(...(fn() || []));
      } catch (e) {
        console.error('Neon Deck facts', e);
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
  }
  nextTicker() {
    if (!this.tickerLines || this.tickerLines.length < 2 || !this.tickerEl || !this.tickerEl.isConnected) return;
    if (this.tickerEl.matches(':hover')) return;
    this.tickerIdx = (this.tickerIdx + 1) % this.tickerLines.length;
    this.showTicker(true);
  }
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
  }

  /** Totals card: live counts from Neon Time, Tickets, Tasks and the vault. The first tile spans the card. */
  renderTotals(d) {
    if (!this.totals) return;
    d = d || this.lastData || this.plugin.collectVaultData();
    const b = this.totals.body;
    b.empty();
    const tiles = b.createDiv('nd-tiles nd-totals' + (this.totalsShown ? '' : ' is-intro'));
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
      if (sub) t.createDiv({ cls: 'nd-tile-sub', text: sub });
      if (hint) tip(t, hint);
    };
    const now = moment();
    const monthStart = now.clone().startOf('month');
    const thisMonth = (ms) => ms >= monthStart.valueOf();
    const month = now.format('MMM');

    // time worked (Neon Time)
    const tm = neonPlugin(this.app, 'neon-time');
    if (tm && tm.days) {
      const todayKey = now.format('YYYY-MM-DD');
      let total = 0;
      let monthMin = 0;
      let worked = 0;
      let tasks = 0;
      let tasksMonth = 0;
      for (const [key, day] of Object.entries(tm.days)) {
        const entries = key === todayKey && tm.entriesOf ? tm.entriesOf(key, true) : day.entries || [];
        const min = entries.reduce((s, e) => s + (e.ms || 0), 0) / 60000;
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
        console.error('Neon Deck totals', e);
      }
      tile([Math.round(total), (x) => fmtMin(Math.round(x))], 'time worked', 'var(--nd-accent)', `${fmtMin(Math.round(monthMin))} in ${month}${bal ? ` · ${bal > 0 ? '+' : ''}${fmtMin(bal)} balance` : ''}`, 'All time tracked in Neon Time, automatic and manual');
      tile(worked, worked === 1 ? 'day worked' : 'days worked', 'var(--nd-info)', null, 'Days with tracked time');
      tile(tasks, 'tasks done', 'var(--nd-go)', `${tasksMonth} in ${month}`, 'Tasks ticked since Neon Time started counting');
    } else {
      const ts = neonPlugin(this.app, 'neon-tasks');
      const log = ts && ts.settings && ts.settings.doneLog;
      if (log) tile(log.length, 'tasks done', 'var(--nd-go)', `${log.filter((x) => thisMonth(x.t)).length} in ${month}`, 'Tasks ticked in the last 120 days');
    }

    // tickets (Neon Tickets)
    const tk = neonPlugin(this.app, 'neon-tickets');
    if (tk && tk.collectTickets) {
      const all = tk.collectTickets();
      const done = all.filter((t) => t.status === 'done');
      const doneMonth = done.filter((t) => t.completed && t.completed.isSame(now, 'month')).length;
      tile(done.length, 'tickets done', 'var(--nd-warn)', `${doneMonth} in ${month} · ${all.length - done.length} open`, 'Tickets marked done, by completed date');
    }

    // notes (vault)
    const created = d.md.filter((f) => thisMonth(f.stat.ctime)).length;
    tile(d.md.length, 'notes', 'var(--nd-text)', `${created} created in ${month}`, 'Notes in the vault, without excluded folders');
  }
}

/* ------------------------------------------------------------------ */
/* Card explorer                                                       */
/* ------------------------------------------------------------------ */

const CARD_CHIPS = [
  ['all', 'All'],
  ['school', 'School'],
  ['projects', 'Projects'],
  ['operations', 'Operations'],
  ['admin', 'Admin'],
  ['revisit', 'Revisit'],
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
    this.build();
    const re = debounce(() => this.refresh(0, true), 250, true);
    this.registerEvent(this.app.vault.on('create', re));
    this.registerEvent(this.app.vault.on('delete', re));
    this.registerEvent(this.app.vault.on('rename', re));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => this.updateCard(f)));
    this.registerEvent(this.app.workspace.on('file-open', () => this.markActive()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.markNav()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.markNav()));
    this.registerEvent(this.app.workspace.on('neon-deck:slots-changed', () => this.renderNav()));
    this.registerEvent(this.app.workspace.on('neon-deck:pins-changed', () => this.refresh(0, true)));
    this.registerEvent(this.app.workspace.on('neon-deck:seen-changed', debounce(() => this.refresh(0, true), 600, true)));
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.isSidebar() === this.sidebar) return;
        this.build();
        this.refresh(0);
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
    ];
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
  sortMenu(e) {
    const m = new Menu();
    const opts = [
      ['modified', 'Recently modified'],
      ['created', 'Recently created'],
      ['revisit', 'Revisit first'],
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
  }
  sorter() {
    const s = this.plugin.settings.cardSort;
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (s === 'name') return byName;
    if (s === 'name-desc') return (a, b) => byName(b, a);
    if (s === 'created') return (a, b) => b.stat.ctime - a.stat.ctime;
    if (s === 'revisit') return (a, b) => this.revisitAge(b) - this.revisitAge(a) || b.stat.mtime - a.stat.mtime;
    return (a, b) => b.stat.mtime - a.stat.mtime;
  }
  /** Days since the note was last opened (or marked revisited); -1 when it isn't a school note. */
  revisitAge(f) {
    if (!(f instanceof TFile) || f.extension !== 'md' || fileCategory(this.app, f) !== 'school') return -1;
    const seen = Math.max(this.plugin.settings.seen[f.path] || 0, f.stat.ctime);
    return Math.floor((Date.now() - seen) / 864e5);
  }
  needsRevisit(f) {
    return this.revisitAge(f) >= this.plugin.settings.revisitDays;
  }
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
  }
  matchChip(f) {
    const c = this.chip;
    if (c === 'all') return true;
    if (c === 'revisit') return this.needsRevisit(f);
    const cat = fileCategory(this.app, f);
    if (c === 'untracked') return f.extension === 'md' && (!cat || cat === 'untracked');
    return cat === c;
  }
  /** Notes in a folder (recursive), with category counts. */
  folderInfo(folder) {
    const notes = [];
    const walk = (fd) => {
      for (const c of fd.children) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') notes.push(c);
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
    return { notes, cat };
  }

  renderChips() {
    const el = this.chipsEl;
    if (!el) return;
    el.empty();
    const folder = this.folder();
    const scope = this.query ? this.app.vault.getMarkdownFiles() : this.folderInfo(folder).notes;
    const revisit = scope.filter((f) => this.needsRevisit(f)).length;
    for (const [k, label] of CARD_CHIPS) {
      const b = el.createEl('button', { cls: `nd-pill-btn chip-${k}` + (this.chip === k ? ' is-on' : '') });
      if (k === 'revisit') icon(b, 'rotate-ccw');
      b.createSpan({ text: k === 'revisit' && revisit ? `${label} (${revisit})` : label });
      if (CATS.includes(k)) b.style.setProperty('--pill-accent', catColor(k));
      b.addEventListener('click', () => {
        this.chip = this.chip === k ? 'all' : k;
        this.refresh(0, true, true);
      });
    }
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
    const sortLabel = { modified: 'Recent', created: 'Created', revisit: 'Revisit first', name: 'A → Z', 'name-desc': 'Z → A' }[this.plugin.settings.cardSort] || 'Recent';
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
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
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
    let acc = '';
    const parts = folder.path === '/' ? [] : folder.path.split('/');
    parts.forEach((p, i) => {
      c.createSpan({ cls: 'nd-crumb-sep', text: '/' });
      acc = acc ? `${acc}/${p}` : p;
      const b = mk(p, acc);
      if (i === parts.length - 1) b.addClass('is-current');
    });
    c.scrollLeft = c.scrollWidth;
  }

  baseCard(parent, cls, i, path) {
    const card = parent.createDiv(`nd-ci ${cls}`);
    card.style.setProperty('--i', String(Math.min(i, 24)));
    card.dataset.path = path;
    return card;
  }
  catTag(parent, cat) {
    if (!cat || cat === 'untracked') return null;
    const t = parent.createSpan({ cls: 'nd-cat-tag', text: CAT_LABEL[cat] });
    t.style.setProperty('--tag-accent', catColor(cat));
    return t;
  }
  folderIcon(parent, cat) {
    const ic = icon(parent, 'folder', 'nd-folder-icon');
    ic.style.setProperty('--folder-accent', cat ? catColor(cat) : 'var(--nd-muted)');
    return ic;
  }
  folderCard(parent, folder, info, i) {
    const card = this.baseCard(parent, 'nd-ci-folder', i, folder.path);
    this.folderIcon(card, info.cat);
    const main = card.createDiv('nd-ci-main');
    const top = main.createDiv('nd-ci-top');
    top.createDiv({ cls: 'nd-ci-title', text: folder.name });
    this.catTag(top, info.cat);
    const n = info.notes.length;
    const weekAgo = Date.now() - 7 * 864e5;
    let meta = `${n} note${n === 1 ? '' : 's'}`;
    if (info.cat === 'school' && n) {
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
  }
  folderMenu(folder, e) {
    e.preventDefault();
    this.plugin.fileMenu(folder, e, (m) => {
      const pinned = this.plugin.settings.pinnedFolders.includes(folder.path);
      m.addItem((it) => it.setTitle(pinned ? 'Unpin folder' : 'Pin folder').setIcon(pinned ? 'pin-off' : 'pin').onClick(() => this.plugin.togglePin(folder.path)));
      m.addItem((it) => it.setTitle('Open in new cards tab').setIcon('layout-grid').onClick(() => this.plugin.openCardsAt(folder.path, true)));
      m.addItem((it) => it.setTitle('New note here').setIcon('file-plus').onClick(() => this.plugin.newNote(folder.path)));
      m.addItem((it) => it.setTitle('New folder here').setIcon('folder-plus').onClick(() => this.plugin.newFolder(folder.path)));
      m.addItem((it) => it.setTitle('Graph of this folder').setIcon('waypoints').onClick(() => this.plugin.openGraph('notes', `folder:${folder.path}`)));
    });
  }
  dragFolder(el, folder) {
    el.setAttr('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      this.plugin.dragging = folder;
      try {
        const dm = this.app.dragManager;
        dm.onDragStart(e, dm.dragFolder(e, folder));
      } catch (_) {
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', folder.path);
      }
    });
    el.addEventListener('dragend', () => (this.plugin.dragging = null));
  }
  fileCard(parent, file, i, showPath) {
    const ext = file.extension.toLowerCase();
    const isMd = ext === 'md';
    const isImg = IMG_EXT.has(ext);
    const cache = isMd ? this.app.metadataCache.getFileCache(file) : null;
    const cat = isMd ? noteCategory(cache) : null;
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
  }
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
  }
  async excerpt(file, max = 180) {
    const key = `${file.path}:${file.stat.mtime}:${max}`;
    let t = this.excerpts.get(key);
    if (t === undefined) {
      t = excerptOf(await this.app.vault.cachedRead(file), max);
      if (this.excerpts.size > 2000) this.excerpts.clear();
      this.excerpts.set(key, t);
    }
    return t;
  }
  async fillExcerpt(file, el) {
    const t = await this.excerpt(file);
    el.setText(t || 'Empty note — click to start writing');
    el.toggleClass('is-empty', !t);
  }
  updateCard(file) {
    if (!this.bodyEl || !(file instanceof TFile)) return;
    const card = this.bodyEl.querySelector(`[data-path="${CSS.escape(file.path)}"]`);
    if (!card) return;
    const ex = card.querySelector('.nd-ci-excerpt');
    if (ex) this.fillExcerpt(file, ex);
  }
  markActive() {
    if (!this.bodyEl) return;
    const p = this.plugin.lastFile && this.plugin.lastFile.path;
    this.bodyEl.querySelectorAll('[data-path]').forEach((c) => c.toggleClass('is-active', c.dataset.path === p));
  }

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
  }
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
    if (fileCategory(this.app, file) === 'school') button(row, { text: 'Mark revisited', onClick: () => (this.plugin.markSeen(file.path), this.hidePreview(true)) });
    const hr = this.contentEl.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const w = 340;
    let left = cr.right - hr.left + 10;
    if (left + w > hr.width - 8) left = Math.max(8, cr.left - hr.left - w - 10);
    pv.style.left = `${left}px`;
    pv.style.top = `${clamp(cr.top - hr.top, 8, Math.max(8, hr.height - pv.offsetHeight - 8))}px`;
  }
  hidePreview(now) {
    window.clearTimeout(this.hideTimer);
    const kill = () => {
      if (this.previewEl) this.previewEl.remove();
      this.previewEl = null;
    };
    if (now) kill();
    else this.hideTimer = window.setTimeout(kill, 220);
  }

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
        this.folderIcon(row, info.cat);
        row.createSpan({ cls: 'nd-side-name', text: fd.name });
        row.createSpan({ cls: 'nd-side-count', text: String(info.notes.length) });
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
    const dirs = kids.filter((c) => c instanceof TFolder).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const files = kids.filter((c) => c instanceof TFile).sort(this.sorter());
    for (const d of dirs) {
      const info = this.folderInfo(d);
      const row = body.createDiv('nd-side-row is-folder');
      row.dataset.path = d.path;
      if (info.cat) row.style.setProperty('--row-tint', catColor(info.cat));
      this.folderIcon(row, info.cat);
      row.createSpan({ cls: 'nd-side-name', text: d.name });
      row.createSpan({ cls: 'nd-side-count', text: String(info.notes.length) });
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
  }
  /** Folders in shades of the accent (red), notes in shades of go (lime); shades alternate per kind. */
  toneRows(body) {
    let dirs = 0;
    let notes = 0;
    for (const el of Array.from(body.children)) {
      if (el.matches('.nd-side-pin, .nd-side-row.is-folder')) el.addClass(dirs++ % 2 ? 'tone-b' : 'tone-a');
      else if (el.matches('.nd-side-row.is-note')) el.addClass(notes++ % 2 ? 'tone-b' : 'tone-a');
      else if (el.matches('.nd-section-k')) dirs = notes = 0;
    }
  }
  sideNote(parent, f, showPath) {
    const row = parent.createDiv('nd-side-row is-note');
    row.dataset.path = f.path;
    if (this.plugin.lastFile && this.plugin.lastFile.path === f.path) row.addClass('is-active');
    const cat = fileCategory(this.app, f);
    if (cat && cat !== 'untracked') row.style.setProperty('--row-accent', catColor(cat));
    row.createSpan({ cls: 'nd-side-name', text: f.extension === 'md' ? f.basename : f.name });
    const t = Math.max(f.stat.mtime, this.plugin.settings.seen[f.path] || 0);
    row.createSpan({ cls: 'nd-side-count', text: showPath && f.parent && f.parent.path !== '/' ? f.parent.path : shortAgo(t) });
    if (this.needsRevisit(f)) row.addClass('needs-revisit');
    this.plugin.bindFileMouse(row, f, this);
  }

  canMove(f, dest) {
    if (dest == null) return false;
    const parent = f.parent ? f.parent.path : '/';
    if (parent === dest) return false;
    if (f instanceof TFolder && (dest === f.path || dest.startsWith(f.path + '/'))) return false;
    return true;
  }
  makeDropTarget(el, getPath) {
    el.addEventListener('dragover', (e) => {
      const f = this.plugin.dragging;
      if (!f || !this.canMove(f, getPath())) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.addClass('is-drop');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.removeClass('is-drop');
    });
    el.addEventListener('drop', async (e) => {
      el.removeClass('is-drop');
      const f = this.plugin.dragging;
      const dest = getPath();
      if (!f || !this.canMove(f, dest)) return;
      e.preventDefault();
      e.stopPropagation();
      this.plugin.dragging = null;
      await this.plugin.moveTo(f, dest);
    });
  }
}
function shortAgo(t) {
  const m = Math.max(0, (Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 1440 * 60) return `${Math.round(m / 1440)}d`;
  return moment(t).format('MMM YY');
}

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
      .filter((f) => f instanceof TFolder && f.path !== '/')
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const f of folders) sel.createEl('option', { value: `folder:${f.path}`, text: `▸ ${f.path}` });
    if (![...sel.options].some((o) => o.value === this.scope)) this.scope = 'vault';
    sel.value = this.scope;
  }

  scopeFiles() {
    const excl = (f) => this.plugin.isExcluded(f);
    let files = this.app.vault.getMarkdownFiles().filter((f) => !excl(f));
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

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.cw) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!this.nodes.length) return;
    const col = this.colors();
    const pal = col.pal;
    const cam = this.cam;
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);
    const focus = this.focusSet();
    ctx.lineCap = 'round';
    // links: thin and quiet, so the nodes carry the picture; same-cluster links take the cluster colour
    // dense graphs get fainter links, so a thousand of them read as structure, not haze
    // (dark lines on a light page read heavier, so light themes go lighter still)
    const linkA = (col.dark ? 0.24 : 0.14) * clamp(250 / Math.max(1, this.links.length), 0.3, 1);
    for (const l of this.links) {
      const on = !focus || (focus.has(l.s.i) && focus.has(l.t.i));
      ctx.globalAlpha = on ? (focus ? 0.75 : linkA) : 0.03;
      ctx.strokeStyle = l.s.c === l.t.c ? pal[l.s.c % pal.length] : col.muted;
      ctx.lineWidth = (0.5 + 1.8 * Math.sqrt(l.w / this.maxW)) / Math.sqrt(cam.k);
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      ctx.stroke();
    }
    // nodes: a dark core lit from inside by the cluster colour, a crisp ring, a soft glow (dark themes);
    // light themes get the same shape without the glow
    const glowK = Math.min(1.6, Math.max(0.6, cam.k));
    for (const n of this.nodes) {
      const on = !focus || focus.has(n.i);
      ctx.globalAlpha = on ? 1 : 0.1;
      const c = pal[n.c % pal.length];
      const hub = n.r > 12;
      const core = ctx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.35, n.r * 0.1, n.x, n.y, n.r);
      core.addColorStop(0, col.a(n.c, col.dark ? 0.55 : 0.35));
      core.addColorStop(1, col.dark ? col.a(n.c, 0.08) : col.a(n.c, 0.12));
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = col.surface;
      if (col.dark && on) {
        ctx.shadowColor = col.a(n.c, hub ? 0.75 : 0.5);
        ctx.shadowBlur = (hub ? 22 : 10) * glowK;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = core;
      ctx.fill();
      ctx.lineWidth = (hub ? 2.2 : 1.6) / Math.sqrt(cam.k);
      ctx.strokeStyle = c;
      ctx.stroke();
      if (hub) {
        // a faint outer orbit marks the hubs
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 1 / cam.k;
        ctx.strokeStyle = col.a(n.c, 0.35);
        ctx.stroke();
      }
      if (n.kind === 'link' || n.kind === 'tag') {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(1.5, n.r * 0.24), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // hover / selection: an accent ring with a slow ripple
    const special = [this.selected, this.hover].filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k);
    if (special.length) {
      const still = prefersReducedMotion();
      const phase = still ? 0 : (performance.now() % 1600) / 1600;
      ctx.globalAlpha = 1;
      for (const i of special) {
        const n = this.nodes[i];
        if (!n) continue;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 / cam.k + 2, 0, Math.PI * 2);
        ctx.lineWidth = 2 / cam.k;
        ctx.strokeStyle = col.hot;
        ctx.shadowColor = col.hotA(0.6);
        ctx.shadowBlur = col.dark ? 12 : 0;
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (!still) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + (4 + phase * 12) / cam.k + 2, 0, Math.PI * 2);
          ctx.lineWidth = 1.5 / cam.k;
          ctx.strokeStyle = col.hotA(0.55 * (1 - phase));
          ctx.stroke();
        }
      }
      // keep the ripple moving while something is hovered or selected, but only while the graph is on
      // screen and Obsidian is focused, and at ~30 fps: a hidden graph tab must cost nothing
      if (!still && !this.pulseQueued && this.contentEl.offsetParent && document.hasFocus()) {
        this.pulseQueued = true;
        window.setTimeout(() => {
          this.pulseQueued = false;
          if ((this.selected >= 0 || this.hover >= 0) && this.contentEl.offsetParent) this.requestDraw();
        }, 33);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.nodes) {
      const special = n.i === this.hover || n.i === this.selected;
      const on = !focus || focus.has(n.i);
      if (!this.showLabels && !special) continue;
      const fs = 9 + n.r * 0.55;
      if (!special && fs * cam.k < 7 && !(focus && on)) continue;
      ctx.globalAlpha = on ? 1 : 0.14;
      ctx.font = `${n.r > 12 || special ? 700 : 500} ${fs}px ${col.font}`;
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = col.bg;
      const y = n.y + n.r + fs * 0.72;
      ctx.strokeText(n.label, n.x, y);
      // hubs speak up, small nodes stay quiet
      ctx.fillStyle = special ? col.hot : n.r > 12 ? col.text : col.muted;
      ctx.fillText(n.label, n.x, y);
    }
    ctx.globalAlpha = 1;
  }

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
        this.dirty = false;
      }
      if (busy || this.drag) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  requestDraw() {
    this.dirty = true;
    this.kick();
  }

  hit(x, y) {
    for (let j = this.nodes.length - 1; j >= 0; j--) {
      const n = this.nodes[j];
      const r = n.r + 4 / this.cam.k;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
  }

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
  }

  select(i) {
    this.selected = i;
    this.renderSelection();
    this.requestDraw();
  }
  nodeFile(n) {
    if (this.mode === 'notes') return this.net.files[n.i];
    if (n.kind === 'link') return this.app.metadataCache.getFirstLinkpathDest(this.net.keys[n.i].slice(1, -1), '');
    return null;
  }
  activateNode(n, e) {
    const f = this.nodeFile(n);
    if (f) this.plugin.openFile(f, e);
    else this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label);
  }
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
  }
  toggleTopic(k) {
    this.focusTopic = this.focusTopic === k ? -1 : k;
    this.gapFocus = null;
    this.panel.querySelectorAll('.nd-topic').forEach((r, idx) => r.toggleClass('is-active', idx === this.focusTopic));
    if (this.focusTopic >= 0) this.fit(true, this.an.topics[k].members);
    else this.fit(true);
    this.requestDraw();
  }

  section(title, ic) {
    const s = this.panel.createDiv('nd-panel-sec');
    const h = s.createDiv('nd-panel-head');
    icon(h, ic);
    h.createSpan({ text: title });
    return s;
  }
  topicWords(k, n = 3) {
    return this.an.topics[k].members.slice(0, n).map((i) => this.net.labels[i]);
  }

  renderPanel() {
    const p = this.panel;
    p.empty();
    const an = this.an;
    const pal = this.colors().pal;
    const unit = this.mode === 'concepts' ? 'concepts' : 'notes';

    const st = this.section('Structure', 'gauge');
    const badge = st.createDiv(`nd-diversity is-${an.diversity.toLowerCase()}`);
    badge.createDiv({ cls: 'nd-div-label', text: an.diversity });
    badge.createDiv({ cls: 'nd-div-q', text: `modularity ${an.Q.toFixed(2)} · top topic ${Math.round(an.topics[0].share * 100)}%` });
    const scale = st.createDiv('nd-div-scale');
    for (const lvl of ['Biased', 'Focused', 'Diversified', 'Dispersed']) scale.createDiv({ cls: 'nd-div-step' + (lvl === an.diversity ? ' is-on' : ''), text: lvl });
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
  }

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
  }

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
      '> [!question] Structural gap found by Neon Deck',
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
    const f = await createUnique(this.app, this.plugin.settings.bridgeFolder, title, body);
    new Notice('🌉 Bridge note created');
    this.plugin.openFile(f, { ctrlKey: true });
  }
}

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
      .setDesc('Also in the dashboard header. Every theme has a light and a dark version.')
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
      .setName('Light / dark mode')
      .addButton((b) => b.setButtonText('Toggle').onClick(() => p.toggleLightDark()));
    new Setting(containerEl)
      .setName('Your name')
      .setDesc('Used in the dashboard greeting.')
      .addText((t) => t.setValue(s.name).onChange((v) => ((s.name = v.trim()), save())));
    new Setting(containerEl).setName('Open dashboard on startup').addToggle((t) => t.setValue(s.openDashboardOnStartup).onChange((v) => ((s.openDashboardOnStartup = v), save())));

    new Setting(containerEl).setName('Notes').setHeading();
    new Setting(containerEl)
      .setName('Core folder')
      .setDesc('Tickets, time log, reviews, quick tasks, daily notes and templates live in here. Your own folders sit next to it.')
      .addText((t) => t.setValue(s.coreFolder).onChange((v) => ((s.coreFolder = normalizePath(v.trim() || 'Core')), save())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('Move Neon files into this folder now').onClick(() => p.tidyIntoCore(true)));
    new Setting(containerEl)
      .setName('Weekly review folder')
      .setDesc('Optional template: a note named Weekly Review in your templates folder with {{weekLine}} and {{weekNotes}}.')
      .addText((t) => t.setValue(s.reviewFolder).onChange((v) => ((s.reviewFolder = v.trim() || 'Core/Reviews'), save())));
    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Comma-separated. Ignored by stats and the graph.')
      .addText((t) => t.setValue(s.excludeFolders).onChange((v) => ((s.excludeFolders = v), save())));

    new Setting(containerEl).setName('Card explorer').setHeading();
    new Setting(containerEl).setName('Show cards in the left sidebar').addToggle((t) => t.setValue(s.cardsInSidebar).onChange((v) => ((s.cardsInSidebar = v), save())));
    new Setting(containerEl)
      .setName('Replace the file explorer')
      .setDesc('Closes the tree-view file explorer on startup. Get it back with “Files: Show file explorer”.')
      .addToggle((t) => t.setValue(s.replaceFileExplorer).onChange((v) => ((s.replaceFileExplorer = v), save())));
    num(new Setting(containerEl).setName('Revisit school notes after (days)').setDesc('School notes you haven’t opened for this long get a Revisit badge.'), 'revisitDays', 1, 365);

    new Setting(containerEl).setName('Graph').setHeading();
    num(new Setting(containerEl).setName('Max notes').setDesc('The graph shows up to twice this many notes.'), 'graphMaxNodes', 20, 400);
    new Setting(containerEl).setName('Bridge note folder').addText((t) => t.setValue(s.bridgeFolder).onChange((v) => ((s.bridgeFolder = v.trim()), save())));
    madeWith(containerEl, 'Neon Deck');
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

module.exports = class NeonDeck extends Plugin {
  async onload() {
    await this.loadSettings();
    this.wordCache = new Map();
    this.lookListeners = new Set();
    this.widgets = new Map();
    this.captures = new Map();
    this.facts = new Map();
    this.actions = new Map();
    this.weekLines = new Map();
    this.excludes = new Map();
    this.services = new Map();
    this.dragging = null;
    this.api = this.buildApi();
    this.loadFonts();
    this.applyLook();

    this.registerView(VIEW_DASH, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_CARDS, (leaf) => new CardsView(leaf, this));
    this.registerView(VIEW_GRAPH, (leaf) => new GraphView(leaf, this));
    for (const [v, d] of [[VIEW_DASH, 'dashboard'], [VIEW_CARDS, 'cards'], [VIEW_GRAPH, 'graph']]) this.registerHoverLinkSource(v, { display: `Neon Deck ${d}`, defaultMod: true });

    this.addRibbonIcon('layout-dashboard', 'Neon Deck dashboard', () => this.activate(VIEW_DASH, 'tab'));
    this.addRibbonIcon('layout-grid', 'Card explorer', () => this.activate(VIEW_CARDS, 'tab'));
    this.addRibbonIcon('waypoints', 'Note graph', () => this.openGraph('notes'));

    const cmds = [
      ['open-dashboard', 'Open dashboard', () => this.activate(VIEW_DASH, 'tab')],
      ['open-cards', 'Open card explorer (tab)', () => this.activate(VIEW_CARDS, 'tab')],
      ['open-cards-sidebar', 'Open card explorer (sidebar)', () => this.activate(VIEW_CARDS, 'left')],
      ['open-graph', 'Open note graph', () => this.openGraph('notes')],
      ['graph-active-note', 'Note graph of active note', () => this.openGraph('notes', 'note')],
      ['open-today', 'Open today’s daily note', () => this.openToday()],
      ['toggle-light-dark', 'Toggle light / dark mode', () => this.toggleLightDark()],
      ['next-theme', 'Next theme', () => this.setLook({ theme: THEMES[(THEMES.indexOf(this.settings.theme) + 1) % THEMES.length] }, true)],
      ['next-pattern', 'Next pattern', () => this.setLook({ pattern: PATTERNS[(PATTERNS.indexOf(this.activePattern()) + 1) % PATTERNS.length] }, true)],
      ['weekly-review', 'Create / open this week’s review', () => this.weeklyReview()],
      ['tidy-core', 'Move Neon files into the Core folder', () => this.tidyIntoCore(true)],
    ];
    for (const [id, name, callback] of cmds) this.addCommand({ id, name, callback });
    // hidden while Neon Tasks is on: it brings its own New note command
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
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: ' ' }],
      callback: () => new QuickCaptureModal(this).open(),
    });
    this.addCommand({
      id: 'mark-revisited',
      name: 'Mark current note as revisited',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) {
          this.markSeen(f.path);
          new Notice('✦ Marked as revisited');
        }
        return true;
      },
    });

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
    if (this.fontStyle) this.fontStyle.remove();
    document.body.removeClass('nd-themed', ...THEMES.map((x) => `nd-theme-${x}`));
    this.app.workspace.trigger('neon-deck:core-unloaded');
  }

  async loadSettings() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    const s = this.settings;
    if (!Array.isArray(s.pinnedFolders)) s.pinnedFolders = [];
    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    if ((raw.settingsVersion || 0) < 3) {
      // 1.2 -> 1.3: style "intensity" becomes a theme; glass/random are gone
      s.theme = raw.intensity === 'calm' ? 'calm' : 'marathon';
      this.legacy = Object.assign({}, raw);
      for (const k of OLD_KEYS) delete s[k];
      s.settingsVersion = 3;
      await this.saveData(s);
    }
    if (!THEMES.includes(s.theme)) s.theme = 'marathon';
    if (s.pattern !== 'auto' && !PATTERNS.includes(s.pattern)) s.pattern = 'auto';
    if (!STRENGTHS.includes(s.patternStrength)) s.patternStrength = 'subtle';
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._saveSoon) this._saveSoon = debounce(() => this.saveSettings(), 4000, true);
    this._saveSoon();
  }

  /* API for Neon Tasks / Tickets / Time ------------------------------------ */
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
      /** named services, e.g. 'newNote' from Neon Tasks, 'newTicket' from Neon Tickets */
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

  loadFonts() {
    const dir = this.manifest.dir;
    const url = (f) => this.app.vault.adapter.getResourcePath(normalizePath(`${dir}/fonts/${f}`));
    const face = (family, file) => `@font-face{font-family:"${family}";src:url("${url(file)}") format("truetype");font-weight:100 900;font-style:normal;font-display:swap;}`;
    this.fontStyle = document.head.createEl('style', { attr: { id: 'neon-deck-fonts' } });
    this.fontStyle.textContent = [face('Unbounded', 'Unbounded.ttf'), face('Space Grotesk', 'SpaceGrotesk.ttf'), face('JetBrains Mono', 'JetBrainsMono.ttf')].join('\n');
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
  isDark() {
    return document.body.hasClass('theme-dark');
  }
  toggleLightDark() {
    const next = this.isDark() ? 'moonstone' : 'obsidian';
    const app = this.app;
    try {
      if (typeof app.changeTheme === 'function') app.changeTheme(next);
      else if (typeof app.setTheme === 'function') app.setTheme(next);
      else throw new Error('no theme api');
      if (app.vault && typeof app.vault.setConfig === 'function') app.vault.setConfig('theme', next);
    } catch (_) {
      document.body.toggleClass('theme-dark', next === 'obsidian');
      document.body.toggleClass('theme-light', next === 'moonstone');
    }
    app.workspace.trigger('css-change');
    this.emitLook();
  }

  /* pins & seen -------------------------------------------------------------- */
  async togglePin(path) {
    const pins = this.settings.pinnedFolders;
    const i = pins.indexOf(path);
    if (i >= 0) pins.splice(i, 1);
    else pins.push(path);
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed');
  }
  async renamePins(oldPath, newPath) {
    let hit = false;
    this.settings.pinnedFolders = this.settings.pinnedFolders.map((p) => {
      if (p === oldPath || p.startsWith(oldPath + '/')) {
        hit = true;
        return newPath + p.slice(oldPath.length);
      }
      return p;
    });
    if (!hit) return;
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed');
  }
  markSeen(path, quiet) {
    this.settings.seen[path] = Date.now();
    this.saveSoon();
    if (!quiet) this.app.workspace.trigger('neon-deck:seen-changed');
  }

  /**
   * Puts everything the Neon plugins keep (tickets, time log, reviews, inbox,
   * quick tasks, daily notes, templates, backups, the guide) under one Core
   * folder, so the vault root holds Core plus the user's own folders.
   * Uses fileManager.renameFile, so links are updated. Settings of the
   * satellites are patched in memory, or in their data.json when disabled.
   */
  async tidyIntoCore(manual) {
    if (this._tidying) return;
    this._tidying = true;
    try {
      const app = this.app;
      const root = normalizePath(this.settings.coreFolder || 'Core');
      const get = (p) => app.vault.getAbstractFileByPath(normalizePath(p));
      const inCore = (p) => p === root || p.startsWith(root + '/');
      const saves = [];
      // a plugin's settings: live if loaded, else its data.json
      const sat = async (id) => {
        const pl = neonPlugin(app, id);
        if (pl && pl.settings) return { s: pl.settings, save: () => pl.saveData(pl.settings) };
        const dp = normalizePath(`${app.vault.configDir}/plugins/${id}/data.json`);
        const dir = normalizePath(`${app.vault.configDir}/plugins/${id}`);
        if (!(await app.vault.adapter.exists(dir)) && !(await app.vault.adapter.exists(dp))) return null;
        let s = {};
        try {
          if (await app.vault.adapter.exists(dp)) s = JSON.parse(await app.vault.adapter.read(dp)) || {};
        } catch (e) {
          return null;
        }
        return { s, save: () => app.vault.adapter.write(dp, JSON.stringify(s, null, 2)) };
      };
      const coreJson = async (name, key, def) => {
        const id = name.replace('.json', '');
        const ip = app.internalPlugins && app.internalPlugins.getPluginById && app.internalPlugins.getPluginById(id);
        const opts = ip && ip.instance && ip.instance.options;
        const dp = normalizePath(`${app.vault.configDir}/${name}`);
        let s = {};
        try {
          if (await app.vault.adapter.exists(dp)) s = JSON.parse(await app.vault.adapter.read(dp)) || {};
        } catch (e) {
          /* keep {} */
        }
        const cur = (opts && opts[key]) || s[key] || def;
        return {
          cur,
          set: (v) => {
            if (opts) opts[key] = v;
            s[key] = v;
            saves.push(() => app.vault.adapter.write(dp, JSON.stringify(s, null, 2)));
          },
        };
      };
      // [current path, old default, setter]
      const items = [];
      const add = (cur, set, old) => {
        cur = cur ? normalizePath(cur) : '';
        // a fresh plugin already points into Core while its old files still sit at the root
        if (old && inCore(cur) && !get(cur) && get(old) && cur === normalizePath(`${root}/${old}`)) cur = old;
        if (cur && cur !== '/' && !inCore(cur)) items.push({ cur, set });
      };
      const s = this.settings;
      const mapEx = [];
      add(s.reviewFolder || 'Reviews', (v) => (s.reviewFolder = v), 'Reviews');
      add(s.inboxPath || 'Inbox.md', (v) => (s.inboxPath = v), 'Inbox.md');
      add(s.bridgeFolder || 'Bridges', (v) => (s.bridgeFolder = v), 'Bridges');
      const tasks = await sat('neon-tasks');
      if (tasks) {
        add(tasks.s.quickTasksPath || 'Quick tasks.md', (v) => (tasks.s.quickTasksPath = v), 'Quick tasks.md');
        add(tasks.s.backupPath || 'Neon/Global tasks backup.md', (v) => (tasks.s.backupPath = v), 'Neon/Global tasks backup.md');
        saves.push(tasks.save);
      }
      const tickets = await sat('neon-tickets');
      if (tickets) {
        add(tickets.s.ticketFolder || 'Tickets', (v) => (tickets.s.ticketFolder = v), 'Tickets');
        saves.push(tickets.save);
      }
      const time = await sat('neon-time');
      if (time) {
        add(time.s.logFolder || 'Time Log', (v) => (time.s.logFolder = v), 'Time Log');
        saves.push(time.save);
      }
      const daily = await coreJson('daily-notes.json', 'folder', '');
      if (daily.cur) add(daily.cur, daily.set);
      const tpl = await coreJson('templates.json', 'folder', '');
      add(tpl.cur || 'Templates', (v) => (tpl.cur ? tpl.set(v) : null));
      for (const p of s.excludeFolders.split(',').map((x) => x.trim()).filter(Boolean)) add(p, (v) => mapEx.push([normalizePath(p), v]));
      for (const p of ['Neon Deck Guide.md', 'Welcome.md']) add(p, () => null);

      // the same folder can come from two places (templates + excluded)
      const seen = new Map();
      for (const it of items) {
        if (!seen.has(it.cur)) seen.set(it.cur, []);
        seen.get(it.cur).push(it.set);
      }
      const ensure = async (dir) => {
        let acc = '';
        for (const part of dir.split('/')) {
          acc = acc ? `${acc}/${part}` : part;
          if (!get(acc)) await app.vault.createFolder(acc);
        }
      };
      let moved = 0;
      const clash = [];
      for (const [cur, sets] of seen) {
        const target = normalizePath(`${root}/${cur}`);
        const f = get(cur);
        if (f && get(target)) {
          clash.push(cur);
          continue;
        }
        if (f) {
          const parent = f.parent;
          await ensure(target.slice(0, target.lastIndexOf('/')));
          await app.fileManager.renameFile(f, target);
          moved++;
          // drop a folder the move left empty (e.g. Neon/ after its backup moved)
          if (parent && parent.path !== '/' && !inCore(parent.path) && parent.children && !parent.children.length) await app.vault.delete(parent, true);
        }
        for (const set of sets) set(target);
      }
      if (mapEx.length) {
        s.excludeFolders = s.excludeFolders
          .split(',')
          .map((x) => {
            const hit = mapEx.find(([a]) => a === normalizePath(x.trim()));
            return hit ? hit[1] : x.trim();
          })
          .filter(Boolean)
          .join(', ');
      }
      if (!get(root)) await app.vault.createFolder(root);
      s.coreTidied = true;
      this._ex = null;
      await this.saveSettings();
      for (const fn of saves) await fn();
      if (moved || manual) new Notice(moved ? `Neon Deck: moved ${moved} item${moved === 1 ? '' : 's'} into ${root}/.` + (clash.length ? ` Skipped (already in ${root}): ${clash.join(', ')}.` : '') : `Neon Deck: everything is already in ${root}/.`, 8000);
      else if (clash.length) new Notice(`Neon Deck: not moved, already in ${root}/: ${clash.join(', ')}`, 8000);
    } catch (e) {
      console.error('Neon Deck: tidy into Core', e);
      new Notice('Neon Deck: could not move everything into the Core folder. See the console.');
    } finally {
      this._tidying = false;
    }
  }

  async onReady() {
    const ws = this.app.workspace;
    if (!this.settings.coreTidied) await this.tidyIntoCore(false);
    this.lastFile = ws.getActiveFile();
    // after a plugin restart Obsidian puts our tabs back only once onload is done, so arrange tabs a moment later
    // (doing it straight away added a second Cards tab and a second Dashboard on every restart)
    window.setTimeout(() => this.arrangeOnStart(), 600);
    ws.trigger('neon-deck:core-ready', this.api);
  }

  async arrangeOnStart() {
    await this.ensureSidebarCards();
    await this.foldNeonTabs();
    if (!this.settings.openDashboardOnStartup) return;
    const ws = this.app.workspace;
    // reuse a Dashboard that's already open in the main area instead of adding another
    const open = ws.getLeavesOfType(VIEW_DASH).find((l) => l.getRoot() === ws.rootSplit);
    if (open) await ws.revealLeaf(open);
    else await this.activate(VIEW_DASH, 'tab');
  }
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
  }

  /* weekly review ------------------------------------------------------------ */
  weekLine(start, end) {
    const parts = [];
    for (const fn of this.weekLines.values()) {
      try {
        parts.push(...(fn(start, end) || []));
      } catch (e) {
        console.error('Neon Deck week line', e);
      }
    }
    const md = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
    const made = md.filter((f) => f.stat.ctime >= start.valueOf() && f.stat.ctime < end.valueOf()).length;
    if (!parts.length || made) parts.push(`${made} new note${made === 1 ? '' : 's'}`);
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }
  async weeklyReview() {
    const m = moment().startOf('isoWeek');
    const end = m.clone().add(7, 'days');
    const folder = normalizePath(this.settings.reviewFolder || 'Core/Reviews');
    const path = normalizePath(`${folder}/${m.format('GGGG-[W]WW')} Review.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return openFile(this.app, existing);

    const inWeek = (t) => t >= m.valueOf() && t < end.valueOf();
    const md = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
    const created = md.filter((f) => inWeek(f.stat.ctime)).sort((a, b) => a.stat.ctime - b.stat.ctime);
    const touched = md.filter((f) => inWeek(f.stat.mtime) && !inWeek(f.stat.ctime)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    const link = (f) => `- [[${f.path.replace(/\.md$/, '')}|${f.basename}]]`;
    const notesMd = [
      created.length ? `**New (${created.length})**\n${created.slice(0, 30).map(link).join('\n')}` : '_No new notes._',
      touched.length ? `\n**Edited (${touched.length})**\n${touched.slice(0, 30).map(link).join('\n')}` : '',
    ].join('\n');
    const line = this.weekLine(m, end);

    let tpl = '';
    const tf = this.app.metadataCache.getFirstLinkpathDest('Templates/Weekly Review', '');
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
  }

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
  }

  /* navigation helpers ---------------------------------------------------- */
  activate(type, where = 'tab') {
    return activateView(this.app, type, where);
  }
  async openCardsAt(path, newTab) {
    const ws = this.app.workspace;
    let leaf;
    if (newTab) leaf = ws.getLeaf('tab');
    else leaf = reusableLeaf(this.app); // the main pane
    await leaf.setViewState({ type: VIEW_CARDS, active: true, state: { path } });
    await ws.revealLeaf(leaf);
  }
  async openGraph(mode, scope) {
    const leaf = await this.activate(VIEW_GRAPH, 'tab');
    const view = leaf.view;
    if (view instanceof GraphView) await view.setState({ mode: 'notes', scope: scope || view.scope }, { history: false });
  }
  openFile(file, evt, line) {
    return openFile(this.app, file, evt, line);
  }
  openSearch(q) {
    const gs = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('global-search');
    if (gs && gs.instance && gs.instance.openGlobalSearch) gs.instance.openGlobalSearch(q);
    else new Notice('Enable the core “Search” plugin to use this');
  }
  /** Excluded folders/files (settings + other Neon plugins). Cached briefly: isExcluded runs once per note in vault scans. */
  excludedPaths() {
    const now = Date.now();
    if (!this._ex || now - this._exAt > 2000) {
      const ex = this.settings.excludeFolders.split(',').map((x) => normalizePath(x.trim())).filter((x) => x && x !== '/');
      for (const fn of this.excludes.values()) {
        try {
          ex.push(...(fn() || []).map(normalizePath));
        } catch (e) {
          console.error('Neon Deck exclude', e);
        }
      }
      this._ex = ex;
      this._exAt = now;
    }
    return this._ex;
  }
  isExcluded(f) {
    return this.excludedPaths().some((p) => f.path === p || f.path.startsWith(p + '/'));
  }
  currentFolder() {
    const f = this.app.workspace.getActiveFile();
    return f && f.parent ? f.parent.path : '/';
  }

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
      try {
        const dm = this.app.dragManager;
        dm.onDragStart(e, dm.dragFile(e, file));
      } catch (_) {
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', `[[${file.basename}]]`);
      }
    });
    el.addEventListener('dragend', () => (this.dragging = null));
  }
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
  }
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
  }
  confirmDelete(file) {
    new ConfirmModal(this.app, {
      title: 'Move to trash?',
      text: `“${file.name}”${file instanceof TFolder ? ' and everything inside it' : ''} will be moved to the trash.`,
      cta: 'Move to trash',
      onConfirm: () => this.app.fileManager.trashFile(file),
    }).open();
  }
  async moveTo(f, dest) {
    const np = normalizePath((dest === '/' ? '' : dest + '/') + f.name);
    if (this.app.vault.getAbstractFileByPath(np)) return new Notice('Something with that name already exists there');
    await this.app.fileManager.renameFile(f, np);
    new Notice(`Moved “${f.name}” → ${dest === '/' ? 'vault root' : dest}`);
  }

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
        await reusableLeaf(this.app).openFile(f, { active: true, state: { mode: 'source' } });
      },
    }).open();
  }
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
  }
  async openToday() {
    openFile(this.app, await ensureToday(this.app));
  }

  /* vault data ------------------------------------------------------------- */
  collectVaultData() {
    const app = this.app;
    const md = app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
    const rl = app.metadataCache.resolvedLinks;
    const incoming = new Set();
    let links = 0;
    for (const src in rl)
      for (const dst in rl[src]) {
        links += rl[src][dst];
        incoming.add(dst);
      }
    const orphans = md.filter((f) => !incoming.has(f.path) && !(rl[f.path] && Object.keys(rl[f.path]).length));
    const startToday = moment().startOf('day').valueOf();
    const editedToday = md.filter((f) => f.stat.mtime >= startToday);
    return { md, links, orphans, editedToday };
  }
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
  }
  stopwords() {
    const extra = this.settings.extraStopwords
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    return new Set([...STOPWORDS, ...extra]);
  }
};
