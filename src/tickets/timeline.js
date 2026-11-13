/* ---- Projects timeline (fork): the projects as a Mermaid Gantt chart ---------------- */

/**
 * Mermaid text for projects (pure). One section per customer; a bar from started (else created) to due,
 * or to the completed / cancelled date once closed; a project without a due date is a milestone at its start.
 * Closed → done, active → active, overdue → crit. `p` items need: title, customer, status, bucket,
 * startedOn / created / due / completed as moments (or anything with .format).
 */
function projectGanttText(items, zoom, today) {
  const d = (m) => (m && m.format ? m.format('YYYY-MM-DD') : m || '');
  const sections = projectGroups(items, 'customer').map(([, name, list]) => ({
    name,
    items: list.map((t) => {
      const start = d(t.startedOn || t.created);
      const end = t.status === 'done' ? d(t.completed) || d(t.due) : d(t.due);
      const tags = t.status === 'done' ? ['done'] : t.bucket === 'overdue' ? ['crit'] : t.status === 'in-progress' ? ['active'] : [];
      return { name: t.statusRaw ? `${t.title} (${t.statusRaw})` : t.title, start, end, tags };
    }),
  }));
  return ganttText({ sections, window: ganttWindow(zoom, today), today });
}

Object.assign(ProjectsView.prototype, {
  /** The timeline above the list, for the projects the list shows (same filter and search). */
  showTimeline(items) {
    const p = this.plugin;
    this.timelineItems = items;
    if (!this.timeline) {
      this.timeline = timelinePanel(this.app, this.timelineEl, this, {
        zoom: p.settings.timelineZoom || '12m',
        onZoom: (z) => ((p.settings.timelineZoom = z), p.saveSettings()),
        build: (zoom) => projectGanttText(this.timelineItems || [], zoom, moment().format('YYYY-MM-DD')),
        empty: 'No projects with dates in this window',
      });
    } else this.timeline.redraw();
  },
});
