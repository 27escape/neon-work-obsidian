/* ---- Project plans (fork): forecast finish, baseline, phase bars, markers in the Planning view -----------------------
 * With the project's started date the plan has a forecast finish; against its due date it is on time or N working
 * days late (the Gantt draws both as milestones, the Projects rows say so too). Save baseline keeps today's planned
 * finish of every task with an id in the plugin's own data (not the note); the list then shows how far each has
 * slipped since. The Gantt can show one bar per phase. Tasks tagged #risk, #issue or #decision get a marker. */

/** The project's due date (its `due` property) as YYYY-MM-DD, or null. */
function planDueDate(app, scope) {
  let f = app.vault.getAbstractFileByPath(scope.path);
  if (scope.kind === 'folder') {
    const rep = f instanceof TFolder ? projectFolderNote(app, f) : null;
    f = rep ? rep.file : null;
  }
  const fm = f instanceof TFile ? (app.metadataCache.getFileCache(f) || {}).frontmatter || {} : {};
  const m = String(fm.due || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}
/** Working days from a to b, negative when b is earlier (pure). */
function planSlipDays(a, b) {
  return b >= a ? planWorkdaysBetween(a, b) : -planWorkdaysBetween(b, a);
}
/** "forecast finish 12 Dec, 3 working days late" / "…, 4 days to spare" / "…" (no due date). */
function planForecastText(end, due, late) {
  if (!end) return '';
  if (!due) return `forecast finish ${planShortDate(end)}`;
  if (late) return `forecast finish ${planShortDate(end)}, ${late} working day${late === 1 ? '' : 's'} after the due date`;
  const spare = planWorkdaysBetween(end, due);
  return `forecast finish ${planShortDate(end)}${spare ? `, ${spare} working day${spare === 1 ? '' : 's'} to spare` : ', on the due date'}`;
}
/** "2 risks · 1 issue · 3 decisions", or ''. */
function planMarkText(tasks) {
  return PLAN_MARKS.map(([k, , label]) => {
    const n = tasks.filter((t) => !t.external && !planClosed(t) && (t.marks || []).includes(k)).length;
    return n ? `${n} ${label.toLowerCase()}${n === 1 ? '' : 's'}` : '';
  })
    .filter(Boolean)
    .join(' · ');
}

Object.assign(PlanView.prototype, {
  /** Gantt: Tasks / Phases; Save baseline. */
  buildForecastTools(tools) {
    this.phasesOnlyEl = pills(tools, [['tasks', 'Tasks'], ['phases', 'Phases']], this.ganttPhases ? 'phases' : 'tasks', (v) => {
      this.ganttPhases = v === 'phases';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    tip(this.phasesOnlyEl.el, 'One bar per phase, or every task');
    this.baselineBtn = button(tools, { icon: 'flag', text: 'Baseline', cls: 'np-baseline', title: 'Save today’s plan as the baseline, to see later how far tasks slip', onClick: (e) => this.baselineMenu(e) });
  },
  syncForecastTools() {
    this.phasesOnlyEl.el.toggleClass('is-hidden', this.mode !== 'gantt');
    this.baselineBtn.toggleClass('is-hidden', !this.base);
    this.baselineBtn.toggleClass('is-on', !!this.baseline());
  },
  /** The plan with real dates (whatever the Dates / Weeks switch): forecast, baseline and slip use it. */
  datedPlan() {
    if (!this.base) return null;
    return planGanttText(this.tasks, { base: this.base, today: this.today, due: this.due });
  },
  baseline() {
    const all = this.plugin.settings.planBaselines || {};
    return (this.plan && all[this.plan.path]) || null;
  },
  baselineMenu(e) {
    const m = new Menu();
    const b = this.baseline();
    m.addItem((i) => i.setTitle(b ? `Save a new baseline (the one from ${planShortDate(b.saved)} is replaced)` : 'Save the plan as the baseline').setIcon('flag').onClick(() => this.saveBaseline()));
    if (b) m.addItem((i) => i.setTitle('Remove the baseline').setIcon('trash-2').onClick(() => this.saveBaseline(true)));
    m.showAtMouseEvent(e);
  },
  async saveBaseline(remove = false) {
    const s = this.plugin.settings;
    s.planBaselines = s.planBaselines || {};
    if (remove) delete s.planBaselines[this.plan.path];
    else {
      const dated = this.datedPlan();
      if (!dated) return new Notice('Set the project’s started date first');
      const tasks = {};
      for (const b of dated.bars) if (b.task && b.task.id && !b.task.external) tasks[b.task.id] = b.end;
      s.planBaselines[this.plan.path] = { saved: this.today, end: dated.end, tasks };
    }
    await this.plugin.saveSettings(); // the plugin's own data, not the note
    new Notice(remove ? 'Baseline removed' : 'Baseline saved');
    this.render();
  },
  /** Working days a task has slipped since the baseline (negative: ahead), or null. */
  slip(t) {
    const b = this.baseline();
    const now = this.ends && this.ends.get(t);
    const then = b && t.id && b.tasks[t.id];
    return then && now ? planSlipDays(then, now) : null;
  },
  /** The summary line's forecast part. */
  forecastSummary() {
    const dated = this.dated;
    if (!dated || !dated.end) return '';
    let s = planForecastText(dated.end, this.due, dated.late);
    const b = this.baseline();
    if (b && b.end) {
      const d = planSlipDays(b.end, dated.end);
      s += d ? ` (${d > 0 ? '+' : ''}${d} since the baseline of ${planShortDate(b.saved)})` : ` (as the baseline of ${planShortDate(b.saved)})`;
    }
    return s;
  },
});
