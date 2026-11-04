/* ------------------------------------------------------------------ */
/* Card explorer                                                       */
/* ------------------------------------------------------------------ */

const CARD_CHIPS = [
  ['all', 'All'],
  ['school', 'School'],
  ['projects', 'Projects'],
  ['operations', 'Operations'],
  ['admin', 'Admin'],
  ['revisit', 'Revisit'],
  ['untracked', 'Untracked'],
];

class CardsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.path = '/';
    this.backStack = [];
    this.fwdStack = [];
    this.query = '';
    this.chip = 'all';
    this.limit = 240;
    this.excerpts = new Map();
    this.firstPaint = true;
  }
  getViewType() {
    return VIEW_CARDS;
  }
  getDisplayText() {
    return 'Cards';
  }
  getIcon() {
    return 'layout-grid';
  }
  getState() {
    return { path: this.path };
  }
  async setState(state, result) {
    if (state && typeof state.path === 'string' && this.app.vault.getAbstractFileByPath(state.path) instanceof TFolder) {
      if (state.path !== this.path && this.bodyEl) this.backStack.push(this.path);
      this.path = state.path;
    }
    await super.setState(state, result);
    if (this.bodyEl) this.refresh(1);
  }
  isSidebar() {
    const ws = this.app.workspace;
    return this.leaf.getRoot && this.leaf.getRoot() !== ws.rootSplit;
  }

  /** Build the sidebar or tab UI; called again when the view moves between them. */
  build() {
    this.hidePreview(true);
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
    const root = this.contentEl;
    root.empty();
    root.removeClass('nd-pattern-host', 'nd-has-pattern');
    root.addClass('nd-root', 'nd-cards');
    this.sidebar = this.isSidebar();
    this.navigation = !this.sidebar; // in the main pane it joins Back / Forward
    root.toggleClass('is-sidebar', this.sidebar);
    this.sideShown = false;
    this.firstPaint = true;
    if (this.sidebar) this.buildSidebar(root);
    else this.buildTab(root);
  }
  async onOpen() {
    this.build();
    const re = debounce(() => this.refresh(0, true), 250, true);
    this.registerEvent(this.app.vault.on('create', re));
    this.registerEvent(this.app.vault.on('delete', re));
    this.registerEvent(this.app.vault.on('rename', re));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        this.updateCard(f);
        // a shown note's `created` changed: its place in the sort may have changed
        const seen = this.createdSeen && this.createdSeen.get(f.path);
        if (seen != null && seen !== createdOf(this.app, f)) re();
      }),
    );
    this.registerEvent(this.app.workspace.on('file-open', () => this.markActive()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.markNav()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.markNav()));
    this.registerEvent(this.app.workspace.on('neon-deck:slots-changed', () => this.renderNav()));
    this.registerEvent(this.app.workspace.on('neon-deck:pins-changed', () => this.refresh(0, true)));
    this.registerEvent(this.app.workspace.on('neon-deck:seen-changed', debounce(() => this.refresh(0, true), 600, true)));
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.isSidebar() === this.sidebar) return;
        this.build();
        this.refresh(0);
      }),
    );
    this.registerDomEvent(this.contentEl, 'mouseup', (e) => {
      if (e.button === 3) {
        e.preventDefault();
        this.goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        this.goForward();
      }
    });
    this.refresh(0);
  }
  async onClose() {
    this.hidePreview(true);
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }

  buildTab(root) {
    root.addClass('nd-pattern-host');
    const bar = root.createDiv('nd-cards-bar');
    const nav = bar.createDiv('nd-nav');
    this.backBtn = button(nav, { icon: 'arrow-left', cls: 'nd-icon-btn', title: 'Back (mouse back button)', onClick: () => this.goBack() });
    this.fwdBtn = button(nav, { icon: 'arrow-right', cls: 'nd-icon-btn', title: 'Forward (mouse forward button)', onClick: () => this.goForward() });
    this.upBtn = button(nav, { icon: 'arrow-up', cls: 'nd-icon-btn', title: 'Up a folder — drop cards here to move them up', onClick: () => this.goUp() });
    this.makeDropTarget(this.upBtn, () => this.parentPath());
    this.crumbs = bar.createDiv('nd-crumbs');
    const tools = bar.createDiv('nd-tools');
    this.buildSearch(tools);
    const mode = tools.createDiv('nd-seg nd-mode-seg');
    this.modeBtns = {};
    for (const [k, label, ic] of [['cards', 'Cards', 'layout-grid'], ['list', 'List', 'list']]) {
      const b = button(mode, { icon: ic, text: label, cls: 'nd-seg-btn', onClick: () => this.setMode(k) });
      this.modeBtns[k] = b;
    }
    this.sortBtn = button(tools, { icon: 'arrow-up-down', text: 'Sort', cls: 'nd-sort-btn', onClick: (e) => this.sortMenu(e) });
    button(tools, { icon: 'plus', text: 'Note', cls: 'mod-cta', title: 'New note here', onClick: () => this.plugin.newNote(this.path) });
    button(tools, { icon: 'folder-plus', cls: 'nd-icon-btn', title: 'New folder here', onClick: () => this.plugin.newFolder(this.path) });
    this.chipsEl = root.createDiv('nd-pills nd-cat-chips');
    this.scroller = root.createDiv('nd-cards-scroll');
    this.bodyEl = this.scroller.createDiv('nd-cards-body');
    this.scroller.addEventListener('contextmenu', (e) => {
      if (e.target !== this.scroller && e.target !== this.bodyEl) return;
      e.preventDefault();
      const m = new Menu();
      m.addItem((i) => i.setTitle('New note here').setIcon('file-plus').onClick(() => this.plugin.newNote(this.path)));
      m.addItem((i) => i.setTitle('New folder here').setIcon('folder-plus').onClick(() => this.plugin.newFolder(this.path)));
      m.showAtMouseEvent(e);
    });
    this.makeDropTarget(this.scroller, () => this.path);
    this.pattern = new PatternLayer(this.plugin, root, this.scroller, '.nd-ci');
  }
  buildSidebar(root) {
    this.navEl = root.createDiv('nd-side-nav');
    this.renderNav();
    const top = root.createDiv('nd-side-top');
    this.buildSearch(top);
    this.scroller = root.createDiv('nd-cards-scroll');
    this.bodyEl = this.scroller.createDiv('nd-side-body');
    this.makeDropTarget(this.scroller, () => this.path);
  }
  /** Sidebar nav: each item shows its view in the main pane. Tickets, Time… come from the other plugins' actions. */
  renderNav() {
    const el = this.navEl;
    if (!el || !this.sidebar) return;
    el.empty();
    const p = this.plugin;
    const items = [
      { icon: 'layout-dashboard', label: 'Dashboard', view: VIEW_DASH, run: () => p.activate(VIEW_DASH, 'tab') },
      { icon: 'layout-grid', label: 'Cards', view: VIEW_CARDS, run: () => p.activate(VIEW_CARDS, 'tab') },
      ...[...p.actions.values()].filter((a) => a.view).sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
      { icon: 'waypoints', label: 'Graph', view: VIEW_GRAPH, run: () => p.activate(VIEW_GRAPH, 'tab') },
    ];
    for (const it of items) {
      const b = el.createEl('button', { cls: 'nd-side-nav-item', attr: { type: 'button', 'data-view': it.view } });
      icon(b, it.icon);
      b.createSpan({ text: it.label });
      b.addEventListener('click', () => it.run());
    }
    this.markNav();
  }
  /** Highlight the nav item for what the main pane shows. */
  markNav() {
    if (!this.navEl) return;
    const ws = this.app.workspace;
    const main = ws.getMostRecentLeaf(ws.rootSplit);
    const type = main ? main.view.getViewType() : '';
    for (const b of this.navEl.querySelectorAll('.nd-side-nav-item')) b.toggleClass('is-active', b.dataset.view === type);
  }
  buildSearch(parent) {
    const search = parent.createDiv('nd-search');
    icon(search, 'search');
    this.searchInput = search.createEl('input', { attr: { type: 'search', placeholder: 'Filter… (#tag works)' } });
    this.searchInput.addEventListener(
      'input',
      debounce(() => {
        this.query = this.searchInput.value.trim().toLowerCase();
        this.refresh(0, true);
      }, 160, true),
    );
  }

  folder() {
    const f = this.app.vault.getAbstractFileByPath(this.path);
    return f instanceof TFolder ? f : this.app.vault.getRoot();
  }
  parentPath() {
    const f = this.folder();
    return f.parent ? f.parent.path : null;
  }
  navigate(path, dir) {
    if (path === this.path) return;
    this.backStack.push(this.path);
    this.fwdStack = [];
    this.path = path;
    this.limit = 240;
    this.refresh(dir);
    this.app.workspace.requestSaveLayout();
  }
  goBack() {
    if (!this.backStack.length) return;
    this.fwdStack.push(this.path);
    this.path = this.backStack.pop();
    this.refresh(-1);
  }
  goForward() {
    if (!this.fwdStack.length) return;
    this.backStack.push(this.path);
    this.path = this.fwdStack.pop();
    this.refresh(1);
  }
  goUp() {
    const p = this.parentPath();
    if (p) this.navigate(p, -1);
  }
  setMode(m) {
    this.plugin.settings.cardMode = m;
    this.plugin.saveSettings();
    this.refresh(0);
  }
  sortMenu(e) {
    const m = new Menu();
    const opts = [
      ['created-prop', 'Created property'],
      ['modified', 'Recently modified'],
      ['created', 'Recently created (file)'],
      ['revisit', 'Revisit first'],
      ['name', 'Name A → Z'],
      ['name-desc', 'Name Z → A'],
    ];
    for (const [k, label] of opts) {
      m.addItem((i) =>
        i.setTitle(label).setChecked(this.plugin.settings.cardSort === k).onClick(async () => {
          this.plugin.settings.cardSort = k;
          await this.plugin.saveSettings();
          this.refresh(0, true, true);
        }),
      );
    }
    m.showAtMouseEvent(e);
  }
  /** Notes in sort order: names starting with "!" first (more "!" higher), then the chosen sort. */
  sorter() {
    const s = this.plugin.settings.cardSort;
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    let cmp = (a, b) => b.stat.mtime - a.stat.mtime;
    if (s === 'name') cmp = byName;
    else if (s === 'name-desc') cmp = (a, b) => byName(b, a);
    else if (s === 'created') cmp = (a, b) => b.stat.ctime - a.stat.ctime;
    else if (s === 'revisit') cmp = (a, b) => this.revisitAge(b) - this.revisitAge(a) || b.stat.mtime - a.stat.mtime;
    else if (s === 'created-prop') {
      const keys = (this.createdSeen = new Map()); // one date per note per sort; also lets 'changed' spot a new date
      const key = (f) => (keys.has(f.path) ? keys.get(f.path) : keys.set(f.path, createdOf(this.app, f)).get(f.path));
      cmp = (a, b) => key(b) - key(a) || byName(a, b);
    }
    return bangFirst(cmp);
  }
  /** Days since the note was last opened (or marked revisited); -1 when it isn't a school note. */
  revisitAge(f) {
    if (!(f instanceof TFile) || f.extension !== 'md' || fileCategory(this.app, f) !== 'school') return -1;
    const seen = Math.max(this.plugin.settings.seen[f.path] || 0, f.stat.ctime);
    return Math.floor((Date.now() - seen) / 864e5);
  }
  needsRevisit(f) {
    return this.revisitAge(f) >= this.plugin.settings.revisitDays;
  }
  matchQuery(f) {
    const q = this.query;
    if (!q) return true;
    const hay = [f.path.toLowerCase()];
    if (f instanceof TFile) {
      const c = this.app.metadataCache.getFileCache(f);
      const tags = c ? getAllTags(c) : null;
      if (tags) hay.push(tags.join(' ').toLowerCase());
    }
    const h = hay.join(' ');
    return q.split(/\s+/).every((t) => h.includes(t));
  }
  matchChip(f) {
    const c = this.chip;
    if (c === 'all') return true;
    if (c === 'revisit') return this.needsRevisit(f);
    const cat = fileCategory(this.app, f);
    if (c === 'untracked') return f.extension === 'md' && (!cat || cat === 'untracked');
    return cat === c;
  }
  /** Notes in a folder (recursive), with category counts. */
  folderInfo(folder) {
    const notes = [];
    const walk = (fd) => {
      for (const c of fd.children) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') notes.push(c);
      }
    };
    walk(folder);
    const counts = {};
    for (const f of notes) {
      const c = fileCategory(this.app, f);
      if (c && c !== 'untracked') counts[c] = (counts[c] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const cat = top && top[1] * 2 >= notes.length ? top[0] : null;
    return { notes, cat };
  }

  renderChips() {
    const el = this.chipsEl;
    if (!el) return;
    el.empty();
    const folder = this.folder();
    const scope = this.query ? this.app.vault.getMarkdownFiles() : this.folderInfo(folder).notes;
    const revisit = scope.filter((f) => this.needsRevisit(f)).length;
    for (const [k, label] of CARD_CHIPS) {
      const b = el.createEl('button', { cls: `nd-pill-btn chip-${k}` + (this.chip === k ? ' is-on' : '') });
      if (k === 'revisit') icon(b, 'rotate-ccw');
      b.createSpan({ text: k === 'revisit' && revisit ? `${label} (${revisit})` : label });
      if (CATS.includes(k)) b.style.setProperty('--pill-accent', catColor(k));
      b.addEventListener('click', () => {
        this.chip = this.chip === k ? 'all' : k;
        this.refresh(0, true, true);
      });
    }
  }

  /** dir: 1 forward, -1 back, 0 fade · quiet: keep scroll, no entry animation · flip: slide cards into their new places */
  refresh(dir = 0, quiet = false, flip = false) {
    if (!this.bodyEl) return;
    this.hidePreview(true);
    const folder = this.folder();
    this.path = folder.path;
    if (this.sidebar) return this.renderSidebar(folder, dir);
    this.renderCrumbs(folder);
    this.renderChips();
    this.backBtn.toggleClass('is-disabled', !this.backStack.length);
    this.fwdBtn.toggleClass('is-disabled', !this.fwdStack.length);
    this.upBtn.toggleClass('is-disabled', !folder.parent);
    const mode = this.plugin.settings.cardMode;
    for (const [k, b] of Object.entries(this.modeBtns)) b.toggleClass('is-active', k === mode);
    const sortLabel = { 'created-prop': 'Created', modified: 'Recent', created: 'Created (file)', revisit: 'Revisit first', name: 'A → Z', 'name-desc': 'Z → A' }[this.plugin.settings.cardSort] || 'Recent';
    this.sortBtn.querySelector('.nd-btn-label').setText(`Sort: ${sortLabel}`);

    const deep = !!this.query || this.chip !== 'all';
    let folders;
    let files;
    if (this.query) {
      const all = this.app.vault.getAllLoadedFiles();
      folders = all.filter((f) => f instanceof TFolder && f.path !== '/' && this.matchQuery(f));
      files = all.filter((f) => f instanceof TFile && this.matchQuery(f) && this.matchChip(f));
    } else {
      folders = folder.children.filter((c) => c instanceof TFolder);
      files = (this.chip === 'all' ? folder.children.filter((c) => c instanceof TFile) : this.folderInfo(folder).notes).filter((f) => this.matchChip(f));
    }
    const finfo = new Map(folders.map((f) => [f, this.folderInfo(f)]));
    if (CATS.includes(this.chip)) folders = folders.filter((f) => finfo.get(f).cat === this.chip);
    else if (this.chip === 'revisit') folders = folders.filter((f) => finfo.get(f).notes.some((n) => this.needsRevisit(n)));
    else if (this.chip === 'untracked') folders = folders.filter((f) => !finfo.get(f).cat);
    folders.sort(bangFirst((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    files.sort(this.sorter());

    const before = flip ? this.snapshot() : null;
    const scroll = this.scroller.scrollTop;
    const body = this.bodyEl;
    body.empty();
    body.toggleClass('is-list', mode === 'list');
    body.removeClass('nd-in-fwd', 'nd-in-back', 'nd-in-fade');
    if (!quiet || this.firstPaint) {
      void body.offsetWidth;
      body.addClass(dir > 0 ? 'nd-in-fwd' : dir < 0 ? 'nd-in-back' : 'nd-in-fade');
    }
    this.firstPaint = false;
    this.incoming = this.incomingLinks();
    if (!folders.length && !files.length) {
      const e = body.createDiv('nd-cards-empty');
      e.createDiv({ cls: 'nd-cards-empty-art', text: this.query || deep ? '∅' : '✦' });
      e.createDiv({ text: this.query || deep ? 'Nothing matches that filter' : 'This folder is empty' });
      if (!this.query && !deep) button(e, { icon: 'file-plus', text: 'New note here', cls: 'mod-cta', onClick: () => this.plugin.newNote(this.path) });
      return;
    }
    let i = 0;
    if (folders.length) {
      body.createDiv({ cls: 'nd-section-k', text: 'Folders' });
      const g = body.createDiv('nd-ci-grid is-folders');
      for (const f of folders) this.folderCard(g, f, finfo.get(f), i++);
    }
    if (files.length) {
      const where = this.query ? 'matching' : `in ${folder.path === '/' ? this.app.vault.getName() : folder.name}`;
      body.createDiv({ cls: 'nd-section-k', text: `Notes ${where} · ${files.length}` });
      const g = body.createDiv('nd-ci-grid is-notes');
      for (const f of files.slice(0, this.limit)) this.fileCard(g, f, i++, deep);
      if (files.length > this.limit) {
        const more = g.createDiv('nd-ci nd-more');
        more.setText(`Show ${files.length - this.limit} more…`);
        more.addEventListener('click', () => {
          this.limit += 240;
          this.refresh(0, true);
        });
      }
    }
    this.scroller.scrollTop = quiet ? scroll : 0;
    if (before) this.playFlip(before);
    if (this.pattern) this.pattern.kick();
  }
  snapshot() {
    const m = new Map();
    this.bodyEl.querySelectorAll('.nd-ci[data-path]').forEach((el) => m.set(el.dataset.path, el.getBoundingClientRect()));
    return m;
  }
  playFlip(before) {
    if (prefersReducedMotion()) return;
    this.bodyEl.querySelectorAll('.nd-ci[data-path]').forEach((el) => {
      const r0 = before.get(el.dataset.path);
      if (!r0) {
        el.addClass('is-new');
        return;
      }
      const r1 = el.getBoundingClientRect();
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      window.requestAnimationFrame(() => {
        el.style.transition = '';
        el.style.transform = '';
      });
    });
  }
  incomingLinks() {
    const rl = this.app.metadataCache.resolvedLinks;
    const inc = new Map();
    for (const src in rl)
      for (const dst in rl[src]) {
        if (!inc.has(dst)) inc.set(dst, []);
        inc.get(dst).push(src);
      }
    return inc;
  }
  linkCount(f) {
    const out = this.app.metadataCache.resolvedLinks[f.path];
    return (out ? Object.keys(out).length : 0) + ((this.incoming && this.incoming.get(f.path)) || []).length;
  }

}
function shortAgo(t) {
  const m = Math.max(0, (Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 1440 * 60) return `${Math.round(m / 1440)}d`;
  return moment(t).format('MMM YY');
}

