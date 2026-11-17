/* ---- Project plans (fork): automatic baselines -------------------------------------------------------------
 * A baseline is today's planned finish of every task, kept so the Planning view can show later how far tasks have
 * slipped (the List's Slip column, "+N since the baseline" after the forecast). It is saved automatically the first
 * time a project is seen started (its status is in progress or on hold) with a started date and plan tasks. While
 * an open task still has no duration the baseline is provisional: it follows every change to the plan, and locks
 * once every open task has a duration (Kevin's choice, 17 Nov). The Planning view's ⋯ menu locks it early,
 * re-baselines it (a new plan agreed: locked) or removes it. Baselines live in the plugin's own
 * settings, one per project path (no files in the vault): they follow a renamed or moved project, and those of
 * projects that no longer exist are dropped on start. */

/** Is the plan still missing durations (an open task of its own, not a milestone, with none)? */
function planIncomplete(tasks) {
  return tasks.some((t) => !t.external && !t.milestone && t.days == null && t.status !== 'done' && t.status !== 'cancelled');
}
/** The baseline of a dated plan (planGanttText with a base date): { saved, end, tasks: { id: finish }, provisional }. */
function planBaselineOf(dated, today, provisional = false) {
  const tasks = {};
  for (const b of dated.bars || []) if (b.task && b.task.id && !b.task.external) tasks[b.task.id] = b.end;
  return { saved: today, end: dated.end || null, tasks, provisional: !!provisional };
}
/** Same plan (end and every task's finish)? Then a provisional baseline needn't be saved again. */
function planBaselineSame(a, b) {
  return !!a && !!b && a.end === b.end && !!a.provisional === !!b.provisional && JSON.stringify(a.tasks) === JSON.stringify(b.tasks);
}
/** Baselines after a rename: the note's own key, or every key inside a renamed folder. Returns true when changed. */
function planBaselineMove(all, from, to) {
  let changed = false;
  for (const key of Object.keys(all || {})) {
    let next = null;
    if (key === from) next = to;
    else if (key.startsWith(from + '/')) next = to + key.slice(from.length);
    if (next && next !== key) {
      all[next] = all[key];
      delete all[key];
      changed = true;
    }
  }
  return changed;
}
/** Drop the baselines whose project no longer exists. Returns true when any were dropped. */
function planBaselinePrune(all, exists) {
  let changed = false;
  for (const key of Object.keys(all || {}))
    if (!exists(key)) {
      delete all[key];
      changed = true;
    }
  return changed;
}
/** Is the project under way (so its plan is agreed)? Not before it starts, and not once it is done. */
function planIsStarted(t) {
  return !!t && (t.status === 'in-progress' || t.status === 'waiting');
}

Object.assign(NeonProjects.prototype, {
  /** Keep baselines with their projects: follow renames, drop the gone ones once the vault is indexed. */
  hookBaselines() {
    const s = this.settings;
    this.registerEvent(
      this.app.vault.on('rename', (f, old) => {
        if (planBaselineMove(s.planBaselines, old, f.path)) this.saveSettings();
      }),
    );
    const ref = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(ref);
      if (planBaselinePrune(s.planBaselines, (p) => !!this.app.vault.getAbstractFileByPath(p))) this.saveSettings();
      this.autoBaselines();
    });
    this.registerEvent(ref);
    this.autoBaselinesSoon = debounce(() => this.autoBaselines(), 5000, true);
  },
  /** Save a baseline for every started project with a started date and plan tasks that has none yet, and follow
   *  the plan with the provisional ones (locking them once every open task has a duration). */
  async autoBaselines() {
    if (this.baselining) return;
    this.baselining = true;
    try {
      const all = (this.settings.planBaselines = this.settings.planBaselines || {});
      const today = moment().format('YYYY-MM-DD');
      let saved = 0;
      for (const t of this.collectProjects()) {
        if (!planIsStarted(t) || !t.startedOn) continue;
        const scope = this.planScope(t);
        const old = all[scope.path];
        if (old && !old.provisional) continue; // locked, or removed ({ removed })
        const tasks = await planCollect(this.app, scope);
        if (!tasks.some((x) => x.id && !x.external)) continue;
        const base = planBaseDate(this.app, scope);
        if (!base) continue;
        const next = planBaselineOf(planGanttText(tasks, { base, today, due: planDueDate(this.app, scope) }), today, planIncomplete(tasks));
        if (planBaselineSame(old, next)) continue;
        all[scope.path] = next;
        saved++;
      }
      if (saved) {
        await this.saveSettings(); // the plugin's own data, not the notes
        this.app.workspace.getLeavesOfType(VIEW_PLAN).forEach((l) => l.view && l.view.render && l.view.render());
      }
    } catch (e) {
      console.error(`${appName()} – Projects: automatic baseline`, e);
    } finally {
      this.baselining = false;
    }
  },
});
