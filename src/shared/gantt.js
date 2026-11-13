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
/**
 * Mermaid gantt text. sections: [{ name, items: [{ name, start, end, tags: ['done'|'active'|'crit'] }] }];
 * an item without an end (or with end = start) is a milestone. With a window, items outside it are left
 * out and bars are clipped to it. Returns '' when nothing is left to draw.
 */
function ganttText({ title, sections, window: win, today }) {
  const lines = ['gantt', '  dateFormat YYYY-MM-DD'];
  const span = win ? (win.to.slice(0, 4) === win.from.slice(0, 4) ? '%d %b' : '%b %Y') : '%b %Y';
  lines.push(`  axisFormat ${span}`);
  if (title) lines.push(`  title ${mermaidSafe(title)}`);
  if (today) lines.push('  todayMarker on');
  let n = 0;
  for (const sec of sections) {
    const rows = [];
    for (const it of sec.items) {
      if (!it.start) continue;
      let start = it.start;
      let end = it.end && it.end > it.start ? it.end : null;
      if (win) {
        const last = end || start;
        if (last < win.from || start > win.to) continue;
        if (start < win.from) start = win.from;
        if (end && end > win.to) end = win.to;
      }
      const tags = (it.tags || []).filter((t) => ['done', 'active', 'crit'].includes(t));
      const id = `t${++n}`;
      if (!end) rows.push(`  ${mermaidSafe(it.name)} :${[...tags, 'milestone', id].join(', ')}, ${start}, 0d`);
      else rows.push(`  ${mermaidSafe(it.name)} :${[...tags, id].join(', ')}, ${start}, ${end}`);
    }
    if (!rows.length) continue;
    lines.push(`  section ${mermaidSafe(sec.name)}`, ...rows);
  }
  return n && lines.some((l) => l.startsWith('  section ')) ? lines.join('\n') : '';
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
/** Copy a chart as a fenced Mermaid block. */
async function copyMermaid(src) {
  try {
    await navigator.clipboard.writeText(mermaidBlock(src));
    new Notice('Timeline copied as Mermaid: paste it into any note');
  } catch (e) {
    console.error('Timeline: copy failed', e);
    new Notice('Could not copy the timeline');
  }
}
/**
 * A timeline panel: zoom buttons, "Copy as Mermaid", and the chart. build(zoom) returns Mermaid text ('' = nothing
 * to show). Returns { redraw } to call when the data changes.
 */
function timelinePanel(app, parent, component, { build, zoom = '12m', onZoom, empty = 'Nothing to show in this window' }) {
  const wrap = parent.createDiv('nd-timeline');
  const bar = wrap.createDiv('nd-timeline-bar');
  const z = pills(bar, GANTT_ZOOMS, zoom, (v) => {
    zoom = v;
    if (onZoom) onZoom(v);
    redraw();
  }, 'nd-timeline-zoom');
  void z;
  let src = '';
  button(bar, { icon: 'copy', text: 'Copy as Mermaid', cls: 'nd-timeline-copy', title: 'Copy this chart as a Mermaid block for a note', onClick: () => src && copyMermaid(src) });
  const chart = wrap.createDiv('nd-timeline-chart');
  let last = null;
  const redraw = async () => {
    src = build(zoom);
    if (src === last && chart.childElementCount) return;
    last = src;
    if (!src) {
      chart.empty();
      chart.createDiv({ cls: 'nd-empty', text: empty });
      return;
    }
    await renderMermaid(app, chart, src, component);
  };
  redraw();
  return { redraw, el: wrap };
}
