/* ---- Project plans (fork): the Planning button on project notes, opening the Planning view, a command -----------
 * A note that belongs to a project (a project note, or any note in a project folder) gets buttons in its header:
 * one Planning button. It opens the Planning view in a new tab, on the Gantt chart; the view switches to the board,
 * graph and list. Nothing is added to the note. */

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
    // no default hotkey (community plugin guidelines): set one in Settings › Hotkeys, e.g. Ctrl/Cmd+Shift+G
    cmd('plan-gantt', 'Project: open Planning', 'gantt');
    // fork: the task editor from a project note's right-click menu (the task under the cursor, or a new one)
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const file = info && info.file;
        const scope = file && planScopeOf(this.app, file);
        if (!scope) return;
        const n = editor.getCursor().line;
        const t = planTask(editor.getLine(n));
        const isTask = !!t && (!!t.id || planHasTag(t.raw, NEON_PLAN.taskTag));
        menu.addItem((i) =>
          i
            .setTitle(isTask ? 'Planning: edit this task' : 'Planning: new task here')
            .setIcon('calendar-range')
            .onClick(() => this.openTaskEditor({ scope, file, line: isTask ? n : null, at: n })),
        );
        if (isTask) menu.addItem((i) => i.setTitle('Planning: new task after this').setIcon('list-plus').onClick(() => this.openTaskEditor({ scope, file, afterLine: n })));
      }),
    );
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
      // fork: one button with a word beside its icon, so it is easy to spot
      const e = v.addAction('calendar-range', 'Planning: Gantt chart, board, graph and task list', () => this.openPlan(scope, 'gantt'));
      e.addClass('np-action');
      e.createSpan({ cls: 'np-action-label', text: 'Planning' });
      const els = [e];
      this.planButtons.set(v, { key, els });
    }
  },
  clearPlanButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const had = this.planButtons && this.planButtons.get(leaf.view);
      if (had) had.els.forEach((e) => e.remove());
    }
  },
  /**
   * Opens the task editor: the task on `line` of `file`, or a new task (its phase: the heading above `at`).
   * view: the Planning view it came from (its tasks are used, and it is refreshed after saving).
   */
  async openTaskEditor({ scope, file, line = null, at = null, phase = null, view = null, after = null, afterLine = null }) {
    const tasks = view ? view.tasks : await planCollect(this.app, scope);
    const open = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === file && l.view.editor);
    const text = open ? open.view.editor.getValue() : await this.app.vault.cachedRead(file);
    const lines = text.split('\n');
    const above = (n) => (planHeadings(lines).filter((h) => h.line < n).pop() || {}).text || '';
    let task = null;
    if (line != null) {
      const want = planTask(lines[line]);
      task = tasks.find((t) => t.file === file && t.line === line && want && t.raw === want.raw) || (want && tasks.find((t) => t.file === file && (want.id ? t.id === want.id : t.raw === want.raw))) || null;
      if (!task && want) task = Object.assign(want, { file, line, phase: above(line) }); // not read into the plan yet
    }
    if (afterLine != null && !after) {
      // a new task straight after the task on that line
      const want = planTask(lines[afterLine]);
      after = (want && tasks.find((t) => t.file === file && (want.id ? t.id === want.id : t.raw === want.raw))) || (want ? Object.assign(want, { file, line: afterLine, phase: above(afterLine) }) : null);
    }
    new PlanTaskModal(this.app, {
      scope,
      file,
      text,
      tasks: task && !tasks.includes(task) ? [...tasks, task] : tasks,
      task,
      after,
      phase: phase != null ? phase : at != null ? above(at + 1) : '',
      base: planBaseDate(this.app, scope),
      onSaved: (id) => view && view.selectSaved(id),
    }).open();
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
