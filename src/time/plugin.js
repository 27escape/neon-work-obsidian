/* ---- plugin ------------------------------------------------------------- */
class NeonTime extends Plugin {
  async onload() {
    this.listeners = new Set();
    this.dirty = new Set();
    this.session = null;
    // short bits of work per note (under a minute so far); they add up instead of being dropped
    this.pending = new Map();
    await this.loadSettings();
    // 1.6.6: tracking keeps going in the background, so the old 2-minute default becomes 30
    // (idleRule is not in the defaults, so only saved data says it was migrated)
    if ((this.settings.idleRule || 0) < 2) {
      if (this.settings.idleMin === 2) this.settings.idleMin = 30;
      this.settings.idleRule = 2;
    }
    this.days = this.settings.days;
    // old saved entries: ops -> operations
    for (const d of Object.values(this.days || {})) for (const e of d.entries || []) e.cat = normCat(e.cat);

    this.registerView(VIEW_TIME, (leaf) => new TimeView(leaf, this));
    this.addRibbonIcon('clock', 'Neon Time', () => this.openTab());
    this.addCommand({ id: 'open-time', name: 'Open Time tab', callback: () => this.openTab() });
    this.addCommand({ id: 'add-time', name: 'Add time by hand', callback: () => this.newEntry({}) });
    this.addCommand({ id: 'wrap-up', name: 'Wrap up the day', callback: () => new WrapUpModal(this).open() });
    this.addCommand({ id: 'write-log', name: 'Write today’s time log note now', callback: () => this.writeDay(moment().format('YYYY-MM-DD'), true) });
    this.addCommand({
      id: 'toggle-tracking',
      name: 'Pause / resume automatic tracking',
      callback: () => {
        this.setTracking(!this.settings.tracking);
        new Notice(this.settings.tracking ? '⏱ Time tracking on' : '⏸ Time tracking paused');
      },
    });
    this.addSettingTab(new NeonTimeSettingTab(this.app, this));

    // activity in the focused note keeps the session alive
    // every window counts: the main one and notes moved to a new window (popouts)
    const touch = (e) => this.touch(e);
    const watched = new WeakSet();
    const watch = (win) => {
      if (!win || watched.has(win)) return;
      watched.add(win);
      const doc = win.document;
      this.registerDomEvent(doc, 'keydown', touch, true);
      this.registerDomEvent(doc, 'mousedown', touch, true);
      this.registerDomEvent(doc, 'wheel', touch, { capture: true, passive: true });
      this.registerDomEvent(doc, 'scroll', touch, { capture: true, passive: true });
      // leaving Obsidian keeps the session open: time away counts if you're back within the idle
      // cutoff, else the session ends at the last activity (checked on return and every 15 s)
      this.registerDomEvent(win, 'focus', () => this.tick());
      this.registerDomEvent(doc, 'visibilitychange', () => !doc.hidden && this.tick());
    };
    watch(window);
    this.registerEvent(this.app.workspace.on('window-open', (_w, win) => watch(win)));
    this.app.workspace.onLayoutReady(() => this.app.workspace.iterateAllLeaves((l) => watch(l.view.containerEl.win)));
    // switching tabs ends the session, unless it's still the same note
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const v = this.activeFileView();
        if (this.session && v && v.file && v.file.path === this.session.path) return;
        this.closeSession();
      }),
    );
    this.registerInterval(window.setInterval(() => this.tick(), 15 * 1000));
    // a note's category can change while you work in it (e.g. untracked ticked)
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        const s = this.session;
        const inSession = s && s.path === file.path;
        if (!inSession && !this.pending.has(file.path)) return;
        const cat = this.trackCat(file);
        if (!cat) return this.dropTracking(file.path);
        const pd = this.pending.get(file.path);
        if (pd) pd.cat = cat;
        // new category: save the time so far, the next activity starts a fresh session
        if (inSession && s.cat !== cat) this.closeSession();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('neon:time-entry', (v) => {
        if (!v || !(v.min > 0)) return;
        this.addEntry({ start: v.start, ms: v.min * 60000, cat: normCat(v.cat) || 'operations', note: v.note || '', path: v.path || '', jira: v.jira || '', source: SOURCES.includes(v.source) ? v.source : 'manual' }, true);
      }),
    );
    this.registerEvent(this.app.workspace.on('neon:task-done', (v) => v && this.addDone({ kind: 'task', text: v.text })));
    this.registerEvent(
      this.app.workspace.on('neon:ticket-changed', (v) => {
        if (!v) return;
        // keyed by ticket id so a ticket that moves to Done/ and back stays one line
        const path = (v.file && v.file.path) || '';
        this.addDone({ kind: 'ticket', ref: v.id || path || v.title, path, text: `${v.id ? v.id + ' ' : ''}${v.title || ''}`.trim(), change: v.change });
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f, old) => {
        let hit = false;
        for (const d of Object.values(this.days)) {
          for (const e of d.entries || []) if (e.path === old) ((e.path = f.path), (hit = true));
          for (const x of d.done || []) {
            if (x.ref === old) ((x.ref = f.path), (hit = true));
            if (x.path === old) ((x.path = f.path), (hit = true));
          }
        }
        if (this.session && this.session.path === old) this.session.path = f.path;
        if (this.pending.has(old)) (this.pending.set(f.path, this.pending.get(old)), this.pending.delete(old));
        if (hit) this.saveSoon();
      }),
    );

    this.buildStatus();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.app.workspace.onLayoutReady(() => {
      this.hookCore();
      this.ensureReadme();
    });
  }
  onunload() {
    this.closeSession();
    // keep short bits of work that haven't reached a minute yet
    for (const k of this.flushPending()) this.dirty.add(k);
    for (const k of this.dirty) this.writeDay(k);
    this.saveData(this.settings);
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('time');
      api.unregisterCapture('time');
      api.unregisterFacts('time');
      api.unregisterWeekLine('time');
      api.unprovide('timeDay');
      api.unregisterAction('time');
      api.unregisterExcluded('time');
    }
  }
  async loadSettings() {
    const data = (await this.loadData()) || {};
    this.settings = Object.assign({}, TIME_DEFAULTS, data);
    if (!this.settings.days || typeof this.settings.days !== 'object') this.settings.days = {};
    if (!this.settings.installedAt) {
      this.settings.installedAt = Date.now();
      await this.saveData(this.settings);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._save) this._save = debounce(() => this.saveData(this.settings), 2000, true);
    this._save();
  }
  /** now: a click, so views redraw at once instead of after their batching delay. */
  emit(now) {
    for (const fn of this.listeners) fn(now);
    this.updateStatus();
    const api = deckApi(this.app);
    if (api) api.factsChanged();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Something changed on a day: save, refresh, and rewrite its log note soon. */
  changed(key, now) {
    this.saveSoon();
    this.dirty.add(key);
    if (!this._write) this._write = debounce(() => this.flush(), 20 * 1000, true);
    this._write();
    this.emit(now);
  }
  async flush() {
    const ed = this.app.workspace.activeEditor;
    const editing = ed && ed.file ? ed.file.path : null;
    const keys = [...this.dirty].filter((k) => this.dayNotePath(k) !== editing);
    for (const k of keys) this.dirty.delete(k);
    if (this.dirty.size && this._write) this._write(); // the open note is written once the user leaves it
    for (const k of keys) await this.writeDay(k);
  }

  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'time', slot: 'time', title: 'Time today', icon: 'clock', sub: this.widgetSub(), mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'time', label: 'Time entry', short: 'Time', icon: 'clock', order: 30, allowEmpty: true, run: (v) => this.newEntry({ note: v }) });
    api.registerAction({ id: 'time', icon: 'clock', label: 'Time', order: 40, view: VIEW_TIME, run: () => this.openTab() });
    api.registerExcluded('time', () => [this.settings.logFolder || 'Neon/Time Log']);
    api.registerFacts('time', () => {
      const s = this.summary(moment().format('YYYY-MM-DD'), true);
      const out = [];
      const top = timeCats().filter((k) => s.by[k]).sort((a, b) => s.by[b] - s.by[a]);
      for (const k of top.slice(0, 2)) out.push({ v: fmtMin(s.by[k]), l: `${CAT_LABEL[k].toLowerCase()} today` });
      const wk = this.balance(moment().startOf('isoWeek'), moment().endOf('isoWeek'));
      if (wk.over) out.push({ v: fmtMin(wk.over), l: 'overtime this week' });
      return out;
    });
    // the dashboard's Activity timeline reads a day's worked time and entries from here
    api.provide('timeDay', (key) => {
      const s = this.summary(key, key === moment().format('YYYY-MM-DD'));
      return { worked: s.total, target: s.target, over: s.over, entries: this.entriesOf(key, false).map((e) => ({ start: e.start, min: entryMin(e), text: e.note || (e.path ? e.path.split('/').pop().replace(/\.md$/, '') : CAT_LABEL[e.cat] || 'Time') })) };
    });
    if (api.activityChanged) api.activityChanged(); // the Activity card can now show worked time
    api.registerWeekLine('time', (start, end) => {
      const by = {};
      let over = 0;
      for (let d = start.clone(); d.isBefore(end); d.add(1, 'day')) {
        const s = this.summary(d.format('YYYY-MM-DD'), false);
        for (const k of timeCats()) by[k] = (by[k] || 0) + s.by[k];
        over += s.over;
      }
      const top = timeCats().filter((k) => by[k]).sort((a, b) => by[b] - by[a])[0];
      const out = [];
      if (top) out.push(`mostly ${CAT_LABEL[top]}`);
      if (over) out.push(`${fmtMin(over)} overtime`);
      return out;
    });
  }

  widgetSub() {
    return `Active time · ${fmtMin(Math.round(this.settings.dayHours * 60))} day`;
  }

  /* ---- UI --------------------------------------------------------------- */
  async openTab() {
    await activateView(this.app, VIEW_TIME, 'tab');
  }
  buildStatus() {
    const el = (this.statusEl = this.addStatusBarItem());
    el.addClass('nd-status', 'tm-status', 'mod-clickable');
    setIcon(el.createSpan('nd-status-icon'), 'clock');
    this.statusTxt = el.createSpan('nd-status-text');
    el.addEventListener('click', () => this.openTab());
    this.updateStatus();
  }
  updateStatus() {
    if (!this.statusEl) return;
    const s = this.summary(moment().format('YYYY-MM-DD'), true);
    this.statusTxt.setText(this.settings.tracking ? fmtMin(s.total) : `${fmtMin(s.total)} · paused`);
    this.statusEl.toggleClass('is-running', !!this.session);
    tip(this.statusEl, this.session ? `Tracking ${this.session.name} · ${CAT_LABEL[this.session.cat]}` : 'Time today · click for the Time tab');
  }
}
