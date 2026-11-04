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
/**
 * Toggle a symmetric marker (*, **, ~~, ==, `) around line[s..e]. For stars the run length decides
 * the state (1 italic, 2 bold, 3 both), so Italic never eats half of a bold. Returns the new line and selection.
 */
function toggleMark(line, s, e, mark) {
  while (s < e && line[s] === ' ') s++;
  while (e > s && line[e - 1] === ' ') e--;
  const run = (i, step) => {
    let n = 0;
    while (line[i + n * step] === '*') n++;
    return n;
  };
  const put = (k, markStr) => {
    const m = markStr.repeat(k);
    const out = line.slice(0, s - cut) + m + line.slice(s, e) + m + line.slice(e + cut);
    return { line: out, s: s - cut + m.length, e: e - cut + m.length };
  };
  let cut;
  if (mark === '*' || mark === '**') {
    // markers inside the selection count as outside
    const inner = Math.min(run(s, 1), run(e - 1, -1), Math.floor((e - s) / 2));
    s += inner;
    e -= inner;
    cut = Math.min(run(s - 1, -1), run(e, 1), 3);
    let bold = cut >= 2, italic = cut % 2 === 1;
    if (mark === '**') bold = !bold;
    else italic = !italic;
    return put((bold ? 2 : 0) + (italic ? 1 : 0), '*');
  }
  const n = mark.length;
  if (e - s >= 2 * n && line.slice(s, s + n) === mark && line.slice(e - n, e) === mark) (s += n), (e -= n);
  cut = line.slice(s - n, s) === mark && line.slice(e, e + n) === mark ? n : 0;
  return put(cut ? 0 : 1, mark);
}
function toggleWrap(editor, open, close = open) {
  const from = editor.getCursor('from');
  const to = editor.getCursor('to');
  if (open === close && from.line === to.line) {
    const r = toggleMark(editor.getLine(from.line), from.ch, to.ch, open);
    editor.replaceRange(r.line, { line: from.line, ch: 0 }, { line: from.line, ch: editor.getLine(from.line).length });
    editor.setSelection({ line: from.line, ch: r.s }, { line: from.line, ch: r.e });
    return;
  }
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
/** A --- divider on its own line, with a blank line above so the text above can't turn into a heading. */
function insertDivider(ed) {
  const l = ed.getCursor().line;
  const cur = ed.getLine(l).trim() ? ed.getLine(l) + '\n\n' : ''; // a line with text stays, the divider goes below it
  const pre = !cur && l > 0 && ed.getLine(l - 1).trim() ? '\n' : '';
  const post = l + 1 <= ed.lastLine() && !ed.getLine(l + 1).trim() ? '' : '\n'; // no extra blank line when one follows
  ed.setLine(l, `${pre}${cur}---${post}`);
  ed.setCursor({ line: l + (pre ? 1 : 0) + (cur ? 2 : 0) + 1, ch: 0 });
}
/**
 * Typing --- under a line of text makes Markdown turn that text into a heading (setext).
 * After Enter on such a ---, put a blank line above it so it stays a divider (Ctrl+Z undoes it).
 */
function keepDivider(ed) {
  const c = ed.getCursor();
  const at = c.line - 1; // the --- line, with the cursor on the new empty line below
  if (at < 1 || ed.getLine(c.line).trim() || ed.getLine(at).trim() !== '---') return;
  const above = ed.getLine(at - 1);
  if (!above.trim() || /^\s*(\||---|```|~~~)/.test(above) || inCodeBlock(ed, at)) return;
  // the closing --- of the frontmatter
  if (ed.getLine(0).trim() === '---') {
    let close = -1;
    for (let i = 1; i < at; i++) if (ed.getLine(i).trim() === '---') (close = i), (i = at);
    if (close === -1) return;
  }
  ed.replaceRange('\n', { line: at, ch: 0 });
}
/** Small sub-title: the line becomes #### (any other heading level is replaced); again turns it back into text. */
function toggleSubtitle(ed) {
  const l = ed.getCursor('from').line;
  const text = ed.getLine(l);
  const m = text.match(/^(#{1,6})\s+/);
  const body = m ? text.slice(m[0].length) : text;
  ed.setLine(l, m && m[1] === '####' ? body : `#### ${body}`);
}
/** Page break for Export to PDF: the next content starts on a new page (inline style, so it works without the plugin too). */
function insertPageBreak(ed) {
  const l = ed.getCursor().line;
  const cur = ed.getLine(l).trim() ? ed.getLine(l) + '\n\n' : '';
  const pre = !cur && l > 0 && ed.getLine(l - 1).trim() ? '\n' : '';
  const post = l + 1 <= ed.lastLine() && !ed.getLine(l + 1).trim() ? '' : '\n\n';
  ed.setLine(l, `${pre}${cur}<div class="nw-pagebreak" style="break-after: page; page-break-after: always;"></div>${post}`);
  ed.setCursor({ line: l + (pre ? 1 : 0) + (cur ? 2 : 0) + 2, ch: 0 });
}
