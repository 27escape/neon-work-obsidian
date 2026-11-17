/* ---- Project plans (fork): owners in the Planning view -------------------------------------------------------------
 * Owners come from [owner:: [[@Sam Taylor]], Alex] (people notes or plain names). The view can show one person's
 * tasks (the Gantt, board and list leave the others out; the graph greys them), group the board by person, and
 * warns when someone has more than their working days in a week (five, fewer with holidays or time off). */

const PLAN_NOBODY = '\u0000nobody'; // the filter value for tasks without an owner

/** Owners of the plan's own tasks: [{ key, name }] by name. */
function planPeople(tasks) {
  const seen = new Map();
  for (const t of tasks) if (!t.external) for (const o of t.owners || []) if (!seen.has(o.key)) seen.set(o.key, o.name);
  return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

Object.assign(PlanView.prototype, {
  /** The person filter (all modes) and the board's Phase / Person rows. */
  buildPeopleTools(tools) {
    this.whoEl = tools.createEl('select', { cls: 'dropdown np-who' });
    tip(this.whoEl, 'Show one person’s tasks');
    this.whoEl.addEventListener('change', () => {
      this.who = this.whoEl.value || null;
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    this.lanesEl = pills(tools, [['phase', 'By phase'], ['person', 'By person']], this.lanes, (v) => {
      this.lanes = v || 'phase';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
  },
  /** Fill the person list from the plan; hide what doesn't apply to this mode. */
  syncPeopleTools() {
    const people = planPeople(this.tasks);
    const sel = this.whoEl;
    sel.empty();
    sel.createEl('option', { text: 'Everyone', attr: { value: '' } });
    for (const p of people) sel.createEl('option', { text: p.name, attr: { value: p.key } });
    sel.createEl('option', { text: 'No owner', attr: { value: PLAN_NOBODY } });
    if (this.who && this.who !== PLAN_NOBODY && !people.some((p) => p.key === this.who)) this.who = null;
    sel.value = this.who || '';
    sel.toggleClass('is-hidden', !people.length);
    this.lanesEl.el.toggleClass('is-hidden', this.mode !== 'board' || !people.length);
  },
  /** Is this task shown under the person filter? */
  shows(t) {
    if (!this.who) return true;
    const owners = t.owners || [];
    return this.who === PLAN_NOBODY ? !owners.length : owners.some((o) => o.key === this.who);
  },
  /** "Marcus Hale has 7 days of work in the week of Mon 23 Nov (5 available)". */
  loadLines(sched, dated = !(this.weeks || !this.base)) {
    let cap = 5;
    let opts = {};
    if (dated && this.base) {
      // calendar weeks, each person's own working days in them (holidays and their time off left out)
      const from = planWorkdays(this.base, 0);
      const leave = this.tasks.leave;
      const days = new Map();
      const dayOf = (d) => days.get(d) || days.set(d, planWorkdays(from, d)).get(d);
      const monday = (ymd) => ymdAdd(ymd, -((planDow(ymd) + 6) % 7));
      const free = (o, ymd) => !planLeaveOff(planLeaveFor(leave, o), ymd);
      opts = { weekOf: (d) => monday(dayOf(d)), works: (o, d) => free(o, dayOf(d)) };
      cap = (o, week) => [0, 1, 2, 3, 4, 5, 6].map((i) => ymdAdd(week, i)).filter((d) => planCal().isWorkday(d) && free(o, d)).length;
    }
    return planOverloads(sched.rows, cap, opts).map(({ name, week, days, cap: avail, lowest }) => {
      const when = typeof week === 'string' ? `the week of ${moment(week, 'YYYY-MM-DD').format('ddd D MMM')}` : `Wk ${week + 1}`;
      const move = lowest ? `; the easiest to move: ${lowest.id || planClip(planText(lowest.raw), 30)}${lowest.priority !== 2 ? ` (${PLAN_PRIORITIES.find((p) => p[0] === lowest.priority)[2].toLowerCase()} priority)` : ''}` : '';
      return `${name} has ${days} days of work in ${when} (${avail} available)${move}`;
    });
  },
  /** "👤 Marcus, Sofia" for a card or row, or ''. */
  ownerText(t) {
    return (t.owners || []).length ? `👤 ${t.owners.map((o) => o.name).join(', ')}` : '';
  },
});
