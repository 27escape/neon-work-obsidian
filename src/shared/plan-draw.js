/* ---- Plans and timelines (fork): colours, the date scale and the Gantt drawing, shared by Projects and Tasks -------
 * Obsidian draws ```mermaid blocks with Pele, which takes no per-bar styles, so the Planning view, the Projects
 * timeline and the Tasks timeline draw their Gantt charts here as SVG: names on the left, a day scale with weekends
 * shaded and weeks (or months) marked, bars in the kind colours, dashed outlines for markers, a dark outline on the
 * critical path, diamonds for milestones, hollow diamonds for due dates, a line for today. The layout is pure
 * (planGanttLayout, tested); planDrawGantt only turns it into SVG elements (no HTML strings). Colours come from
 * Obsidian's colour variables as #rrggbb. */

const PLAN_WEEK_BASE = '2026-01-05'; // a Monday, week 01 of its year: "Wk %W" then counts weeks from the start

// bar kinds in the order the legend shows them: [kind, label, Obsidian colour variable, fallback]
const PLAN_KINDS = [
  ['ready', 'Ready to start', '--color-blue', '#3a7bd5'],
  ['waiting', 'Waiting on earlier tasks', '--color-blue', '#9dbbe8'], // drawn paler (planColour)
  ['blocked', 'Blocked', '--color-purple', '#8e5bd0'],
  ['doing', 'In progress', '--color-cyan', '#1fa8b8'],
  ['soon', 'Due within a week', '--color-orange', '#e8871e'],
  ['overdue', 'Overdue', '--color-red', '#d93b3b'],
  ['done', 'Done', '--color-green', '#2e9e5b'],
  ['outside', 'Outside this project', '--text-faint', '#999999'],
];

/** "4 Dec" (pure). */
const planShortDate = (ymd) => `${+ymd.slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+ymd.slice(5, 7) - 1]}`;

const planClip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

// markers for tasks tagged #risk, #issue or #decision: a sign before the name and a dashed outline on the bar
const PLAN_MARKS = [
  ['risk', '⚠', 'Risk', '--color-orange', '#e8871e'],
  ['issue', '‼', 'Issue', '--color-red', '#d93b3b'],
  ['decision', '⚖', 'Decision', '--color-green', '#2e9e5b'],
];

/** A task's key across re-reads of the note: its id, else its place. */
const planKey = (t) => t.id || `${t.file.path}:${t.line}`;

/** #rrggbb from #rgb, #rrggbb, rgb() or rgba() (alpha dropped), else null (pure). */
function planToHex(c) {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).replace(/./g, '$&$&')).toLowerCase();
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!m) return null;
  return '#' + m.slice(1, 4).map((v) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
}

/** A theme colour variable as #rrggbb (Mermaid's classDef can't take rgb() or hsl()); any CSS colour is resolved. */
function planCssHex(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  let hex = planToHex(v);
  if (!hex && v) {
    const probe = document.body.createDiv({ attr: { style: 'display:none' } });
    probe.style.color = v;
    hex = planToHex(getComputedStyle(probe).color);
    probe.remove();
  }
  return hex || fallback;
}

/** Text colour on a filled kind colour: dark on orange and grey, white on the rest. */
const planInk = (kind) => (kind === 'soon' || kind === 'outside' || kind === 'waiting' ? '#000000' : '#ffffff');

/** Fill an element with a kind's colour, as the Gantt bars and graph boxes are. */
function planFill(el, kind) {
  const c = planColour(kind);
  el.style.backgroundColor = c;
  el.style.borderColor = c;
  el.style.color = planInk(kind);
}

/** The colour in use for a bar kind (Obsidian's colour variables, so it follows the theme), as #rrggbb. */
function planColour(kind) {
  const k = PLAN_KINDS.find((x) => x[0] === kind) || PLAN_KINDS[0];
  const c = planCssHex(k[2], k[3]);
  return kind === 'waiting' ? planMix(c, planCssHex('--background-primary', '#ffffff'), 0.55) : c;
}

/** #rrggbb between two colours: share of b (0–1). Pure. */
function planMix(a, b, share) {
  const n = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(n(a, i) * (1 - share) + n(b, i) * share).toString(16).padStart(2, '0')).join('');
}

/** Every colour the charts use, as #rrggbb: the kinds, the critical path's outline (edge) and the markers (mark-risk…). */
function planColourMap() {
  return Object.assign(
    Object.fromEntries(PLAN_KINDS.map(([k]) => [k, planColour(k)])),
    Object.fromEntries(PLAN_MARKS.map(([k, , , v, fb]) => [`mark-${k}`, planCssHex(v, fb)])),
    { edge: planCssHex('--text-normal', '#222222') },
  );
}

const PLAN_DAY = 86400000;
/** Calendar days from a to b (pure). */
const planDayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / PLAN_DAY);

/**
 * Where everything goes (pure). rows: planGanttText's rows. Returns { width, height, labelW, dayW, days: [{ x, date,
 * weekend }], ticks: [{ x, text }], today: x | null, items: [{ type: 'section', y, text } | { type: 'bar', y, x, w,
 * row }] } with x in the chart area (after the label column).
 */
function planGanttLayout(rows, { today = null, relative = false, width = 900, labelW = 300, rowH = 26, headH = 26, minDay = 8, maxDay = 40 } = {}) {
  const dated = rows.filter((r) => r.bar && r.bar.start);
  if (!dated.length) return null;
  let first = dated.reduce((a, r) => (r.bar.start < a ? r.bar.start : a), dated[0].bar.start);
  let last = dated.reduce((a, r) => [r.bar.end, r.bar.due || ''].reduce((m, d) => (d > m ? d : m), a), dated[0].bar.end); // due dates fit too
  if (!relative && today && today < first && planDayDiff(today, first) < 30) first = today;
  if (!relative && today && today > last && planDayDiff(last, today) < 30) last = today;
  const from = ymdAdd(first, -1);
  const n = planDayDiff(from, ymdAdd(last, 2)) + 1;
  // fractional, so a year still fills the width (rounding down to whole pixels left long spans cramped)
  const dayW = Math.floor(Math.max(minDay, Math.min(maxDay, (width - labelW - 8) / n)) * 100) / 100;
  const x = (d) => planDayDiff(from, d) * dayW;
  const days = [];
  const ticks = [];
  for (let i = 0; i < n; i++) {
    const date = ymdAdd(from, i);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    days.push({ x: i * dayW, date, weekend: dayW >= 6 && (wd === 0 || wd === 6) }); // too narrow: no shading
    // a line each Monday, or on the 1st of each month when weeks would crowd
    const weekly = dayW * 7 >= 46;
    if (weekly ? wd === 1 : date.endsWith('-01')) {
      const mon = planShortDate(date).split(' ')[1];
      const text = weekly ? (relative ? `Wk ${Math.floor(planDayDiff(PLAN_WEEK_BASE, date) / 7) + 1}` : planShortDate(date)) : ticks.length && !date.endsWith('-01-01') ? mon : `${mon} ${date.slice(2, 4)}`; // the year on the first and on January
      ticks.push({ x: i * dayW, text, date, weekly });
    }
  }
  // a label only where there is room for it (the line stays): about 46 px apart
  // a month label that loses its place takes its year to the next label shown, so the year change still shows
  let lastX = -Infinity;
  let year = false;
  for (const t of ticks) {
    if (t.x - lastX < 46) {
      if (!t.weekly && / \d\d$/.test(t.text)) year = true;
      t.text = '';
    } else {
      if (year && !t.weekly && !/ \d\d$/.test(t.text)) t.text += ` ${t.date.slice(2, 4)}`;
      year = false;
      lastX = t.x;
    }
  }
  const items = [];
  let y = headH;
  for (const r of rows) {
    if (r.section) items.push({ type: 'section', y, text: r.section });
    else {
      const b = r.bar;
      const left = x(b.start);
      const w = r.milestone ? 0 : r.thin ? Math.max(3, Math.round(dayW / 4)) : (planDayDiff(b.start, b.end) + 1) * dayW;
      items.push({ type: 'bar', y, x: left, w, row: r, dueX: b.due ? x(b.due) + dayW / 2 : null });
    }
    y += rowH;
  }
  const t = !relative && today && today >= from && planDayDiff(from, today) < n ? x(today) + dayW / 2 : null;
  return { width: labelW + n * dayW + 8, height: y + 6, labelW, dayW, rowH, headH, days, ticks, today: t, items };
}

/** "b waits for a", "b starts with a (+2d)", "b ends with a". */
function planLinkSentence(l) {
  const to = l.to.id || planClip(planText(l.to.raw), 30);
  const lag = l.lag ? ` (+${l.lag}d)` : '';
  return l.type === 'ss' ? `${to} starts with ${l.from.id}${lag}` : l.type === 'ff' ? `${to} ends with ${l.from.id}${lag}` : `${to} waits for ${l.from.id}`;
}
/** Where a bar starts and ends on the drawn chart (x from the left of the SVG): a milestone is a diamond. */
function planBarEnds(lay, it) {
  const mid = it.y + lay.rowH / 2;
  if (it.row.milestone) {
    const cx = lay.labelW + it.x + lay.dayW / 2;
    const s = Math.min(lay.rowH / 2 - 3, 9);
    return { x0: cx - s, x1: cx + s, y: mid };
  }
  return { x0: lay.labelW + it.x + 1, x1: lay.labelW + it.x + Math.max(2, it.w - 1), y: mid };
}
/**
 * The dependency arrows between drawn task bars (pure): [{ from, to, d, crit, late }], from the end of the task
 * waited for to the start of the task that waits. d: an SVG path with right angles (around the bars when the next one
 * starts before this one ends); crit: both on the critical path; late: the task waited for is overdue.
 */
function planGanttLinks(lay) {
  const byId = new Map();
  for (const it of lay.items) if (it.type === 'bar' && it.row.bar.task && it.row.bar.task.id) byId.set(it.row.bar.task.id, it);
  const out = [];
  for (const it of lay.items) {
    const t = it.type === 'bar' && it.row.bar.task;
    if (!t) continue;
    for (const id of t.deps || []) {
      const p = byId.get(id);
      if (!p || p === it) continue;
      const a = planBarEnds(lay, p);
      const b = planBarEnds(lay, it);
      const gap = 6;
      const half = it.row.milestone ? Math.min(lay.rowH / 2 - 3, 9) : (lay.rowH - 10) / 2; // half the bar's height
      const down = b.y > a.y;
      let d;
      let end;
      if (b.x0 - a.x1 >= gap * 2) {
        // room between them: along, down, and into the start of the bar
        d = `M${a.x1},${a.y} H${a.x1 + gap} V${b.y} H${b.x0}`;
        end = { x: b.x0, y: b.y, dir: 'right' };
      } else if (b.x0 >= a.x1 - 2) {
        // the next starts as this one ends: along a little, then down (or up) into the top of the bar
        const x = Math.max(a.x1 + gap, b.x0 + gap);
        const y = down ? b.y - half : b.y + half;
        d = `M${a.x1},${a.y} H${x} V${y}`;
        end = { x, y, dir: down ? 'down' : 'up' };
      } else {
        // the next bar starts before this one ends: down between the rows, back, then into the bar
        const between = down ? b.y - lay.rowH / 2 : b.y + lay.rowH / 2;
        d = `M${a.x1},${a.y} H${a.x1 + gap} V${between} H${b.x0 - gap * 1.5} V${b.y} H${b.x0}`;
        end = { x: b.x0, y: b.y, dir: 'right' };
      }
      out.push({ from: p.row.bar.task, to: t, type: 'fs', d, end, crit: !!(p.row.bar.crit && it.row.bar.crit), late: p.row.bar.kind === 'overdue' });
    }
    // run alongside: start to start (round the left of both bars), end to end (round the right)
    for (const l of t.links || []) {
      const p = byId.get(l.id);
      if (!p || p === it) continue;
      const a = planBarEnds(lay, p);
      const b = planBarEnds(lay, it);
      const gap = 6;
      let d;
      let end;
      if (l.type === 'ss') {
        const x = Math.min(a.x0, b.x0) - gap;
        d = `M${a.x0},${a.y} H${x} V${b.y} H${b.x0}`;
        end = { x: b.x0, y: b.y, dir: 'right' };
      } else {
        const x = Math.max(a.x1, b.x1) + gap;
        d = `M${a.x1},${a.y} H${x} V${b.y} H${b.x1}`;
        end = { x: b.x1, y: b.y, dir: 'left' };
      }
      out.push({ from: p.row.bar.task, to: t, type: l.type, lag: l.lag, d, end, crit: !!(p.row.bar.crit && it.row.bar.crit), late: false });
    }
  }
  return out;
}

/**
 * Draw a layout into `el` as SVG. colours: planColourMap(); onBar(e, bar) for task rows; selKey: the selected task;
 * links: draw the dependency arrows (planGanttLinks); onLink(e, link) when one is clicked; onMenu(e, bar): right-click.
 */
function planDrawGantt(el, lay, { colours, onBar = null, selKey = null, links = false, onLink = null, onMenu = null }) {
  const { labelW, dayW, rowH, headH } = lay;
  const svg = el.createSvg('svg', { cls: 'np-gantt', attr: { width: lay.width, height: lay.height, viewBox: `0 0 ${lay.width} ${lay.height}`, xmlns: 'http://www.w3.org/2000/svg' } });
  svg.style.fontFamily = 'var(--font-interface)';
  svg.style.fontSize = '12px';
  const add = (tag, attr, style) => {
    const e = svg.createSvg(tag, { attr });
    if (style) e.setAttr('style', style);
    return e;
  };
  const text = (x, y, s, style, anchor = 'start') => {
    const e = add('text', { x, y, 'text-anchor': anchor, 'dominant-baseline': 'middle' }, `fill: var(--text-normal);${style || ''}`);
    e.textContent = s;
    return e;
  };
  // weekends and week lines
  for (const d of lay.days) if (d.weekend) add('rect', { x: labelW + d.x, y: headH, width: dayW, height: lay.height - headH }, 'fill: var(--background-modifier-hover)');
  for (const t of lay.ticks) {
    add('line', { x1: labelW + t.x, y1: headH - 6, x2: labelW + t.x, y2: lay.height }, 'stroke: var(--background-modifier-border); stroke-width: 1');
    if (t.text) text(labelW + t.x + 3, headH / 2, t.text, 'fill: var(--text-muted); font-size: 11px');
  }
  add('line', { x1: labelW, y1: headH, x2: lay.width, y2: headH }, 'stroke: var(--background-modifier-border)');
  // dependency arrows, under the bars; red when the task waited for is late, bold along the critical path
  const arrows = links ? planGanttLinks(lay) : [];
  for (const l of arrows) {
    const c = l.late ? colours.overdue || '#d93b3b' : l.crit ? colours.edge : 'var(--text-faint)';
    // ordinary links faint, so a task feeding many others doesn't drown the chart; hovering a row brings its own up
    const strong = l.crit || l.late;
    // classes as a list: Obsidian adds an SVG element's classes one by one, and a name with a space throws
    const g = svg.createSvg('g', { cls: strong ? ['np-g-link', 'is-strong'] : 'np-g-link', attr: { 'data-from': planKey(l.from), 'data-to': planKey(l.to), opacity: strong ? '0.9' : '0.4' } });
    // run-alongside links (starts with, ends with) dashed, so they read differently from "after"
    g.createSvg('path', { attr: { d: l.d, fill: 'none' } }).setAttr('style', `stroke: ${c}; stroke-width: ${l.crit || l.late ? 1.6 : 1}${l.type !== 'fs' ? '; stroke-dasharray: 4 3' : ''}`);
    const { x, y, dir } = l.end;
    const head =
      dir === 'down' ? `${x},${y} ${x - 3.5},${y - 5} ${x + 3.5},${y - 5}` : dir === 'up' ? `${x},${y} ${x - 3.5},${y + 5} ${x + 3.5},${y + 5}` : dir === 'left' ? `${x},${y} ${x + 5},${y - 3.5} ${x + 5},${y + 3.5}` : `${x},${y} ${x - 5},${y - 3.5} ${x - 5},${y + 3.5}`;
    g.createSvg('polygon', { attr: { points: head } }).setAttr('style', `fill: ${c}`);
  }
  const maxChars = Math.floor((labelW - 18) / 6.4);
  for (const it of lay.items) {
    const mid = it.y + rowH / 2;
    if (it.type === 'section') {
      add('rect', { x: 0, y: it.y, width: lay.width, height: rowH }, 'fill: var(--background-secondary)');
      text(8, mid, planClip(it.text, maxChars + 4), 'font-weight: 600');
      continue;
    }
    const r = it.row;
    const b = r.bar;
    const key = b.task ? planKey(b.task) : b.project ? b.project.file.path : '';
    const g = svg.createSvg('g', { cls: 'np-g-row', attr: key ? { 'data-key': key } : {} });
    const hit = g.createSvg('rect', { cls: 'np-g-hit', attr: { x: 0, y: it.y, width: lay.width, height: rowH } });
    hit.setAttr('style', `fill: transparent${key && key === selKey ? '; stroke: var(--interactive-accent); stroke-width: 2' : ''}`);
    // steps (the checkboxes under the task): "2/4", and ✓ when all are done but the task isn't ticked yet
    const steps = r.steps ? ` · ${r.steps.done}/${r.steps.total}${r.stepsDone ? ' ✓' : ''}` : '';
    const name = `${r.label}${r.who ? ` · ${r.who}` : ''}${steps}`;
    const strong = b.mark === 'risk' || b.mark === 'issue';
    const label = g.createSvg('text', { attr: { x: 18, y: mid, 'dominant-baseline': 'middle' } });
    label.setAttr('style', `fill: var(--text-normal)${strong ? '; font-weight: 700' : ''}${b.kind === 'done' ? '; fill: var(--text-muted)' : ''}`);
    label.textContent = planClip(name, maxChars);
    g.createSvg('title').textContent = name;
    const fill = colours[b.kind] || '#888888';
    const mark = b.mark ? colours[`mark-${b.mark}`] : null;
    const stroke = mark || (b.crit ? colours.edge : fill);
    const outline = `stroke: ${stroke}; stroke-width: ${mark ? 2.5 : b.crit ? 2 : 1}${mark ? '; stroke-dasharray: 5 3' : ''}`;
    if (r.milestone) {
      const cx = labelW + it.x + dayW / 2;
      const s = Math.min(rowH / 2 - 3, 9);
      g.createSvg('polygon', { attr: { points: `${cx},${mid - s} ${cx + s},${mid} ${cx},${mid + s} ${cx - s},${mid}` } }).setAttr('style', `fill: ${fill}; ${outline}`);
    } else {
      g.createSvg('rect', { cls: 'np-g-bar', attr: { x: labelW + it.x + 1, y: it.y + 5, width: Math.max(2, it.w - 2), height: rowH - 10, rx: 3 } }).setAttr('style', `fill: ${fill}; ${outline}`);
      // how far through its steps: the left part of the bar, darker
      if (r.steps && r.steps.done && b.kind !== 'done' && /^#[0-9a-f]{6}$/i.test(fill)) {
        const pw = Math.max(2, ((it.w - 2) * r.steps.done) / r.steps.total);
        g.createSvg('rect', { cls: 'np-g-progress', attr: { x: labelW + it.x + 1, y: it.y + rowH / 2 - 2, width: pw, height: 4, rx: 2 } }).setAttr('style', `fill: ${planMix(fill, '#000000', 0.45)}; pointer-events: none`);
      }
    }
    if (it.dueX != null) {
      // a project's due date: a hollow diamond
      const s = Math.min(rowH / 2 - 4, 7);
      const c = b.kind === 'overdue' ? colours.overdue : 'var(--text-muted)';
      g.createSvg('polygon', { attr: { points: `${labelW + it.dueX},${mid - s} ${labelW + it.dueX + s},${mid} ${labelW + it.dueX},${mid + s} ${labelW + it.dueX - s},${mid}` } }).setAttr('style', `fill: var(--background-primary); stroke: ${c}; stroke-width: 2`);
    }
    if (arrows.length && b.task) {
      // hovering a task: its own arrows (in and out) stand out
      const mine = () => svg.querySelectorAll(`.np-g-link[data-from="${CSS.escape(key)}"], .np-g-link[data-to="${CSS.escape(key)}"]`);
      g.addEventListener('pointerenter', () => mine().forEach((x) => x.addClass('is-hot')));
      g.addEventListener('pointerleave', () => mine().forEach((x) => x.removeClass('is-hot')));
    }
    if ((b.task || b.project) && onBar) {
      g.addClass('is-task');
      g.addEventListener('click', (e) => onBar(e, b));
      if (onMenu)
        g.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          onMenu(e, b);
        });
    }
  }
  // the arrows' click areas, above the rows (whose own click area spans the whole width): wide and see-through
  if (onLink)
    for (const l of arrows) {
      const hit = svg.createSvg('path', { cls: 'np-g-link-hit', attr: { d: l.d, fill: 'none' } });
      hit.setAttr('style', 'stroke: transparent; stroke-width: 9; cursor: pointer');
      hit.createSvg('title').textContent = `${planLinkSentence(l)}: click to remove the link`;
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        onLink(e, l);
      });
    }
  if (lay.today != null) add('line', { x1: labelW + lay.today, y1: headH - 4, x2: labelW + lay.today, y2: lay.height }, `stroke: ${colours.overdue || '#d93b3b'}; stroke-width: 2`);
  return svg;
}
