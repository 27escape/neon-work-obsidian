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
    const projects = neonPlugin(this.app, 'neon-tickets');
    const dirs = [...SYSTEM_FOLDERS, deck && deck.reviewFolder && deck.reviewFolder(), time && time.logFolder && time.logFolder(), projects && projects.projectFolder && projects.projectFolder()].filter(Boolean);
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
});
