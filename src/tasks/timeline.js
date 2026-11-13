/* ---- Tasks timeline (fork): due-dated tasks as a Mermaid Gantt chart ---------------- */
const TASK_TIMELINE_MAX = 60; // rows; more than this stops being readable

/**
 * Mermaid text for tasks (pure). Only tasks with a 📅 due (or ⏳ scheduled) date, one section per note,
 * nearest first. A task with a 🛫 start before its date is a bar, any other task a milestone on its date.
 * Overdue → crit, in progress ([/]) → active.
 */
function taskGanttText(tasks, zoom, today) {
  const dated = tasks.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, TASK_TIMELINE_MAX);
  const by = new Map();
  for (const t of dated) {
    const note = t.file && t.file.basename ? t.file.basename : 'Tasks';
    if (!by.has(note)) by.set(note, []);
    const start = (String(t.raw || '').match(/🛫\s*(\d{4}-\d{2}-\d{2})/u) || [])[1];
    by.get(note).push({
      name: t.display || t.raw,
      start: start && start < t.due ? start : t.due,
      end: start && start < t.due ? t.due : null,
      tags: t.group === 'overdue' ? ['crit'] : t.doing ? ['active'] : [],
    });
  }
  return ganttText({ sections: [...by].map(([name, items]) => ({ name, items })), window: ganttWindow(zoom, today), today });
}

Object.assign(TasksView.prototype, {
  /** The timeline card across the top of the Tasks tab. */
  mountTimeline(grid) {
    const p = this.plugin;
    const card = widget(grid, 'nt-view-card nt-view-timeline', 'Timeline', 'calendar-range', 'Open tasks with a due date, by note');
    let items = [];
    const panel = timelinePanel(this.app, card.body, this, {
      zoom: p.settings.timelineZoom || '3m',
      onZoom: (z) => ((p.settings.timelineZoom = z), p.saveSettings()),
      build: (zoom) => taskGanttText(items, zoom, moment().format('YYYY-MM-DD')),
      empty: 'No open tasks with a due date in this window',
    });
    const refresh = async () => {
      items = await p.collectTasks();
      panel.redraw();
    };
    const soon = debounce(refresh, 500, true);
    this.register(p.onChange(soon));
    refresh();
  },
});
