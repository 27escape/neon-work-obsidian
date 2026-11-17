/* ---- Tasks timeline (fork): due-dated tasks as a Gantt chart, drawn by the plugin (shared plan-draw.js) -------- */
const TASK_TIMELINE_MAX = 60; // rows; more than this stops being readable

// the timeline's colours: [kind, label]
const TASK_TL_KEY = [
  ['overdue', 'Overdue'],
  ['soon', 'Due within a week'],
  ['doing', 'In progress'],
  ['ready', 'Open'],
];

/**
 * Rows for the drawn timeline (pure): one section per note (nearest first), a bar from 🛫 start to 📅 due, else a
 * diamond on the due date; coloured overdue, due within a week, in progress or open. win: { from, to } or null.
 */
function taskTimelineRows(tasks, win, today) {
  const week = ymdAdd(today, 7);
  const dated = tasks.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, TASK_TIMELINE_MAX);
  const by = new Map();
  for (const t of dated) {
    const start0 = (String(t.raw || '').match(/🛫\s*(\d{4}-\d{2}-\d{2})/u) || [])[1];
    let start = start0 && start0 < t.due ? start0 : t.due;
    let end = t.due;
    if (win && (end < win.from || start > win.to)) continue;
    if (win && start < win.from) start = win.from;
    if (win && end > win.to) end = win.to;
    const kind = t.group === 'overdue' || t.due < today ? 'overdue' : t.doing ? 'doing' : t.due <= week ? 'soon' : 'ready';
    const note = t.file && t.file.basename ? t.file.basename : 'Tasks';
    if (!by.has(note)) by.set(note, []);
    by.get(note).push({ bar: { id: '', task: t, kind, crit: false, mark: null, start, end }, label: t.display || t.raw, who: '', milestone: start === end && !start0, thin: false });
  }
  const rows = [];
  for (const [note, list] of by) rows.push({ section: note }, ...list);
  return rows;
}

Object.assign(TasksView.prototype, {
  /** The timeline card across the top of the Tasks tab: dated tasks, drawn by the plugin; a click opens the task. */
  mountTimeline(grid) {
    const p = this.plugin;
    const card = widget(grid, 'nt-view-card nt-view-timeline', 'Timeline', 'calendar-range', 'Open tasks with a due date, by note');
    let items = [];
    const bar = card.body.createDiv('nd-timeline-bar');
    pills(bar, GANTT_ZOOMS, p.settings.timelineZoom || '3m', (z) => {
      p.settings.timelineZoom = z || '3m';
      p.saveSettings();
      draw();
    }, 'nd-timeline-zoom');
    const key = card.body.createDiv('np-legend nt-tl-key');
    for (const [kind, label] of TASK_TL_KEY) {
      const k = key.createSpan('np-key');
      k.createSpan({ cls: 'np-swatch' }).style.backgroundColor = planColour(kind);
      k.createSpan({ text: label });
    }
    const chart = card.body.createDiv('np-chart nt-tl-chart');
    const draw = () => {
      const today = moment().format('YYYY-MM-DD');
      const rows = taskTimelineRows(items, ganttWindow(p.settings.timelineZoom || '3m', today), today);
      chart.empty();
      const lay = rows.length ? planGanttLayout(rows, { today, width: chart.clientWidth || card.body.clientWidth || 900, labelW: 300, minDay: 1, maxDay: 30 }) : null;
      if (!lay) return void emptyState(chart, 'No open tasks with a due date in this window');
      planDrawGantt(chart, lay, { colours: planColourMap(), onBar: (e, b) => openFile(this.app, b.task.file, e, b.task.line) });
    };
    const refresh = async () => {
      items = await p.collectTasks();
      draw();
    };
    const soon = debounce(refresh, 500, true);
    this.register(p.onChange(soon));
    refresh();
  },
});
