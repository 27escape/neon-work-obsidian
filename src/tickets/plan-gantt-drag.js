/* ---- Project plans (fork): editing on the Gantt chart -------------------------------------------------------
 * Drag a bar's right end to change its length ([duration:: Nd], or the 📅 date of a task fixed by 🛫 and 📅), the
 * bar itself to start it later (🛫 start, "not before": what waits for it moves too; it can't go before what it
 * waits for), and Alt-drag from one bar onto another to link them, by the ends you use: from the right end to the
 * other's left, the second waits for the first (⛔); left end to left end, it starts with it ([starts-with:: ]);
 * right end to right end, it ends with it ([ends-with:: ]). The first gets an id if it has none; no loops. Click an
 * arrow to remove that link. Each change edits only the task lines involved,
 * through the usual queue (editTask); Undo puts the last change back. Off on phones (dragging would fight the
 * scrolling). Kevin, 17 Nov: Alt for links, 🛫 for moving. */

/** The working day a dragged date lands on: a Saturday or Sunday moves to the Monday (pure). */
const planDropDay = (ymd) => planWorkdays(ymd, 0);
/** The working day before a date (pure). */
function planWorkdaysBack(ymd) {
  let d = ymdAdd(ymd, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = ymdAdd(d, -1);
  return d;
}
/** Length in working days of a bar from start to last (inclusive), at least 1 (pure). */
const planBarDays = (start, last) => Math.max(1, planWorkdaysBetween(start, planDropDay(last)) + 1);
/**
 * The earliest a task may start (pure): the working day after the last task it waits for ends, and not before
 * today if it hasn't started. bars: the dated plan's bars.
 */
function planEarliest(t, bars, today) {
  let at = null;
  const later = (d) => (at = !at || d > at ? d : at);
  const barOf = (id) => bars.find((x) => x.task && x.task.id === id);
  for (const id of t.deps || []) {
    const b = barOf(id);
    if (b) later(planWorkdays(b.end, 1));
  }
  // starts with: its start plus the lag; ends with: early enough to finish with it (the length stays)
  for (const l of t.links || []) {
    const b = barOf(l.id);
    if (!b) continue;
    if (l.type === 'ss') later(planWorkdays(b.start, l.lag));
    else {
      const own = bars.find((x) => x.task === t);
      const len = own ? planWorkdaysBetween(own.start, own.end) : 0;
      const fin = planWorkdays(b.end, l.lag);
      // the latest start that still finishes with it: count back the task's length in working days
      let s = fin;
      for (let k = 0; k < len; k++) s = planWorkdaysBack(s);
      later(s);
    }
  }
  if (t.status === 'todo' && today && (!at || today > at)) at = planDropDay(today);
  return at;
}

/**
 * The link an Alt-drag makes (pure): from an end to the other's left half: waits for (fs); from a start to the
 * other's left half: starts with (ss); from an end to the other's right half: ends with (ff); a start to an end:
 * null (not offered). A milestone counts as its left half.
 */
function planDropType(fromStart, x, ends, milestone) {
  const left = milestone || x < (ends.x0 + ends.x1) / 2;
  if (fromStart) return left ? 'ss' : null;
  return left ? 'fs' : 'ff';
}

Object.assign(PlanView.prototype, {
  /** Make the drawn Gantt editable. svg: planDrawGantt's result (redrawn often: its own listeners go with it). */
  attachGanttDrag(svg, lay, bars) {
    if (!svg || NEON_MOBILE.phone) return;
    const dated = !!this.base && !this.weeks;
    const items = lay.items.filter((it) => it.type === 'bar' && it.row.bar.task && !it.row.bar.task.external);
    const scale = () => svg.getBoundingClientRect().width / lay.width || 1;
    const at = (e) => {
      const r = svg.getBoundingClientRect();
      const k = scale();
      return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    };
    const rowAt = (y) => lay.items.find((it) => it.type === 'bar' && y >= it.y && y < it.y + lay.rowH);
    const zone = (p) => {
      const it = rowAt(p.y);
      if (!it || !items.includes(it)) return null;
      const e = planBarEnds(lay, it);
      if (p.x < e.x0 - 4 || p.x > e.x1 + 4) return null;
      return { it, ends: e, end: !it.row.milestone && p.x >= e.x1 - 6 };
    };
    // the pointer shows what a drag would do
    svg.addEventListener('pointermove', (e) => {
      if (this.drag) return;
      const z = zone(at(e));
      svg.style.cursor = !z ? '' : e.altKey ? 'crosshair' : z.end ? 'ew-resize' : dated ? 'grab' : '';
    });
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = at(e);
      const z = zone(p);
      if (!z) return;
      const mode = e.altKey ? 'link' : z.end ? 'end' : dated ? 'move' : null;
      if (!mode) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const key = planKey(z.it.row.bar.task);
      const row = [...svg.querySelectorAll('.np-g-row')].find((r) => r.getAttribute('data-key') === key);
      const shape = row && row.querySelector('.np-g-bar, polygon');
      // Alt-drag: from the left half of the bar, a start; from the right half, an end
      const fromStart = mode === 'link' && !z.it.row.milestone && p.x < (z.ends.x0 + z.ends.x1) / 2;
      this.drag = { mode, it: z.it, ends: z.ends, fromStart, x0: p.x, moved: false, row, shape, w0: shape && shape.getAttr('width') };
    });
    svg.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const p = at(e);
      const dx = p.x - d.x0;
      if (!d.moved && Math.abs(dx) < 4 && d.mode !== 'link') return; // a click, not a drag yet
      if (!d.moved) {
        d.moved = true;
        this.dragActive = true; // no redraws until it lands
        svg.addClass('is-dragging');
      }
      const days = Math.round(dx / lay.dayW);
      const b = d.it.row.bar;
      if (d.mode === 'end' && d.shape) {
        d.shape.setAttr('width', String(Math.max(lay.dayW - 2, Number(d.w0) + days * lay.dayW)));
        this.dragTip(svg, p, `${planBarDays(b.start, ymdAdd(b.end, days))} working day${planBarDays(b.start, ymdAdd(b.end, days)) === 1 ? '' : 's'}`);
      } else if (d.mode === 'move' && d.row) {
        for (const el of d.row.querySelectorAll('.np-g-bar, polygon')) el.setAttr('transform', `translate(${days * lay.dayW} 0)`);
        this.dragTip(svg, p, `Starts ${planShortDate(planDropDay(ymdAdd(b.start, days)))}`);
      } else if (d.mode === 'link') {
        if (!d.line) d.line = svg.createSvg('line', { cls: 'np-g-drag-link' });
        d.line.setAttrs({ x1: d.fromStart ? d.ends.x0 : d.ends.x1, y1: d.ends.y, x2: p.x, y2: p.y });
        const target = rowAt(p.y);
        const ok = target && items.includes(target) && target !== d.it;
        const type = ok ? planDropType(d.fromStart, p.x, planBarEnds(lay, target), target.row.milestone) : null;
        const name = ok ? planClip(planText(target.row.bar.task.raw), 30) : '';
        this.dragTip(svg, p, !ok ? 'Drop on the task to link: its left end to start with, right end to end with' : type === 'fs' ? `${name} waits for this` : type === 'ss' ? `${name} starts with this` : type === 'ff' ? `${name} ends with this` : 'From a start, drop on the other’s left end');
      }
    });
    const end = (e, cancel) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.dragActive = false;
      svg.removeClass('is-dragging');
      if (!d.moved) {
        // a click, not a drag: the pointer was held by the chart, so the bar's own click never comes; open the editor here
        this.justDragged = true;
        window.setTimeout(() => (this.justDragged = false), 300);
        if (!cancel) this.openTask(e, d.it.row.bar.task);
        return;
      }
      this.justDragged = true; // the click that follows the drag isn't a click on the bar
      window.setTimeout(() => (this.justDragged = false), 300);
      if (cancel) return this.render();
      const p = at(e);
      const days = Math.round((p.x - d.x0) / lay.dayW);
      if (d.mode === 'link') {
        const target = rowAt(p.y);
        if (target && items.includes(target) && target !== d.it) {
          const type = planDropType(d.fromStart, p.x, planBarEnds(lay, target), target.row.milestone);
          if (type) return void this.dropLink(d.it.row.bar.task, target.row.bar.task, type);
          new Notice('From the start of a bar, drop on the left end of the other: it then starts with it');
        }
        return this.render();
      }
      if (!days) return this.render();
      if (d.mode === 'end') return void this.dropEnd(d.it.row.bar, days);
      this.dropMove(d.it.row.bar, days, bars);
    };
    svg.addEventListener('pointerup', (e) => end(e, false));
    svg.addEventListener('pointercancel', (e) => end(e, true));
  },
  /** A small label by the pointer while dragging. */
  dragTip(svg, p, text) {
    let tip = svg.querySelector('.np-g-drag-tip');
    if (!tip) tip = svg.createSvg('text', { cls: 'np-g-drag-tip' });
    tip.setAttrs({ x: p.x + 12, y: p.y - 10 });
    tip.textContent = text;
  },
  /** The right end dropped: a new length, or a new 📅 for a task fixed by its 🛫 and 📅 dates. */
  dropEnd(bar, days) {
    const t = bar.task;
    const last = planDropDay(ymdAdd(bar.end, days));
    const fixed = this.base && !this.weeks && t.start && t.due && t.due >= t.start;
    if (fixed) return this.changeTasks(`end of “${planClip(planText(t.raw), 30)}”`, [[t, (rest) => planSetSign(rest, '📅', last < t.start ? t.start : last)]]);
    const n = planBarDays(bar.start, last);
    this.changeTasks(`length of “${planClip(planText(t.raw), 30)}”`, [[t, (rest) => planDurRest(rest, n)]]);
  },
  /** The bar dropped somewhere else: 🛫 start ("not before"), never before what it waits for. */
  dropMove(bar, days, bars) {
    const t = bar.task;
    const start = planDropDay(ymdAdd(bar.start, days));
    const earliest = planEarliest(t, bars, this.today);
    if (earliest && start < earliest) {
      const why = (t.deps || []).map((id) => bars.find((b) => b.task && b.task.id === id)).filter(Boolean).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      new Notice(why && planWorkdays(why.end, 1) === earliest ? `It can’t start before ${planShortDate(earliest)}: it waits for ${why.task.id}, which ends ${planShortDate(why.end)}` : `It can’t start before ${planShortDate(earliest)} (not started yet, so not before today)`);
      return this.render();
    }
    const name = `start of “${planClip(planText(t.raw), 30)}”`;
    if (t.milestone) return this.changeTasks(name, [[t, (rest) => planSetSign(rest, t.due ? '📅' : '🛫', start)]]);
    if (t.start && t.due && t.due >= t.start) {
      // fixed dates: both move, keeping its length in working days
      const due = planWorkdays(start, planWorkdaysBetween(t.start, t.due));
      return this.changeTasks(name, [[t, (rest) => planSetSign(planSetSign(rest, '🛫', start), '📅', due)]]);
    }
    // back to the earliest it can start anyway: no 🛫 needed
    this.changeTasks(name, [[t, (rest) => planSetSign(rest, '🛫', earliest && start === earliest ? null : start)]]);
  },
  /** Alt-drag from one bar onto another: `to` waits for (fs), starts with (ss) or ends with (ff) `from`; `from` gets an id first if it has none. */
  dropLink(from, to, type = 'fs') {
    if (from.id && planLinkIds(to).includes(from.id)) {
      new Notice(`${to.id || planClip(planText(to.raw), 30)} is already linked to ${from.id}: click its arrow to remove that link first`);
      return this.render();
    }
    if (planDownstream(this.tasks, to).has(from)) {
      new Notice('That would make a loop: the first task already waits, in the end, for the second');
      return this.render();
    }
    const edits = [];
    let id = from.id;
    if (!id) {
      const fm = (this.app.metadataCache.getFileCache(from.file) || {}).frontmatter || {};
      id = planNextId(this.tasks.map((x) => x.id).filter(Boolean), planPrefix(fm, planScopeTitle(this.plan)));
      edits.push([from, (rest) => planSetSign(rest, '🆔', id)]);
    }
    edits.push([to, (rest) => (type === 'fs' ? planDepsRest(rest, [id], []) : planLinkRest(rest, type, [{ id, lag: 0 }], []))]);
    this.changeTasks(`link ${id} → ${to.id || planClip(planText(to.raw), 20)}`, edits);
  },
  /** An arrow clicked: remove that link (or open either task). */
  linkMenu(e, l) {
    const m = new Menu();
    const drop = (rest) => (l.type === 'ss' || l.type === 'ff' ? planLinkRest(rest, l.type, [], [l.from.id]) : planDepsRest(rest, [], [l.from.id]));
    m.addItem((i) => i.setTitle(`Remove the link: ${planLinkSentence(l)}`).setIcon('unlink').onClick(() => this.changeTasks(`link ${l.from.id} → ${l.to.id || ''}`, [[l.to, drop]])));
    m.addItem((i) => i.setTitle(`Open ${l.from.id}`).setIcon('file-text').onClick(() => openFile(this.app, l.from.file, null, l.from.line)));
    m.showAtMouseEvent(e);
  },
  /** Change task lines in order ([task, rest => rest]), remembering them for Undo. */
  async changeTasks(label, edits) {
    const before = edits.map(([t]) => ({ t, raw: t.raw, box: t.box }));
    for (const [t, fn] of edits) await this.editTask(t, (text) => planEditLine(text, t, (rest, box) => ({ rest: fn(rest).replace(/\s{2,}/g, ' ').trim(), box })));
    this.lastChange = { label, before };
    this.syncUndo();
  },
  /** Undo: put the last change back (task lines as they were, or a deleted task's lines and links). */
  async undoChange() {
    const c = this.lastChange;
    if (!c) return;
    this.lastChange = null;
    this.syncUndo();
    if (c.restore) await c.restore(); // a deleted task: its lines and links back
    else for (const b of [...c.before].reverse()) await this.editTask(b.t, (text) => planEditLine(text, b.t, () => ({ rest: b.raw, box: b.box })));
    if (c.restore) this.refresh();
    new Notice(`Undone: ${c.label}`);
  },
  syncUndo() {
    if (!this.undoBtn) return;
    this.undoBtn.toggleClass('is-hidden', !this.lastChange);
    if (this.lastChange) this.undoBtn.setAttr('aria-label', `Undo: ${this.lastChange.label}`);
  },
});
