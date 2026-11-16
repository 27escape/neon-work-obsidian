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
      const job = planCollect(this.app, scope, { neighbours: false })
        .then((tasks) => planCounts(tasks, today))
        .catch((e) => {
          console.error('Projects: could not read the project tasks', e);
          return null;
        });
      this.planCache.set(key, job);
    }
    return this.planCache.get(key);
  },
  /** Adds the counts to a row once read; short: only overdue and due this week. */
  renderPlanSummary(el, t, short = false) {
    this.planSummary(t).then((c) => {
      const text = planSummaryText(c, short);
      if (!text || !el.isConnected) return;
      const s = el.createSpan({ cls: `tk-age tk-plan${c.overdue ? ' is-overdue' : ''}${short ? ' is-short' : ''}`, text: short ? ` · ${text}` : text });
      tip(s, 'This project’s tasks (ready: nothing it depends on is still open)');
    });
  },
});
