class NeonTasks extends Plugin {
  async onload() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, TASKS_DEFAULTS, raw || {});
    const s = this.settings;
    if (!Array.isArray(s.globalTasks)) s.globalTasks = [];
    if (!Array.isArray(s.doneLog)) s.doneLog = [];
    if (!s.installedAt) s.installedAt = Date.now();
    this.freshData = !raw;
    await this.saveSettings();
    this.selfCreated = new Set();
    this.listeners = new Set();

    this.addCommand({ id: 'new-note', name: 'New note', callback: () => this.newNote(this.currentFolder()) });
    this.addCommand({
      id: 'fix-properties',
      name: 'Fix properties of current note',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== 'md') return false;
        if (!checking) this.fixProps(f).then((ch) => new Notice(ch ? '✦ Properties fixed' : 'Properties already tidy'));
        return true;
      },
    });
    this.addCommand({ id: 'fix-properties-folder', name: 'Fix properties in a folder…', callback: () => this.pickFolderToFix() });
    this.addCommand({ id: 'add-global-task', name: 'Add a Global task', callback: () => new PromptModal(this.app, { title: 'Global task', placeholder: 'Important · not tied to notes', cta: 'Add', onSubmit: (v) => this.addGlobal(v) }).open() });
    this.addCommand({ id: 'uncategorised', name: 'Show new notes without a category', callback: () => new UncategorisedModal(this, this.uncategorised()).open() });
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) menu.addItem((i) => i.setTitle('Fix properties in folder').setIcon('wand-2').onClick(() => this.fixFolder(file)));
        else if (file instanceof TFile && file.extension === 'md') menu.addItem((i) => i.setTitle('Fix properties').setIcon('wand-2').onClick(() => this.fixProps(file).then((ch) => new Notice(ch ? '✦ Properties fixed' : 'Properties already tidy'))));
      }),
    );
    this.addSettingTab(new NeonTasksSettingTab(this.app, this));
    this.buildStatus();

    const changed = debounce(() => this.emit(), 250, true);
    // Only notes that feed the Tasks widget trigger a refresh.
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, _d, cache) => {
        if (!this.sourcePaths || this.sourcePaths.has(f.path) || this.isTaskSource(f, cache) || f.path === this.quickPath() || dailyDateOf(this.app, f)) changed();
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
      this.maybeRestore();
      // after Obsidian has read every note's properties
      window.setTimeout(() => this.migrateCategories(), 5000);
      this.dailyBackup();
      this.registerInterval(window.setInterval(() => this.dailyBackup(), 60 * 60 * 1000));
    });
  }
  onunload() {
    this.writeBackup();
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tasks');
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
    api.registerWidget({ id: 'tasks', slot: 'tasks', title: 'Tasks', icon: 'list-checks', sub: 'Tagged notes · today · quick', mount: (card) => this.mountTasks(card) });
    api.registerWidget({ id: 'global', slot: 'global', title: 'Global tasks', icon: 'star', sub: 'Important · not tied to notes', mount: (card) => this.mountGlobal(card) });
    api.registerCapture({ id: 'task', label: 'Task', short: 'Task', icon: 'square-check', order: 10, run: (v) => this.addQuickTask(v) });
    api.registerCapture({ id: 'global', label: 'Global task', short: 'Global', icon: 'star', order: 11, run: (v) => this.addGlobal(v) });
    // Recently done on the dashboard: tasks ticked in the widgets (doneLog keeps 120 days)
    if (api.registerActivity)
      api.registerActivity('tasks', () =>
        this.settings.doneLog.map((x) => {
          const f = x.src && x.src !== 'global' ? this.app.vault.getAbstractFileByPath(x.src) : null;
          return { t: x.t, kind: 'task', text: x.text, due: x.due || null, src: x.src === 'global' ? 'Global' : f ? f.basename : '', open: f ? (e) => openFile(this.app, f, e) : null };
        }),
      );
    api.registerFacts('tasks', () => {
      const out = [];
      if (this.openCount != null) out.push({ v: this.openCount, l: 'open tasks' });
      const n = this.doneOn(moment());
      if (n) out.push({ v: n, l: n === 1 ? 'task done' : 'tasks done' });
      return out;
    });
    api.registerWeekLine('tasks', (start, end) => {
      const n = this.settings.doneLog.filter((d) => d.t >= start.valueOf() && d.t < end.valueOf()).length;
      return n ? [`${n} task${n === 1 ? '' : 's'} done`] : [];
    });
    api.provide('newNote', (folder) => this.newNote(folder));
    api.registerExcluded('tasks', () => [this.settings.backupPath]);
  }
  doneOn(m) {
    const k = m.format('YYYY-MM-DD');
    return this.settings.doneLog.filter((d) => dayKey(d.t) === k).length;
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
