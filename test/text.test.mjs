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

test('ticket template export creates missing folders and opens a snapshot for PDF (item 16, bug 2)', async () => {
  const { NeonTickets } = load('neon-tickets', ['NeonTickets']);
  const folders = new Set();
  const files = new Map();
  const made = [];
  let opened;
  let command;
  const leaf = { openFile: async (file) => (opened = file) };
  const app = {
    vault: {
      getAbstractFileByPath: (path) => files.get(path) || (folders.has(path) ? { path } : null),
      createFolder: async (path) => (made.push(path), folders.add(path)),
      create: async (path, text) => {
        const file = { path };
        files.set(path, file);
        file.text = text;
        return file;
      },
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => leaf,
      setActiveLeaf: () => {},
    },
    commands: { executeCommandById: (id) => ((command = id), true) },
  };
  const p = Object.assign(Object.create(NeonTickets.prototype), { app, settings: { ticketFolder: 'Core/Tickets' } });
  const note = await p.exportTemplate({ id: 'tpl-test', name: 'Laptop setup', description: 'Prepare the laptop', priority: 'high', dueDays: 2, steps: ['Install tools', 'Test access'] });
  assert.equal(note.path, 'Core/Tickets/Templates/Laptop setup.md');
  assert.deepEqual(made, ['Core', 'Core/Tickets', 'Core/Tickets/Templates']);
  assert.match(note.text, /type: ticket-template-export/);
  assert.match(note.text, /Changes to this note do not update the template/);
  assert.match(note.text, /- \[ \] Install tools/);
  assert.equal(opened, note);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(command, 'workspace:export-pdf');
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

test('research topic data is normalized without malformed or duplicate rows', () => {
  const { normalizeResearchTopics } = load('neon-research', ['normalizeResearchTopics']);
  const raw = [
    { text: '  Quantum   gravity ', done: true },
    { text: 'quantum gravity', done: false },
    { text: ' ' },
    { text: 42 },
    null,
    { text: 'x'.repeat(201) },
  ];
  assert.deepEqual([...normalizeResearchTopics(raw)].map((x) => ({ ...x })), [{ text: 'Quantum gravity', done: true }]);
  assert.deepEqual([...normalizeResearchTopics(null)], []);
});

test('research topics validate additions and save check/remove changes', () => {
  const { NeonResearch } = load('neon-research', ['NeonResearch']);
  const p = Object.assign(Object.create(NeonResearch.prototype), {
    settings: { researchTopics: [] },
    saves: 0,
    renders: 0,
    saveSoon() { this.saves++; },
    emitSoon() { this.renders++; },
  });
  assert.equal(p.addResearchTopic('  '), false);
  assert.equal(p.addResearchTopic('x'.repeat(201)), false);
  assert.equal(p.addResearchTopic('  Neural   networks '), true);
  assert.equal(p.addResearchTopic('neural networks'), false);
  assert.equal(p.settings.researchTopics.length, 1);
  assert.equal(p.settings.researchTopics[0].text, 'Neural networks');
  const topic = p.settings.researchTopics[0];
  p.toggleResearchTopic(topic);
  assert.equal(topic.done, true);
  p.toggleResearchTopic(topic);
  assert.equal(topic.done, false);
  p.removeResearchTopic({});
  assert.equal(p.settings.researchTopics.length, 1);
  p.removeResearchTopic(topic);
  assert.equal(p.settings.researchTopics.length, 0);
  assert.equal(p.saves, 4);
  assert.equal(p.renders, 4);
});

test('time entry start uses optional text with strict HH:mm parsing (issue 25)', () => {
  const source = readFileSync(new URL('../src/time/entry-modal.js', import.meta.url), 'utf8');
  assert.match(source, /field\('Start', row\)\.createEl\('input', \{ cls: 'nd-input', attr: \{ type: 'text' \} \}\)/);
  assert.match(source, /moment\(`\$\{date\.value\} \$\{clock\}`, 'YYYY-MM-DD HH:mm', true\)/);
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

test('Radar is removed and Blackwall is available without breaking saved settings', async () => {
  const { NeonDeck, PATTERNS, THEME_PATTERN } = load('neon-deck', ['NeonDeck', 'PATTERNS', 'THEME_PATTERN']);
  assert.equal(PATTERNS.includes('radar'), false);
  assert.equal(PATTERNS.includes('blackwall'), true);
  assert.equal(THEME_PATTERN.blueprint, 'hex');
  const p = Object.assign(Object.create(NeonDeck.prototype), {
    loadData: async () => ({ settingsVersion: 3, theme: 'blueprint', pattern: 'radar' }),
  });
  await p.loadSettings();
  assert.equal(p.settings.pattern, 'auto');
  assert.equal(p.activePattern(), 'hex');
});

test('research add explains duplicates and keeps the box focused (issues 37, 38)', () => {
  const source = readFileSync(new URL('../src/research/research-list.js', import.meta.url), 'utf8');
  assert.match(source, /is already on the list/);
  assert.match(source, /this\.researchFocus = true/);
  assert.match(source, /addEventListener\('paste'/);
});

test('dashboard redraws when the day changes while it stays open (issue 31)', () => {
  const source = readFileSync(new URL('../src/deck/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /this\.clockDay && this\.clockDay !== key/);
});

test('/flashcard turns the line into a question :: answer card (issue 40)', () => {
  const { insertFlashcard } = load('neon-write', ['insertFlashcard']);
  const ed = (text) => ({ text, cur: null, getCursor: () => ({ line: 0, ch: 0 }), getLine() { return this.text; }, setLine(_, v) { this.text = v; }, setCursor(c) { this.cur = c.ch; } });
  const a = ed('What is ATP? ');
  insertFlashcard(a);
  assert.deepEqual([a.text, a.cur], ['What is ATP? :: ', 16]);
  const b = ed('');
  insertFlashcard(b);
  assert.deepEqual([b.text, b.cur], [' :: ', 0]);
});

test('Study tab motion respects reduced motion (issues 36, 42)', () => {
  const css = readFileSync(new URL('../src/research/styles.css', import.meta.url), 'utf8');
  const tail = css.slice(css.indexOf('Study tab motion'));
  for (const sel of ['.nr-panel.is-switch', '.nr-research-row.is-new', '.nr-research-row.is-leaving']) assert.ok(tail.lastIndexOf(sel) > tail.indexOf('prefers-reduced-motion'), sel);
});
