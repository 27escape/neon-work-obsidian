/* ---- All projects in one view (fork): the Projects tab's timeline, drawn by the plugin --------------------------
 * One row per project, grouped by customer: a bar from its start to its plan's forecast finish (else its due date, or
 * its closing date once closed), a hollow diamond on its due date, coloured by how it stands. Drawn with the Planning
 * view's Gantt (planGanttLayout / planDrawGantt), since Obsidian's chart engine takes no colours per bar. A click
 * opens the project's Planning view (Ctrl/Cmd-click: its note). */

// colours by how a project stands (the kinds reuse the plan colours)
const PROJECT_KEY = [
  ['overdue', 'Late (forecast after due, or past due)'],
  ['soon', 'Needs attention (overdue or blocked tasks)'],
  ['doing', 'In progress'],
  ['ready', 'Not started'],
  ['waiting', 'On hold'],
  ['done', 'Closed'],
];

/**
 * Rows for the drawn timeline (pure). sums: Map note path → the project's plan summary (planCounts + end, late), or
 * nothing yet. win: { from, to } or null. One section per customer, one bar per project.
 */
function projectTimelineRows(items, sums, win) {
  const d = (m) => (m && m.format ? m.format('YYYY-MM-DD') : m || null);
  const inWin = (x) => !win || (x >= win.from && x <= win.to);
  const rows = [];
  for (const [, name, list] of projectGroups(items, 'customer')) {
    const sec = [];
    for (const t of list) {
      const c = sums.get(t.file.path) || null;
      const closed = t.status === 'done';
      let start = d(t.startedOn || t.created);
      if (!start) continue;
      let end = closed ? d(t.completed) || d(t.due) || start : (c && c.end) || d(t.due) || start;
      if (end < start) end = start;
      const due = closed ? null : d(t.due);
      if (win && (end < win.from || start > win.to) && !(due && inWin(due))) continue;
      if (win) {
        if (start < win.from) start = win.from;
        if (end > win.to) end = win.to;
        if (end < start) end = start;
      }
      const kind = closed ? 'done' : (c && c.late) || t.bucket === 'overdue' ? 'overdue' : c && (c.overdue || c.blocked) ? 'soon' : t.status === 'waiting' ? 'waiting' : t.status === 'in-progress' ? 'doing' : 'ready';
      const note = closed ? t.statusRaw || 'closed' : [c && c.late ? `${c.late} working day${c.late === 1 ? '' : 's'} late` : '', c ? planSummaryText(c, true) : ''].filter(Boolean).join(' · ');
      const bar = { id: '', task: null, project: t, hasPlan: !!(c && c.total), kind, crit: false, mark: null, start, end, due: due && inWin(due) ? due : null };
      sec.push({ bar, label: t.title, who: note, milestone: false, thin: false });
    }
    if (sec.length) rows.push({ section: name || 'No customer' }, ...sec);
  }
  return rows;
}

Object.assign(ProjectsView.prototype, {
  /** The timeline above the list, for the projects the list shows (same filter and search). */
  showTimeline(items) {
    const p = this.plugin;
    this.timelineItems = items;
    if (!this.tl) {
      const el = this.timelineEl;
      el.empty();
      const bar = el.createDiv('nd-timeline-bar');
      const zoom = pills(bar, GANTT_ZOOMS, p.settings.timelineZoom || '12m', (z) => {
        p.settings.timelineZoom = z || '12m';
        p.saveSettings();
        this.drawTimeline();
      }, 'nd-timeline-zoom');
      const key = el.createDiv('np-legend tk-tl-key');
      for (const [kind, label] of PROJECT_KEY) {
        const k = key.createSpan('np-key');
        k.createSpan({ cls: 'np-swatch' }).style.backgroundColor = planColour(kind);
        k.createSpan({ text: label });
      }
      key.createSpan({ cls: 'np-key', text: '◇ due date' });
      this.tl = { zoom, chart: el.createDiv('np-chart tk-tl-chart'), sums: new Map() };
    }
    this.drawTimeline();
    // the plans' forecasts come in a moment later: draw again with them
    const token = (this.tlToken = {});
    Promise.all(items.map((t) => p.planSummary(t).then((c) => [t.file.path, c]))).then((pairs) => {
      if (this.tlToken !== token || !this.tl) return;
      this.tl.sums = new Map(pairs.filter(([, c]) => c));
      this.drawTimeline();
    });
  },
  drawTimeline() {
    const p = this.plugin;
    const { chart, sums } = this.tl;
    const today = moment().format('YYYY-MM-DD');
    const win = ganttWindow(p.settings.timelineZoom || '12m', today);
    const rows = projectTimelineRows(this.timelineItems || [], sums, win);
    chart.empty();
    const lay = rows.length ? planGanttLayout(rows, { today, width: chart.clientWidth || this.timelineEl.clientWidth || 900, labelW: 320, minDay: 1, maxDay: 24 }) : null;
    if (!lay) emptyState(chart, 'No projects with dates in this window');
    else
      planDrawGantt(chart, lay, {
        colours: planColourMap(),
        onBar: (e, b) => {
          const t = b.project;
          if (e.ctrlKey || e.metaKey || !b.hasPlan) return p.openProject(t.file, e);
          p.openPlan(p.planScope(t), 'gantt');
        },
      });
    if (this.fitIsland) this.fitIsland();
  },
});
