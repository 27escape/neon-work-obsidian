/* ---- merged table cells (item 36): a cell that is only "<" joins the cell on its left ---- */
/** Reading view / PDF: apply the merges in one rendered table; a merged first body row becomes a title above the header. */
function mergeTable(table) {
  const rows = [...table.querySelectorAll('tr')];
  for (const tr of rows) {
    const cells = [...tr.children];
    // a row with "<" in it: empty cells after the title also join, so a new column keeps the title full width
    const merging = cells.some((c) => c.textContent.trim() === '<');
    let keep = null;
    for (const c of cells) {
      const t = c.textContent.trim();
      if (keep && (t === '<' || (merging && !t && keep === cells[0]))) {
        keep.colSpan += 1;
        c.remove();
      } else keep = c;
    }
  }
  const body = table.tBodies[0];
  const first = body && body.rows[0];
  const head = table.tHead;
  if (first && head && first.cells.length === 1 && first.cells[0].colSpan > 1) {
    first.addClass('nw-title-row');
    head.prepend(first);
  }
}
/** Line with the table cell at `ch` turned into "<" (or back to empty). */
function toggleMergeCell(line, ch) {
  const bars = [...line].map((c, i) => (c === '|' && line[i - 1] !== '\\' ? i : -1)).filter((i) => i >= 0);
  const k = bars.findIndex((b, i) => b < ch && (bars[i + 1] ?? Infinity) >= ch);
  if (k < 0 || k >= bars.length - 1 || k === 0) return null; // outside the table, or the first cell (nothing on its left)
  const cell = line.slice(bars[k] + 1, bars[k + 1]);
  return line.slice(0, bars[k] + 1) + (cell.trim() === '<' ? '  ' : ' < ') + line.slice(bars[k + 1]);
}
