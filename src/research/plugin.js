/* ---- plugin ------------------------------------------------------------------ */
class NeonResearch extends Plugin {
  async onload() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, NR_DEFAULTS, raw);
    if (!Array.isArray(this.settings.open)) this.settings.open = [];
    this.settings.researchTopics = normalizeResearchTopics(this.settings.researchTopics);
    if (!this.settings.cards || typeof this.settings.cards !== 'object') this.settings.cards = {};
    const s = this.settings;
    if (!Array.isArray(s.roots) || !s.roots.length) s.roots = [{ name: 'Research', path: normalizePath(s.root || NR_DEFAULTS.root) }, { name: 'School', path: 'Learning/School' }];
    s.roots = s.roots.filter((r) => r && typeof r.path === 'string' && r.path.trim()).map((r) => ({ name: String(r.name || r.path.split('/').pop()), path: normalizePath(r.path) }));
    if (!s.roots.length) s.roots = [{ name: 'Research', path: NR_DEFAULTS.root }];
    if (!(s.activeRoot >= 0 && s.activeRoot < s.roots.length)) s.activeRoot = 0;
    s.root = s.roots[0].path;
    this.cardCache = new Map(); // path -> { text, cards }: each note is parsed once per change
    this.listeners = new Set();
    this.cardText = new Map();
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.addRibbonIcon('library', 'Study', () => this.openTab());
    this.addCommand({ id: 'open-research', name: 'Open the Study tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-topic', name: 'New topic', callback: () => this.newTopic(this.rootFolder()) });
    this.addCommand({ id: 'quiz-all', name: 'Quiz me…', callback: () => new QuizPickModal(this).open() });
    this.addCommand({
      id: 'add-flashcard',
      name: 'Add flashcard to this note',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== 'md' || !this.inRoot(f)) return false;
        if (!checking) new FlashcardModal(this, f).open();
        return true;
      },
    });
    // a Flashcards button in the header of notes inside a section
    const syncButtons = () => this.app.workspace.getLeavesOfType('markdown').forEach((l) => this.syncCardButton(l.view));
    this.registerEvent(this.app.workspace.on('file-open', syncButtons));
    this.registerEvent(this.app.workspace.on('active-leaf-change', syncButtons));
    this.app.workspace.onLayoutReady(syncButtons);
    this.register(() => this.app.workspace.getLeavesOfType('markdown').forEach((l) => l.view.nrCardBtn && (l.view.nrCardBtn.remove(), (l.view.nrCardBtn = null))));
    this.addCommand({ id: 'link-suggestions', name: 'Suggest links in this note', callback: () => this.showLinkSuggestions(true) });
    this.addSettingTab(new NeonResearchSettingTab(this.app, this));

    // status bar: "N possible links" for the open research note
    this.linkEl = this.addStatusBarItem();
    this.linkEl.addClass('nd-status', 'nr-status', 'mod-clickable');
    this.linkEl.addEventListener('click', () => this.showLinkSuggestions(true));
    this.linkEl.hide();
    const hint = debounce(() => this.updateLinkHint(), 800, true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hint));
    // quiz-card text cache, kept current from the change event (it hands over the note's text)
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, data) => {
        if (!this.inRoot(f)) return;
        this.noteText(f, data);
        hint();
      }),
    );
    const anyChange = (f) => (this.inRoot(f) || f instanceof TFolder) && this.emitSoon();
    this.registerEvent(this.app.vault.on('create', anyChange));
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        for (const p of [...this.cardText.keys()]) if (p === f.path || p.startsWith(f.path + '/')) (this.cardText.delete(p), this.cardCache.delete(p));
        // forget quiz history of deleted notes, and the open state of deleted folders
        for (const id of Object.keys(this.settings.cards)) if (id.startsWith(f.path + '|') || id.startsWith(f.path + '/')) delete this.settings.cards[id];
        this.settings.open = this.settings.open.filter((x) => x !== f.path && !x.startsWith(f.path + '/'));
        this.saveSoon();
        this.emitSoon();
      }),
    );
    this.registerEvent(this.app.vault.on('rename', (f, old) => this.onRename(f, old)));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookDeck()));
    this.app.workspace.onLayoutReady(async () => {
      this.hookDeck();
      this.updateLinkHint();
      await this.refreshCardText();
      this.emitSoon();
    });
  }
  onunload() {
    if (this._save) (this._save.cancel(), this.saveData(this.settings)); // don't lose the last 1.5 s of changes
    const api = deckApi(this.app);
    if (api) api.unregisterAction('research');
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._save) this._save = debounce(() => this.saveData(this.settings), 1500, true);
    this._save();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit) this._emit = debounce(() => this.listeners.forEach((fn) => fn()), 120, true);
    this._emit();
  }
  hookDeck() {
    const api = deckApi(this.app);
    if (api) api.registerAction({ id: 'research', icon: 'library', label: 'Study', order: 45, view: VIEW_RESEARCH, run: () => this.openTab() });
  }
  openTab() {
    return activateView(this.app, VIEW_RESEARCH, 'tab');
  }

  /* ---- the tree ---- */
  /** Path of the root shown in the tab. */
  get root() {
    return this.settings.roots[this.settings.activeRoot].path;
  }
  rootFolder(path = this.root) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }
  /** The root a file lives in (any root, not only the shown one), or null. */
  rootOf(f) {
    return (f && this.settings.roots.find((r) => f.path.startsWith(r.path + '/'))) || null;
  }
  inRoot(f) {
    return !!this.rootOf(f);
  }
  setActiveRoot(i) {
    if (i === this.settings.activeRoot || !this.settings.roots[i]) return;
    this.settings.activeRoot = i;
    this.saveSoon();
    this.listeners.forEach((fn) => fn('now')); // a click: redraw now, skip the batching delays
  }
  notesUnder(folder) {
    if (!folder) return [];
    const out = [];
    const walk = (x) => {
      for (const c of x.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') out.push(c);
      }
    };
    walk(folder);
    return out;
  }
  researchNotes(path = this.root) {
    return this.notesUnder(this.rootFolder(path));
  }
  allNotes() {
    return this.settings.roots.flatMap((r) => this.researchNotes(r.path));
  }
  isOpen(path) {
    return this.settings.open.includes(path);
  }
  /** Remember a folder's open state without redrawing (the tree updates itself). */
  setOpen(path, open) {
    this.settings.open = this.settings.open.filter((x) => x !== path);
    if (open) this.settings.open.push(path);
    this.saveSoon();
  }
  toggleOpen(path, force) {
    const open = force != null ? force : !this.isOpen(path);
    this.settings.open = this.settings.open.filter((x) => x !== path);
    if (open) this.settings.open.push(path);
    this.saveSoon();
    this.emitSoon();
  }
}
