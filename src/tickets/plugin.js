class NeonProjects extends Plugin {
  async onload() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, PROJECTS_DEFAULTS, raw || {});
    const s = this.settings;
    if (!s.notified || typeof s.notified !== 'object') s.notified = {};
    s.statusLog = Array.isArray(s.statusLog) ? s.statusLog.slice(-200) : [];
    s.activityStatuses = Array.isArray(s.activityStatuses) ? s.activityStatuses.slice() : ['done', 'waiting'];
    if (!PROJECT_SORTS.some(([k]) => k === s.tabSort)) s.tabSort = 'customer';
    this.applyProjectSettings();
    this.listeners = new Set();
    this.cache = null;

    this.registerView(VIEW_TICKETS, (leaf) => new ProjectsView(leaf, this));
    this.addRibbonIcon('briefcase', 'Projects', () => this.openTracker());
    this.addCommand({ id: 'open-tickets', name: 'Open the Projects tab', callback: () => this.openTracker() });
    this.addCommand({ id: 'new-ticket', name: 'New project', callback: () => this.newProject() });
    this.addCommand({ id: 'ticket-reminders', name: 'Show projects that need attention', callback: () => this.checkReminders(true) });
    const cur = (id, name, fn) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const t = this.projectFor(this.app.workspace.getActiveFile());
          if (!t) return false;
          if (!checking) fn(t);
          return true;
        },
      });
    cur('project-status', 'Project: set status of current project', (t) => {
      const m = new Menu();
      projectMenu(this, t, m);
      const r = document.body.getBoundingClientRect();
      m.showAtPosition({ x: r.width / 2, y: r.height / 3 });
    });
    cur('ticket-postpone-7', 'Project: postpone current project by 1 week', (t) => this.postpone(t, 7));
    cur('ticket-due', 'Project: set due date of current project', (t) => this.promptDate(t, 'due'));
    cur('project-note', 'Project: set note of current project', (t) => this.promptNote(t));
    this.addSettingTab(new NeonProjectsSettingTab(this.app, this));
    this.buildStatus();

    // only project notes invalidate the list: typing in other notes costs nothing
    const dirty = () => {
      this.cache = null;
      this.emitSoon();
      const api = deckApi(this.app);
      if (api && api.activityChanged) api.activityChanged(); // Recently done reads the closed dates
    };
    const known = (path) => !!(this.cache && this.cache.paths.has(path));
    this.registerEvent(this.app.metadataCache.on('changed', (f, _d, cache) => (isProjectCache(cache) || known(f.path)) && dirty()));
    this.registerEvent(this.app.vault.on('delete', (f) => known(f.path) && dirty()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (known(old) || f instanceof TFolder || isProjectCache(this.app.metadataCache.getFileCache(f))) && dirty()));
    const ref = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(ref);
      dirty();
    });
    this.registerEvent(ref);
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.hookCore();
      window.setTimeout(() => this.checkReminders(), 4000);
      this.registerInterval(window.setInterval(() => this.checkReminders(), 15 * 60 * 1000));
    });
  }
  onunload() {
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tickets');
      api.unregisterCapture('ticket');
      api.unregisterAction('tickets');
      api.unregisterFacts('tickets');
      if (api.unregisterActivity) api.unregisterActivity('tickets');
      api.unregisterWeekLine('tickets');
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit)
      this._emit = debounce(() => {
        for (const fn of this.listeners) fn();
        const api = deckApi(this.app);
        if (api) api.factsChanged();
      }, 300, true);
    this._emit();
  }
  /** New project from other modules (New note, capture): { title, customer }. */
  newTicket(opts) {
    this.newProject(opts || {});
  }
  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tickets', slot: 'tickets', title: 'Projects', icon: 'briefcase', mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'ticket', label: 'Project', short: 'Project', icon: 'briefcase', order: 20, allowEmpty: true, run: (v) => this.newProject({ title: v }) });
    api.registerAction({ id: 'tickets', icon: 'briefcase', label: 'Projects', order: 20, view: VIEW_TICKETS, run: () => this.openTracker() });
    if (api.registerActivity)
      api.registerActivity('tickets', () => this.closedActivity());
    api.registerFacts('tickets', () => {
      const act = this.activeProjects();
      const week = act.filter((t) => t.due && t.daysLeft >= 0 && t.daysLeft <= 7).length;
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const out = [{ v: week, l: week === 1 ? 'project due this week' : 'projects due this week' }];
      if (over) out.push({ v: over, l: 'overdue' });
      const n = this.closedIn(moment());
      if (n) out.push({ v: n, l: `closed in ${moment().format('MMMM')}` });
      return out;
    });
    api.registerWeekLine('tickets', (start, end) => {
      const n = this.collectProjects().filter((t) => t.completed && !t.completed.isBefore(start) && t.completed.isBefore(end)).length;
      return n ? [`${n} project${n === 1 ? '' : 's'} closed`] : [];
    });
  }
  openTracker() {
    return activateView(this.app, VIEW_TICKETS, 'tab');
  }
  buildStatus() {
    const el = this.addStatusBarItem();
    el.addClass('nd-status', 'tk-statusbar', 'mod-clickable');
    setIcon(el.createSpan('nd-status-icon'), 'briefcase');
    const txt = el.createSpan('nd-status-text');
    tip(el, 'Projects — click to open the Projects tab');
    el.addEventListener('click', () => this.openTracker());
    const update = () => {
      const act = this.activeProjects();
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const today = act.filter((t) => t.bucket === 'today').length;
      el.toggle(act.length > 0);
      const parts = [];
      if (over) parts.push(`${over} overdue`);
      if (today) parts.push(`${today} due today`);
      txt.setText(parts.length ? parts.join(' · ') : `${act.length} open projects`);
      el.toggleClass('is-alert', over > 0);
      el.toggleClass('is-warn', !over && today > 0);
    };
    this.register(this.onChange(update));
    this.registerInterval(window.setInterval(update, 5 * 60 * 1000));
    this.app.workspace.onLayoutReady(update);
  }
}
