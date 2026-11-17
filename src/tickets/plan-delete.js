/* ---- Project plans (fork): cancel or delete a task -----------------------------------------------------------
 * From the task editor (and the task menu). Cancel marks it [-] with today's ❌ date: the line, its steps and its
 * history stay, and a cancelled task takes no time, so nothing has to change elsewhere. Delete removes the line and
 * the steps under it, and takes its id out of the ⛔ / starts-with / ends-with links of the tasks that depend on it
 * (in any note of the plan), after a confirmation that lists all of that. Both go through writeNote (read-only
 * blocks them; Ctrl+Z in an open note brings them back), and the Planning view's Undo puts the last one back. */

/** The text without a task's line and the lines under it (its steps, notes): { text, removed, at } or null (pure). */
function planDeleteText(text, t) {
  const lines = text.split('\n');
  const n = planFindLine(lines, t);
  if (n < 0) return null;
  const end = planBelow(lines, n);
  const removed = lines.splice(n, end - n);
  return { text: lines.join('\n'), removed, at: n };
}
/** A task's line with one id taken out of all its links (⛔, starts-with, ends-with) (pure). */
const planUnlinkRest = (rest, id) => planLinkRest(planLinkRest(planDepsRest(rest, [], [id]), 'ss', [], [id]), 'ff', [], [id]);
/** A task's line marked cancelled today: ❌, and no ✅ (pure). */
const planCancelRest = (rest, today) => `${planSetSign(planSetSign(rest, '✅', null), '❌', null).trim()} ❌ ${today}`;

/** What deleting a task would touch: the tasks linked to it, and its steps. */
function planDeleteImpact(t, tasks) {
  const dependants = t.id ? tasks.filter((x) => x !== t && planLinkIds(x).includes(t.id)) : [];
  return { dependants, steps: t.steps || null };
}

/** The delete confirmation: what goes, what changes, and a way to cancel the task instead. */
class PlanDeleteModal extends Modal {
  constructor(app, { task, impact, onDelete, onCancelTask }) {
    super(app);
    Object.assign(this, { task, impact, onDelete, onCancelTask });
  }
  onOpen() {
    const t = this.task;
    const { dependants, steps } = this.impact;
    this.modalEl.addClass('nd-modal', 'np-delete-modal');
    this.titleEl.setText('Delete this task?');
    this.contentEl.createEl('p', { cls: 'np-del-name', text: `${t.id ? `${t.id} · ` : ''}${planText(t.raw)}` });
    const ul = this.contentEl.createEl('ul');
    ul.createEl('li', { text: 'Its line is removed from the note.' });
    if (steps) ul.createEl('li', { text: `Its ${steps.total} step${steps.total === 1 ? '' : 's'} (${steps.done} done) and anything else under it go too.` });
    if (dependants.length) ul.createEl('li', { text: `${dependants.length} task${dependants.length === 1 ? ' depends' : 's depend'} on it: ${planAnd(dependants.map(planProblemName))}. Their links to it are removed.` });
    if (t.milestone) ul.createEl('li', { text: 'It is a milestone: check nothing outside the plan refers to it.' });
    const mark = planMark(t);
    if (mark) ul.createEl('li', { text: `It is marked as ${mark[2].toLowerCase()} (${mark[1]}): the report and the List won't show it any more.` });
    this.contentEl.createEl('p', { cls: 'setting-item-description', text: 'Cancelling keeps the line (and its history) marked ❌ instead; a cancelled task takes no time in the plan.' });
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Keep it', onClick: () => this.close() });
    if (t.status !== 'cancelled')
      button(row, { text: 'Cancel the task instead', cls: 'mod-cta', onClick: () => (this.close(), this.onCancelTask()) });
    button(row, { text: 'Delete', cls: 'mod-warning', onClick: () => (this.close(), this.onDelete()) });
  }
  onClose() {
    this.contentEl.empty();
  }
}

Object.assign(NeonProjects.prototype, {
  /** Cancel a task: [-] and ❌ today. view: the Planning view (for Undo). */
  async cancelPlanTask(t, view = null) {
    const before = { t, raw: t.raw, box: t.box };
    const today = moment().format('YYYY-MM-DD');
    let res = null;
    try {
      await writeNote(this.app, t.file, (text) => {
        res = planEditLine(text, t, (rest) => ({ rest: planCancelRest(rest, today), box: '-' }));
        return res ? res.text : text;
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not cancel the task', e);
        new Notice('Could not cancel the task. Details in the console.');
      }
      return false;
    }
    if (!res) {
      new Notice('That task changed in the note: open it again');
      return false;
    }
    Object.assign(t, planTask(`- [-] ${res.raw}`, { file: t.file, line: res.line, phase: t.phase }) || {});
    new Notice(`Cancelled: ${planClip(planText(t.raw), 50)}`);
    if (view) {
      view.lastChange = { label: `cancel “${planClip(planText(t.raw), 30)}”`, before: [before] };
      view.syncUndo();
      view.render();
    }
    return true;
  },
  /** Ask, then delete a task (its line and steps) and its id from the tasks linked to it. */
  confirmDeleteTask(t, tasks, view = null, after = null) {
    new PlanDeleteModal(this.app, {
      task: t,
      impact: planDeleteImpact(t, tasks),
      onCancelTask: async () => (await this.cancelPlanTask(t, view)) && after && after(),
      onDelete: async () => (await this.deletePlanTask(t, tasks, view)) && after && after(),
    }).open();
  },
  async deletePlanTask(t, tasks, view = null) {
    const { dependants } = planDeleteImpact(t, tasks);
    const undo = { lines: null, at: -1, next: null, links: [] };
    try {
      // the links first, note by note (the task's own note last: its line goes at the end)
      for (const d of dependants) {
        const raw = d.raw;
        let res = null;
        await writeNote(this.app, d.file, (text) => {
          res = planEditLine(text, d, (rest, box) => ({ rest: planUnlinkRest(rest, t.id).replace(/\s{2,}/g, ' ').trim(), box }));
          return res ? res.text : text;
        });
        if (res) undo.links.push({ file: d.file, now: res.raw, box: res.box, raw });
      }
      let gone = null;
      await writeNote(this.app, t.file, (text) => {
        gone = planDeleteText(text, t);
        if (gone) {
          const lines = text.split('\n');
          undo.next = lines[gone.at + gone.removed.length] ?? null; // the line after it, to find the place again
        }
        return gone ? gone.text : text;
      });
      if (!gone) return void new Notice('That task changed in the note: nothing deleted. Open it again.');
      Object.assign(undo, { lines: gone.removed, at: gone.at, file: t.file });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not delete the task', e);
        new Notice('Could not delete the task. Details in the console.');
      }
      return false;
    }
    new Notice(`Deleted: ${planClip(planText(t.raw), 50)}${dependants.length ? ` (and its links from ${dependants.length} task${dependants.length === 1 ? '' : 's'})` : ''}`);
    if (view) {
      view.lastChange = { label: `delete “${planClip(planText(t.raw), 30)}”`, restore: () => this.undoDelete(undo) };
      view.syncUndo();
      view.refresh();
    }
    return true;
  },
  /** Put a deleted task back: its lines where they were (found by the line that followed them), then its links. */
  async undoDelete(u) {
    await writeNote(this.app, u.file, (text) => {
      const lines = text.split('\n');
      let at = u.next == null ? lines.length : lines.indexOf(u.next, Math.max(0, u.at - 5));
      if (at < 0) at = Math.min(u.at, lines.length);
      lines.splice(at, 0, ...u.lines);
      return lines.join('\n');
    });
    for (const l of u.links)
      await writeNote(this.app, l.file, (text) => {
        const res = planEditLine(text, { raw: l.now, id: null }, () => ({ rest: l.raw, box: l.box }));
        return res ? res.text : text;
      });
  },
});
