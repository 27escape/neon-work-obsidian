Object.assign(NeonDeck.prototype, {
  /* pins & seen -------------------------------------------------------------- */
  async togglePin(path) {
    const pins = this.settings.pinnedFolders;
    const i = pins.indexOf(path);
    if (i >= 0) pins.splice(i, 1);
    else pins.push(path);
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed');
  },
  /** A folder was renamed or moved: its pins and icon colours (and those of folders inside it) follow. */
  async renamePins(oldPath, newPath) {
    let hit = false;
    const move = (p) => (p === oldPath || p.startsWith(oldPath + '/') ? ((hit = true), newPath + p.slice(oldPath.length)) : p);
    this.settings.pinnedFolders = this.settings.pinnedFolders.map(move);
    const cols = this.settings.folderColors;
    for (const k of Object.keys(cols)) {
      const nk = move(k);
      if (nk !== k) ((cols[nk] = cols[k]), delete cols[k]);
    }
    if (!hit) return;
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed');
  },
  /** Icon colour of one folder; null goes back to the category colour. */
  async setFolderColor(path, color) {
    if (color && FOLDER_COLOR_RE.test(color)) this.settings.folderColors[path] = color;
    else delete this.settings.folderColors[path];
    await this.saveSettings();
    this.app.workspace.trigger('neon-deck:pins-changed'); // cards views redraw on it
  },
  markSeen(path, quiet) {
    this.settings.seen[path] = Date.now();
    this.saveSoon();
    if (!quiet) this.app.workspace.trigger('neon-deck:seen-changed');
  },

  /** Excluded folders/files (settings + other Neon plugins). Cached briefly: isExcluded runs once per note in vault scans. */
  excludedPaths() {
    const now = Date.now();
    if (!this._ex || now - this._exAt > 2000) {
      const ex = this.settings.excludeFolders.split(',').map((x) => normalizePath(x.trim())).filter((x) => x && x !== '/');
      for (const fn of this.excludes.values()) {
        try {
          ex.push(...(fn() || []).map(normalizePath));
        } catch (e) {
          console.error('Neon Deck exclude', e);
        }
      }
      this._ex = ex;
      this._exAt = now;
    }
    return this._ex;
  },
  isExcluded(f) {
    return this.excludedPaths().some((p) => f.path === p || f.path.startsWith(p + '/'));
  },
  currentFolder() {
    const f = this.app.workspace.getActiveFile();
    return f && f.parent ? f.parent.path : '/';
  },

  bindFileMouse(el, file, hoverParent) {
    el.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      const pop = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && this.services.get('ticketClick');
      if (pop && pop(file)) return;
      openFile(this.app, file, e);
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        openFile(this.app, file, { ctrlKey: true });
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fileMenu(file, e);
    });
    if (hoverParent && !(hoverParent instanceof CardsView)) {
      el.addEventListener('mouseover', (e) => {
        this.app.workspace.trigger('hover-link', {
          event: e,
          source: hoverParent.getViewType ? hoverParent.getViewType() : VIEW_DASH,
          hoverParent,
          targetEl: el,
          linktext: file.path,
        });
      });
    }
    el.setAttr('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      this.dragging = file;
      try {
        const dm = this.app.dragManager;
        dm.onDragStart(e, dm.dragFile(e, file));
      } catch (_) {
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', `[[${file.basename}]]`);
      }
    });
    el.addEventListener('dragend', () => (this.dragging = null));
  },
  fileMenu(file, e, extra) {
    const menu = new Menu();
    if (file instanceof TFile) {
      menu.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus').onClick(() => openFile(this.app, file, { ctrlKey: true })));
      menu.addItem((i) => i.setTitle('Open to the right').setIcon('separator-vertical').onClick(() => openFile(this.app, file, { shiftKey: true })));
    }
    if (extra) extra(menu);
    menu.addSeparator();
    menu.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => this.promptRename(file)));
    menu.addItem((i) => {
      i.setTitle('Delete').setIcon('trash-2').onClick(() => this.confirmDelete(file));
      if (i.setWarning) i.setWarning(true);
    });
    menu.addSeparator();
    this.app.workspace.trigger('file-menu', menu, file, 'neon-deck');
    menu.showAtMouseEvent(e);
  },
  promptRename(file) {
    const base = file instanceof TFile ? file.basename : file.name;
    new PromptModal(this.app, {
      title: 'Rename',
      value: base,
      cta: 'Rename',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name || name === base) return;
        const parent = file.parent && file.parent.path !== '/' ? file.parent.path + '/' : '';
        const np = normalizePath(parent + name + (file instanceof TFile ? `.${file.extension}` : ''));
        if (this.app.vault.getAbstractFileByPath(np)) return new Notice('Something with that name already exists');
        await this.app.fileManager.renameFile(file, np);
      },
    }).open();
  },
  confirmDelete(file) {
    new ConfirmModal(this.app, {
      title: 'Move to trash?',
      text: `“${file.name}”${file instanceof TFolder ? ' and everything inside it' : ''} will be moved to the trash.`,
      cta: 'Move to trash',
      onConfirm: () => this.app.fileManager.trashFile(file),
    }).open();
  },
  async moveTo(f, dest) {
    const np = normalizePath((dest === '/' ? '' : dest + '/') + f.name);
    if (this.app.vault.getAbstractFileByPath(np)) return new Notice('Something with that name already exists there');
    await this.app.fileManager.renameFile(f, np);
    new Notice(`Moved “${f.name}” → ${dest === '/' ? 'vault root' : dest}`);
  },
  /** Files dropped from the computer (PDF, DOCX, images, …): copied into dest; a taken name gets a number, nothing is overwritten. */
  async importFiles(dt, dest) {
    const where = dest === '/' ? 'vault root' : dest;
    // read entries now: the drop's data is gone after the first await
    const entries = Array.from(dt.items || []).map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry());
    const files = Array.from(dt.files);
    let n = 0;
    const free = async (dir, name) => {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let np = normalizePath(dir + name);
      for (let k = 1; await this.app.vault.adapter.exists(np); k++) np = normalizePath(`${dir}${base} ${k}${ext}`);
      return np;
    };
    const addFile = async (f, dir, inFolder) => {
      try {
        const np = await free(dir, f.name);
        // files of a dropped folder stay where they are: Neon Write's image mover skips these paths
        if (inFolder) (this.placed || (this.placed = new Set())).add(np);
        await this.app.vault.createBinary(np, await f.arrayBuffer());
        n++;
      } catch (err) {
        console.error('Neon Deck: could not add', f.name, err);
        new Notice(`Could not add “${f.name}”`);
      }
    };
    // a dropped folder comes in with everything inside it (issue 55); an existing name gets a number
    const addDir = async (entry, dir) => {
      const path = await free(dir, entry.name);
      await this.app.vault.createFolder(path);
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) {
          if (c.isDirectory) await addDir(c, path + '/');
          else await addFile(await new Promise((res, rej) => c.file(res, rej)), path + '/', true);
        }
      }
    };
    const dir = dest === '/' ? '' : dest + '/';
    for (const [i, f] of files.entries()) {
      try {
        if (entries[i] && entries[i].isDirectory) await addDir(entries[i], dir);
        else await addFile(f, dir);
      } catch (err) {
        console.error('Neon Deck: could not add', f.name, err);
        new Notice(`Could not add “${f.name}”`);
      }
    }
    if (n) new Notice(`Added ${n} file${n === 1 ? '' : 's'} → ${where}`);
  },

  /* file creation --------------------------------------------------------- */
  newNote(folder) {
    const svc = this.services.get('newNote');
    if (svc) return svc(folder || '/');
    new PromptModal(this.app, {
      title: 'New note',
      placeholder: 'Untitled',
      cta: 'Create',
      onSubmit: async (v) => {
        const f = await createUnique(this.app, folder, v || 'Untitled', '');
        await reusableLeaf(this.app).openFile(f, { active: true, state: { mode: 'source' } });
      },
    }).open();
  },
  newFolder(parent) {
    new PromptModal(this.app, {
      title: 'New folder',
      placeholder: 'Folder name',
      cta: 'Create',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name) return;
        const p = normalizePath((parent && parent !== '/' ? parent + '/' : '') + name);
        if (this.app.vault.getAbstractFileByPath(p)) return new Notice('That folder already exists');
        await this.app.vault.createFolder(p);
      },
    }).open();
  },
  async openToday() {
    openFile(this.app, await ensureToday(this.app));
  },

  /* vault data ------------------------------------------------------------- */
  collectVaultData() {
    const app = this.app;
    const md = app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
    const rl = app.metadataCache.resolvedLinks;
    const incoming = new Set();
    let links = 0;
    for (const src in rl)
      for (const dst in rl[src]) {
        links += rl[src][dst];
        incoming.add(dst);
      }
    const orphans = md.filter((f) => !incoming.has(f.path) && !(rl[f.path] && Object.keys(rl[f.path]).length));
    const startToday = moment().startOf('day').valueOf();
    const editedToday = md.filter((f) => f.stat.mtime >= startToday);
    return { md, links, orphans, editedToday };
  },
  async totalWords(md) {
    let total = 0;
    for (const f of md.slice(0, 5000)) {
      const c = this.wordCache.get(f.path);
      if (c && c.mtime === f.stat.mtime) {
        total += c.words;
        continue;
      }
      const words = countWords(await this.app.vault.cachedRead(f));
      this.wordCache.set(f.path, { mtime: f.stat.mtime, words });
      total += words;
    }
    return total;
  },
  stopwords() {
    const extra = this.settings.extraStopwords
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    return new Set([...STOPWORDS, ...extra]);
  },
});
