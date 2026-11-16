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
    meta.createSpan({ text: t.milestone ? '◆ milestone' : `${planDays(t)}d` });
    if (t.due) meta.createSpan({ cls: kind === 'overdue' || kind === 'soon' ? `is-${kind}` : '', text: `📅 ${moment(t.due, 'YYYY-MM-DD').format('D MMM')}` });
    if (t.status === 'cancelled') meta.createSpan({ text: 'cancelled' });
    c.addEventListener('pointerdown', (e) => this.dragStart(e, c, t));
    c.addEventListener('click', (e) => {
      if (Date.now() - (this.dragEndAt || 0) < 400) return; // the click that ends a drag doesn't open the note
      openFile(this.app, t.file, e, t.line);
    });
    c.addEventListener('contextmenu', (e) => this.taskMenu(e, t));
  },
  /**
   * Drag with the pointer: past a few pixels a copy of the card follows the pointer, the cell under it lights up when
   * it takes drops, and letting go there moves the task. Escape, or letting go elsewhere, cancels.
   */
  dragStart(e, card, t) {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const home = card.parentElement; // dropping back where it came from changes nothing
    let ghost = null;
    let over = null;
    const stop = new AbortController();
    const end = () => {
      stop.abort();
      this.dragActive = false;
      if (this.redrawAfterDrag) {
        this.redrawAfterDrag = false;
        window.setTimeout(() => this.render(), 0);
      }
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
          this.dragActive = true; // the board isn't redrawn under the pointer (see render)
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
        this.dragEndAt = Date.now();
        if (!cell || cell === home) return;
        NEON_GUARD.lastGesture = Date.now(); // a drop is asked for by you: a read-only refusal gets a notice
        cell.appendChild(card); // show it at once; the view redraws when the note changes
        this.moveTask(t, cell.dataset.box);
      },
      { signal: stop.signal },
    );
    window.addEventListener('pointercancel', end, { signal: stop.signal });
    window.addEventListener('keydown', (ev) => ev.key === 'Escape' && end(), { signal: stop.signal });
  },
});
