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
  return planInlineVars(new XMLSerializer().serializeToString(copy), (name) => css.getPropertyValue(name));
}
/**
 * var(--name) or var(--name, fallback) in serialised SVG → the value in use now. The values land inside
 * double-quoted attributes, so their quotes become single quotes and & < > are escaped: Obsidian's font lists
 * ("??", "??", ui-sans-serif, …) otherwise ended the style attribute early and the SVG would not open.
 */
function planInlineVars(text, get) {
  const safe = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, "'");
  return text.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (m, name, fb) => {
    const v = String(get(name) || '').trim() || (fb || '').trim();
    return v ? safe(v) : m;
  });
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

