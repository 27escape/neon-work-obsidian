Object.assign(NeonProjects.prototype, {
  /* collecting ------------------------------------------------------------- */
  /** Every project note (excluded folders skipped), cached until a project note changes or the day turns. */
  collectProjects() {
    if (this.cache && this.cache.day === dayKey(Date.now())) return this.cache.list;
    const out = [];
    const today = moment().startOf('day');
    const deck = neonPlugin(this.app, 'neon-deck');
    for (const { file: f, cache } of noteIndex(this.app).projects()) {
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      out.push(this.toProject(f, cache, today));
    }
    out.sort(projectSort);
    this.cache = { day: dayKey(Date.now()), list: out, paths: new Set(out.map((t) => t.file.path)) };
    return out;
  },
  /** A project from its note's properties. */
  toProject(f, cache, today) {
    const fm = (cache && cache.frontmatter) || {};
    const text = (v) => (v != null && typeof v !== 'object' ? String(v).trim() : '');
    const started = parseDay(fm.started);
    const created = parseDay(fm.created) || started || moment(f.stat.ctime);
    const due = parseDay(fm.due);
    const remindRaw = text(fm.remind);
    const statusRaw = text(fm.status);
    const status = projectKind(statusRaw);
    const t = {
      file: f,
      title: projectTitle(f.basename),
      statusRaw,
      status,
      customer: projectCustomer(f.path, fm, this.settings.customersFolder),
      stage: text(fm.stage),
      note: text(fm.note),
      category: noteCategory(cache, f.path) || 'other',
      created,
      startedOn: started,
      due,
      remind: parseDay(remindRaw),
      completed: parseDay(fm.completed) || parseDay(fm.cancelled),
      daysLeft: due ? daysFromToday(due) : null,
      age: Math.max(0, today.diff((started || created).clone().startOf('day'), 'days')),
      progress: 0,
    };
    if (due) {
      const from = started || created;
      const span = due.clone().endOf('day').diff(from, 'minutes');
      t.progress = span > 0 ? clamp(moment().diff(from, 'minutes') / span, 0, 1) : 1;
    }
    t.bucket = status === 'done' ? 'done' : !due ? 'nodate' : t.daysLeft < 0 ? 'overdue' : t.daysLeft === 0 ? 'today' : t.daysLeft <= 7 ? 'week' : 'later';
    return t;
  },
  activeProjects() {
    return this.collectProjects().filter((t) => t.status !== 'done');
  },
  projectFor(file) {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return isProjectCache(cache) ? this.toProject(file, cache, moment().startOf('day')) : null;
  },
  closedIn(m) {
    return this.collectProjects().filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
  },
  renderCounter(el, all) {
    el.empty();
    const now = moment();
    const last = now.clone().subtract(1, 'month');
    const closed = (m) => all.filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
    el.createSpan({ cls: 'tk-counter-n', text: String(closed(now)) });
    el.createSpan({ cls: 'tk-counter-l', text: `closed in ${now.format('MMMM')} · ${closed(last)} in ${last.format('MMMM')}` });
  },
});
