/* ---- Project plans (fork): save a drawn chart as SVG or PNG ------------------------------------------------------
 * Everything stays on this computer: the chart already drawn in the view is copied into a file that the system's
 * download handling saves (a blob: link, no network). Theme colours given as CSS variables are written in, so the
 * file looks the same outside Obsidian. The PNG is drawn from that SVG on a canvas. */

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

/** A PNG (twice the size on screen) drawn from SVG text; the image is the chart itself as a data: URL (local). */
function planPng(svgText, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    // a data: URL, not blob: — Obsidian's content security policy refuses blob: images
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    const img = createEl('img');
    img.onload = () => {
      try {
        const c = createEl('canvas');
        c.width = Math.ceil(width * scale);
        c.height = Math.ceil(height * scale);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('no PNG'))), 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('the chart could not be drawn as an image'));
    img.src = url;
  });
}

/** Save the chart in `el` as svg or png, named after the plan. */
async function planExport(el, title, kind) {
  const svg = el.querySelector('svg');
  if (!svg) return new Notice('Nothing to save yet');
  const name = `${safeName(title) || 'Plan'} ${moment().format('YYYY-MM-DD')}`;
  try {
    const text = planSvgText(svg);
    if (kind === 'svg') return planDownload(new Blob([text], { type: 'image/svg+xml' }), `${name}.svg`);
    const box = svg.getBoundingClientRect();
    planDownload(await planPng(text, box.width, box.height), `${name}.png`);
  } catch (e) {
    console.error('Plan: could not save the chart', e);
    new Notice('Could not save the chart. Details in the console.');
  }
}

/** The colour in use for a bar kind (Obsidian's colour variables, so it follows the theme). */
function planColour(kind) {
  const k = PLAN_KINDS.find((x) => x[0] === kind) || PLAN_KINDS[0];
  return getComputedStyle(document.body).getPropertyValue(k[2]).trim() || k[3];
}

/**
 * Colour the bars of a drawn Gantt by kind, as inline styles so a saved SVG or PNG keeps them. Mermaid names each
 * bar <svg id>-<task id> (older versions: the task id). Critical-path bars get an outline. Waits for the drawing.
 */
async function planPaint(el, bars) {
  let svg = el.querySelector('svg');
  for (let i = 0; !svg && i < 30 && el.isConnected; i++) {
    await new Promise((r) => window.setTimeout(r, 100));
    svg = el.querySelector('svg');
  }
  if (!svg) return;
  const edge = getComputedStyle(document.body).getPropertyValue('--text-normal').trim() || '#222222';
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
