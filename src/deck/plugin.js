/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

class NeonDeck extends Plugin {
  async onload() {
    await this.loadSettings();
    this.wordCache = new Map();
    this.lookListeners = new Set();
    this.widgets = new Map();
    this.captures = new Map();
    this.facts = new Map();
    this.activity = new Map(); // id -> () => [{ t, kind, text, src, status?, open? }] (Recently done log)
    this.actions = new Map();
    this.weekLines = new Map();
    this.excludes = new Map();
    this.services = new Map();
    this.dragging = null;
    this.api = this.buildApi();
    this.applyLook();

    this.registerView(VIEW_DASH, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_CARDS, (leaf) => new CardsView(leaf, this));
    this.registerView(VIEW_GRAPH, (leaf) => new GraphView(leaf, this));
    for (const [v, d] of [[VIEW_DASH, 'dashboard'], [VIEW_CARDS, 'cards'], [VIEW_GRAPH, 'graph']]) this.registerHoverLinkSource(v, { display: `Neon Deck ${d}`, defaultMod: true });

    this.addRibbonIcon('layout-dashboard', 'Neon Deck dashboard', () => this.activate(VIEW_DASH, 'tab'));
    this.addRibbonIcon('layout-grid', 'Card explorer', () => this.activate(VIEW_CARDS, 'tab'));
    this.addRibbonIcon('waypoints', 'Note graph', () => this.openGraph('notes'));

    const cmds = [
      ['open-dashboard', 'Open dashboard', () => this.activate(VIEW_DASH, 'tab')],
      ['open-cards', 'Open card explorer (tab)', () => this.activate(VIEW_CARDS, 'tab')],
      ['open-cards-sidebar', 'Open card explorer (sidebar)', () => this.activate(VIEW_CARDS, 'left')],
      ['open-graph', 'Open note graph', () => this.openGraph('notes')],
      ['graph-active-note', 'Note graph of active note', () => this.openGraph('notes', 'note')],
      ['open-today', 'Open today’s daily note', () => this.openToday()],
      ['next-theme', 'Next theme', () => this.setLook({ theme: THEMES[(THEMES.indexOf(this.settings.theme) + 1) % THEMES.length] }, true)],
      ['next-pattern', 'Next pattern', () => this.setLook({ pattern: PATTERNS[(PATTERNS.indexOf(this.activePattern()) + 1) % PATTERNS.length] }, true)],
      ['weekly-review', 'Create / open this week’s review', () => this.weeklyReview()],
      ['tidy-core', 'Move Neon files into the Core folder', () => this.tidyIntoCore(true)],
    ];
    for (const [id, name, callback] of cmds) this.addCommand({ id, name, callback });
    // hidden while Neon Tasks is on: it brings its own New note command
    this.addCommand({
      id: 'new-note',
      name: 'New note',
      checkCallback: (checking) => {
        if (this.services.has('newNote')) return false;
        if (!checking) this.newNote(this.currentFolder());
        return true;
      },
    });
    this.addCommand({
      id: 'quick-capture',
      name: 'Quick capture',
      callback: () => new QuickCaptureModal(this).open(),
    });
    this.addCommand({
      id: 'mark-revisited',
      name: 'Mark current note as revisited',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) {
          this.markSeen(f.path);
          new Notice('✦ Marked as revisited');
        }
        return true;
      },
    });

    // last, so Alt+1..4 stay Task, Global task, Ticket, Time entry as in the spec
    this.addSettingTab(new NeonSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (!f) return;
        this.lastFile = f;
        this.markSeen(f.path, true);
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f, old) => {
        this.wordCache.delete(old);
        const seen = this.settings.seen;
        if (seen[old]) {
          seen[f.path] = seen[old];
          delete seen[old];
          this.saveSoon();
        }
        if (f instanceof TFolder) this.renamePins(old, f.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        if (this.settings.seen[f.path]) {
          delete this.settings.seen[f.path];
          this.saveSoon();
        }
      }),
    );
    this.registerDomEvent(window, 'focus', () => this.emitLook());
    this.app.workspace.onLayoutReady(() => this.onReady());
  }

  onunload() {
    if (this._saveSoon) (this._saveSoon.cancel(), this.saveSettings()); // don't lose the last 4 s of changes
    document.body.removeClass('nd-themed', ...THEMES.map((x) => `nd-theme-${x}`));
    this.app.workspace.trigger('neon-deck:core-unloaded');
  }

  async loadSettings() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    const s = this.settings;
    if (!Array.isArray(s.pinnedFolders)) s.pinnedFolders = [];
    if (!s.folderColors || typeof s.folderColors !== 'object') s.folderColors = {};
    for (const [k, v] of Object.entries(s.folderColors)) if (!FOLDER_COLOR_RE.test(String(v))) delete s.folderColors[k];
    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    if ((raw.settingsVersion || 0) < 3) {
      // 1.2 -> 1.3: style "intensity" becomes a theme; glass/random are gone
      s.theme = raw.intensity === 'calm' ? 'calm' : 'marathon';
      this.legacy = Object.assign({}, raw);
      for (const k of OLD_KEYS) delete s[k];
      s.settingsVersion = 3;
      await this.saveData(s);
    }
    // 1.6.6: the sidebar sorts by the `created` property by default (item 25); moved once
    if ((s.sortRule || 0) < 1) {
      if (s.cardSort === 'modified') s.cardSort = 'created-prop';
      s.sortRule = 1;
    }
    if (!THEMES.includes(s.theme)) s.theme = 'marathon';
    if (s.pattern === 'circuit' || s.pattern === 'shard') s.pattern = 'prism'; // 2.0.4: Circuit (and the short-lived Shard) became Prism
    if (s.pattern !== 'auto' && !PATTERNS.includes(s.pattern)) s.pattern = 'auto';
    if (!STRENGTHS.includes(s.patternStrength)) s.patternStrength = 'subtle';
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._saveSoon) this._saveSoon = debounce(() => this.saveSettings(), 4000, true);
    this._saveSoon();
  }

  /* API for Neon Tasks / Tickets / Time ------------------------------------ */
  buildApi() {
    const p = this;
    const changed = (ev) => p.app.workspace.trigger(ev);
    return {
      version: ND_VERSION,
      registerWidget(def) {
        p.widgets.set(def.id, def);
        changed('neon-deck:slots-changed');
      },
      unregisterWidget(id) {
        if (p.widgets.delete(id)) changed('neon-deck:slots-changed');
      },
      registerCapture(def) {
        p.registerCapture(def);
        changed('neon-deck:captures-changed');
      },
      unregisterCapture(id) {
        if (p.captures.delete(id)) changed('neon-deck:captures-changed');
      },
      registerFacts(id, fn) {
        p.facts.set(id, fn);
        changed('neon-deck:facts-changed');
      },
      unregisterFacts(id) {
        p.facts.delete(id);
      },
      factsChanged: () => changed('neon-deck:facts-changed'),
      /** Recently done: a module offers its log (ticked tasks, tickets set to Done/Waiting); the Deck only merges and draws */
      registerActivity(id, fn) {
        p.activity.set(id, fn);
        changed('neon-deck:activity-changed');
      },
      unregisterActivity(id) {
        if (p.activity.delete(id)) changed('neon-deck:activity-changed');
      },
      activityChanged: () => changed('neon-deck:activity-changed'),
      registerAction(def) {
        p.actions.set(def.id, def);
        changed('neon-deck:slots-changed');
      },
      unregisterAction(id) {
        if (p.actions.delete(id)) changed('neon-deck:slots-changed');
      },
      registerWeekLine(id, fn) {
        p.weekLines.set(id, fn);
      },
      unregisterWeekLine(id) {
        p.weekLines.delete(id);
      },
      registerExcluded(id, fn) {
        p.excludes.set(id, fn);
      },
      unregisterExcluded(id) {
        p.excludes.delete(id);
      },
      /** named services, e.g. 'newNote' from Neon Tasks, 'newTicket' from Neon Tickets */
      provide(name, fn) {
        p.services.set(name, fn);
      },
      unprovide(name) {
        p.services.delete(name);
      },
      service: (name) => p.services.get(name) || null,
      openFile: (f, e, line) => openFile(p.app, f, e, line),
      bindFileMouse: (el, f, view) => p.bindFileMouse(el, f, view),
      /** the live dashboard pattern behind any element; returns { kick, destroy } */
      mountPattern: (host, scroller, cardSel) => new PatternLayer(p, host, scroller, cardSel),
      fileMenu: (f, e, extra) => p.fileMenu(f, e, extra),
      onLook: (fn) => p.onLook(fn),
      theme: () => p.settings.theme,
    };
  }
  registerCapture(def) {
    this.captures.set(def.id, def);
  }
  captureTargets() {
    return [...this.captures.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  }


  /* look: theme + pattern -------------------------------------------------- */
  activePattern() {
    const s = this.settings;
    return s.pattern === 'auto' ? THEME_PATTERN[s.theme] || 'none' : s.pattern;
  }
  applyLook() {
    const b = document.body;
    b.addClass('nd-themed');
    for (const t of THEMES) b.toggleClass(`nd-theme-${t}`, this.settings.theme === t);
  }
  async setLook(patch, notify) {
    Object.assign(this.settings, patch);
    this.applyLook();
    await this.saveSettings();
    this.app.workspace.trigger('css-change');
    this.emitLook();
    if (notify) new Notice(`${THEME_LABEL[this.settings.theme]} · ${PATTERN_LABEL[this.activePattern()]}`);
  }
  onLook(fn) {
    this.lookListeners.add(fn);
    return () => this.lookListeners.delete(fn);
  }
  emitLook() {
    for (const fn of this.lookListeners) fn();
  }

}
