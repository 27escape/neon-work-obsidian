/* ---- selection toolbar -------------------------------------------------- */
const TOOLBAR = [
  { icon: 'bold', title: 'Bold', run: (ed) => toggleWrap(ed, '**') },
  { icon: 'italic', title: 'Italic', run: (ed) => toggleWrap(ed, '*') },
  { icon: 'strikethrough', title: 'Strikethrough', run: (ed) => toggleWrap(ed, '~~') },
  { icon: 'highlighter', title: 'Highlight', run: (ed) => toggleWrap(ed, '==') },
  { icon: 'code', title: 'Inline code', run: (ed) => toggleWrap(ed, '`') },
  { icon: 'link', title: 'Link to note', run: (ed) => toggleWrap(ed, '[[', ']]') },
  { sep: true },
  { icon: 'heading', title: 'Heading (H1 → H2 → H3 → none)', run: (ed) => cycleHeading(ed) },
  { icon: 'heading-4', title: 'Sub-title (small heading; again to remove)', run: (ed) => toggleSubtitle(ed) },
  { icon: 'message-square-quote', title: 'Callout', run: (ed) => makeCallout(ed) },
];
class SelectionToolbar {
  constructor(plugin) {
    this.plugin = plugin;
    const el = (this.el = document.body.createDiv('nw-toolbar nd-root'));
    for (const b of TOOLBAR) {
      if (b.sep) {
        el.createDiv('nw-tb-sep');
        continue;
      }
      const btn = el.createEl('button', { cls: 'nw-tb-btn', attr: { type: 'button', 'aria-label': b.title } });
      setIcon(btn, b.icon);
      tip(btn, b.title);
      // mousedown, not click: the selection in the note must survive the press
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const ed = this.editor();
        if (!ed) return;
        b.run(ed);
        window.setTimeout(() => this.update(), 0);
      });
    }
  }
  editor() {
    const v = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return v && v.getMode() === 'source' ? v.editor : null;
  }
  /** Show above the selection when there is one in the active note; hide otherwise. */
  update() {
    const v = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const ed = v && v.getMode() === 'source' ? v.editor : null;
    const sel = window.getSelection();
    if (!this.plugin.settings.toolbar || !ed || !ed.somethingSelected() || !sel || !sel.rangeCount || !v.contentEl.contains(sel.anchorNode)) return this.hide();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return this.hide();
    const el = this.el;
    el.addClass('is-shown');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8; // no room above: sit below
    el.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8)}px`;
    el.style.top = `${y}px`;
  }
  hide() {
    this.el.removeClass('is-shown');
  }
  destroy() {
    this.el.remove();
  }
}

