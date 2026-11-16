/* ---- Project plans (fork): buttons on project notes, opening the Plan view, commands ---------------------------
 * A note that belongs to a project (a project note, or any note in a project folder) gets buttons in its header:
 * Gantt chart and task list. They open the Plan view in a new tab; nothing is added to the note. */

Object.assign(NeonProjects.prototype, {
  hookPlans() {
    this.registerView(VIEW_PLAN, (leaf) => new PlanView(leaf, this));
    this.planButtons = new WeakMap();
    const sync = debounce(() => this.syncPlanButtons(), 300, true);
    this.registerEvent(this.app.workspace.on('layout-change', sync));
    this.registerEvent(this.app.workspace.on('file-open', sync));
    this.registerEvent(this.app.metadataCache.on('changed', sync)); // a note tagged as a project gets its buttons
    this.app.workspace.onLayoutReady(() => this.syncPlanButtons());
    this.register(() => this.clearPlanButtons());
    const cmd = (id, name, mode) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const f = this.app.workspace.getActiveFile();
          const scope = f && planScopeOf(this.app, f);
          if (!scope) return false;
          if (!checking) this.openPlan(scope, mode);
          return true;
        },
      });
    cmd('plan-gantt', 'Project: open the plan as a Gantt chart', 'gantt');
    cmd('plan-list', 'Project: open the plan as a task list', 'list');
  },
  /** Adds or removes the header buttons so they match each open note. */
  syncPlanButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const v = leaf.view;
      if (!v || typeof v.addAction !== 'function') continue;
      const scope = v.file ? planScopeOf(this.app, v.file) : null;
      const key = scope ? `${scope.kind}:${scope.path}` : '';
      const had = this.planButtons.get(v);
      if ((had ? had.key : '') === key) continue;
      if (had) had.els.forEach((e) => e.remove());
      this.planButtons.delete(v);
      if (!scope) continue;
      const els = [v.addAction('list-checks', 'Plan: task list', () => this.openPlan(scope, 'list')), v.addAction('calendar-range', 'Plan: Gantt chart', () => this.openPlan(scope, 'gantt'))];
      // fork: a word beside each icon, so the buttons are easy to spot
      els.forEach((e, i) => {
        e.addClass('np-action');
        e.createSpan({ cls: 'np-action-label', text: i ? 'Gantt' : 'List' });
      });
      this.planButtons.set(v, { key, els });
    }
  },
  clearPlanButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const had = this.planButtons && this.planButtons.get(leaf.view);
      if (had) had.els.forEach((e) => e.remove());
    }
  },
  /** Opens the plan in a tab: the one already showing this plan, else a new tab. */
  async openPlan(scope, mode = 'gantt') {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_PLAN).find((l) => l.view && l.view.plan && l.view.plan.path === scope.path);
    if (!leaf) leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_PLAN, active: true, state: { kind: scope.kind, path: scope.path, mode } });
    ws.revealLeaf(leaf);
  },
});
