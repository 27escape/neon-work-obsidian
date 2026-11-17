/* ---- Mermaid Gantt timelines (fork) -------------------------------------------------
 * Builds Mermaid "gantt" text from plain items and draws it with Obsidian's own Markdown renderer, so a
 * timeline looks the same here as when it is pasted into a note ("Copy as Mermaid"). Pure text building
 * is kept apart from drawing so it can be tested. Dates are YYYY-MM-DD strings throughout. */

const GANTT_ZOOMS = [
  ['3m', '3 months'],
  ['12m', '12 months'],
  ['all', 'Everything'],
];

/** A date string n days / months from a date string (UTC, so no daylight-saving drift). */
function ymdAdd(ymd, days = 0, months = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d + days));
  return t.toISOString().slice(0, 10);
}
/** The window a zoom shows around today: { from, to }, or null for everything. */
function ganttWindow(zoom, today) {
  if (zoom === '3m') return { from: ymdAdd(today, -14), to: ymdAdd(today, 0, 3) };
  if (zoom === '12m') return { from: ymdAdd(today, 0, -1), to: ymdAdd(today, 0, 11) };
  return null;
}
/** Text Mermaid accepts in a task or section name (":" and "#" and ";" end or break a line there). */
function mermaidSafe(text) {
  return String(text || '')
    .replace(/[:;#]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled';
}
/** The text as a fenced block, ready to paste into a note. */
const mermaidBlock = (src) => '```mermaid\n' + src + '\n```\n';

/** Draw Mermaid text into an element with Obsidian's renderer (component: the view, for clean-up). */
async function renderMermaid(app, el, src, component) {
  el.empty();
  const R = obsidian.MarkdownRenderer;
  try {
    if (R && R.render) await R.render(app, mermaidBlock(src), el, '', component);
    else if (R && R.renderMarkdown) await R.renderMarkdown(mermaidBlock(src), el, '', component);
  } catch (e) {
    console.error('Timeline: could not draw the chart', e);
    el.createDiv({ cls: 'nd-empty', text: 'The timeline could not be drawn. Details in the console.' });
  }
}
