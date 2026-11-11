Object.assign(CardsView.prototype, {
  /* sidebar ------------------------------------------------------------- */
  renderSidebar(folder, dir = 0) {
    const body = this.bodyEl;
    const scroll = this.scroller.scrollTop;
    body.empty();
    // rows slide in when you change folder (and on first open), not on background refreshes
    body.removeClass('nd-side-in-fwd', 'nd-side-in-back', 'nd-side-in-fade');
    const animate = dir !== 0 || !this.sideShown;
    this.sideShown = true;
    const finishAnim = () => {
      if (!animate) return;
      let i = 0;
      for (const el of Array.from(body.children)) el.style.setProperty('--i', String(Math.min(i++, 14)));
      void body.offsetWidth;
      body.addClass(dir > 0 ? 'nd-side-in-fwd' : dir < 0 ? 'nd-side-in-back' : 'nd-side-in-fade');
      window.clearTimeout(this.sideAnimTimer);
      this.sideAnimTimer = window.setTimeout(() => body.removeClass('nd-side-in-fwd', 'nd-side-in-back', 'nd-side-in-fade'), 700);
    };
    const q = this.query;
    if (q) {
      const hits = this.app.vault.getMarkdownFiles().filter((f) => this.matchQuery(f)).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 60);
      body.createDiv({ cls: 'nd-section-k', text: `Matches · ${hits.length}` });
      for (const f of hits) this.sideNote(body, f, true);
      if (!hits.length) emptyState(body, 'Nothing matches');
      this.toneRows(body);
      return finishAnim();
    }
    const pins = this.plugin.settings.pinnedFolders.filter((p) => this.app.vault.getAbstractFileByPath(p) instanceof TFolder);
    if (pins.length) {
      body.createDiv({ cls: 'nd-section-k', text: 'Pinned folders' });
      for (const p of pins) {
        const fd = this.app.vault.getAbstractFileByPath(p);
        const info = this.folderInfo(fd);
        const row = body.createDiv('nd-side-pin' + (p === this.path ? ' is-current' : ''));
        this.folderIcon(row, info.cat, p);
        row.createSpan({ cls: 'nd-side-name', text: fd.name });
        row.createSpan({ cls: 'nd-side-count', text: String(info.notes.length + info.other) });
        tip(row, `${p} · right-click to unpin`);
        row.addEventListener('click', () => this.navigate(p, 1));
        row.addEventListener('auxclick', (e) => e.button === 1 && this.plugin.openCardsAt(p, true));
        row.addEventListener('contextmenu', (e) => this.folderMenu(fd, e));
        this.makeDropTarget(row, () => p);
      }
    }
    // browse: current folder
    const head = body.createDiv('nd-side-browse');
    const up = button(head, { icon: 'arrow-up', cls: 'nd-icon-btn', title: 'Up a folder', onClick: () => this.goUp() });
    up.toggleClass('is-disabled', !folder.parent);
    this.makeDropTarget(up, () => this.parentPath());
    // only the folder you're in, not the whole path (full path on hover)
    const label = head.createSpan({ cls: 'nd-section-k', text: folder.path === '/' ? this.app.vault.getName() : folder.name });
    if (folder.path !== '/') tip(label, folder.path);
    button(head, { icon: 'file-plus', cls: 'nd-icon-btn nd-side-add is-note', title: 'New note here', onClick: () => this.plugin.newNote(this.path) });
    button(head, { icon: 'folder-plus', cls: 'nd-icon-btn nd-side-add is-folder', title: 'New folder here', onClick: () => this.plugin.newFolder(this.path) });
    const kids = folder.children.slice();
    const dirs = kids.filter((c) => c instanceof TFolder).sort(bangFirst((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
    const files = kids.filter((c) => c instanceof TFile).sort(this.sorter());
    for (const d of dirs) {
      const info = this.folderInfo(d);
      const row = body.createDiv('nd-side-row is-folder');
      row.dataset.path = d.path;
      if (info.cat) row.style.setProperty('--row-tint', catColor(info.cat));
      this.folderIcon(row, info.cat, d.path);
      if (d.name.startsWith('!')) icon(row, 'pin', 'nd-ico nd-side-bang');
      row.createSpan({ cls: 'nd-side-name', text: d.name });
      row.createSpan({ cls: 'nd-side-count', text: String(info.notes.length + info.other) });
      row.addEventListener('click', () => this.navigate(d.path, 1));
      row.addEventListener('contextmenu', (e) => this.folderMenu(d, e));
      this.dragFolder(row, d);
      this.makeDropTarget(row, () => d.path);
    }
    for (const f of files.slice(0, this.limit)) this.sideNote(body, f, false);
    if (files.length > this.limit) {
      const more = body.createDiv({ cls: 'nd-side-more', text: `Show ${files.length - this.limit} more…` });
      more.addEventListener('click', () => ((this.limit += 240), this.renderSidebar(this.folder())));
    }
    if (!dirs.length && !files.length) emptyState(body, 'Empty folder');
    // inside a folder, its contents sit a little indented under it
    if (folder.parent) for (let el = head.nextElementSibling; el; el = el.nextElementSibling) el.addClass('is-child');
    this.toneRows(body);
    finishAnim();
    this.scroller.scrollTop = animate && dir !== 0 ? 0 : scroll;
  },
  /** Folders in shades of the accent (red), notes in shades of go (lime); shades alternate per kind. */
  toneRows(body) {
    let dirs = 0;
    let notes = 0;
    for (const el of Array.from(body.children)) {
      if (el.matches('.nd-side-pin, .nd-side-row.is-folder')) el.addClass(dirs++ % 2 ? 'tone-b' : 'tone-a');
      else if (el.matches('.nd-side-row.is-note')) el.addClass(notes++ % 2 ? 'tone-b' : 'tone-a');
      else if (el.matches('.nd-section-k')) dirs = notes = 0;
    }
  },
  sideNote(parent, f, showPath) {
    const row = parent.createDiv('nd-side-row is-note');
    row.dataset.path = f.path;
    if (this.plugin.lastFile && this.plugin.lastFile.path === f.path) row.addClass('is-active');
    const cat = fileCategory(this.app, f);
    if (cat && cat !== 'untracked') row.style.setProperty('--row-accent', catColor(cat));
    if (f.name.startsWith('!')) icon(row, 'pin', 'nd-ico nd-side-bang');
    row.createSpan({ cls: 'nd-side-name', text: f.extension === 'md' ? f.basename : f.name });
    const t = Math.max(f.stat.mtime, this.plugin.settings.seen[f.path] || 0);
    row.createSpan({ cls: 'nd-side-count', text: showPath && f.parent && f.parent.path !== '/' ? f.parent.path : shortAgo(t) });
    if (this.needsRevisit(f)) row.addClass('needs-revisit');
    this.plugin.bindFileMouse(row, f, this);
  },

  canMove(f, dest) {
    if (dest == null) return false;
    const parent = f.parent ? f.parent.path : '/';
    if (parent === dest) return false;
    if (f instanceof TFolder && (dest === f.path || dest.startsWith(f.path + '/'))) return false;
    return true;
  },
  /** What is being dragged over a folder target: vault items to move, or files from the computer to copy in. */
  dropItems(e, dest) {
    if (dest == null) return null;
    // a card or row of ours, else something from Obsidian's file list (one item or a selection)
    const d = this.app.dragManager && this.app.dragManager.draggable;
    const own = this.plugin.dragging ? [this.plugin.dragging] : d ? (d.files || (d.file ? [d.file] : [])) : [];
    const items = own.filter((f) => (f instanceof TFile || f instanceof TFolder) && this.canMove(f, dest));
    if (items.length) return { move: items };
    if (own.length) return null; // vault items that are already there
    return e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files') ? { copy: true } : null;
  },
  makeDropTarget(el, getPath) {
    el.addEventListener('dragover', (e) => {
      const what = this.dropItems(e, getPath());
      if (!what) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = what.copy ? 'copy' : 'move';
      el.addClass('is-drop');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.removeClass('is-drop');
    });
    el.addEventListener('drop', async (e) => {
      el.removeClass('is-drop');
      const dest = getPath();
      const what = this.dropItems(e, dest);
      if (!what) return;
      e.preventDefault();
      e.stopPropagation();
      this.plugin.dragging = null;
      if (what.copy) return this.plugin.importFiles(e.dataTransfer, dest);
      for (const f of what.move) await this.plugin.moveTo(f, dest);
    });
  },
});
