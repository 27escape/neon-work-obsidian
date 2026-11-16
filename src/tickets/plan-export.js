/* ---- Project plans (fork): save a drawn chart as SVG, colour its bars ------------------------------------------------------
 * Everything stays on this computer: the chart already drawn in the view is copied into a file that the system's
 * download handling saves (a blob: link, no network). Theme colours given as CSS variables are written in, so the
 * file looks the same outside Obsidian. (PNG was dropped: Obsidian would not load the chart as an image.) */

/** The SVG text of a drawn chart, with sizes, a background and the theme's CSS variables resolved. */
function planSvgText(svg) {
  const css = getComputedStyle(document.body);
  const box = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(Math.ceil(box.width)));
  copy.setAttribute('height', String(Math.ceil(box.height)));
  copy.style.maxWidth = 'none';
  copy.style.backgroundColor = css.getPropertyValue('--background-primary').trim() || '#ffffff';
  const text = new XMLSerializer().serializeToString(copy);
  // var(--name) or var(--name, fallback) → the value in use now
  return text.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (m, name, fb) => css.getPropertyValue(name).trim() || (fb || '').trim() || m);
}

/** Hand a file to the system's download handling (Obsidian asks where to save it, or uses Downloads). */
function planDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.body.createEl('a', { attr: { href: url, download: name } });
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Save the chart in `el` as an SVG file, named after the plan. */
function planExport(el, title) {
  const svg = el.querySelector('svg');
  if (!svg) return new Notice('Nothing to save yet');
  const name = `${safeName(title) || 'Plan'} ${moment().format('YYYY-MM-DD')}`;
  try {
    planDownload(new Blob([planSvgText(svg)], { type: 'image/svg+xml' }), `${name}.svg`);
  } catch (e) {
    console.error('Plan: could not save the chart', e);
    new Notice('Could not save the chart. Details in the console.');
  }
}

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
/** The colour in use for a bar kind (Obsidian's colour variables, so it follows the theme), as #rrggbb. */
function planColour(kind) {
  const k = PLAN_KINDS.find((x) => x[0] === kind) || PLAN_KINDS[0];
  return planCssHex(k[2], k[3]);
}

/**
 * Colour the bars of a drawn Gantt by kind, as inline styles so a saved SVG keeps them. Mermaid names each
 * bar <svg id>-<task id> (older versions: the task id). Critical-path bars get an outline. Waits for the drawing.
 */
async function planPaint(el, bars) {
  let svg = el.querySelector('svg');
  for (let i = 0; !svg && i < 30 && el.isConnected; i++) {
    await new Promise((r) => window.setTimeout(r, 100));
    svg = el.querySelector('svg');
  }
  if (!svg) return;
  const edge = planCssHex('--text-normal', '#222222');
  for (const b of bars) {
    const rect = svg.querySelector(`rect[id="${b.id}"], rect[id$="-${b.id}"]`);
    if (!rect) continue;
    const c = planColour(b.kind);
    rect.style.fill = c;
    rect.style.stroke = b.crit ? edge : c;
    rect.style.strokeWidth = b.crit ? '2px' : '1px';
    const label = svg.querySelector(`text[id="${b.id}-text"], text[id$="-${b.id}-text"]`);
    if (label && !/Outside/i.test(label.getAttribute('class') || '')) label.style.fill = b.kind === 'soon' || b.kind === 'outside' ? '#000000' : '#ffffff';
  }
}
