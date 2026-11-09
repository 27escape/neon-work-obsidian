/* ---- lockable callouts (item 31): `> [!info|locked]`; the state lives in the note ---- */
let cmState = null;
let cmView = null;
try {
  cmState = require('@codemirror/state'); // provided by Obsidian at runtime
  cmView = require('@codemirror/view');
} catch (e) {
  console.error('Neon Write: callout lock needs @codemirror/state', e);
}
const lockAnno = cmState ? cmState.Annotation.define() : null; // marks our own lock/unlock edits
const CALLOUT_HEAD_RE = /^(\s*>\s*\[!)([^\]|]+)(\|[^\]]*)?(\][+-]?)(.*)$/;
/** Header line with "locked" added to or removed from the callout metadata; null when it isn't a callout header. */
function toggleLockMeta(text) {
  const m = text.match(CALLOUT_HEAD_RE);
  if (!m) return null;
  const words = (m[3] || '').slice(1).split(/[\s|]+/).filter(Boolean);
  const next = words.includes('locked') ? words.filter((w) => w !== 'locked') : [...words, 'locked'];
  return `${m[1]}${m[2]}${next.length ? '|' + next.join(' ') : ''}${m[4]}${m[5]}`;
}
/* lockable math blocks (issue 34): `$$ % locked` (a TeX comment, so the formula renders the same) */
const MATH_OPEN_RE = /^(\s*\$\$)\s*(%\s*locked)?\s*$/;
const MATH_LOCKED_RE = /^\s*\$\$\s*%\s*locked\s*$/;
/** [open, close] line indexes (0-based) of each multi-line $$ block, outside code fences. */
function mathBlocks(lines) {
  const out = [];
  let fence = false;
  let open = -1;
  lines.forEach((t, i) => {
    if (open < 0 && /^\s*(```|~~~)/.test(t)) fence = !fence;
    if (fence) return;
    if (open < 0) {
      if (MATH_OPEN_RE.test(t)) open = i;
    } else if (/\$\$\s*$/.test(t)) {
      out.push([open, i]);
      open = -1;
    }
  });
  return out;
}
/** Opening `$$` line with "% locked" added or removed; null when it isn't one. */
function toggleMathLock(text) {
  const m = text.match(MATH_OPEN_RE);
  return m ? (m[2] ? m[1] : `${m[1]} % locked`) : null;
}
const lockCache = new WeakMap(); // doc -> locked ranges (a doc never changes, so its ranges don't either)
/** [from, to] of every locked callout (its header line and the > lines under it) and locked math block. */
function lockedRanges(doc) {
  if (lockCache.has(doc)) return lockCache.get(doc);
  // shortcut: one pass over the lines per changed doc; fine for notes, upgrade to the syntax tree if huge notes lag
  const out = [];
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const m = l.text.match(CALLOUT_HEAD_RE);
    if (!m || !/(^|[\s|])locked(\s|$)/.test((m[3] || '').slice(1))) continue;
    let end = l;
    while (end.number < doc.lines && /^\s*>/.test(doc.line(end.number + 1).text)) end = doc.line(end.number + 1);
    out.push([l.from, end.to]);
    i = end.number;
  }
  const lines = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  for (const [a, b] of mathBlocks(lines)) if (MATH_LOCKED_RE.test(lines[a])) out.push([doc.line(a + 1).from, doc.line(b + 1).to]);
  lockCache.set(doc, out);
  return out;
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

