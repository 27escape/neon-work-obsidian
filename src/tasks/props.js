Object.assign(NeonTasks.prototype, {
  /* new notes ------------------------------------------------------------- */
  newNote(folder) {
    // fork: with customers, the card that knows the customer folder layout
    if (NEON_CATS.customers) return new CustomerNoteModal(this, { folder }).open();
    new NewNoteModal(this, { folder }).open();
  },
  /** Folders the plugins write to themselves (log notes, reviews, backups): never asked about. */
  isSystemPath(path) {
    const deck = neonPlugin(this.app, 'neon-deck');
    const time = neonPlugin(this.app, 'neon-time');
    const tickets = neonPlugin(this.app, 'neon-tickets');
    const dirs = [...SYSTEM_FOLDERS, deck && deck.settings && deck.settings.reviewFolder, time && time.settings && time.settings.logFolder, tickets && tickets.settings && tickets.settings.ticketFolder].filter(Boolean);
    return dirs.some((p) => path === p || path.startsWith(p + '/'));
  },
  onCreate(f) {
    if (!this.settings.askOnCreate || !(f instanceof TFile) || f.extension !== 'md') return;
    if (!this.ready || Date.now() - this.ready < 3000) return;
    if (this.selfCreated.size || f.stat.size > 0 || this.isSystemPath(f.path) || dailyDateOf(this.app, f)) return;
    if (Date.now() - f.stat.ctime > 5000) return;
    // let Obsidian open the note first, then ask (only if it is still empty)
    window.setTimeout(async () => {
      const cur = this.app.vault.getAbstractFileByPath(f.path);
      if (!(cur instanceof TFile)) return;
      if ((await this.app.vault.read(cur)).trim()) return;
      new (NEON_CATS.customers ? CustomerNoteModal : NewNoteModal)(this, { file: cur }).open();
    }, 350);
  },
  needsCategory(f) {
    if (!(f instanceof TFile) || f.extension !== 'md') return false;
    if (f.stat.ctime < this.settings.installedAt || this.isSystemPath(f.path) || dailyDateOf(this.app, f)) return false;
    if (f.path === this.quickPath() || f.path === normalizePath(this.settings.backupPath)) return false;
    return noteCategory(this.app.metadataCache.getFileCache(f), f.path) === null;
  },
  uncategorised() {
    return this.app.vault.getMarkdownFiles().filter((f) => this.needsCategory(f)).sort((a, b) => b.stat.ctime - a.stat.ctime);
  },
  buildStatus() {
    const el = this.addStatusBarItem();
    el.addClass('nd-status', 'nt-status', 'mod-clickable');
    const ic = el.createSpan('nd-status-icon');
    setIcon(ic, 'tag');
    const txt = el.createSpan('nd-status-text');
    tip(el, 'New notes without a category — click to list them');
    el.addEventListener('click', () => new UncategorisedModal(this, this.uncategorised()).open());
    const update = () => {
      const n = this.uncategorised().length;
      el.toggle(n > 0 && this.settings.showNoCategoryBar && !NEON_CATS.customers); // fork: no nagging by default
      txt.setText(`${n} no category`);
    };
    this.register(this.onChange(update));
    this.app.workspace.onLayoutReady(update);
  },
  updateBar() {
    document.querySelectorAll('.nt-nocat-bar').forEach((el) => el.remove());
    if (!this.settings.showNoCategoryBar) return;
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (!view || !view.file || !this.needsCategory(view.file)) return;
    const file = view.file;
    const header = view.containerEl.querySelector('.view-header');
    const bar = createDiv('nt-nocat-bar');
    if (header) header.after(bar);
    else view.containerEl.prepend(bar);
    icon(bar, 'tag');
    bar.createSpan({ cls: 'nt-nocat-k', text: 'No category yet' });
    for (const c of [...CATS, 'untracked']) {
      const b = bar.createEl('button', { cls: 'nd-pill-btn', text: CAT_LABEL[c] });
      b.style.setProperty('--pill-accent', c === 'untracked' ? 'var(--nd-muted)' : catColor(c));
      b.addEventListener('click', async () => {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          fm[c] = true;
          if (!fm.created) fm.created = moment(file.stat.ctime).format('YYYY-MM-DD');
          reorderProps(fm);
        });
        bar.remove();
      });
    }
    const x = bar.createDiv('nt-nocat-x');
    setIcon(x, 'x');
    tip(x, 'Hide for now');
    x.addEventListener('click', () => bar.remove());
  },

  /* fix properties ---------------------------------------------------------- */
  /** One time: notes still using the old `ops` category get `operations` instead. */
  async migrateCategories() {
    if (this.settings.catMigrated) return;
    const old = Object.keys(CAT_ALIAS);
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      const fm = (cache && cache.frontmatter) || {};
      const tags = cache && cache.frontmatter ? fmTags(fm).map((t) => String(t).toLowerCase()) : [];
      const hit = old.some((o) => fm[o] != null || tags.includes(o) || (typeof fm.category === 'string' && fm.category.toLowerCase() === o));
      if (hit && (await this.fixProps(f))) n++;
    }
    this.settings.catMigrated = true;
    await this.saveSettings();
    if (n) new Notice(`✦ Renamed the Ops category to Operations in ${n} note${n === 1 ? '' : 's'}`);
  },
  async fixProps(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const ticket = isTicketCache(cache);
    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const before = JSON.stringify(fm);
      // tags: always a clean list
      if (fm.tags != null) {
        const tags = [...new Set(fmTags(fm))];
        if (tags.length) fm.tags = tags;
        else delete fm.tags;
      }
      if (fm.tag != null && fm.tags == null) {
        const tags = fmTags({ tags: fm.tag });
        if (tags.length) fm.tags = tags;
        delete fm.tag;
      }
      // old category names (ops -> operations), as property, category value or tag
      for (const [old, c] of Object.entries(CAT_ALIAS)) {
        if (fm[old] != null) {
          if (isTrue(fm[old])) fm[c] = true;
          delete fm[old];
        }
      }
      if (Array.isArray(fm.tags)) fm.tags = [...new Set(fm.tags.map((t) => (CAT_ALIAS[String(t).toLowerCase()] ? CAT_ALIAS[String(t).toLowerCase()] : t)))];
      // "category: school" -> school: true
      if (typeof fm.category === 'string' && CATS.includes(normCat(fm.category.toLowerCase()))) {
        fm[normCat(fm.category.toLowerCase())] = true;
        delete fm.category;
      }
      for (const c of [...CATS, 'untracked']) {
        if (fm[c] === 'true' || fm[c] === 'yes') fm[c] = true;
        if (fm[c] === false || fm[c] === 'false' || fm[c] === 'no') delete fm[c];
      }
      if (!fm.created) fm.created = moment(file.stat.ctime).format('YYYY-MM-DD');
      if (ticket) {
        if (!fm.type) fm.type = 'ticket';
        if (!fm.status) fm.status = 'open';
        if (!fm.priority) fm.priority = 'normal';
      }
      for (const [k, v] of Object.entries(fm)) {
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete fm[k];
      }
      reorderProps(fm);
      changed = JSON.stringify(fm) !== before;
    });
    return changed;
  },
  async fixFolder(folder) {
    const files = [];
    const walk = (fd) => fd.children.forEach((c) => (c instanceof TFolder ? walk(c) : c instanceof TFile && c.extension === 'md' && files.push(c)));
    walk(folder);
    new ConfirmModal(this.app, {
      title: `Fix properties in “${folder.path === '/' ? this.app.vault.getName() : folder.name}”?`,
      text: `${files.length} note${files.length === 1 ? '' : 's'}: adds a created date, turns “category: x” into the checkbox, removes empty properties and puts them in a fixed order. Note text is not touched.`,
      cta: 'Fix properties',
      warning: false,
      onConfirm: async () => {
        let n = 0;
        for (const f of files) if (await this.fixProps(f)) n++;
        new Notice(`✦ Fixed ${n} of ${files.length} notes`);
      },
    }).open();
  },
  pickFolderToFix() {
    const plugin = this;
    class FolderPick extends SuggestModal {
      getSuggestions(q) {
        return this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
      }
      renderSuggestion(f, el) {
        el.setText(f.path === '/' ? '/ (whole vault)' : f.path);
      }
      onChooseSuggestion(f) {
        plugin.fixFolder(f);
      }
    }
    const m = new FolderPick(this.app);
    m.setPlaceholder('Fix properties in which folder?');
    m.open();
  },
});
