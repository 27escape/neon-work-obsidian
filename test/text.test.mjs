// Pure text functions: each was a real bug or is easy to break.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from './load.mjs';

const W = load('neon-write', ['toggleMark', 'toggleMergeCell', 'toggleLockMeta']);
const T = load('neon-tickets', ['addToSection']);
const K = load('neon-tasks', ['taskGroup']);
const D = load('neon-deck', ['bangFirst']);

// "a [word] b" -> selection between the brackets
const mark = (x, m) => {
  const s = x.indexOf('['), e = x.indexOf(']') - 1;
  const r = W.toggleMark(x.replace('[', '').replace(']', ''), s, e, m);
  return r.line.slice(0, r.s) + '[' + r.line.slice(r.s, r.e) + ']' + r.line.slice(r.e);
};

test('format bar toggles (items 30, 34)', () => {
  assert.equal(mark('a [w] b', '**'), 'a **[w]** b');
  assert.equal(mark('a **[w]** b', '**'), 'a [w] b');
  assert.equal(mark('a **[w]** b', '*'), 'a ***[w]*** b'); // italic on bold: both, not swapped
  assert.equal(mark('a [**w**] b', '**'), 'a [w] b');
  assert.equal(mark('a [w ]b', '**'), 'a **[w]** b');
  assert.equal(mark('a ~~[w]~~ b', '~~'), 'a [w] b');
});

test('merged table cells (item 36)', () => {
  assert.equal(W.toggleMergeCell('| a | b | c |', 7), '| a | < | c |');
  assert.equal(W.toggleMergeCell('| a | < | c |', 7), '| a |  | c |');
  assert.equal(W.toggleMergeCell('| a | b |', 2), null);
});

test('math blocks lock with a TeX comment (issue 34)', () => {
  const { toggleMathLock, mathBlocks } = load('neon-write', ['toggleMathLock', 'mathBlocks']);
  assert.equal(toggleMathLock('$$'), '$$ % locked');
  assert.equal(toggleMathLock('$$ % locked'), '$$');
  assert.equal(toggleMathLock('$$x$$'), null);
  assert.deepEqual([...mathBlocks(['a', '$$ % locked', 'x^2', '$$', '```', '$$', '```', '$$', 'y', '$$'])].map((b) => [...b]), [[1, 3], [7, 9]]);
});

test('callout lock metadata (item 31)', () => {
  assert.equal(W.toggleLockMeta('> [!info] Title'), '> [!info|locked] Title');
  assert.equal(W.toggleLockMeta('> [!info|locked] Title'), '> [!info] Title');
  assert.equal(W.toggleLockMeta('> [!tip|wide]- T'), '> [!tip|wide locked]- T');
  assert.equal(W.toggleLockMeta('> plain quote'), null);
});

test('ticket log lines go on top (item 13)', () => {
  assert.equal(T.addToSection('## Log\n- old\n', 'log', '- new'), '## Log\n- new\n- old\n');
  assert.equal(T.addToSection('## Steps\n- [ ] a\n', 'steps', '- [ ] b'), '## Steps\n- [ ] a\n- [ ] b\n');
});

test('removing a ticket step removes its completion log entry', async () => {
  const { NeonTickets } = load('neon-tickets', ['NeonTickets']);
  const text = '## Next steps\n- [x] Ship ✅ 2026-01-01 10:00\n\n## Log\n- 2026-01-01 10:00 — Step done: Ship\n- 2026-01-01 09:00 — Step done: Other\n';
  let out;
  const app = {
    workspace: { getLeavesOfType: () => [] },
    vault: { process: async (file, fn) => (out = fn(text)) },
  };
  const p = Object.assign(Object.create(NeonTickets.prototype), { app });
  await p.removeStep({ file: { path: 'ticket.md' } }, { line: 1, text: 'Ship' });
  assert.equal(out, '## Next steps\n\n## Log\n- 2026-01-01 09:00 — Step done: Other\n');
});

test('ticket templates are notes: format round-trips and parses hand edits (issues 49, 51)', () => {
  const { templateMarkdown, parseTemplateNote } = load('neon-tickets', ['templateMarkdown', 'parseTemplateNote']);
  const tpl = { id: 'tpl-1', name: 'Laptop setup', description: 'Prepare the laptop\n- for the new hire', priority: 'high', dueDays: 2, steps: ['Install tools', 'Test access'] };
  const back = parseTemplateNote('Laptop setup', templateMarkdown(tpl));
  assert.deepEqual({ ...back, steps: [...back.steps] }, tpl);
  const none = parseTemplateNote('X', templateMarkdown({ ...tpl, dueDays: null, priority: 'normal', description: '' }));
  assert.equal(none.dueDays, null);
  assert.equal(none.description, '');
  // hand-written note: quoted type, unknown priority, extra sections and ticked steps
  const hand = parseTemplateNote('Mine', '---\ntype: "ticket-template"\npriority: whenever\n---\n# Mine\n## Steps\n- [x] One\n- [ ] Two\n## Notes\nfree text\n');
  assert.deepEqual([...hand.steps], ['One', 'Two']);
  assert.equal(hand.priority, 'normal');
  assert.equal(hand.id, '');
  // old export snapshots and ordinary notes are not templates
  assert.equal(parseTemplateNote('Old', '---\ntype: ticket-template-export\n---\n'), null);
  assert.equal(parseTemplateNote('Note', 'just text'), null);
});

test('ticket templates move from plugin data into notes once, and the folder is made in a fresh vault', async () => {
  const { NeonTickets, TFile } = load('neon-tickets', ['NeonTickets', 'TFile']);
  const files = new Map();
  const folders = new Set();
  const mk = (path, text) => Object.assign(Object.create(TFile.prototype), { path, basename: path.split('/').pop().replace(/\.md$/, ''), text });
  const app = {
    vault: {
      getAbstractFileByPath: (p) => files.get(p) || (folders.has(p) ? { path: p } : null),
      createFolder: async (p) => folders.add(p),
      create: async (p, text) => (files.set(p, mk(p, text)), files.get(p)),
      getMarkdownFiles: () => [...files.values()],
      cachedRead: async (f) => f.text,
      read: async (f) => f.text,
      modify: async (f, text) => (f.text = text),
      process: async (f, fn) => (f.text = fn(f.text)),
    },
    workspace: { getActiveViewOfType: () => null, iterateAllLeaves: () => {} },
  };
  const old = [{ id: 'a', name: 'Onboarding', steps: ['Account'], description: '', priority: 'normal', dueDays: null }];
  let saves = 0;
  const p = Object.assign(Object.create(NeonTickets.prototype), { app, settings: { ticketFolder: 'Core/Tickets', templates: old, templatesMigrated: false }, saveSettings: async () => saves++, emitSoon() {} });
  await p.initTemplates();
  assert.ok(folders.has('Core/Tickets/Templates'));
  assert.deepEqual(JSON.parse(JSON.stringify(p.templates.map((t) => [t.id, t.name, t.path]))), [['a', 'Onboarding', 'Core/Tickets/Templates/Onboarding.md']]);
  assert.equal(p.settings.templates, old); // backup kept
  // a template deleted as a note doesn't come back on the next start
  files.clear();
  await p.initTemplates();
  assert.equal(p.templates.length, 0);
  assert.equal(saves, 1);
});
test('task groups by due date', () => {
  assert.deepEqual({ ...K.taskGroup('x 📅 2026-01-01', null, '2026-01-02') }, { due: '2026-01-01', group: 'overdue' });
  assert.deepEqual({ ...K.taskGroup('x', {}, '2026-01-02') }, { due: null, group: 'today' });
});

test('! names sort first (item 24)', () => {
  const by = D.bangFirst((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(['b', '!a', 'a', '!!z'].map((name) => ({ name })).sort(by).map((x) => x.name), ['!!z', '!a', 'a', 'b']);
});

test('minimal edit for writes into an open editor', () => {
  const S = load('neon-tasks', ['minimalEdit']);
  const apply = (a, c) => a.slice(0, c.from) + c.text + a.slice(c.to);
  for (const [a, b] of [['abc', 'abXc'], ['- [ ] a\n- [ ] b', '- [x] a\n- [ ] b'], ['x', ''], ['', 'new'], ['same', 'same'], ['aaa', 'aa']]) assert.equal(apply(a, S.minimalEdit(a, b)), b);
  assert.deepEqual({ ...S.minimalEdit('- [ ] a', '- [x] a') }, { from: 3, to: 4, text: 'x' });
});

test('manual time stays exact when the workday timer is shorter', () => {
  const { NeonTime } = load('neon-time', ['NeonTime']);
  const key = '2026-01-01';
  const t = {
    days: { [key]: { entries: [{ start: 1, ms: 120 * 60000, cat: 'operations', source: 'manual' }] } },
    pending: new Map(),
    session: null,
    entriesOf: NeonTime.prototype.entriesOf,
    targetMin: () => 480,
    workMin: () => 24,
    workOf: () => ({ start: 1, end: 2, breaks: [] }),
    workState: () => 'running',
  };
  const sum = NeonTime.prototype.summary.call(t, key, false);
  assert.equal(sum.total, 120);
  assert.equal(sum.by.operations, 120);
});

test('workday: input keeps a day from before midnight going, but not after a long idle', () => {
  const { NeonTime } = load('neon-time', ['NeonTime']);
  const now = Date.now();
  const day = (last) => ({ work: { start: 1, last, breaks: [] } });
  const t = { settings: { workIdleH: 3 }, saveSoon() {}, workOf: NeonTime.prototype.workOf };
  t.days = { '2025-12-31': day(now - 60000) }; // started yesterday, active a minute ago
  NeonTime.prototype.workSeen.call(t);
  assert.ok(t.days['2025-12-31'].work.last >= now);
  t.days = { '2026-01-01': day(now - 10 * 3600000) }; // laptop slept 10 h
  NeonTime.prototype.workSeen.call(t);
  assert.equal(t.days['2026-01-01'].work.last, now - 10 * 3600000);
});

test('manual breaks reduce only the work timer and reject invalid ranges', () => {
  const { NeonTime } = load('neon-time', ['NeonTime']);
  const start = Date.now() - 4 * 3600000;
  const key = '2026-01-01';
  const t = Object.assign(Object.create(NeonTime.prototype), {
    days: { [key]: { work: { start, last: Date.now(), breaks: [], end: null } } },
    saves: 0,
    changed() { this.saves++; },
  });
  assert.equal(t.addBreak({ start: start + 3600000, ms: 30 * 60000 }), true);
  assert.equal(t.workMin(key), 210);
  assert.equal(t.addBreak({ start: start + 3600000, ms: 15 * 60000 }), false);
  assert.equal(t.addBreak({ start: start - 60000, ms: 15 * 60000 }), false);
  assert.equal(t.addBreak({ start, ms: 30 * 60000 }), true);
  assert.equal(t.workMin(key), 180);
  assert.equal(t.saves, 2);
  t.days = {};
  assert.equal(t.addBreak({ start, ms: 30 * 60000 }), false);
});

test('time start field accepts loose clock input (issue 32)', () => {
  const { parseClock } = load('neon-time', ['parseClock']);
  for (const [a, b] of [['930', '09:30'], ['0930', '09:30'], ['9:5', '09:05'], ['9.30', '09:30'], ['14', '14:00'], [' 7 ', '07:00'], ['23:59', '23:59']]) assert.equal(parseClock(a), b);
  for (const x of ['', '24', '9:60', '12345', 'abc', '2400']) assert.equal(parseClock(x), null);
});

test('time entries are logged as From / Until instead of minutes', () => {
  const { entryRange } = load('neon-time', ['entryRange']);
  const src = readFileSync(new URL('../src/time/entry-modal.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /field\('Minutes'/);
  // the test moment stub has no clock maths, so check the rejections it can see
  assert.deepEqual({ ...entryRange('2026-01-05', 'x', '10:00') }, { bad: 'from' });
  assert.deepEqual({ ...entryRange('2026-01-05', '9:00', '25') }, { bad: 'until' });
});
test('recently done log has no height cap or trailing separator (issue 27)', () => {
  const source = readFileSync(new URL('../src/deck/styles-dashboard.css', import.meta.url), 'utf8');
  assert.match(source, /\.nd-w-recent \.nd-done-log \{[^}]*max-height: none;[^}]*margin-bottom: 0;[^}]*padding-bottom: 0;[^}]*border-bottom: 0;[^}]*\}/);
});

test('ticket step text stays plain text with click and keyboard toggling (issue 30)', () => {
  const source = readFileSync(new URL('../src/tickets/ticket-view.js', import.meta.url), 'utf8');
  assert.match(source, /const label = r\.createSpan\(\{ cls: 'tk-step-text', text: step\.text, attr: \{ role: 'button', tabindex: '0', 'aria-pressed': String\(step\.done\) \} \}\);/);
  assert.match(source, /box\.addEventListener\('click', tick\);\s*label\.addEventListener\('click', tick\);/);
  assert.match(source, /label\.addEventListener\('keydown',[\s\S]*?e\.key !== 'Enter' && e\.key !== ' '[\s\S]*?if \(!e\.repeat\) tick\(\);/);
});

test('Complete all animates open steps from top to bottom before saving', () => {
  const source = readFileSync(new URL('../src/tickets/ticket-view.js', import.meta.url), 'utf8');
  assert.match(source, /const rows = \[\.\.\.ss\.querySelectorAll\('\.tk-step:not\(\.is-done\)'\)\];[\s\S]*?const delay = prefersReducedMotion\(\) \? 0 : Math\.min\(80, 480 \/ rows\.length\);[\s\S]*?for \(const r of rows\)[\s\S]*?r\.addClass\('is-done', 'is-pop'\);[\s\S]*?if \(delay\) await new Promise\(\(resolve\) => window\.setTimeout\(resolve, delay\)\);[\s\S]*?await this\.plugin\.completeAllSteps\(t\);/);
});

test('ticket write queues release settled note entries', () => {
  const source = readFileSync(new URL('../src/tickets/actions.js', import.meta.url), 'utf8');
  assert.equal((source.match(/next\.then\(\(\) => this\.writeQ\.get\(key\) === next && this\.writeQ\.delete\(key\)\);/g) || []).length, 3);
});

test('Radar and Blackwall are removed, Black ICE is available, saved settings fall back', async () => {
  const { NeonDeck, PATTERNS, THEME_PATTERN } = load('neon-deck', ['NeonDeck', 'PATTERNS', 'THEME_PATTERN']);
  assert.equal(PATTERNS.includes('radar'), false);
  assert.equal(PATTERNS.includes('blackwall'), false);
  assert.equal(PATTERNS.includes('blackice'), true);
  assert.equal(THEME_PATTERN.blueprint, 'hex');
  const p = Object.assign(Object.create(NeonDeck.prototype), {
    loadData: async () => ({ settingsVersion: 3, theme: 'blueprint', pattern: 'radar' }),
  });
  await p.loadSettings();
  assert.equal(p.settings.pattern, 'auto');
  assert.equal(p.activePattern(), 'hex');
  const q = Object.assign(Object.create(NeonDeck.prototype), { loadData: async () => ({ settingsVersion: 3, theme: 'cyberpunk', pattern: 'blackwall' }) });
  await q.loadSettings();
  assert.equal(q.settings.pattern, 'auto');
});

test('dashboard redraws when the day changes while it stays open (issue 31)', () => {
  const source = readFileSync(new URL('../src/deck/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /this\.clockDay && this\.clockDay !== key/);
});

test('/flashcard popup: card lines, editing an existing card, and where cards go', () => {
  const { cardLine, splitCard, placeCards } = load('neon-write', ['cardLine', 'splitCard', 'placeCards']);
  assert.equal(cardLine(' What is  ATP? ', 'Energy :: fuel'), 'What is ATP? :: Energy : fuel');
  assert.equal(cardLine('## Heading q', 'a'), 'Heading q :: a');
  assert.equal(cardLine('q', '  '), null);
  assert.deepEqual([...splitCard('What is ATP? :: Energy')], ['What is ATP?', 'Energy', true]);
  assert.deepEqual([...splitCard('Just a line')], ['Just a line', '', false]);
  const cards = [{ line: 'a :: b', fromLine: false }, { line: 'c :: d', fromLine: false }];
  assert.equal(placeCards('', cards).replace, true); // blank line: cards go there
  assert.equal(placeCards('Some paragraph', cards).replace, false); // keep the paragraph, cards go below
  assert.equal(placeCards('Some paragraph', [{ line: 'Some paragraph :: x', fromLine: true }]).replace, true);
  assert.equal(placeCards('', cards).text, 'a :: b\nc :: d');
  // Esc on an unchanged card line: nothing to do (no rewrite, no undo step)
  assert.equal(placeCards('    - q :: a', [{ line: '- q :: a', fromLine: true }]), null);
  // an indented card keeps its indent when edited
  assert.equal(placeCards('    q :: a', [{ line: 'q :: b', fromLine: true }]).text, '    q :: b');
  // the cursor line changed while the popup was open: cards go below, the line is kept
  assert.equal(placeCards('', cards, 'typed meanwhile').replace, false);
  assert.equal(placeCards('', cards, null).replace, false);
});
test('Study tab motion respects reduced motion (issues 36, 42)', () => {
  const css = readFileSync(new URL('../src/research/styles.css', import.meta.url), 'utf8');
  const tail = css.slice(css.indexOf('Study tab motion'));
  for (const sel of ['.nr-panel.is-switch', '.nr-research-row.is-new', '.nr-research-row.is-leaving']) assert.ok(tail.lastIndexOf(sel) > tail.indexOf('prefers-reduced-motion'), sel);
});

test('workday timer counts toward the day total; breaks are shown but not counted (issues 48, 52)', () => {
  const { NeonTime } = load('neon-time', ['NeonTime']);
  const key = '2026-01-05'; // a Monday
  const start = new Date('2026-01-05T08:00:00').getTime();
  const h = 3600000;
  const t = Object.assign(Object.create(NeonTime.prototype), {
    settings: { dayHours: 8, idleMin: 30 },
    pending: new Map(),
    targetMin: () => 480,
    days: { [key]: { entries: [{ start, ms: 2 * h, cat: 'projects' }], work: { start, end: start + 9 * h, last: start + 9 * h, breaks: [[start + 4 * h, start + 5 * h]] } } },
  });
  let s = t.summary(key, false);
  assert.equal(s.tracked, 120);
  assert.equal(s.total, 480); // 9 h day minus the 1 h break
  assert.equal(s.untracked, 360);
  assert.equal(s.breaks, 60);
  assert.equal(s.over, 0);
  // more logged than the timer: logged time wins, nothing untracked
  t.days[key].entries.push({ start, ms: 7 * h, cat: 'admin' });
  s = t.summary(key, false);
  assert.equal(s.total, 540);
  assert.equal(s.untracked, 0);
  assert.equal(s.over, 60);
  // a past day never ended stops at its last activity
  Object.assign(t.days[key].work, { end: null, last: start + 3 * h, breaks: [] });
  t.days[key].entries = [];
  assert.equal(t.summary(key, false).total, 180);
});

test('Status grouping: not started first, then Waiting, In progress, Open, Done (issue 59)', () => {
  const { ticketGroups, TICKETS_DEFAULTS } = load('neon-tickets', ['ticketGroups', 'TICKETS_DEFAULTS']);
  assert.equal(TICKETS_DEFAULTS.tabSort, 'customer'); // fork: projects group by customer by default
  const tk = (title, status, started) => ({ title, status, started, priority: 'normal', bucket: 'nodate', due: null });
  const groups = ticketGroups([tk('a', 'done', true), tk('b', 'open', true), tk('c', 'in-progress', true), tk('d', 'waiting', true), tk('e', 'open', false)], 'status');
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(([k, , g]) => [k, g.map((t) => t.title).join('')]))), [
    ['status-new', 'e'],
    ['status-waiting', 'd'],
    ['status-in-progress', 'c'],
    ['status-open', 'b'],
    ['status-done', 'a'],
  ]);
});

