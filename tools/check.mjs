#!/usr/bin/env node
// Neon Deck check runner for Claude Code. No dependencies (Node 18+).
//
//   node neon-check.mjs <vault-or-plugins-dir> [--module time,tasks] [--json] [--no-log]
//   node neon-check.mjs --add-check "<module>|<what to do>|<what must happen>"   (adds a manual check after a bug)
//   node neon-check.mjs --manual <module,...>      (only print the manual checks to do)
//
// <vault-or-plugins-dir> = the unpacked vault (…/Projects) or its .obsidian/plugins folder.
// Automatic checks run here and print only failures + a one-line summary.
// Manual checks (things a script can't see) are printed with --manual <modules>, as a short list, to keep output small.
// Results are appended to neon-check-log.jsonl next to this script. Extra checks live in neon-check-extra.json.
// Use made-up data only. Never use company data.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(HERE, 'neon-check-log.jsonl'); // gitignored
const EXTRA = path.join(HERE, 'neon-check-extra.json');
const MAX_LINES = 800; // source file size rule (item 21)
const MODULES = ['deck', 'tasks', 'time', 'tickets', 'research', 'write'];
const PLUGIN_ID = { deck: 'neon-deck', tasks: 'neon-tasks', time: 'neon-time', tickets: 'neon-tickets', research: 'neon-research', write: 'neon-write' };

/* ---- manual checks (what a script can't see). Keep each one line: what to do → what must happen. ---- */
const MANUAL = {
  all: [
    'LOCAL: with the network turned off AND with a network monitor running (Obsidian dev tools → Network tab, or Windows Resource Monitor) use every view for 10 minutes → zero requests from Neon code, no error because the network is missing; diagnostics and error log contain no note text.',
    'Start with an empty vault → no console errors, every view opens, empty states shown.',
    'Start with the fixture vault (~500 notes, 100 tickets, 30 days of time) → dashboard usable in under 3 s.',
    'Turn each module off and on 5 times → no duplicate commands, buttons, tabs, status items, timers or listeners.',
    'Reload Obsidian right after changing a setting, opening a folder, ticking a task, grading a card → all four are kept.',
    'Start in safe mode → only core + settings load. Make one module throw on start → notice, that module paused, the others run.',
    'Make each module throw in start / handler / command / timer, and run a handler for 500 ms → the others keep working; after 3 errors in 60 s the module is paused with one notice.',
    'Load an old data.json (missing keys) and one with extra keys → defaults filled, unknown keys kept, backup made before migration. Cut-off data.json → only that module resets.',
    'Delete, rename, move a note, folder, topic while its view is open → view updates, no error, no stale rows.',
    'Open each view 20 times → memory does not keep growing; after closing, canvases, timers, listeners are gone. Leave open 2 h, visible then hidden → hidden uses almost no CPU.',
    'Every theme × light/dark × each view at 800×600, 1280×720, 1920×1080 → nothing cut off, text contrast ≥ 4.5:1, corners rounded, no overflow. Reduced motion → no animations.',
    'Windows: paths with spaces, long paths, case-only rename (a.md → A.md), locked/read-only file → notice, no crash, no half-written file.',
    'Before and after any refactor, same screenshots of every view → no visible difference unless intended.',
    'Copy the update zip (code only) over an existing vault → same tabs, settings, data; new version shown.',
  ],
  tasks: [
    'Add, edit, tick, delete a task 20 times in a row → no duplicates, no lost lines, file not rewritten repeatedly. New task row visible within 100 ms.',
    'Global tasks: drag-reorder, double-click edit, undo delete → file and screen match.',
    'Edit a task in its note while shown on the dashboard → the row updates.',
  ],
  time: [
    'Work past 8 h; delete entries at 9 h and 12 h; running entry at 8 h+ → delete and tracking still work.',
    'Set untracked: true on an open, tracking note → tracking stops, nothing logged.',
    'Click to another app and back within 30 min → time counted; away over 30 min → ends at last activity, idle time dropped; laptop sleep; midnight → no lost or double time.',
    'Work timer: start, pause, resume, close Obsidian, reopen, end day, 2 h idle auto-close → total right, nothing left over shown, Time Log files unchanged.',
  ],
  tickets: [
    'New ticket, log entry (newest first in pop-up, tab and note), time entry, screenshot paste, done, reopen → all views agree.',
    'CSV import (when built): same file twice, changed row, bad row, empty file, wrong columns → no duplicates, no overwritten notes, clear message.',
  ],
  research: [
    'Create, rename, delete topic and note; open/close a folder → under 50 ms, no full redraw. Type 30 s in a research note → no stall over 100 ms.',
    'Add flashcard; quiz again/hard/easy; quiz with a failing save → never freezes; history follows a rename.',
    'Research + School roots: switch, quiz counts separate → no mixing, nothing scanned outside the roots.',
  ],
  write: [
    'Open, edit, save, close a large note → no lost text.',
    'Click into table cells 20 times while editing (Live Preview and Source), also right after inserting a table and in an old table → every click puts the cursor in the cell and typing works (item 26).',
    'Edit a note while Tasks, Tickets, Time or Research write to the vault (tick a task, log on a ticket, timer tick) → the cursor and focus in the open note are never lost.',
  ],
  deck: [
    'Graph with 2000 notes → opens without freezing, stops drawing when settled or hidden. Select a node with 50 linked notes at a small window → the whole selection can be scrolled.',
    'Activity: month view, each week, empty month, month with 1000 entries → fills the card, no overflow.',
  ],
};

/* ---- helpers ---- */
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(process.cwd(), p) || p;

/* ---- --add-check ---- */
if (val('--add-check')) {
  const [mod, todo, expect] = val('--add-check').split('|').map((s) => (s || '').trim());
  if (!mod || !todo || !expect || !(mod === 'all' || MODULES.includes(mod))) {
    console.error('usage: --add-check "<all|deck|tasks|time|tickets|research|write>|<what to do>|<what must happen>"');
    process.exit(2);
  }
  const extra = readJson(EXTRA, []);
  extra.push({ date: new Date().toISOString().slice(0, 10), module: mod, text: `${todo} → ${expect}` });
  fs.writeFileSync(EXTRA, JSON.stringify(extra, null, 2) + '\n');
  console.log(`added to ${path.basename(EXTRA)} (${extra.length} extra checks)`);
  process.exit(0);
}

const asked = (val('--module') || '').split(',').filter(Boolean);
const typo = asked.filter((m) => !MODULES.includes(m));
if (typo.length) { console.error(`unknown module(s): ${typo.join(', ')} — use ${MODULES.join(', ')}`); process.exit(2); }
const only = asked;
// body of the first `name(...) {` method, matched by braces (regex [^}]* stops at the first nested block)
const methodBody = (js, name) => {
  const m = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`).exec(js);
  if (!m) return null;
  let d = 0;
  for (let i = m.index + m[0].length - 1; i < js.length; i++) {
    if (js[i] === '{') d++;
    else if (js[i] === '}' && --d === 0) return js.slice(m.index, i + 1);
  }
  return js.slice(m.index);
};
const mods = only.length ? only : MODULES;

function printManual(list) {
  const extra = readJson(EXTRA, []);
  const items = [...(MANUAL.all || [])];
  for (const m of list) items.push(...(MANUAL[m] || []));
  for (const e of extra) if (e.module === 'all' || list.includes(e.module)) items.push(e.text + ' [added ' + e.date + ']');
  console.log(`\nMANUAL CHECKS (${items.length}) — do these, then record PASS/FAIL in the log:`);
  items.forEach((t, i) => console.log(` ${String(i + 1).padStart(2)}. ${t}`));
}

if (val('--manual')) {
  printManual(val('--manual').split(',').filter((m) => MODULES.includes(m)));
  process.exit(0);
}

/* ---- automatic checks ---- */
const target = args.find((a) => !a.startsWith('--') && a !== val('--module'));
if (!target || !fs.existsSync(target)) {
  console.error('usage: node neon-check.mjs <vault-or-plugins-dir> [--module time,tasks] [--json] [--no-log]');
  process.exit(2);
}
// fork: the plugin folder is named after the plugin id in src/kernel/manifest.json (upstream: neon-deck)
const DECK_DIR = (() => {
  try {
    return JSON.parse(fs.readFileSync('src/kernel/manifest.json', 'utf8')).id;
  } catch (e) {
    return 'neon-deck';
  }
})();
let plugins = path.join(target, '.obsidian', 'plugins');
if (!fs.existsSync(plugins)) plugins = fs.existsSync(path.join(target, DECK_DIR)) ? target : plugins;
if (!fs.existsSync(plugins)) { console.error('no plugins folder found under', target); process.exit(2); }

// Neon Deck 2: one plugin folder whose main.js holds every module (sections "/* ==== module <id> ==== */")
const deckMain = path.join(plugins, DECK_DIR, 'main.js');
const BUNDLE = fs.existsSync(deckMain) && /^const NEON_MODULES = \[/m.test(fs.readFileSync(deckMain, 'utf8'));
/** A module's code and CSS: its own plugin folder (1.x) or its section of the bundle (2.x). */
function readSrc(m) {
  const id = PLUGIN_ID[m];
  if (!BUNDLE) {
    const dir = path.join(plugins, id);
    const r = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
    return { js: r('main.js'), css: r('styles.css'), file: path.join(dir, 'main.js') };
  }
  const all = fs.readFileSync(deckMain, 'utf8');
  const i = all.indexOf(`/* ==== module ${id} ==== */`);
  if (i < 0) return { js: null, css: null, file: deckMain };
  const j = all.indexOf('/* ==== module ', i + 10);
  const cssAll = fs.readFileSync(path.join(plugins, DECK_DIR, 'styles.css'), 'utf8');
  const ci = cssAll.indexOf(`/* @src ${id}/styles.css */`);
  const cj = ci < 0 ? -1 : cssAll.indexOf('/* @src ', ci + 5);
  return { js: all.slice(i, j < 0 ? all.indexOf('const NEON_MODULES') : j), css: ci < 0 ? null : cssAll.slice(ci, cj < 0 ? undefined : cj), file: deckMain };
}

const results = []; // { id, status: PASS|FAIL|WARN, msg }
const add = (id, status, msg) => results.push({ id, status, msg });

// 1. manifests: versions equal, id matches folder
const versions = {};
// fork: the bundle's folder and manifest id follow src/kernel/manifest.json (upstream: neon-deck)
const PLUGIN_DIR = (m) => (m === 'deck' ? DECK_DIR : PLUGIN_ID[m]);
for (const m of BUNDLE ? ['deck'] : mods) {
  const dir = path.join(plugins, PLUGIN_DIR(m));
  if (!fs.existsSync(dir)) { add('manifest', 'FAIL', `${PLUGIN_DIR(m)}: folder missing`); continue; }
  const mf = readJson(path.join(dir, 'manifest.json'), null);
  if (!mf) { add('manifest', 'FAIL', `${PLUGIN_ID[m]}: manifest.json missing or invalid`); continue; }
  versions[m] = mf.version;
  if (mf.id !== PLUGIN_DIR(m)) add('manifest', 'FAIL', `${PLUGIN_DIR(m)}: manifest id is "${mf.id}"`);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(String(mf.version))) add('manifest', 'FAIL', `${PLUGIN_ID[m]}: version "${mf.version}" is not x.y.z (or x.y.z-beta.n)`);
  for (const k of ['name', 'minAppVersion', 'description', 'author']) if (!mf[k]) add('manifest', 'WARN', `${PLUGIN_ID[m]}: manifest has no ${k}`);
  for (const f of ['main.js', 'styles.css']) if (!fs.existsSync(path.join(dir, f))) add('files', 'FAIL', `${PLUGIN_ID[m]}: ${f} missing`);
}
const vset = new Set(Object.values(versions));
if (vset.size > 1) add('versions', 'FAIL', 'manifest versions differ: ' + Object.entries(versions).map(([k, v]) => `${k}=${v}`).join(', '));

for (const m of mods) {
  const dir = path.join(plugins, PLUGIN_DIR(m));
  const { js, css: cssSrc, file: mainJs } = readSrc(m);
  if (js == null) continue;
  const lines = js.split('\n').length;

  // 2. syntax
  try { execFileSync(process.execPath, ['--check', mainJs], { stdio: 'pipe' }); }
  catch (e) { add('syntax', 'FAIL', `${m}: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' | ')}`); }

  // 3. file size (built files are only reported; source files must stay under the limit)
  if (lines > MAX_LINES && !BUNDLE) add('size', 'WARN', `${m}/main.js is ${lines} lines (built file; the source must be split into files under ${MAX_LINES})`);

  // 4. timers and loops: each must have a matching clear/cleanup
  const count = (re, s = js) => (s.match(re) || []).length;
  const si = count(/\bsetInterval\(/g), ri = count(/registerInterval\(/g);
  const ci = count(/clearInterval\(/g);
  if (si > ri + ci) add('timers', 'WARN', `${m}: ${si} setInterval vs ${ri} registerInterval + ${ci} clearInterval — check the rest are cleared on unload`);
  // one-shot or self-ending frames (countUp) are fine; a loop kept in a field must be cancellable
  const raf = count(/requestAnimationFrame\(/g), caf = count(/cancelAnimationFrame\(/g);
  const rafLoop = count(/this\.\w+\s*=\s*(?:window\.)?requestAnimationFrame\(/g);
  if (rafLoop && caf === 0) add('timers', 'FAIL', `${m}: ${rafLoop} requestAnimationFrame loop(s) kept in a field but never cancelAnimationFrame`);
  const ael = count(/\.addEventListener\(/g), rel2 = count(/removeEventListener\(|registerDomEvent\(|registerEvent\(/g);
  if (ael > 0 && rel2 === 0) add('listeners', 'WARN', `${m}: ${ael} addEventListener and no remove/register helper at all`);

  // 5. error handling
  const tries = count(/\btry\s*\{/g);
  if (tries === 0) add('errors', 'FAIL', `${m}: no try/catch anywhere`);
  const unload = methodBody(js, 'onunload');
  if (!unload) add('unload', 'FAIL', `${m}: no onunload()`);
  else if (/saveSoon|debounce\(\(\) => this\.saveData/.test(js) && !/flush|saveData|saveSettings|\.run\(\)/.test(unload)) add('unload', 'WARN', `${m}: debounced save but onunload doesn't seem to flush it`);
  // a busy flag set before an await and reset after it, without finally: one failed await locks the UI for good
  for (const b of js.matchAll(/this\.(\w+) = true;/g)) {
    const rest = js.slice(b.index, b.index + 2000), end = rest.indexOf(`this.${b[1]} = false`);
    if (end > 0 && /\bawait\b/.test(rest.slice(0, end)) && !/finally|catch/.test(rest.slice(0, end))) add('errors', 'FAIL', `${m}: this.${b[1]} set before an await and reset after it without try/finally — a failed await leaves it stuck (line ${js.slice(0, b.index).split('\n').length})`);
  }

  // 6. leftovers
  const logs = count(/console\.log\(/g);
  if (logs) add('console', 'WARN', `${m}: ${logs} console.log call(s)`);
  if (/\b(TODO|FIXME|XXX)\b/.test(js)) add('todo', 'WARN', `${m}: TODO/FIXME left in code`);
  if (/\bdebugger\b/.test(js)) add('debugger', 'FAIL', `${m}: debugger statement`);

  // 7. settings defaults: settings loader that deletes unknown keys loses data on downgrade
  if (/for \(const k of Object\.keys\(this\.settings\)\) if \(!\(k in [A-Z_]+\)\) delete/.test(js)) add('settings', 'WARN', `${m}: onload deletes unknown settings keys (data loss on downgrade/update)`);

  // 8. unused CSS classes (class defined in styles.css, never named in main.js or other plugins' JS)
  if (cssSrc != null) {
    const cssText = cssSrc;
    const classes = new Set([...cssText.matchAll(/\.([a-z][a-z0-9]*-[a-z0-9_-]+)/gi)].map((x) => x[1]));
    const allJs = mods.map((x) => path.join(plugins, BUNDLE ? DECK_DIR : PLUGIN_ID[x], 'main.js')).filter(fs.existsSync).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const unused = [...classes].filter((c) => /^(nd|nt|tm|tk|nr|nw)-/.test(c) && !allJs.includes(c) && !/^(is|has|mod|nd-theme|nd-pattern|theme)-?/.test(c) && !/-(dark|light)$/.test(c));
    if (unused.length > 15) add('css', 'WARN', `${m}: ${unused.length} CSS classes never named in any main.js (e.g. ${unused.slice(0, 5).join(', ')}) — check for dead CSS`);
    const remoteCss = [...cssText.matchAll(/url\(\s*['"]?(https?:)?\/\/[^)]+\)|@import\s+(?:url\()?['"]?https?:/g)].length;
    if (remoteCss) add('LOCAL', 'FAIL', `${m}: CSS loads ${remoteCss} remote file(s) (url(http…), @import) — fonts and images must ship inside the plugin`);
    const kf = (cssText.match(/@keyframes/g) || []).length;
    if (kf && !/prefers-reduced-motion/.test(cssText)) add('motion', 'FAIL', `${m}: ${kf} @keyframes but no prefers-reduced-motion block`);
    const longAnim = [...cssText.matchAll(/(?:animation|transition)[^;{}]*?(?<![\w.])(\d*\.?\d+)(ms|s)\b/g)].filter((x) => (x[2] === 's' ? +x[1] * 1000 : +x[1]) > 600 && !/infinite/.test(x[0]));
    if (longAnim.length > 3) add('motion', 'WARN', `${m}: ${longAnim.length} animations/transitions over 600 ms (keep UI motion under ~450 ms)`);
    const hardRadius = (cssText.match(/border-radius:\s*\d+px/g) || []).length;
    if (hardRadius > 12) add('theme', 'WARN', `${m}: ${hardRadius} hard-coded px border-radius values — use --nd-radius / --nd-radius-s so themes stay consistent (item 22)`);
    const outsideTheme = cssText.replace(/body\.nd-theme-[^{]*\{[^}]*\}/g, '').replace(/:root[^{]*\{[^}]*\}/g, '');
    const hexes = (outsideTheme.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).length;
    if (hexes > 10) add('theme', 'WARN', `${m}: ${hexes} hard-coded hex colours outside theme blocks — use --nd-* tokens (item 22)`);
    const heavy = (cssText.match(/backdrop-filter|filter:\s*blur|will-change/g) || []).length;
    if (heavy > 6) add('perf', 'WARN', `${m}: ${heavy} backdrop-filter/blur/will-change uses — costly on large areas`);
    const unscoped = [...cssText.matchAll(/^(table|th|td|tr|input|button|a|p|h[1-6]|ul|li)\s*[,{]/gm)].length;
    if (unscoped) add('css', 'FAIL', `${m}: ${unscoped} rule(s) on bare element selectors (body token blocks are fine) — they leak into all of Obsidian; scope them under the plugin's class`);
    if (/!important/.test(cssText) && (cssText.match(/!important/g) || []).length > 25) add('css', 'WARN', `${m}: ${(cssText.match(/!important/g) || []).length}× !important`);
    if (/nd-theme-brutal/.test(cssText)) add('css', 'FAIL', `${m}: nd-theme-brutal rules are back (the Brutal theme was removed in item 22)`);
  }
  // 8a. 100% LOCAL rule: no network access of any kind, nothing leaves the machine
  const NET = [
    [/\bfetch\s*\(/, 'fetch()'], [/XMLHttpRequest/, 'XMLHttpRequest'], [/\bWebSocket\b/, 'WebSocket'], [/\bEventSource\b/, 'EventSource'],
    [/\brequestUrl\s*\(/, 'requestUrl()'], [/sendBeacon/, 'sendBeacon'], [/require\(\s*['"](?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process|worker_threads|cluster)['"]\s*\)/, 'node network/process module'],
    [/require\(\s*['"]electron['"]\s*\)/, 'electron module'], [/\bnew Image\s*\(/, 'new Image() (can load remote files)'], [/navigator\.(?:geolocation|sendBeacon|mediaDevices)/, 'navigator network/device API'],
    [/importScripts\s*\(|import\s*\(\s*['"]https?:/, 'remote script import'], [/<script[^>]+src=|<link[^>]+href=["']https?:/i, 'remote script/link tag'], [/\bnew Worker\s*\(/, 'Worker'],
    [/window\.open\s*\(|\.openExternal\s*\(/, 'opens external pages (window.open/openExternal)'],
  ];
  for (const [re, name] of NET) if (re.test(js)) add('LOCAL', 'FAIL', `${m}: uses ${name} — plugins must be 100% local, no network calls, note content never leaves the machine`);
  // system notifications froze Obsidian's main process for minutes (Linux, 2026-11-04): reminders stay in-app
  if (/new\s+(?:window\.)?Notification\s*\(|Notification\.requestPermission/.test(js)) add('safety', 'FAIL', `${m}: uses system notifications (new Notification) — they can freeze Obsidian; use an in-app Notice`);
  const urls = [...new Set([...js.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map((x) => x[0]))].filter((u) => !/^https?:\/\/(?:www\.)?w3\.org\//.test(u));
  if (urls.length) add('LOCAL', 'WARN', `${m}: URL(s) in code (${urls.slice(0, 3).join(', ')}${urls.length > 3 ? ', …' : ''}) — fine only as plain text the user can click, never loaded or sent automatically`);

  // 8b. more code checks
  const cnt = (re) => count(re);
  const cmdIds = [...js.matchAll(/addCommand\(\{\s*id:\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
  const dupCmd = cmdIds.filter((x, i) => cmdIds.indexOf(x) !== i);
  if (dupCmd.length) add('commands', 'FAIL', `${m}: duplicate command id(s): ${[...new Set(dupCmd)].join(', ')}`);
  if (/\beval\(|new Function\(/.test(js)) add('safety', 'FAIL', `${m}: eval / new Function used`);
  const ih = cnt(/\.innerHTML\s*=|insertAdjacentHTML\(/g);
  if (ih) add('safety', 'WARN', `${m}: ${ih}× innerHTML/insertAdjacentHTML — use createEl/setText unless the content is fixed text`);
  const vmod = cnt(/vault\.modify\(/g), vproc = cnt(/vault\.process\(/g);
  if (vmod) add('writes', 'WARN', `${m}: ${vmod}× vault.modify (read-then-write race; prefer vault.process, and never write the note the user is typing in — item 26)`);
  // vault.create only makes new files, so it can't overwrite a note being typed in
  if (vproc + vmod > 0 && !/activeEditor|getActiveFile|\.hasFocus\(\)|isTyping/.test(js)) add('writes', 'WARN', `${m}: writes to notes but never checks whether the user is editing that note`);
  const scans = cnt(/getMarkdownFiles\(\)/g);
  if (scans > 8) add('perf', 'WARN', `${m}: ${scans}× getMarkdownFiles() (full vault scans); share one cache (items 3, 11, 21)`);
  const modEv = cnt(/vault\.on\(['"]modify['"]/g);
  if (modEv) add('perf', 'WARN', `${m}: ${modEv} vault 'modify' listener(s) — fires on every keystroke save; make sure it is debounced and cheap`);
  const layoutEv = cnt(/on\(['"]layout-change['"]/g);
  if (layoutEv) add('perf', 'WARN', `${m}: ${layoutEv} 'layout-change' listener(s) — fires very often; handler must be cheap, idempotent and never touch the editor DOM or focus`);
  const leafEv = cnt(/on\(['"]active-leaf-change['"]/g);
  if (leafEv > 3) add('perf', 'WARN', `${m}: ${leafEv} 'active-leaf-change' listeners in one plugin — merge them`);
  const emptyN = cnt(/\.empty\(\)/g), renders = cnt(/\brender\w*\(/g);
  if (emptyN > 25) add('perf', 'WARN', `${m}: ${emptyN}× .empty() (full redraws) — update only changed rows where lists are long`);
  const awaitLoop = [...js.matchAll(/for \(const \w+ of [^\n]*?\)\s*\{?[^\n]*?await [^\n]*?(cachedRead|vault\.read|process)\(/g)].length;
  if (awaitLoop) add('perf', 'WARN', `${m}: ${awaitLoop} loop(s) reading files one by one with await — batch or use the metadata cache`);
  const focusCalls = cnt(/\.focus\(\)/g);
  if (focusCalls > 12) add('focus', 'WARN', `${m}: ${focusCalls}× .focus() — each is a chance to steal focus from the editor (item 26)`);
  const globalQ = cnt(/document\.querySelector(All)?\(/g);
  if (globalQ > 6) add('dom', 'WARN', `${m}: ${globalQ}× document.querySelector — scope queries to the view's own element`);
  const bodyCls = [...js.matchAll(/document\.body\.(?:addClass|toggleClass)\(/g)].length;
  if (bodyCls && !/document\.body\.removeClass\(/.test(js)) add('cleanup', 'WARN', `${m}: adds body classes but never removes them on unload`);
  const settingsKeys = [...js.matchAll(/^const ([A-Z_]+_DEFAULTS)\s*=/gm)].length;
  if (!settingsKeys && !/DEFAULT/.test(js)) add('settings', 'WARN', `${m}: no settings defaults object found`);
  // numbers worth keeping in the log
  const stats = { lines, tries, setInterval: si, raf, listeners: ael, emptyCalls: emptyN };
  (results.stats = results.stats || {})[m] = stats;

  // 9. leftover theme
  if (/brutal/i.test(js)) add('theme', 'FAIL', `${m}: "brutal" is back in main.js (the theme was removed in item 22)`);
}

// 9b. helpers copied into several plugins (candidates for the shared module, items 20/21)
{
  const names = new Map();
  for (const m of mods) {
    const { js } = readSrc(m);
    if (js == null) continue;
    for (const x of js.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\(/gm)) names.set(x[1], (names.get(x[1]) || new Set()).add(m));
  }
  const dup = [...names].filter(([, v]) => v.size > 1).map(([k, v]) => `${k}×${v.size}`);
  if (mods.length > 1 && dup.length > 5) add('duplicates', 'WARN', `${dup.length} function names defined in more than one plugin (e.g. ${dup.slice(0, 8).join(', ')}) — move into one shared module`);
  // two plugins registering the same command id or view type
  const seen = new Map();
  for (const m of mods) {
    const { js } = readSrc(m);
    if (js == null) continue;
    for (const x of js.matchAll(/(?:registerView\(\s*|VIEW_[A-Z_]+\s*=\s*)['"]([^'"]+)['"]/g)) {
      if (seen.has(x[1]) && seen.get(x[1]) !== m) add('views', 'FAIL', `view type "${x[1]}" defined in ${seen.get(x[1])} and ${m}`);
      seen.set(x[1], m);
    }
  }
}

if (BUNDLE) {
  const old = MODULES.filter((m) => m !== 'deck' && fs.existsSync(path.join(plugins, PLUGIN_ID[m], 'main.js')));
  if (old.length) add('update', 'WARN', `old 1.x plugin folders still in plugins/ (${old.map((m) => PLUGIN_ID[m]).join(', ')}): fine as a way back, delete them once 2.x is settled`);
}
// 9c. other plugin files: nothing but main.js, styles.css, manifest.json, data.json, fonts allowed to load code
for (const m of BUNDLE ? ['deck'] : mods) {
  const dir = path.join(plugins, PLUGIN_DIR(m));
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    const b = path.basename(f);
    if (/\.(html?|wasm|exe|dll|node|sh|bat|ps1)$/i.test(b)) add('LOCAL', 'FAIL', `${m}: unexpected file ${rel(f)} (plugins must be plain JS + CSS)`);
    if (b === 'package.json' || f.split(path.sep).includes('node_modules')) add('LOCAL', 'WARN', `${m}: ${rel(f)} shipped inside the plugin (dependencies should be bundled, not shipped)`);
  }
}

// 10b. regressions: each guards a bug that was fixed (the source repo sits next to dist/)
const SRC = [path.join(target, 'src'), path.join(target, '..', 'src')].find((d) => fs.existsSync(path.join(d, 'deck', 'pattern.js')));
const deckCss = path.join(plugins, PLUGIN_ID.deck, 'styles.css');
if (fs.existsSync(deckCss)) {
  const css = fs.readFileSync(deckCss, 'utf8');
  if (/data:font\/ttf/.test(css)) add('size', 'FAIL', 'styles.css embeds TTF fonts again: use the WOFF2 files (2026-11-10, 1.6 MB → 0.4 MB)');
  if (css.length > 500_000) add('size', 'FAIL', `styles.css is ${(css.length / 1e3).toFixed(0)} KB (fonts are WOFF2 now; target under 500 KB)`);
}
if (SRC) {
  const src = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
  const pat = src('deck/pattern.js');
  const ice = pat.slice(pat.indexOf('float blackice('), pat.indexOf('float field('));
  const amp = +((pat.match(/vec3 iceV[\s\S]*?\)\*(\.\d+);/) || [])[1] || 1);
  if (!(amp < 0.25)) add('pattern', 'FAIL', `Black ICE corner drift is ${amp}: at .25 or more a triangle can flip over (facets pop, edges vanish)`);
  if ((ice.match(/iceV\(/g) || []).length > 2) add('perf', 'FAIL', 'blackice() calls iceV() more than twice: compute the 16 shared corners once per pixel');
  if (!/if \(!e\.isAfter\(s\)\) e\.add\(1, 'day'\)/.test(src('time/entry-modal.js'))) add('time', 'FAIL', 'entryRange no longer rolls Until past midnight: 23:30 → 00:30 would be rejected');
  if (!/now === orig/.test(src('write/editor-helpers.js'))) add('write', 'FAIL', 'placeCards must not overwrite a cursor line that changed while the flashcard popup was open');
}

// 10. vault hygiene: stuff that should not ship (not in the source repo, which is never shipped as a vault)
const repoMode = fs.existsSync(path.join(target, 'tools', 'files.json'));
const all = repoMode ? [] : walk(path.resolve(target));
const total = all.reduce((n, f) => n + fs.statSync(f).size, 0);
const git = all.filter((f) => f.split(path.sep).includes('.git'));
if (git.length) add('size', 'FAIL', `a .git folder is inside the vault (${(git.reduce((n, f) => n + fs.statSync(f).size, 0) / 1e6).toFixed(1)} MB) — leave it out of the shipped zip`);
if (all.some((f) => f.includes(`${path.sep}plugins${path.sep}docs${path.sep}`))) add('size', 'WARN', 'plugins/docs folder inside the vault — leave it out of the shipped zip');
if (total > 3e6 && !git.length) add('size', 'WARN', `vault is ${(total / 1e6).toFixed(1)} MB (target 1–2 MB)`);
for (const f of all) { const n = fs.statSync(f).size; if (n > 800_000 && !/\.(ttf|woff2?)$/.test(f)) add('size', 'WARN', `${rel(f)} is ${(n / 1e6).toFixed(1)} MB`); }
// plugin data files: parse
for (const m of mods) {
  const f = path.join(plugins, PLUGIN_DIR(m), 'data.json');
  if (fs.existsSync(f) && readJson(f, undefined) === undefined) add('data', 'FAIL', `${m}/data.json is not valid JSON`);
}
// update zip must not carry data.json
if (flag('--update-package') && all.some((f) => path.basename(f) === 'data.json')) add('update', 'FAIL', 'update package contains a data.json (it would overwrite the user\'s data)');

// 11. source tree (when src/ exists): file size rule and hand-edit guard
for (const base of [path.resolve(target), path.resolve(target, '..'), path.resolve(target, '..', '..')]) {
  const src = path.join(base, 'src');
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
  for (const f of walk(src).filter((x) => /\.(js|mjs|ts|css)$/.test(x))) {
    const n = fs.readFileSync(f, 'utf8').split('\n').length;
    if (n > MAX_LINES) add('src-size', 'FAIL', `${rel(f)} is ${n} lines (limit ${MAX_LINES}); split by feature`);
    else if (n > 400) add('src-size', 'WARN', `${rel(f)} is ${n} lines (target under 400)`);
  }
  break;
}

/* ---- report ---- */
const fails = results.filter((r) => r.status === 'FAIL');
const warns = results.filter((r) => r.status === 'WARN');
if (flag('--json')) console.log(JSON.stringify({ target: path.resolve(target), modules: mods, versions, stats: results.stats, results }, null, 2));
else {
  console.log(`neon-check: ${path.resolve(target)} · modules: ${mods.join(', ')} · versions: ${[...vset].join(', ') || '?'}`);
  for (const r of [...fails, ...warns]) console.log(` ${r.status === 'FAIL' ? '✗ FAIL' : '! warn'}  [${r.id}] ${r.msg}`);
  console.log(`\n${fails.length ? '✗' : '✓'} ${fails.length} failure(s), ${warns.length} warning(s)`);
  console.log(`\nmanual checks (not run by this script): node neon-check.mjs --manual ${mods.join(',')}`);
}
if (!flag('--no-log')) {
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), target: path.resolve(target), modules: mods, versions, stats: results.stats, fails: fails.length, warns: warns.length, failures: fails.map((r) => `[${r.id}] ${r.msg}`) }) + '\n');
}
process.exit(fails.length ? 1 : 0);
