/* ---- Project plans (fork): the board ---------------------------------------------------------------------------
 * Columns by state: Ready, Blocked (worked out from ⛔, so nothing can be dropped there), In progress, Done; rows by
 * phase. Dragging a card (or its menu) changes only the checkbox in the note, through writeNote: [ ] / [/] / [x],
 * adding ✅ today when done and removing it when reopened. Nothing is written while read-only is on. */

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
        if (box !== null) this.dropTarget(cell, box);
        for (const t of list.filter((x) => planState(x, byId) === key)) this.card(cell, t);
      }
    }
  },
  card(cell, t) {
    const kind = this.kinds.get(t) || 'ready';
    const c = cell.createDiv({ cls: `np-card is-${kind}${t.status === 'cancelled' ? ' is-cancelled' : ''}`, attr: { draggable: 'true' } });
    planFill(c, kind); // same colours as the Gantt bars and graph boxes
    c.createDiv({ cls: 'np-card-text', text: planText(t.raw) });
    const meta = c.createDiv('np-card-meta');
    if (t.id) meta.createSpan({ cls: 'np-id', text: t.id });
    meta.createSpan({ text: `${planDays(t)}d` });
    if (t.due) meta.createSpan({ cls: kind === 'overdue' || kind === 'soon' ? `is-${kind}` : '', text: `📅 ${moment(t.due, 'YYYY-MM-DD').format('D MMM')}` });
    if (t.status === 'cancelled') meta.createSpan({ text: 'cancelled' });
    c.addEventListener('dragstart', (e) => {
      this.dragging = t;
      e.dataTransfer.setData('text/plain', t.id || planText(t.raw));
      e.dataTransfer.effectAllowed = 'move';
      c.addClass('is-dragging');
    });
    c.addEventListener('dragend', () => {
      c.removeClass('is-dragging');
      this.dragging = null;
    });
    c.addEventListener('click', (e) => openFile(this.app, t.file, e, t.line));
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) => i.setTitle('Open').setIcon('file-text').onClick(() => openFile(this.app, t.file, null, t.line)));
      m.addSeparator();
      for (const [key, label, box] of PLAN_COLUMNS) if (box !== null) m.addItem((i) => i.setTitle(`Move to ${label}`).setChecked(t.box === box || (box === 'x' && t.status === 'done')).onClick(() => this.moveTask(t, box)));
      m.showAtMouseEvent(e);
    });
  },
  dropTarget(cell, box) {
    cell.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.addClass('is-over');
    });
    cell.addEventListener('dragleave', () => cell.removeClass('is-over'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.removeClass('is-over');
      const t = this.dragging;
      this.dragging = null;
      if (t) this.moveTask(t, box);
    });
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
