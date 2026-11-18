/* ---- Project plans (fork): a drawn chart as SVG text, for the Planning report -------------------------------------
 * The chart already drawn is copied with its theme colours (CSS variables) written in, so the report's chart file
 * looks the same outside Obsidian. (The SVG and Copy as Mermaid buttons were dropped, 17 Nov: the report covers it.) */

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
  const once = (s) =>
    s.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (m, name, fb) => {
      const v = String(get(name) || '').trim() || (fb || '').trim();
      return v ? safe(v) : m;
    });
  // innermost first, until nothing changes: var(--np-link-c, var(--text-faint)) resolves too
  let out = text;
  for (let i = 0; i < 5; i++) {
    const next = once(out);
    if (next === out) break;
    out = next;
  }
  return out;
}
