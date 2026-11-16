/* ---- Project plans (fork): Durations to dates ---------------------------------------------------------------------
 * The plan works out every task's dates from durations and dependencies; this writes them into the tasks as 🛫 start
 * and 📅 due, after you choose which. Tasks that already have dates are left unticked, so nothing you set is replaced
 * unless you ask. One write per note; only the dates of the chosen tasks change. Milestones get a 📅 only. */

/** The note's text with 🛫 / 📅 set on each task (pure). items: [{ task, start, due }] (null leaves that date alone). */
function planDatesEdit(text, items) {
  let cur = text;
  const missing = [];
  for (const it of items) {
    const r = planEditLine(cur, it.task, (rest, box) => {
      let x = rest;
      if (it.start) x = planSetSign(x, '🛫', it.start);
      if (it.due) x = planSetSign(x, '📅', it.due);
      return { rest: x, box };
    });
    if (r) cur = r.text;
    else missing.push(it.task);
  }
  return { text: cur, missing };
}

class PlanDatesModal extends Modal {
  /** view: the Planning view (its tasks and its plan with real dates). */
  constructor(app, view) {
    super(app);
    this.view = view;
    const ends = new Map((view.dated ? view.dated.bars : []).filter((b) => b.task).map((b) => [b.task, b]));
    this.rows = view.tasks
      .filter((t) => !t.external && !planClosed(t) && ends.has(t))
      .map((t) => {
        const b = ends.get(t);
        const start = t.milestone ? null : b.start;
        const due = b.end;
        const same = (t.milestone || t.start === start) && t.due === due;
        return { task: t, start, due, on: !same && !t.start && !t.due, same };
      });
    this.withStart = true;
    this.withDue = true;
  }
  onOpen() {
    const { contentEl: el, modalEl } = this;
    modalEl.addClass('nd-modal', 'np-dates');
    this.titleEl.setText('Write the planned dates into the tasks');
    el.createEl('p', { cls: 'setting-item-description', text: 'The dates the plan works out from durations and dependencies, from the project’s start date and today. Tasks that already have dates are not ticked: tick them to replace their dates. Nothing else in the tasks changes.' });
    if (NEON_GUARD.readOnly) el.createDiv({ cls: 'np-ed-warn', text: 'Read-only is on, so writing is blocked. Turn it off in the plugin’s settings to change notes.' });
    const opts = el.createDiv('np-dates-opts');
    const check = (label, key) => {
      const l = opts.createEl('label', { cls: 'np-ed-check' });
      const c = l.createEl('input', { attr: { type: 'checkbox' } });
      c.checked = this[key];
      l.createSpan({ text: label });
      c.addEventListener('change', () => ((this[key] = c.checked), this.update()));
    };
    check('🛫 Start dates', 'withStart');
    check('📅 Due dates', 'withDue');
    const all = opts.createEl('button', { text: 'Tick all', attr: { type: 'button' } });
    all.addEventListener('click', () => (this.rows.forEach((r) => (r.on = !r.same)), this.draw()));
    const none = opts.createEl('button', { text: 'Tick none', attr: { type: 'button' } });
    none.addEventListener('click', () => (this.rows.forEach((r) => (r.on = false)), this.draw()));
    this.listEl = el.createDiv('np-dates-list');
    const bar = el.createDiv('np-ed-buttons');
    this.goBtn = bar.createEl('button', { cls: 'mod-cta' });
    this.goBtn.addEventListener('click', () => this.save());
    bar.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    this.draw();
  }
  draw() {
    const list = this.listEl;
    list.empty();
    if (!this.rows.length) return void list.createDiv({ cls: 'np-ed-none', text: 'No open tasks to date.' });
    const table = list.createEl('table', { cls: 'np-table' });
    const hr = table.createEl('thead').createEl('tr');
    for (const h of ['', 'Task', 'Now', 'Planned']) hr.createEl('th', { text: h });
    const body = table.createEl('tbody');
    const d = (x) => (x ? planShortDate(x) : '–');
    for (const r of this.rows) {
      const tr = body.createEl('tr', { cls: r.same ? 'is-same' : '' });
      const c = tr.createEl('td').createEl('input', { attr: { type: 'checkbox' } });
      c.checked = r.on;
      c.disabled = r.same;
      c.addEventListener('change', () => ((r.on = c.checked), this.update()));
      tr.createEl('td', { text: `${r.task.id ? `${r.task.id} · ` : ''}${planClip(planText(r.task.raw), 50)}` });
      tr.createEl('td', { cls: 'np-id', text: `🛫 ${d(r.task.start)} · 📅 ${d(r.task.due)}` });
      tr.createEl('td', { cls: r.same ? 'np-id' : '', text: r.same ? 'already these dates' : `${r.start ? `🛫 ${d(r.start)} · ` : ''}📅 ${d(r.due)}` });
    }
    this.update();
  }
  chosen() {
    return this.rows.filter((r) => r.on).map((r) => ({ task: r.task, start: this.withStart ? r.start : null, due: this.withDue ? r.due : null }));
  }
  update() {
    const n = this.chosen().filter((x) => x.start || x.due).length;
    this.goBtn.setText(n ? `Write dates into ${n} task${n === 1 ? '' : 's'}` : 'Nothing to write');
    this.goBtn.disabled = !n;
  }
  async save() {
    const items = this.chosen().filter((x) => x.start || x.due);
    const byFile = new Map();
    for (const it of items) (byFile.get(it.task.file) || byFile.set(it.task.file, []).get(it.task.file)).push(it);
    let missing = 0;
    try {
      for (const [file, list] of byFile)
        await writeNote(this.app, file, (text) => {
          const r = planDatesEdit(text, list);
          missing += r.missing.length;
          return r.text;
        });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not write the dates', e);
        new Notice('Could not write the dates. Details in the console.');
      }
      return;
    }
    new Notice(`Dates written into ${items.length - missing} task${items.length - missing === 1 ? '' : 's'}${missing ? `; ${missing} had changed and were left alone` : ''}`);
    this.close();
    this.view.refresh();
  }
  onClose() {
    this.contentEl.empty();
  }
}
