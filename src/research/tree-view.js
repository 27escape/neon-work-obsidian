/* ---- the Research tab: one topic tree per section, or the notes by status ------------ */
class ResearchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_RESEARCH;
  }
  getDisplayText() {
    return 'Research';
  }
  getIcon() {
    return 'library';
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'nr-view');
    this.scroller = this.contentEl.createDiv('nr-scroll');
    const mount = () => {
      if (this.pattern) this.pattern.destroy();
      const api = deckApi(this.app);
      this.pattern = api && api.mountPattern ? api.mountPattern(this.contentEl, this.scroller, '.nd-card, .nd-hero') : null;
    };
    mount();
    this.register(() => this.pattern && this.pattern.destroy());
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', mount));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.pattern && (this.pattern.destroy(), (this.pattern = null))));
    const soon = debounce(() => this.render(), 150, true);
    // f: one note's text changed but not its cards, so only its row's "edited" time moves; 'now': a click
    this.register(this.plugin.onChange((f) => (f === 'now' ? this.render() : f ? this.touchRow(f) : soon())));
    // hidden tabs skip redraws and catch up when shown
    // checked a frame later: the event fires before the tab is actually shown
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.stale && window.requestAnimationFrame(() => this.stale && this.isShown() && this.render())));
    this.first = true;
    this.render();
  }
  isShown() {
    return this.contentEl.isConnected && this.contentEl.offsetParent !== null;
  }
  touchRow(f) {
    const r = this.rows && this.rows.get(f.path);
    if (r) r.setText(shortAgo(f.stat.mtime));
  }
  async onClose() {
    this.contentEl.empty();
  }
  render() {
    const p = this.plugin;
    const sc = this.scroller;
    if (!sc) return;
    if (!this.first && !this.isShown()) return void (this.stale = true);
    this.stale = false;
    this.rows = new Map(); // note path -> its "edited" cell
    const top = sc.scrollTop;
    sc.empty();
    const root = sc.createDiv('nr-inner' + (this.first ? ' is-entering' : ''));
    if (this.first) {
      this.first = false;
      window.setTimeout(() => root.removeClass('is-entering'), 900);
    }
    const byStatus = this.tab === 'status';
    const rootFolder = p.rootFolder();
    const hero = root.createDiv('nd-hero nr-hero');
    const l = hero.createDiv('nr-hero-l');
    const roots = p.settings.roots;
    const cur = roots[p.settings.activeRoot];
    l.createDiv({ cls: 'nd-hero-greet', text: cur ? cur.name : 'Research' });
    if (rootFolder) {
      const nTopics = rootFolder.children.filter((c) => c instanceof TFolder).length;
      const nNotes = p.researchNotes().length;
      l.createDiv({ cls: 'nr-hero-sub', text: `${nTopics} topic${nTopics === 1 ? '' : 's'} · ${nNotes} note${nNotes === 1 ? '' : 's'}` });
      l.createDiv({ cls: 'nr-hero-sub', text: statusLine(p.statusSummary(rootFolder)) });
      const acts = hero.createDiv('nr-acts');
      button(acts, { icon: 'folder-plus', text: 'Topic', cls: 'mod-cta', title: 'New topic', onClick: () => p.newTopic(rootFolder) });
    } else {
      l.createDiv({ cls: 'nr-hero-sub', text: cur ? `Folder “${cur.path}” not found` : 'No section yet: choose a folder to start' });
    }
    pills(root, [['topics', 'Topics'], ['status', 'By status']], byStatus ? 'status' : 'topics', (v) => {
      if (v === this.tab || (v === 'topics' && !this.tab)) return;
      this.switchDir = v === 'status' ? 1 : -1;
      this.tab = v;
      this.render();
    }, 'nr-view-tabs');
    {
      // section switch on its own row under the title: click to switch, right-click to rename/remove, + to add
      const sw = pills(hero, roots.map((r, i) => [i, r.name]), p.settings.activeRoot, (i) => p.setActiveRoot(i), 'nr-roots');
      for (const [i, btn] of sw.btns) {
        tip(btn, roots[i].path);
        btn.addEventListener('contextmenu', (e) => (e.preventDefault(), p.sectionMenu(i, e)));
      }
      const add = sw.el.createEl('button', { cls: 'nd-pill-btn nr-root-add', attr: { type: 'button', 'aria-label': 'Add a section (folder)' } });
      setIcon(add, 'plus');
      tip(add, 'Add a section: pick or create a folder');
      add.addEventListener('click', () => p.pickSection());
    }

    // the tree sits in one panel (a "window" for the pattern, like the dashboard cards)
    const panel = root.createDiv('nd-card nr-panel');
    if (this.switchDir) {
      panel.addClass('is-switch');
      panel.style.setProperty('--dir', String(this.switchDir));
      this.switchDir = 0;
    }
    if (!rootFolder) {
      const e = panel.createDiv('nr-empty');
      button(e, { icon: 'folder-search', text: roots.length ? 'Choose another folder' : 'Choose a research folder', cls: 'mod-cta', onClick: () => p.pickSection() });
    } else if (byStatus) {
      this.renderStatus(panel);
    } else {
      const kids = this.childrenOf(rootFolder);
      if (!kids.folders.length && !kids.notes.length) {
        const e = panel.createDiv('nr-empty');
        button(e, { icon: 'folder-plus', text: 'Add your first topic', cls: 'mod-cta', onClick: () => p.newTopic(rootFolder) });
      } else {
        const tree = panel.createDiv('nr-tree');
        for (const f of kids.folders) this.folderRow(tree, f, 0);
        for (const f of kids.notes) this.noteRow(tree, f, 0);
      }
    }
    madeWith(root.createDiv('nr-foot'), 'Neon Research');
    sc.scrollTop = top;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  childrenOf(folder) {
    const folders = [];
    const notes = [];
    for (const c of folder.children || []) {
      if (c instanceof TFolder) folders.push(c);
      else if (c instanceof TFile && c.extension === 'md') notes.push(c);
    }
    // names starting with "!" first (as in the Neon sidebar), then A → Z
    const bangs = (f) => (f.name.match(/^!+/) || [''])[0].length;
    const by = (a, b) => bangs(b) - bangs(a) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return { folders: folders.sort(by), notes: notes.sort(by) };
  }
  folderRow(parent, folder, depth) {
    const p = this.plugin;
    const open = p.isOpen(folder.path);
    const wrap = parent.createDiv('nr-node');
    const row = wrap.createDiv('nr-row is-folder' + (open ? ' is-open' : ''));
    row.style.setProperty('--depth', String(depth));
    const chev = icon(row, open ? 'chevron-down' : 'chevron-right', 'nd-ico nr-chev');
    const fico = icon(row, open ? 'folder-open' : 'folder', 'nd-ico nr-folder-ico');
    row.createSpan({ cls: 'nr-name', text: p.folderLabel(folder) });
    // right-hand columns have fixed widths so they line up from row to row
    const n = p.notesUnder(folder).length;
    row.createSpan({ cls: 'nr-col nr-c-count', text: `${n} note${n === 1 ? '' : 's'}` });
    const toResearch = p.statusSummary(folder).open;
    const dc = row.createSpan('nr-col nr-c-due');
    if (toResearch) dc.createSpan({ cls: 'nr-due', text: `${toResearch} to research` });
    row.createSpan('nr-col nr-c-when');
    const acts = row.createDiv('nr-row-acts');
    button(acts, { icon: 'plus', cls: 'nd-icon-btn', title: 'Add a subtopic or a note', onClick: (e) => (e.stopPropagation(), this.addMenu(folder, e)) });
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'Rename, delete', onClick: (e) => (e.stopPropagation(), this.folderMenu(folder, e)) });
    const fill = () => {
      const kids = this.childrenOf(folder);
      const box = wrap.createDiv('nr-kids');
      box.style.setProperty('--depth', String(depth)); // its guide line sits under this folder's chevron
      for (const f of kids.folders) this.folderRow(box, f, depth + 1);
      for (const f of kids.notes) this.noteRow(box, f, depth + 1);
      return box;
    };
    // open/close right here, without redrawing the tree
    row.addEventListener('click', () => {
      const now = !p.isOpen(folder.path);
      p.setOpen(folder.path, now);
      row.toggleClass('is-open', now);
      setIcon(chev, now ? 'chevron-down' : 'chevron-right');
      setIcon(fico, now ? 'folder-open' : 'folder');
      const old = wrap.querySelector(':scope > .nr-kids');
      if (old) slide(old, false);
      if (now) slide(fill(), true);
      if (this.pattern && this.pattern.kick) this.pattern.kick();
    });
    row.addEventListener('contextmenu', (e) => (e.preventDefault(), this.folderMenu(folder, e)));
    if (open) fill();
  }
  noteRow(parent, file, depth) {
    const p = this.plugin;
    const row = parent.createDiv('nr-row is-note');
    row.style.setProperty('--depth', String(depth));
    row.createSpan('nr-chev-space');
    icon(row, 'file-text', 'nd-ico nr-note-ico');
    row.createSpan({ cls: 'nr-name', text: file.basename });
    const st = p.statusOf(file);
    row.createSpan('nr-col nr-c-count');
    const sc = row.createSpan('nr-col nr-c-due');
    if (st) sc.createSpan({ cls: `nr-status-pill is-${statusKind(st, p.doneStatuses())}`, text: st });
    const when = row.createSpan({ cls: 'nr-col nr-c-when', text: shortAgo(file.stat.mtime) });
    this.rows.set(file.path, when);
    tip(when, `Edited ${moment(file.stat.mtime).format('D MMM YYYY, HH:mm')}`);
    const acts = row.createDiv('nr-row-acts');
    acts.createSpan('nr-act-space'); // notes have one button: keep its column where folders have two
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'Rename, delete', onClick: (e) => (e.stopPropagation(), this.noteMenu(file, e)) });
    row.addEventListener('click', (e) => openFile(this.app, file, e));
    row.addEventListener('contextmenu', (e) => (e.preventDefault(), this.noteMenu(file, e)));
  }
  addMenu(folder, e) {
    const m = new Menu();
    m.addItem((i) => i.setTitle('New subtopic').setIcon('folder-plus').onClick(() => this.plugin.newTopic(folder)));
    m.addItem((i) => i.setTitle('New note').setIcon('file-plus').onClick(() => this.plugin.newNote(folder)));
    m.showAtMouseEvent(e);
  }
  folderMenu(folder, e) {
    const p = this.plugin;
    const m = new Menu();
    m.addItem((i) => i.setTitle('New subtopic').setIcon('folder-plus').onClick(() => p.newTopic(folder)));
    m.addItem((i) => i.setTitle('New note').setIcon('file-plus').onClick(() => p.newNote(folder)));
    m.addSeparator();
    m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => p.rename(folder)));
    m.addItem((i) => i.setTitle('Delete topic…').setIcon('trash-2').setWarning(true).onClick(() => p.remove(folder)));
    m.showAtMouseEvent(e);
  }
  noteMenu(file, e) {
    const p = this.plugin;
    const m = new Menu();
    m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => this.app.workspace.getLeaf('tab').openFile(file)));
    m.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => p.rename(file)));
    m.addItem((i) => i.setTitle('Delete note…').setIcon('trash-2').setWarning(true).onClick(() => p.remove(file)));
    m.showAtMouseEvent(e);
  }
}


/** Open (true) or close a folder's children with a short height slide; a closed box is removed. */
function slide(el, open) {
  if (prefersReducedMotion()) return open || el.remove();
  const h = el.scrollHeight;
  const a = el.animate(open ? [{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }] : [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: open ? 200 : 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  el.style.overflow = 'hidden';
  a.onfinish = () => (open ? (el.style.overflow = '') : el.remove());
}
