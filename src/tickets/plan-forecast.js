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

/**
 * Schedule warnings (pure): a task planned to finish after its 📅 date, due before a task it depends on, or in
 * progress past its planned finish. ends: Map task → planned last day (the plan with real dates), or none. Returns
 * [{ task, text }] in the plan's order.
 */
function planWarnings(tasks, ends, today) {
  const { byId } = planIndex(tasks);
  const name = (t) => t.id || planClip(planText(t.raw), 30);
  const out = [];
  for (const t of tasks) {
    if (t.external || planClosed(t)) continue;
    const end = ends && ends.get(t);
    if (end && t.due && end > t.due && !t.milestone) out.push({ task: t, text: `${name(t)}: planned to finish ${planShortDate(end)}, ${planWorkdaysBetween(t.due, end)} working days after its 📅 ${planShortDate(t.due)}` });
    for (const d of t.deps) {
      const x = byId.get(d);
      if (x && t.due && x.due && t.due < x.due) out.push({ task: t, text: `${name(t)}: 📅 ${planShortDate(t.due)} is before ${name(x)}'s 📅 ${planShortDate(x.due)}, which it waits for` });
    }
    if (t.status === 'doing' && end && today && end < today) out.push({ task: t, text: `${name(t)}: in progress, planned to finish ${planShortDate(end)}` });
  }
  return out;
}

Object.assign(PlanView.prototype, {
  /** Gantt: Tasks / Phases; Report; Dates… (the baseline is automatic: see plan-baseline.js and the ⋯ menu). */
  buildForecastTools(tools) {
    this.phasesOnlyEl = pills(tools, [['tasks', 'Tasks'], ['phases', 'Phases']], this.ganttPhases ? 'phases' : 'tasks', (v) => {
      this.ganttPhases = v === 'phases';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    tip(this.phasesOnlyEl.el, 'One bar per phase, or every task');
    this.reportBtn = button(tools, { icon: 'file-output', text: 'Report', cls: 'np-report-btn', title: 'Save a printable report of this plan (a note with the chart) in the reports folder', onClick: () => this.writeReport() });
    this.datesBtn = button(tools, { icon: 'calendar-check', text: 'Dates…', cls: 'np-dates-btn', title: 'Write the planned dates into the tasks (🛫 start, 📅 due), choosing which', onClick: () => new PlanDatesModal(this.app, this).open() });
  },
  syncForecastTools() {
    this.phasesOnlyEl.el.toggleClass('is-hidden', this.mode !== 'gantt');
    this.datesBtn.toggleClass('is-hidden', !this.base);
  },
  /** The plan with real dates (whatever the Dates / Weeks switch): forecast, baseline and slip use it. */
  datedPlan() {
    if (!this.base) return null;
    return planGanttText(this.tasks, { base: this.base, today: this.today, due: this.due });
  },
  baseline() {
    const all = this.plugin.settings.planBaselines || {};
    const b = this.plan && all[this.plan.path];
    return b && b.tasks ? b : null; // { removed } only stops the automatic one coming back
  },
  /** The ⋯ menu: re-baseline (a new plan agreed) or remove the baseline; only with real dates. */
  onPaneMenu(menu, source) {
    ItemView.prototype.onPaneMenu.call(this, menu, source);
    if (!this.plan || !this.base) return;
    const b = this.baseline();
    menu.addItem((i) => i.setSection('action').setTitle(b ? `Re-baseline (replaces the one from ${planShortDate(b.saved)})` : 'Save a baseline now').setIcon('flag').onClick(() => this.saveBaseline()));
    if (b) menu.addItem((i) => i.setSection('action').setTitle('Remove the baseline').setIcon('trash-2').onClick(() => this.saveBaseline(true)));
  },
  async saveBaseline(remove = false) {
    const s = this.plugin.settings;
    s.planBaselines = s.planBaselines || {};
    if (remove) s.planBaselines[this.plan.path] = { removed: this.today }; // not saved again automatically
    else {
      const dated = this.datedPlan();
      if (!dated) return new Notice('Set the project’s started date first');
      s.planBaselines[this.plan.path] = planBaselineOf(dated, this.today);
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
