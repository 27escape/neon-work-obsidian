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
