/* ---- Project plans (fork): the board ---------------------------------------------------------------------------
 * Columns by state: Ready, Waiting (worked out from ⛔, so nothing can be dropped there; blocked cards sit here,
 * purple, with what blocks them), In progress, Done; rows by phase. Dragging a card (or its menu) changes only the checkbox in the note, through writeNote: [ ] / [/] / [x],
 * adding ✅ today when done and removing it when reopened. Nothing is written while read-only is on.
 * Dragging uses pointer events, not the browser's drag and drop: inside Obsidian the drop of an HTML5 drag never
 * reached the board (the target lit up, nothing moved). Pointer events also work with touch. */

const PLAN_COLUMNS = [
  ['ready', 'Ready', ' '],
  ['waiting', 'Waiting', null], // waiting and blocked tasks
  ['doing', 'In progress', '/'],
  ['done', 'Done', 'x'],
];

/** "blocked by pla-gp3 (overdue)" / "blocked: #blocked" for a blocked task, else ''. */
function planBlockedText(t, byId, today) {
  if (!t || planClosed(t) || !byId) return '';
  if (t.flagged) return 'blocked: tagged #blocked';
  const by = planBlockers(t, byId, today);
  if (!by.length) return '';
  const name = (x) => `${x.id || planClip(planText(x.raw), 30)} (${x.flagged ? '#blocked' : 'overdue'})`;
  return `blocked by ${by.slice(0, 2).map(name).join(', ')}${by.length > 2 ? ` +${by.length - 2}` : ''}`;
}

Object.assign(PlanView.prototype, {
  renderBoard() {
    const { byId } = planIndex(this.tasks);
    const own = this.tasks.filter((t) => !t.external && this.shows(t));
    const lanes = new Map();
    const byPerson = this.lanes === 'person' && planPeople(this.tasks).length;
    for (const t of own) {
      // by person: a task with two owners sits in its first owner's row
      const k = byPerson ? ((t.owners || [])[0] || { name: 'No owner' }).name : t.phase || 'Tasks';
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(t);
    }
    if (byPerson && lanes.has('No owner')) {
      const none = lanes.get('No owner');
      lanes.delete('No owner');
      lanes.set('No owner', none);
    }
    const board = this.bodyEl.createDiv('np-board');
    const today = this.today;
    const column = (t) => {
      const s = planState(t, byId, today);
      return s === 'blocked' ? 'waiting' : s;
    };
    for (const [key, label] of PLAN_COLUMNS) {
      const head = board.createDiv({ cls: `np-col-head is-${key}` });
      head.createSpan({ text: label });
      const n = own.filter((t) => column(t) === key).length;
      const blocked = key === 'waiting' ? own.filter((t) => planState(t, byId, today) === 'blocked').length : 0;
      head.createSpan({ cls: 'np-col-n', text: blocked ? `${n} · ${blocked} blocked` : String(n) });
      if (key === 'waiting') tip(head, 'Waiting on earlier tasks (worked out from ⛔, so cards can’t be dropped here). Purple: blocked by an overdue or #blocked task upstream');
    }
    for (const [lane, list] of lanes) {
      board.createDiv({ cls: 'np-lane', text: lane });
      for (const [key, , box] of PLAN_COLUMNS) {
        const cell = board.createDiv({ cls: `np-cell is-${key}` });
        if (box !== null) cell.dataset.box = box; // a drop target (Waiting has none)
        for (const t of list.filter((x) => column(x) === key)) this.card(cell, t, byId);
      }
    }
  },
  card(cell, t, byId) {
    const kind = this.kinds.get(t) || 'ready';
    const c = cell.createDiv({ cls: `np-card is-${kind}${t.status === 'cancelled' ? ' is-cancelled' : ''}`, attr: { 'data-key': planKey(t) } });
    planFill(c, kind); // same colours as the Gantt bars and graph boxes
    c.createDiv({ cls: 'np-card-text', text: planText(t.raw) });
    const meta = c.createDiv('np-card-meta');
    if (t.id) meta.createSpan({ cls: 'np-id', text: t.id });
    meta.createSpan({ text: t.milestone ? '◆ milestone' : `${planDays(t)}d` });
    if (this.ownerText(t)) meta.createSpan({ text: this.ownerText(t) });
    for (const [k, sign, label] of PLAN_MARKS) if ((t.marks || []).includes(k)) c.createDiv({ cls: `np-mark is-${k}`, text: `${sign} ${label}` });
    if (t.due) meta.createSpan({ cls: kind === 'overdue' || kind === 'soon' ? `is-${kind}` : '', text: `📅 ${moment(t.due, 'YYYY-MM-DD').format('D MMM')}` });
    if (t.status === 'cancelled') meta.createSpan({ text: 'cancelled' });
    const why = planBlockedText(t, byId, this.today);
    if (why) c.createDiv({ cls: 'np-card-why', text: why });
    c.addEventListener('pointerdown', (e) => this.dragStart(e, c, t));
    c.addEventListener('click', (e) => {
      if (Date.now() - (this.dragEndAt || 0) < 400) return; // the click that ends a drag doesn't open anything
      this.openTask(e, t);
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
