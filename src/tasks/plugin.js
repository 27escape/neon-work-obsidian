class NeonTasks extends Plugin {
  async onload() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, TASKS_DEFAULTS, raw || {});
    const s = this.settings;
    if (!Array.isArray(s.globalTasks)) s.globalTasks = [];
    if (!Array.isArray(s.doneLog)) s.doneLog = [];
    if (!s.installedAt) s.installedAt = Date.now();
    dropOldDefaults(this.app, s, { quickTasksPath: 'Todo.md' }); // fork: the Todo note follows the base folder unless set
    this.freshData = !raw;
    await this.saveSettings();
    this.selfCreated = new Set();
    this.listeners = new Set();

    // fork: a Tasks tab in the main pane, listed in the Neon sidebar like Projects, Time and Research
    this.registerView(VIEW_TASKS, (leaf) => new TasksView(leaf, this));
    this.addCommand({ id: 'open-tasks', name: 'Open the Tasks tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-note', name: 'New note', callback: () => this.newNote(this.currentFolder()) });
    // fork: "Fix properties" (current note / folder) and the automatic ops → operations rename are removed:
    // they deleted empty properties (e.g. due: and completed: from your templates) and imposed upstream categories
    this.addCommand({ id: 'add-global-task', name: 'Add a task to Todo', callback: () => new PromptModal(this.app, { title: 'Add to Todo', placeholder: 'Goes at the top of your Todo note', cta: 'Add', onSubmit: (v) => this.addQuickTask(v) }).open() });
    this.addCommand({ id: 'uncategorised', name: 'Show new notes without a category', callback: () => new UncategorisedModal(this, this.uncategorised()).open() });
    this.addSettingTab(new NeonTasksSettingTab(this.app, this));
    this.buildStatus();

    const changed = debounce(() => this.emit(), 250, true);
    // fork: finished tasks come from the notes; rescan when a note with ticked tasks changes
    const rescan = debounce(() => this.scanDone().catch((e) => console.error('Neon Deck (fork) done tasks', e)), 1000, true);
    this.registerEvent(this.app.metadataCache.on('changed', (f, _d, cache) => (cache && cache.listItems && cache.listItems.some((li) => li.task === 'x' || li.task === 'X')) || (this.doneTasks || []).some((x) => x.path === f.path) ? rescan() : null));
    this.registerEvent(this.app.vault.on('delete', rescan));
    this.registerEvent(this.app.vault.on('rename', rescan));
    const doneRef = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(doneRef);
      rescan();
    });
    this.registerEvent(doneRef);
    // Only notes that feed the Tasks widget trigger a refresh.
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, _d, cache) => {
        if (!this.sourcePaths || this.sourcePaths.has(f.path) || this.mayHoldTasks(f, cache) || f.path === this.quickPath()) changed();
      }),
    );
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', changed));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateBar()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.updateBar()));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        const a = this.app.workspace.getActiveFile();
        if (a && f.path === a.path) this.updateBar();
      }),
    );
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.ready = Date.now();
      this.registerEvent(this.app.vault.on('create', (f) => this.onCreate(f)));
      this.hookCore();
      this.updateBar();
      this.offerGlobalMove();
      // fork: no Global tasks backup (they are the Todo note); a new day moves tasks between groups
      this.registerInterval(window.setInterval(() => this.dayKey !== (this.dayKey = moment().format('YYYY-MM-DD')) && (this.emit(), rescan()), 10 * 60 * 1000));
      rescan();
    });
  }
  onunload() {
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tasks');
      api.unregisterAction('tasks');
      api.unregisterWidget('global');
      api.unregisterCapture('task');
      api.unregisterCapture('global');
      api.unregisterFacts('tasks');
      api.unregisterActivity && api.unregisterActivity('tasks');
      api.unregisterWeekLine('tasks');
      api.unprovide('newNote');
      api.unregisterExcluded('tasks');
    }
    document.querySelectorAll('.nt-nocat-bar').forEach((el) => el.remove());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  emit() {
    for (const fn of this.listeners) fn();
    const api = deckApi(this.app);
    if (api) api.factsChanged();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  openTab() {
    return activateView(this.app, VIEW_TASKS, 'tab');
  }
  currentFolder() {
    const f = this.app.workspace.getActiveFile();
    return f && f.parent ? f.parent.path : '/';
  }
  ticketService() {
    const t = neonPlugin(this.app, 'neon-tickets');
    return t && t.newTicket ? (opts) => t.newTicket(opts) : null;
  }

  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tasks', slot: 'tasks', title: 'Tasks', icon: 'list-checks', sub: `${this.settings.taskTag || 'Tasks'} across your notes · by date`, mount: (card) => this.mountTasks(card) });
    api.registerWidget({ id: 'global', slot: 'global', title: 'Todo', icon: 'star', sub: this.quickPath(), mount: (card) => this.mountGlobal(card) });
    api.registerAction({ id: 'tasks', icon: 'list-checks', label: 'Tasks', order: 15, view: VIEW_TASKS, run: () => this.openTab() });
    api.registerCapture({ id: 'task', label: 'Todo task', short: 'Todo', icon: 'square-check', order: 10, run: (v) => this.addQuickTask(v) });
    // Recently done on the dashboard (fork): tasks ticked anywhere, read from their ✅ dates in your notes
    if (api.registerActivity) api.registerActivity('tasks', () => this.doneActivity());
    api.registerFacts('tasks', () => {
      const out = [];
      if (this.openCount != null) out.push({ v: this.openCount, l: 'open tasks' });
      const n = this.doneOn(moment());
      if (n) out.push({ v: n, l: n === 1 ? 'task done' : 'tasks done' });
      return out;
    });
    api.registerWeekLine('tasks', (start, end) => {
      const n = this.doneBetween(start, end);
      return n ? [`${n} task${n === 1 ? '' : 's'} done`] : [];
    });
    api.provide('newNote', (folder) => this.newNote(folder));
    api.registerExcluded('tasks', () => []);
  }
  doneOn(m) {
    return this.doneBetween(m.clone().startOf('day'), m.clone().startOf('day').add(1, 'day'));
  }
  logDone(text, src, due) {
    const log = this.settings.doneLog;
    log.push(due ? { t: Date.now(), text, src, due } : { t: Date.now(), text, src });
    const cut = Date.now() - 120 * 864e5;
    while (log.length && log[0].t < cut) log.shift();
    this.saveSettings();
    this.app.workspace.trigger('neon:task-done', { text, src });
    const api = deckApi(this.app);
    if (api && api.activityChanged) api.activityChanged();
  }

}
