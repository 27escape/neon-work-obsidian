/* ---- Project plans (fork): owners in the Planning view -------------------------------------------------------------
 * Owners come from [owner:: [[@Sam Taylor]], Alex] (people notes or plain names). The view can show one person's
 * tasks (the Gantt, board and list leave the others out; the graph greys them), group the board by person, and
 * warns when someone has more than five days of work in a week. */

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
  loadLines(sched) {
    const weeks = this.weeks || !this.base;
    return planOverloads(sched.rows).map(({ name, week, days, lowest }) => {
      const when = weeks ? `Wk ${week + 1}` : `the week of ${planDayLabel(week * 5, this.base, false)}`;
      const move = lowest ? `; the easiest to move: ${lowest.id || planClip(planText(lowest.raw), 30)}${lowest.priority !== 2 ? ` (${PLAN_PRIORITIES.find((p) => p[0] === lowest.priority)[2].toLowerCase()} priority)` : ''}` : '';
      return `${name} has ${days} days of work in ${when} (5 available)${move}`;
    });
  },
  /** "👤 Marcus, Sofia" for a card or row, or ''. */
  ownerText(t) {
    return (t.owners || []).length ? `👤 ${t.owners.map((o) => o.name).join(', ')}` : '';
  },
});
