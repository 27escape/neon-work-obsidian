/* ---- Project plans (fork): keep ⏳ scheduled dates in step with the plan ------------------------------------
 * A per-project choice (the project note's `plan-scheduled: true`, set from the Planning tab's ⋯ menu; off by
 * default). When on, each open task of the project gets ⏳ = the day the plan has it starting, updated whenever the
 * plan moves it, so the Tasks plugin, the Tasks card and calendars show the current plan. Only ⏳ is written: 🛫
 * ("not before") and 📅 (a deadline) are left alone, so the plan keeps flowing and nothing turns overdue because of
 * it. Not while you are typing in that note (it waits until you leave it); one write per note, through the view's
 * edit queue. Kevin, 17 Nov. */

/** The ⏳ dates that differ from the plan (pure): [{ task, date }] for the plan's own open tasks. bars: a dated plan's. */
function planScheduledChanges(tasks, bars) {
  const out = [];
  for (const b of bars || []) {
    const t = b.task;
    if (!t || t.external || planClosed(t) || !tasks.includes(t)) continue;
    if (t.scheduled !== b.start) out.push({ task: t, date: b.start });
  }
  return out;
}
/** The note's text with these tasks' ⏳ set ({ task, date }); tasks not found are left out (pure). */
function planScheduledText(text, changes) {
  let cur = text;
  for (const c of changes) {
    const r = planEditLine(cur, c.task, (rest, box) => ({ rest: planSetSign(rest, '⏳', c.date), box }));
    if (r) cur = r.text;
  }
  return cur;
}
/** Is a project set to keep ⏳ in step? (its note's plan-scheduled property) */
const planKeepsScheduled = (fm) => fm && (fm['plan-scheduled'] === true || String(fm['plan-scheduled']).toLowerCase() === 'true');

Object.assign(PlanView.prototype, {
  keepsScheduled() {
    const f = this.scopeFile();
    return !!f && planKeepsScheduled((this.app.metadataCache.getFileCache(f) || {}).frontmatter);
  },
  /** Turn the choice on or off (a property of the project note). */
  async toggleScheduled() {
    const f = this.scopeFile();
    if (!f) return void new Notice('This project has no note of its own to keep the setting in');
    const on = !this.keepsScheduled();
    try {
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        if (on) fm['plan-scheduled'] = true;
        else delete fm['plan-scheduled'];
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) new Notice('Could not change the setting. Details in the console.');
      return;
    }
    new Notice(on ? 'Planning now keeps ⏳ scheduled dates in step with the plan' : 'Planning no longer writes ⏳ scheduled dates');
    // the property change refreshes the view, which then writes the dates
  },
  /** Write ⏳ where the plan has moved a task (when this project keeps them in step). */
  syncScheduled() {
    if (!this.base || !this.keepsScheduled()) return;
    const dated = this.datedPlan();
    const changes = planScheduledChanges(this.tasks, dated && dated.bars);
    if (!changes.length) return;
    const byFile = new Map();
    for (const c of changes) byFile.set(c.task.file, [...(byFile.get(c.task.file) || []), c]);
    // not while you are typing in that note: wait until you leave it
    const typing = (f) => this.app.workspace.getLeavesOfType('markdown').some((l) => l.view.file === f && l.view.editor && l.view.editor.hasFocus());
    for (const [file, list] of byFile) {
      if (typing(file)) {
        this.scheduledPending = true;
        continue;
      }
      const job = (this.editing || Promise.resolve()).then(() => writeNote(this.app, file, (text) => planScheduledText(text, list)));
      this.editing = job.catch((e) => {
        if (!(e && e.neonReadOnly)) console.error('Planning: could not write ⏳ dates', e);
      });
    }
  },
});
