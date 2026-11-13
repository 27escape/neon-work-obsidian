Object.assign(CardsView.prototype, {
  sortMenu(e) {
    const m = new Menu();
    const opts = [
      ['created-prop', 'Created property'],
      ['modified', 'Recently modified'],
      ['created', 'Recently created (file)'],
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
  },
  /** Notes in sort order: names starting with "!" first (more "!" higher), then the chosen sort. */
  sorter() {
    const s = this.plugin.settings.cardSort;
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    let cmp = (a, b) => b.stat.mtime - a.stat.mtime;
    if (s === 'name') cmp = byName;
    else if (s === 'name-desc') cmp = (a, b) => byName(b, a);
    else if (s === 'created') cmp = (a, b) => b.stat.ctime - a.stat.ctime;
    else if (s === 'created-prop') {
      const keys = (this.createdSeen = new Map()); // one date per note per sort; also lets 'changed' spot a new date
      const key = (f) => (keys.has(f.path) ? keys.get(f.path) : keys.set(f.path, createdOf(this.app, f)).get(f.path));
      cmp = (a, b) => key(b) - key(a) || byName(a, b);
    }
    return bangFirst(cmp);
  },
  /** fork: the Revisit feature (for upstream "school" notes) is removed; kept as stubs for the callers. */
  revisitAge() {
    return -1;
  },
  needsRevisit() {
    return false;
  },
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
  },
  matchChip(f) {
    const c = this.chip;
    if (c === 'all') return true;
    if (c === 'revisit') return this.needsRevisit(f);
    const cat = fileCategory(this.app, f);
    if (c === 'untracked') return f.extension === 'md' && (!cat || cat === 'untracked');
    return cat === c;
  },
  /** Notes in a folder (recursive), with category counts and how many other files (images…) it holds. */
  folderInfo(folder) {
    const notes = [];
    let other = 0; // images and other attachments (issue 53)
    const walk = (fd) => {
      for (const c of fd.children) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') notes.push(c);
        else if (c instanceof TFile) other++;
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
    return { notes, other, cat };
  },

  renderChips() {
    const el = this.chipsEl;
    if (!el) return;
    el.empty();
    const folder = this.folder();
    const scope = this.query ? this.app.vault.getMarkdownFiles() : this.folderInfo(folder).notes;
    const revisit = scope.filter((f) => this.needsRevisit(f)).length;
    // fork: the category chips are the current categories (your customers); Revisit only for upstream "school"
    const chips = [['all', 'All'], ...CATS.map((c) => [c, CAT_LABEL[c] || c]), ['untracked', NEON_CATS.customers ? 'No customer' : 'Untracked']];
    if (!chips.some(([k]) => k === this.chip)) this.chip = 'all';
    for (const [k, label] of chips) {
      const b = el.createEl('button', { cls: `nd-pill-btn chip-${k}` + (this.chip === k ? ' is-on' : '') });
      if (k === 'revisit') icon(b, 'rotate-ccw');
      b.createSpan({ text: k === 'revisit' && revisit ? `${label} (${revisit})` : label });
      if (CATS.includes(k)) b.style.setProperty('--pill-accent', catColor(k));
      b.addEventListener('click', () => {
        this.chip = this.chip === k ? 'all' : k;
        this.refresh(0, true, true);
      });
    }
  },

});
