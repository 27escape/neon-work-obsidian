/* ---- Project plans (fork): the task editor ----------------------------------------------------------------------------
 * A form for one task of a project note: description, status, phase, owners, duration or milestone, #blocked, what it
 * depends on and what it blocks (pickers over the note's tasks, loops refused), dates (with the plan's own dates),
 * and an id given automatically. A preview shows the exact line, and what changes in other tasks, before saving.
 * The text work is in plan-form.js; this file is only the form. One save is one write to the note. */

const PLAN_STATUS_CHOICES = [
  [' ', 'To do'],
  ['/', 'In progress'],
  ['x', 'Done'],
  ['-', 'Cancelled'],
];

class PlanTaskModal extends Modal {
  /** ctx: { scope, file, text (the note now), tasks (the plan), task (null: new), after (a new task follows it), phase, base, onSaved(id) } */
  constructor(app, ctx) {
    super(app);
    this.ctx = ctx;
    const t = ctx.task;
    const { byId } = planIndex(ctx.tasks);
    this.byId = byId;
    this.today = moment().format('YYYY-MM-DD');
    this.form = {
      desc: t ? planSplit(t.raw).desc : '',
      box: t ? (t.box === 'X' ? 'x' : t.box) : ' ',
      days: t ? t.days : null,
      milestone: !!(t && t.milestone),
      flagged: !!(t && t.flagged),
      marks: t ? [...(t.marks || [])] : [],
      priority: t ? t.priority ?? 2 : 2,
      start: (t && t.start) || null,
      scheduled: (t && t.scheduled) || null,
      due: (t && t.due) || null,
      id: (t && t.id) || null,
    };
    // the note's other tasks: what the pickers offer
    this.mine = ctx.tasks.filter((x) => !x.external && x.file.path === ctx.file.path && x !== t);
    this.deps = t ? t.deps.map((id) => ({ id, task: byId.get(id) || null })) : ctx.after ? [{ id: ctx.after.id || null, task: ctx.after }] : [];
    this.owners = t ? (t.owners || []).map((o) => o.text) : []; // as written: [[@Sam Taylor]] or a plain name
    this.peopleNotes = app.vault.getMarkdownFiles().filter((f) => f.basename.startsWith('@')).map((f) => f.basename).sort();
    this.blocks = new Set(t && t.id ? this.mine.filter((x) => x.deps.includes(t.id)) : []);
    this.blocks0 = new Set(this.blocks);
    this.phase = t ? t.phase || '' : ctx.after ? ctx.after.phase || '' : ctx.phase || '';
    this.phases = planHeadings(ctx.text.split('\n')).map((h) => h.text);
    const fm = (app.metadataCache.getFileCache(ctx.file) || {}).frontmatter || {};
    this.prefix = planPrefix(fm, planScopeTitle(ctx.scope));
    this.planned = t ? planPlannedDates(ctx.tasks, ctx.base, this.today).get(t) : null;
  }

  onOpen() {
    const { contentEl: el, modalEl } = this;
    modalEl.addClass('nd-modal', 'np-editor');
    this.titleEl.setText(this.ctx.task ? 'Edit task' : this.ctx.after ? `New task after “${planClip(planText(this.ctx.after.raw), 40)}”` : 'New task');
    if (NEON_GUARD.readOnly) el.createDiv({ cls: 'np-ed-warn', text: 'Read-only is on, so saving is blocked. Turn it off in the plugin’s settings to change notes.' });
    const f = this.form;
    const row = (label, cls = '') => {
      const r = el.createDiv(`np-ed-row ${cls}`.trim());
      r.createDiv({ cls: 'np-ed-label', text: label });
      return r.createDiv('np-ed-field');
    };
    // description
    const desc = row('Description').createEl('textarea', { cls: 'np-ed-desc', attr: { rows: '2', placeholder: 'What needs doing' } });
    desc.value = f.desc;
    desc.addEventListener('input', () => ((f.desc = desc.value), this.update()));
    window.setTimeout(() => desc.focus(), 0);
    // status and phase
    const sp = row('Status');
    const status = sp.createEl('select', { cls: 'dropdown' });
    const choices = PLAN_STATUS_CHOICES.some(([b]) => b === f.box) ? PLAN_STATUS_CHOICES : [...PLAN_STATUS_CHOICES, [f.box, `Other [${f.box}]`]];
    for (const [b, label] of choices) status.createEl('option', { text: label, attr: { value: b } });
    status.value = f.box;
    status.addEventListener('change', () => ((f.box = status.value), this.update()));
    sp.createSpan({ cls: 'np-ed-sub', text: 'Priority' });
    const pri = sp.createEl('select', { cls: 'dropdown' });
    for (const [n, e, label] of PLAN_PRIORITIES) pri.createEl('option', { text: e ? `${e} ${label}` : label, attr: { value: String(n) } });
    pri.value = String(f.priority);
    pri.addEventListener('change', () => ((f.priority = +pri.value), this.update()));
    sp.createSpan({ cls: 'np-ed-sub', text: 'Phase' });
    const phase = sp.createEl('select', { cls: 'dropdown' });
    phase.createEl('option', { text: '(end of the note)', attr: { value: '' } });
    for (const p of this.phases) phase.createEl('option', { text: p, attr: { value: p } });
    phase.value = this.phases.includes(this.phase) ? this.phase : '';
    phase.addEventListener('change', () => ((this.phase = phase.value), this.update()));
    this.ownerEl = row('Owner', 'np-ed-pick');
    // duration, milestone, blocked
    const dr = row('Duration');
    const weeks = f.days != null && f.days >= 5 && f.days % 5 === 0;
    const num = dr.createEl('input', { cls: 'np-ed-num', attr: { type: 'number', min: '0', step: '1' } });
    num.value = f.days == null ? '' : String(weeks ? f.days / 5 : f.days);
    const unit = dr.createEl('select', { cls: 'dropdown' });
    for (const [v, label] of [['d', 'days'], ['w', 'weeks']]) unit.createEl('option', { text: label, attr: { value: v } });
    unit.value = weeks ? 'w' : 'd';
    const readDays = () => {
      const v = num.value.trim();
      f.days = v === '' ? null : Math.max(0, Math.round(parseFloat(v) * (unit.value === 'w' ? 5 : 1)));
      this.update();
    };
    num.addEventListener('input', readDays);
    unit.addEventListener('change', readDays);
    const chips = dr.createDiv('np-ed-chips');
    for (const [d, label] of [[1, '1d'], [2, '2d'], [3, '3d'], [5, '1w'], [10, '2w']]) {
      const b = chips.createEl('button', { cls: 'np-ed-chip', text: label, attr: { type: 'button' } });
      b.addEventListener('click', () => {
        num.value = String(d >= 5 ? d / 5 : d);
        unit.value = d >= 5 ? 'w' : 'd';
        readDays();
      });
    }
    const none = chips.createEl('button', { cls: 'np-ed-chip', text: 'No estimate', attr: { type: 'button' } });
    none.addEventListener('click', () => ((num.value = ''), readDays()));
    const flags = row('');
    const toggle = (label, key, title) => {
      const l = flags.createEl('label', { cls: 'np-ed-check' });
      const c = l.createEl('input', { attr: { type: 'checkbox' } });
      c.checked = !!f[key];
      l.createSpan({ text: label });
      tip(l, title);
      c.addEventListener('change', () => {
        f[key] = c.checked;
        if (key === 'milestone') num.disabled = unit.disabled = c.checked;
        this.update();
      });
      return c;
    };
    toggle('Milestone (#milestone)', 'milestone', 'A point in time, no length: a diamond on the Gantt chart');
    toggle('Blocked (#blocked)', 'flagged', 'Held up by something outside the plan (a supplier, an approval); everything after it is blocked too');
    num.disabled = unit.disabled = f.milestone;
    const marks = row('Marker');
    for (const [k, sign, label] of PLAN_MARKS) {
      const l = marks.createEl('label', { cls: 'np-ed-check' });
      const c = l.createEl('input', { attr: { type: 'checkbox' } });
      c.checked = f.marks.includes(k);
      l.createSpan({ text: `${sign} ${label} (#${k})` });
      c.addEventListener('change', () => {
        f.marks = c.checked ? [...f.marks, k] : f.marks.filter((x) => x !== k);
        this.update();
      });
    }
    // dependencies
    this.depsEl = row('Depends on', 'np-ed-pick');
    this.blocksEl = row('Blocks', 'np-ed-pick');
    // dates
    const dt = row('Dates');
    for (const [key, sign, label] of [['start', '🛫', 'Start'], ['scheduled', '⏳', 'Scheduled'], ['due', '📅', 'Due']]) {
      const w = dt.createDiv('np-ed-date');
      w.createSpan({ text: `${sign} ${label}` });
      const i = w.createEl('input', { attr: { type: 'date' } });
      i.value = f[key] || '';
      i.addEventListener('change', () => ((f[key] = i.value || null), this.update()));
      this[`${key}El`] = i;
    }
    this.weekendEl = dt.createDiv('np-ed-warn-line');
    if (this.planned) {
      const p = dt.createDiv('np-ed-planned');
      p.createSpan({ text: `Planned: ${moment(this.planned.start).format('ddd D MMM')} – ${moment(this.planned.due).format('ddd D MMM')} ` });
      const use = p.createEl('button', { cls: 'np-ed-chip', text: 'Use planned dates', attr: { type: 'button' } });
      use.addEventListener('click', () => {
        f.start = this.startEl.value = this.planned.start;
        f.due = this.dueEl.value = this.planned.due;
        this.update();
      });
    } else if (this.ctx.task) dt.createDiv({ cls: 'np-ed-planned', text: 'Set the project’s started date to see the plan’s dates here.' });
    // id and preview
    this.idEl = row('Id').createDiv('np-ed-id');
    const pv = el.createDiv('np-ed-preview');
    pv.createDiv({ cls: 'np-ed-label', text: 'Will write' });
    this.previewEl = pv.createEl('pre');
    this.alsoEl = pv.createDiv('np-ed-also');
    // buttons
    const bar = el.createDiv('np-ed-buttons');
    const save = bar.createEl('button', { cls: 'mod-cta', text: 'Save' });
    save.addEventListener('click', () => this.save());
    bar.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    this.scope.register(['Mod'], 'Enter', () => (this.save(), false));
    this.update();
  }

  /** Tasks that can't be picked: the task itself and anything that would make a loop. */
  forbidden() {
    const t = this.ctx.task;
    const deps = new Set();
    const blocks = new Set();
    if (t) for (const x of planDownstream(this.ctx.tasks, t)) deps.add(x);
    for (const b of this.blocks) {
      deps.add(b);
      for (const x of planDownstream(this.ctx.tasks, b)) deps.add(x);
    }
    for (const d of this.deps)
      if (d.task) {
        blocks.add(d.task);
        for (const x of planUpstream(this.byId, d.task)) blocks.add(x);
      }
    return { deps, blocks };
  }

  /** A picker: chips of what's chosen, a search box, matching tasks of the note (loops greyed out). */
  picker(el, { chosen, add, remove, bad, hint }) {
    el.empty();
    const chips = el.createDiv('np-ed-chips');
    for (const c of chosen) {
      const chip = chips.createSpan({ cls: 'np-ed-tag', text: c.label });
      const x = chip.createSpan({ cls: 'np-ed-x', text: '×' });
      x.addEventListener('click', () => (remove(c), this.update()));
    }
    const q = el.createEl('input', { cls: 'np-ed-search', attr: { type: 'search', placeholder: hint } });
    const list = el.createDiv('np-ed-list');
    const taken = new Set(chosen.map((c) => c.task).filter(Boolean));
    const draw = () => {
      list.empty();
      const s = q.value.trim().toLowerCase();
      if (!s) return;
      const hits = this.mine.filter((x) => !taken.has(x) && `${x.id || ''} ${planText(x.raw)} ${x.phase || ''}`.toLowerCase().includes(s)).slice(0, 8);
      if (!hits.length) list.createDiv({ cls: 'np-ed-none', text: 'No task in this note matches' });
      for (const x of hits) {
        const no = bad.has(x);
        const item = list.createDiv({ cls: `np-ed-hit${no ? ' is-off' : ''}` });
        const dot = item.createSpan('np-swatch');
        dot.style.backgroundColor = planColour(planBarKind(x, planState(x, this.byId, this.today), this.today));
        item.createSpan({ cls: 'np-id', text: x.id || 'no id' });
        item.createSpan({ text: planClip(planText(x.raw), 60) });
        item.createSpan({ cls: 'np-ed-phase', text: x.phase || '' });
        if (no) tip(item, 'That would make a loop: it already comes after this task');
        else item.addEventListener('click', () => (add(x), this.update()));
      }
    };
    q.addEventListener('input', draw);
  }

  /** Owners: chips, and a search over the people notes (@Name); Enter adds a plain name if none matches. */
  drawOwners() {
    const el = this.ownerEl;
    el.empty();
    const chips = el.createDiv('np-ed-chips');
    for (const text of this.owners) {
      const o = planOwners(`[owner:: ${text}]`)[0];
      const chip = chips.createSpan({ cls: 'np-ed-tag', text: `👤 ${o ? o.name : text}` });
      chip.createSpan({ cls: 'np-ed-x', text: '×' }).addEventListener('click', () => {
        this.owners = this.owners.filter((x) => x !== text);
        this.update();
      });
    }
    const q = el.createEl('input', { cls: 'np-ed-search', attr: { type: 'search', placeholder: 'Search people (@ notes), or type a name and press Enter…' } });
    const list = el.createDiv('np-ed-list');
    const add = (text) => {
      if (!this.owners.includes(text)) this.owners.push(text);
      this.update();
    };
    const hits = () => {
      const s = q.value.trim().toLowerCase().replace(/^@/, '');
      return s ? this.peopleNotes.filter((n) => n.toLowerCase().includes(s) && !this.owners.includes(`[[${n}]]`)).slice(0, 8) : [];
    };
    q.addEventListener('input', () => {
      list.empty();
      for (const n of hits()) {
        const item = list.createDiv({ cls: 'np-ed-hit', text: n });
        item.addEventListener('click', () => add(`[[${n}]]`));
      }
    });
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !q.value.trim()) return;
      e.preventDefault();
      const h = hits();
      add(h.length ? `[[${h[0]}]]` : q.value.trim().replace(/[[\],]/g, ''));
    });
  }

  /** The planned change: ids given out, the main task's form, edits of other tasks; and the notes for the preview. */
  plan() {
    const t = this.ctx.task;
    const used = new Set(this.ctx.tasks.map((x) => x.id).filter(Boolean));
    const f = Object.assign({}, this.form, { owners: this.owners.slice(), marks: this.form.marks.slice() });
    const notes = [];
    if (!f.id) {
      f.id = planNextId(used, this.prefix);
      used.add(f.id);
    }
    const ops = new Map(); // task → { add, remove, id }
    const op = (x) => ops.get(x) || ops.set(x, { add: [], remove: [], id: null }).get(x);
    f.deps = this.deps.map((d) => {
      if (d.id) return d.id;
      const o = op(d.task);
      if (!o.id) {
        o.id = planNextId(used, this.prefix);
        used.add(o.id);
        notes.push(`gives “${planClip(planText(d.task.raw), 40)}” the id ${o.id}`);
      }
      return o.id;
    });
    for (const b of this.blocks)
      if (!this.blocks0.has(b)) {
        op(b).add.push(f.id);
        notes.push(`adds ⛔ ${f.id} to “${planClip(planText(b.raw), 40)}”`);
      }
    for (const b of this.blocks0)
      if (!this.blocks.has(b)) {
        op(b).remove.push(f.id);
        notes.push(`removes ⛔ ${f.id} from “${planClip(planText(b.raw), 40)}”`);
      }
    if (!t) f.tag = taskTagFirst();
    const others = [...ops].map(([task, o]) => ({
      task,
      fn: (rest, box) => ({ rest: planDepsRest(o.id ? planSetSign(rest, '🆔', o.id) : rest, o.add, o.remove), box }),
    }));
    return { plan: { others, main: { task: t, form: f, phase: this.phase, after: t ? null : this.ctx.after || null } }, notes, f };
  }

  update() {
    this.drawOwners();
    const f0 = this.form;
    const weekend = PLAN_DATE_SIGNS.map(([k, sign]) => (planWeekend(f0[k]) ? `${sign} ${planWeekend(f0[k])}` : '')).filter(Boolean);
    if (this.weekendEl) this.weekendEl.setText(weekend.length ? `⚠ On a weekend: ${weekend.join(', ')}. Working days skip weekends; move it to a weekday?` : '');
    const bad = this.forbidden();
    this.picker(this.depsEl, {
      chosen: this.deps.map((d) => ({ task: d.task, label: d.task ? `${d.task.id || 'new id'} · ${planClip(planText(d.task.raw), 30)}${d.task.external ? ' ↗' : ''}` : `${d.id} (not found)`, d })),
      add: (x) => this.deps.push({ id: x.id || null, task: x }),
      remove: (c) => (this.deps = this.deps.filter((d) => d !== c.d)),
      bad: bad.deps,
      hint: 'Search this note’s tasks that must be done first…',
    });
    this.picker(this.blocksEl, {
      chosen: [...this.blocks].map((x) => ({ task: x, label: `${x.id || 'no id'} · ${planClip(planText(x.raw), 30)}` })),
      add: (x) => this.blocks.add(x),
      remove: (c) => this.blocks.delete(c.task),
      bad: bad.blocks,
      hint: 'Search this note’s tasks that wait for this one…',
    });
    const { plan, notes, f } = this.plan();
    this.idEl.setText(this.form.id ? f.id : `${f.id} (new)`);
    const res = planEditFile(this.ctx.text, plan, this.today);
    const lines = res.text.split('\n');
    this.previewEl.setText(res.line >= 0 ? lines[res.line].replace(/\r$/, '') : '(this task has changed in the note: close and open it again)');
    this.alsoEl.empty();
    for (const n of notes) this.alsoEl.createDiv({ text: `Also ${n}` });
    const where = this.phase ? `under “${this.phase}”` : 'at the end of the note';
    if (!this.ctx.task) this.alsoEl.createDiv({ text: `Goes ${where}` });
    else if (this.phase !== (this.ctx.task.phase || '')) this.alsoEl.createDiv({ text: `Moves ${where}` });
  }

  async save() {
    if (!this.form.desc.trim()) return new Notice('A task needs a description');
    const { plan, f } = this.plan();
    this.lastId = f.id; // the view selects the saved task, so the next New task follows it
    let res = null;
    try {
      await writeNote(this.app, this.ctx.file, (text) => {
        res = planEditFile(text, plan, moment().format('YYYY-MM-DD'));
        return res.text;
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not save the task', e);
        new Notice('Could not save the task. Details in the console.');
      }
      return;
    }
    if (res && res.line < 0) return new Notice('That task changed in the note in the meantime: nothing saved. Open it again.');
    if (res && res.missing.length) new Notice(`Saved; ${res.missing.length} other task(s) had changed and were left alone`);
    this.close();
    if (this.ctx.onSaved) this.ctx.onSaved(this.lastId);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** The first task tag (from the Tasks section's setting), for new tasks. */
function taskTagFirst() {
  const t = String(NEON_PLAN.taskTag || '').split(',')[0].trim();
  return t ? (t.startsWith('#') ? t : `#${t}`) : '';
}
