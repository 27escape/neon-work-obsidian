/* ---- plugin ------------------------------------------------------------------ */
class NeonResearch extends Plugin {
  async onload() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, NR_DEFAULTS, raw);
    if (!Array.isArray(this.settings.open)) this.settings.open = [];
    const s = this.settings;
    // fork: sections come only from settings; an old single `root` (1.x data) becomes the first section
    if (!Array.isArray(s.roots)) s.roots = s.root ? [{ name: 'Research', path: normalizePath(s.root) }] : [];
    s.roots = s.roots.filter((r) => r && typeof r.path === 'string' && r.path.trim()).map((r) => ({ name: String(r.name || r.path.split('/').pop()), path: normalizePath(r.path) }));
    if (!(s.activeRoot >= 0 && s.activeRoot < s.roots.length)) s.activeRoot = 0;
    s.root = s.roots.length ? s.roots[0].path : '';
    this.listeners = new Set();
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.addRibbonIcon('library', 'Research', () => this.openTab());
    this.addCommand({ id: 'open-research', name: 'Open the Research tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-topic', name: 'New topic', callback: () => (this.rootFolder() ? this.newTopic(this.rootFolder()) : this.pickSection()) });
    // old flashcard blocks (quizzes were removed in the fork) stay off the page
    this.registerMarkdownCodeBlockProcessor(CARD_BLOCK, (src, el) => el.addClass('nr-cards-block'));
    this.addCommand({ id: 'link-suggestions', name: 'Suggest links in this note', callback: () => this.showLinkSuggestions(true) });
    this.addSettingTab(new NeonResearchSettingTab(this.app, this));

    // status bar: "N possible links" for the open research note
    this.linkEl = this.addStatusBarItem();
    this.linkEl.addClass('nd-status', 'nr-status', 'mod-clickable');
    this.linkEl.addEventListener('click', () => this.showLinkSuggestions(true));
    this.linkEl.hide();
    const hint = debounce(() => this.updateLinkHint(), 800, true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hint));
    // a research note changed (its status may have): redraw, and refresh the link hint
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (!this.inRoot(f)) return;
        this.emitSoon();
        hint();
      }),
    );
    const anyChange = (f) => (this.inRoot(f) || f instanceof TFolder) && this.emitSoon();
    this.registerEvent(this.app.vault.on('create', anyChange));
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        // forget the open state of deleted folders
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
    if (api) api.registerAction({ id: 'research', icon: 'library', label: 'Research', order: 45, view: VIEW_RESEARCH, run: () => this.openTab() });
  }
  openTab() {
    return activateView(this.app, VIEW_RESEARCH, 'tab');
  }

  /* ---- the tree ---- */
  /** Path of the root shown in the tab. */
  get root() {
    const r = this.settings.roots[this.settings.activeRoot];
    return r ? r.path : ''; // fork: no section chosen yet
  }
  rootFolder(path = this.root) {
    if (!path) return null;
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
