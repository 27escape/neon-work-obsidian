/* ---- Project plans (fork): the board ---------------------------------------------------------------------------
 * Columns by state: Ready, Blocked (worked out from ⛔, so nothing can be dropped there), In progress, Done; rows by
 * phase. Dragging a card (or its menu) changes only the checkbox in the note, through writeNote: [ ] / [/] / [x],
 * adding ✅ today when done and removing it when reopened. Nothing is written while read-only is on.
 * Dragging uses pointer events, not the browser's drag and drop: inside Obsidian the drop of an HTML5 drag never
 * reached the board (the target lit up, nothing moved). Pointer events also work with touch. */

const PLAN_COLUMNS = [
  ['ready', 'Ready', ' '],
  ['blocked', 'Blocked', null],
  ['doing', 'In progress', '/'],
  ['done', 'Done', 'x'],
];

/**
 * Text with the task's checkbox set to `box` (pure), or null when the task can't be found. The task is looked for on
 * its line, else on the one line that holds the same text. Done adds "✅ today" if missing; reopening removes it.
 */
function planSetBox(text, t, box, today) {
  const lines = text.split('\n');
  const re = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s+)(.*)$/u;
  const fits = (l) => {
    const m = (l || '').replace(/\r$/, '').match(re);
    return !!m && m[4] === t.raw;
  };
  let n = fits(lines[t.line]) ? t.line : -1;
  if (n < 0) {
    const hits = lines.map((l, i) => (fits(l) ? i : -1)).filter((i) => i >= 0);
    if (hits.length !== 1) return null;
    n = hits[0];
  }
  const cr = lines[n].endsWith('\r') ? '\r' : '';
  const m = lines[n].replace(/\r$/, '').match(re);
  let rest = m[4];
  if (box === 'x' || box === 'X') {
    if (!/✅\s*\d{4}-\d{2}-\d{2}/u.test(rest)) rest = `${rest} ✅ ${today}`;
  } else rest = rest.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/gu, '');
  lines[n] = m[1] + box + m[3] + rest + cr;
  return lines.join('\n');
}

Object.assign(PlanView.prototype, {
  renderBoard() {
    const { byId } = planIndex(this.tasks);
    const own = this.tasks.filter((t) => !t.external);
    const lanes = new Map();
    for (const t of own) {
      const k = t.phase || 'Tasks';
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(t);
    }
    const board = this.bodyEl.createDiv('np-board');
    for (const [key, label] of PLAN_COLUMNS) {
      const head = board.createDiv({ cls: `np-col-head is-${key}` });
      head.createSpan({ text: label });
      head.createSpan({ cls: 'np-col-n', text: String(own.filter((t) => planState(t, byId) === key).length) });
      if (key === 'blocked') tip(head, 'Waiting on a task it depends on: worked out from ⛔, so cards can’t be dropped here');
    }
    for (const [lane, list] of lanes) {
      board.createDiv({ cls: 'np-lane', text: lane });
      for (const [key, , box] of PLAN_COLUMNS) {
        const cell = board.createDiv({ cls: `np-cell is-${key}` });
        if (box !== null) cell.dataset.box = box; // a drop target (Blocked has none)
        for (const t of list.filter((x) => planState(x, byId) === key)) this.card(cell, t);
      }
    }
  },
  card(cell, t) {
    const kind = this.kinds.get(t) || 'ready';
    const c = cell.createDiv({ cls: `np-card is-${kind}${t.status === 'cancelled' ? ' is-cancelled' : ''}` });
    planFill(c, kind); // same colours as the Gantt bars and graph boxes
    c.createDiv({ cls: 'np-card-text', text: planText(t.raw) });
    const meta = c.createDiv('np-card-meta');
    if (t.id) meta.createSpan({ cls: 'np-id', text: t.id });
    meta.createSpan({ text: `${planDays(t)}d` });
    if (t.due) meta.createSpan({ cls: kind === 'overdue' || kind === 'soon' ? `is-${kind}` : '', text: `📅 ${moment(t.due, 'YYYY-MM-DD').format('D MMM')}` });
    if (t.status === 'cancelled') meta.createSpan({ text: 'cancelled' });
    c.addEventListener('pointerdown', (e) => this.dragStart(e, c, t));
    c.addEventListener('click', (e) => {
      if (this.dragged) return void (this.dragged = false); // the click that ends a drag doesn't open the note
      openFile(this.app, t.file, e, t.line);
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) => i.setTitle('Open').setIcon('file-text').onClick(() => openFile(this.app, t.file, null, t.line)));
      m.addSeparator();
      for (const [key, label, box] of PLAN_COLUMNS) if (box !== null) m.addItem((i) => i.setTitle(`Move to ${label}`).setChecked(t.box === box || (box === 'x' && t.status === 'done')).onClick(() => this.moveTask(t, box)));
      m.showAtMouseEvent(e);
    });
  },
  /**
   * Drag with the pointer: past a few pixels a copy of the card follows the pointer, the cell under it lights up when
   * it takes drops, and letting go there moves the task. Escape, or letting go elsewhere, cancels.
   */
  dragStart(e, card, t) {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let ghost = null;
    let over = null;
    const stop = new AbortController();
    const end = () => {
      stop.abort();
      if (ghost) ghost.remove();
      card.removeClass('is-dragging');
      if (over) over.removeClass('is-over');
    };
    this.register(() => stop.abort());
    const target = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cell = el && el.closest('.np-cell');
      return cell && this.bodyEl.contains(cell) && cell.dataset.box !== undefined ? cell : null;
    };
    window.addEventListener(
      'pointermove',
      (ev) => {
        if (!ghost) {
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
          const box = card.getBoundingClientRect();
          ghost = card.cloneNode(true);
          ghost.addClass('np-ghost');
          ghost.style.width = `${box.width}px`;
          document.body.appendChild(ghost);
          card.addClass('is-dragging');
        }
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
        const cell = target(ev);
        if (cell !== over) {
          if (over) over.removeClass('is-over');
          over = cell;
          if (over) over.addClass('is-over');
        }
      },
      { signal: stop.signal },
    );
    window.addEventListener(
      'pointerup',
      (ev) => {
        const cell = ghost ? target(ev) : null;
        const dragged = !!ghost;
        end();
        if (!dragged) return;
        this.dragged = true; // swallow the click that follows
        window.setTimeout(() => (this.dragged = false), 0);
        if (!cell) return;
        NEON_GUARD.lastGesture = Date.now(); // a drop is asked for by you: a read-only refusal gets a notice
        cell.appendChild(card); // show it at once; the view redraws when the note changes
        this.moveTask(t, cell.dataset.box);
      },
      { signal: stop.signal },
    );
    window.addEventListener('pointercancel', end, { signal: stop.signal });
    window.addEventListener('keydown', (ev) => ev.key === 'Escape' && end(), { signal: stop.signal });
  },
  /** Set a task's checkbox in its note; the view redraws when the note changes. */
  async moveTask(t, box) {
    if (t.box === box || (box === 'x' && t.status === 'done')) return;
    let found = true;
    try {
      await writeNote(this.app, t.file, (text) => {
        const next = planSetBox(text, t, box, moment().format('YYYY-MM-DD'));
        if (next === null) found = false;
        return next === null ? text : next;
      });
      if (!found) {
        new Notice('That task changed in the meantime: refreshed');
        this.refresh();
      }
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Plan: could not move the task', e);
        new Notice('Could not change the task. Details in the console.');
      }
    }
  },
});
