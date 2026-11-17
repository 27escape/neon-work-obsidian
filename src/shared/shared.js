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

const ND_VERSION = '1.0.0'; // set from the manifest by tools/build.mjs
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
