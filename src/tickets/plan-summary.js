/* ---- Project plans (fork): task counts on the project rows ------------------------------------------------------
 * Tasks in project notes don't show on the Tasks card (setting in the Tasks section); each project's row shows how
 * its own tasks stand instead, so nothing overdue goes unseen. Counts are cached until a project note changes. */

Object.assign(NeonProjects.prototype, {
  /** The plan a project row stands for: its folder, else the folder or note its note belongs to. */
  planScope(t) {
    if (t.folder) return { kind: 'folder', path: t.folder };
    return planScopeOf(this.app, t.file) || { kind: 'note', path: t.file.path };
  },
  /** Promise of the project's task counts (planCounts), or null when they can't be read. */
  planSummary(t) {
    const scope = this.planScope(t);
    const key = `${scope.kind}:${scope.path}`;
    if (!this.planCache) this.planCache = new Map();
    if (!this.planCache.has(key)) {
      const today = moment().format('YYYY-MM-DD');
      const ymd = (m) => (m && m.format ? m.format('YYYY-MM-DD') : null);
      const job = planCollect(this.app, scope, { neighbours: false })
        // fork: a link to an id outside the project may be another project's task: look further only then
        .then((tasks) => (planProblems(tasks).some((p) => p.kind === 'missing') ? planCollect(this.app, scope) : tasks))
        .then((tasks) => {
          const c = planCounts(tasks.filter((x) => !x.external), today);
          c.problems = planProblems(tasks).map((p) => p.text); // missing ids, ids used twice, loops
          // the forecast finish against the due date, when the project has a started date
          const base = ymd(t.startedOn);
          const g = base && c.total ? planGanttText(tasks, { base, today, due: ymd(t.due) }) : null;
          return Object.assign(c, { end: g ? g.end : null, late: g ? g.late : 0, due: ymd(t.due) });
        })
        .catch((e) => {
          console.error('Projects: could not read the project tasks', e);
          return null;
        });
      this.planCache.set(key, job);
    }
    return this.planCache.get(key);
  },
  /** Adds the counts to a row once read; short: only overdue and due this week. Plan problems are always shown. */
  renderPlanSummary(el, t, short = false) {
    this.planSummary(t).then((c) => {
      if (!c || !el.isConnected) return;
      const late = c.late ? `${c.late} working day${c.late === 1 ? '' : 's'} late` : '';
      const text = short ? [planSummaryText(c, true), late].filter(Boolean).join(' · ') : [planSummaryText(c), planForecastText(c.end, c.due, c.late)].filter(Boolean).join(' · ');
      if (!text) return;
      const s = el.createSpan({ cls: `tk-age tk-plan${c.overdue || c.late ? ' is-overdue' : ''}${short ? ' is-short' : ''}`, text: short ? ` · ${text}` : text });
      tip(s, 'This project’s tasks (ready: nothing it depends on is still open)');
      if (c.problems && c.problems.length) tip(el.createSpan({ cls: 'tk-age tk-plan is-overdue tk-plan-problems', text: ` · ${planProblemCount(c.problems.length)}` }), c.problems.join('\n'));
    });
  },
  /** The dashboard card's pills: late, overdue, due soon, blocked (only what needs action). */
  renderPlanBadges(el, t) {
    this.planSummary(t).then((c) => {
      if (!c || !el.isConnected) return;
      const pills = [
        [c.late, `${c.late}d late`, 'is-late', `Forecast finish ${c.late} working day${c.late === 1 ? '' : 's'} after the due date`],
        [c.overdue, `${c.overdue} overdue`, 'is-overdue', 'Tasks past their 📅 date'],
        [c.week, `${c.week} due soon`, 'is-soon', 'Tasks due within a week'],
        [c.blocked, `${c.blocked} blocked`, 'is-blocked', 'Tasks held up by an overdue or #blocked task'],
        [(c.problems || []).length, planProblemCount((c.problems || []).length), 'is-problem', `Open Planning to fix:\n${(c.problems || []).join('\n')}`],
      ];
      for (const [n, text, cls, title] of pills) if (n) tip(el.createSpan({ cls: `tk-pill ${cls}`, text }), title);
    });
  },
});
