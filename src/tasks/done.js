/* ---- finished tasks, read from your notes (fork) ------------------------------------
 * Recently done, the "tasks done" fact and the weekly review count tasks ticked anywhere in Obsidian
 * (editor, Tasks plugin, these cards): a ticked line with a ✅ date. Read only, nothing is logged. */
const DONE_TASK_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s+(.*)$/;
const DONE_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const DONE_DAYS = 42; // the card shows 14 days; weekly reviews may look back a few weeks

/** A ticked task line → { date, raw }, or null (not ticked, or no ✅ date). */
function doneTaskOf(line) {
  const m = String(line || '').replace(/\r$/, '').match(DONE_TASK_RE);
  if (!m || !m[1].trim()) return null;
  const d = m[1].match(DONE_DATE_RE);
  return d ? { date: d[1], raw: m[1] } : null;
}

Object.assign(NeonTasks.prototype, {
  /** Ticked tasks with a ✅ date in the last DONE_DAYS days, newest first. */
  async scanDone() {
    const app = this.app;
    const cut = moment().startOf('day').subtract(DONE_DAYS, 'days');
    const cutKey = cut.format('YYYY-MM-DD');
    const deck = neonPlugin(app, 'neon-deck');
    const tag = (this.settings.taskTag || '').trim();
    const todo = this.quickPath();
    const out = [];
    for (const { file: f, cache } of noteIndex(app).withDoneTasks(cut.valueOf())) {
      if (this.isLegacyTicket(cache)) continue;
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of cache.listItems) {
        if (li.task !== 'x' && li.task !== 'X') continue;
        const d = doneTaskOf(lines[li.position.start.line]);
        if (!d || d.date < cutKey) continue;
        out.push({ date: d.date, text: taskDisplay(d.raw, tag), path: f.path, src: f.path === todo ? 'Todo' : f.basename, line: li.position.start.line });
      }
    }
    out.sort((a, b) => b.date.localeCompare(a.date) || a.src.localeCompare(b.src) || a.line - b.line);
    const sig = out.map((x) => `${x.date}|${x.path}|${x.line}|${x.text}`).join('\n');
    this.doneTasks = out;
    if (sig === this.doneSig) return;
    this.doneSig = sig;
    const api = deckApi(app);
    if (api) {
      if (api.activityChanged) api.activityChanged();
      if (api.factsChanged) api.factsChanged();
    }
  },
  /** Recently done rows for the dashboard. */
  doneActivity() {
    return (this.doneTasks || []).map((x) => {
      const f = this.app.vault.getAbstractFileByPath(x.path);
      return { t: moment(x.date, 'YYYY-MM-DD').valueOf(), allDay: true, kind: 'task', text: x.text, src: x.src, open: f ? (e) => openFile(this.app, f, e) : null };
    });
  },
  /** Tasks ticked between two moments (by their ✅ date). */
  doneBetween(start, end) {
    const a = start.format('YYYY-MM-DD');
    const b = end.format('YYYY-MM-DD');
    return (this.doneTasks || []).filter((x) => x.date >= a && x.date < b).length;
  },
});
