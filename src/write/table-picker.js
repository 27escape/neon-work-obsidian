/* ---- table picker ------------------------------------------------------- */
/** A rows × columns grid under the caret: hover or use the arrows, click or Enter inserts. */
class TablePicker {
  constructor(editor, rect) {
    this.editor = editor;
    this.r = 3;
    this.c = 3;
    const el = (this.el = document.body.createDiv('nw-table-picker nd-root'));
    el.createDiv({ cls: 'nw-tp-title', text: 'Insert table' });
    const grid = el.createDiv('nw-tp-grid');
    grid.style.setProperty('--cols', String(GRID_COLS));
    this.cells = [];
    for (let r = 1; r <= GRID_ROWS; r++) {
      for (let c = 1; c <= GRID_COLS; c++) {
        const cell = grid.createDiv('nw-tp-cell');
        cell.addEventListener('mouseenter', () => this.set(r, c));
        cell.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.set(r, c);
          this.insert();
        });
        this.cells.push({ r, c, cell });
      }
    }
    this.label = el.createDiv('nw-tp-label');
    el.createDiv({ cls: 'nw-tp-hint', text: 'first row is the header · arrows + Enter · Esc' });
    this.place(rect);
    this.set(this.r, this.c);
    this.onKey = (e) => {
      const k = e.key;
      const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
      if (moves[k]) this.set(clamp(this.r + moves[k][0], 1, GRID_ROWS), clamp(this.c + moves[k][1], 1, GRID_COLS));
      else if (k === 'Enter') this.insert();
      else if (k === 'Escape') this.close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    this.onDown = (e) => {
      if (!el.contains(e.target)) this.close();
    };
    document.addEventListener('keydown', this.onKey, true);
    window.setTimeout(() => document.addEventListener('mousedown', this.onDown, true), 0);
  }
  place(rect) {
    const el = this.el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = rect ? rect.left : (window.innerWidth - w) / 2;
    let y = rect ? rect.bottom + 6 : (window.innerHeight - h) / 2;
    if (rect && y + h > window.innerHeight - 8) y = rect.top - h - 6; // no room below: open above
    el.style.left = `${clamp(x, 8, window.innerWidth - w - 8)}px`;
    el.style.top = `${clamp(y, 8, window.innerHeight - h - 8)}px`;
  }
  set(r, c) {
    this.r = r;
    this.c = c;
    for (const x of this.cells) {
      x.cell.toggleClass('is-on', x.r <= r && x.c <= c);
      x.cell.toggleClass('is-head', x.r === 1 && x.c <= c);
    }
    this.label.setText(`${r} × ${c}  ·  ${r} row${r === 1 ? '' : 's'}, ${c} column${c === 1 ? '' : 's'}`);
  }
  insert() {
    const { r, c, editor } = this;
    this.close();
    insertTable(editor, r, c);
  }
  close() {
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('mousedown', this.onDown, true);
    this.el.remove();
  }
}

