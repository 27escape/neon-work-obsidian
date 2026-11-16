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

/** A PNG (twice the size on screen) drawn from SVG text; the image is loaded from a local blob: URL only. */
function planPng(svgText, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
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
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('the chart could not be drawn as an image'));
    };
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
