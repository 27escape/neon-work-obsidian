Object.assign(NeonDeck.prototype, {
  async onReady() {
    const ws = this.app.workspace;
    // fork: the automatic “tidy into Core” move was removed; Neon Deck never moves your files
    this.lastFile = ws.getActiveFile();
    this.registerClaudeCard(); // fork
    this.registerInboxCapture(); // fork
    // after a plugin restart Obsidian puts our tabs back only once onload is done, so arrange tabs a moment later
    // (doing it straight away added a second Cards tab and a second Dashboard on every restart)
    window.setTimeout(() => this.arrangeOnStart(), 600);
    ws.trigger('neon-deck:core-ready', this.api);
  },

  async arrangeOnStart() {
    await this.ensureSidebarCards();
    await this.foldNeonTabs();
    if (!this.settings.openDashboardOnStartup) return;
    const ws = this.app.workspace;
    // reuse a Dashboard that's already open in the main area instead of adding another
    const open = ws.getLeavesOfType(VIEW_DASH).find((l) => l.getRoot() === ws.rootSplit);
    if (open) await ws.revealLeaf(open);
    else await this.activate(VIEW_DASH, 'tab');
  },
  /** One Cards tab in the left sidebar: add it when missing, close copies left by earlier restarts. */
  async ensureSidebarCards() {
    const ws = this.app.workspace;
    if (!this.settings.cardsInSidebar) return;
    const side = [];
    const walk = (n) => {
      if (n.view && n.getViewState().type === VIEW_CARDS) side.push(n);
      (n.children || []).forEach(walk);
    };
    walk(ws.leftSplit);
    if (!side.length) {
      const leaf = ws.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_CARDS, active: true });
    } else if (side.length > 1) {
      const keep = side.find((l) => !l.isDeferred) || side[0];
      for (const l of side) if (l !== keep) l.detach();
    }
    if (this.settings.replaceFileExplorer) ws.getLeavesOfType('file-explorer').forEach((l) => l.detach());
  },

  /* weekly review ------------------------------------------------------------ */
  weekLine(start, end) {
    const parts = [];
    for (const fn of this.weekLines.values()) {
      try {
        parts.push(...(fn(start, end) || []));
      } catch (e) {
        console.error('Neon Deck week line', e);
      }
    }
    const md = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
    const made = md.filter((f) => f.stat.ctime >= start.valueOf() && f.stat.ctime < end.valueOf()).length;
    if (!parts.length || made) parts.push(`${made} new note${made === 1 ? '' : 's'}`);
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  },
  async weeklyReview() {
    const m = moment().startOf('isoWeek');
    const end = m.clone().add(7, 'days');
    const folder = this.reviewFolder();
    const path = normalizePath(`${folder}/${m.format('GGGG-[W]WW')} Review.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return openFile(this.app, existing);

    const inWeek = (t) => t >= m.valueOf() && t < end.valueOf();
    const md = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcluded(f));
    const created = md.filter((f) => inWeek(f.stat.ctime)).sort((a, b) => a.stat.ctime - b.stat.ctime);
    const touched = md.filter((f) => inWeek(f.stat.mtime) && !inWeek(f.stat.ctime)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    const link = (f) => `- [[${f.path.replace(/\.md$/, '')}|${f.basename}]]`;
    const notesMd = [
      created.length ? `**New (${created.length})**\n${created.slice(0, 30).map(link).join('\n')}` : '_No new notes._',
      touched.length ? `\n**Edited (${touched.length})**\n${touched.slice(0, 30).map(link).join('\n')}` : '',
    ].join('\n');
    const line = this.weekLine(m, end);

    let tpl = '';
    // fork: the template note from settings; else upstream's "Templates/Weekly Review"
    const want = (this.settings.reviewTemplate || '').trim();
    const tf = want ? this.app.metadataCache.getFirstLinkpathDest(want.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(want)) : this.app.metadataCache.getFirstLinkpathDest('Templates/Weekly Review', '');
    if (want && !(tf instanceof TFile)) new Notice(`Weekly review template “${want}” not found: using the built-in layout`);
    if (tf) tpl = await this.app.vault.read(tf);
    if (!tpl) tpl = '# Week {{date:GGGG-[W]WW}}\n\n> {{weekLine}}\n\n## Notes\n{{weekNotes}}\n';
    else if (!/{{\s*weekLine\s*}}/.test(tpl)) tpl = tpl.replace(/^(#[^\n]*\n)?/, (h) => `${h || ''}\n> {{weekLine}}\n\n`);
    const content = applyTemplate(tpl, m, path.split('/').pop().replace(/\.md$/, ''))
      .replace(/{{\s*weekLine\s*}}/g, line)
      .replace(/{{\s*weekFocus\s*}}/g, '') // old templates: the focus timer is gone
      .replace(/{{\s*weekNotes\s*}}/g, notesMd)
      .replace(/{{\s*weekEnd(?::([^}]+))?\s*}}/g, (_, f) => end.clone().subtract(1, 'day').format(f ? f.trim() : 'YYYY-MM-DD'));
    await ensureFolder(this.app, folder);
    const f = await this.app.vault.create(path, content);
    openFile(this.app, f);
  },

  /**
   * Once, after the switch to one main pane: Dashboard, Cards, Tickets, Time… used to sit in their
   * own (often pinned) tabs. Keep one of them as the unpinned main pane and close the rest.
   */
  async foldNeonTabs() {
    if (this.settings.singlePane) return;
    const ws = this.app.workspace;
    // getLeavesOfType also finds tabs Obsidian hasn't loaded yet
    const neon = MAIN_VIEWS.flatMap((t) => ws.getLeavesOfType(t)).filter((l) => l.getRoot() === ws.rootSplit);
    if (neon.length) {
      const keep = neon.find((l) => l.getViewState().type === VIEW_DASH) || neon[0];
      for (const l of neon) if (l !== keep) l.detach();
      keep.setPinned(false);
    }
    this.settings.singlePane = true;
    await this.saveSettings();
  },

  /* navigation helpers ---------------------------------------------------- */
  activate(type, where = 'tab') {
    return activateView(this.app, type, where);
  },
  async openCardsAt(path, newTab) {
    const ws = this.app.workspace;
    let leaf;
    if (newTab) leaf = ws.getLeaf('tab');
    else leaf = reusableLeaf(this.app); // the main pane
    await leaf.setViewState({ type: VIEW_CARDS, active: true, state: { path } });
    await ws.revealLeaf(leaf);
  },
  async openGraph(mode, scope) {
    const leaf = await this.activate(VIEW_GRAPH, 'tab');
    const view = leaf.view;
    if (view instanceof GraphView) await view.setState({ mode: 'notes', scope: scope || view.scope }, { history: false });
  },
  openFile(file, evt, line) {
    return openFile(this.app, file, evt, line);
  },
  openSearch(q) {
    const ws = this.app.workspace;
    const leaf = ws.getLeavesOfType('search')[0] || ws.getLeftLeaf(false);
    if (!leaf) return;
    leaf.setViewState({ type: 'search', active: true, state: { query: q } }).then(() => ws.revealLeaf(leaf));
  },
  /** fork: locations inside the base folder unless set */
  reviewFolder() {
    return locPath(this.settings.reviewFolder, 'Reviews');
  },
  bridgeFolder() {
    return locPath(this.settings.bridgeFolder, 'Bridges');
  },
});
