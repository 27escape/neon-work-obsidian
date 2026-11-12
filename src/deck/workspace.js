Object.assign(NeonDeck.prototype, {
  /**
   * Puts everything the Neon plugins keep (tickets, time log, reviews, inbox,
   * quick tasks, daily notes, templates, backups, the guide) under one Core
   * folder, so the vault root holds Core plus the user's own folders.
   * Uses fileManager.renameFile, so links are updated. Settings of the
   * satellites are patched in memory, or in their data.json when disabled.
   */
  async tidyIntoCore(manual) {
    if (this._tidying) return;
    this._tidying = true;
    try {
      const app = this.app;
      const root = normalizePath(this.settings.coreFolder || 'Core');
      const get = (p) => app.vault.getAbstractFileByPath(normalizePath(p));
      const inCore = (p) => p === root || p.startsWith(root + '/');
      const saves = [];
      // a plugin's settings: live if loaded, else its data.json
      const sat = async (id) => {
        const pl = neonPlugin(app, id);
        if (pl && pl.settings) return { s: pl.settings, save: () => pl.saveData(pl.settings) };
        const dp = normalizePath(`${app.vault.configDir}/plugins/${id}/data.json`);
        const dir = normalizePath(`${app.vault.configDir}/plugins/${id}`);
        if (!(await app.vault.adapter.exists(dir)) && !(await app.vault.adapter.exists(dp))) return null;
        let s = {};
        try {
          if (await app.vault.adapter.exists(dp)) s = JSON.parse(await app.vault.adapter.read(dp)) || {};
        } catch (e) {
          return null;
        }
        return { s, save: () => app.vault.adapter.write(dp, JSON.stringify(s, null, 2)) };
      };
      const coreJson = async (name, key, def, label) => {
        const dp = normalizePath(`${app.vault.configDir}/${name}`);
        let s = {};
        try {
          if (await app.vault.adapter.exists(dp)) s = JSON.parse(await app.vault.adapter.read(dp)) || {};
        } catch (e) {
          /* keep {} */
        }
        // Obsidian's own settings stay the user's: say what to change instead of writing them
        return { cur: s[key] || def, set: (v) => coreHints.push(`${label} → ${v}`) };
      };
      const coreHints = [];
      // [current path, old default, setter]
      const items = [];
      const add = (cur, set, old) => {
        cur = cur ? normalizePath(cur) : '';
        // a fresh plugin already points into Core while its old files still sit at the root
        if (old && inCore(cur) && !get(cur) && get(old) && cur === normalizePath(`${root}/${old}`)) cur = old;
        if (cur && cur !== '/' && !inCore(cur)) items.push({ cur, set });
      };
      const s = this.settings;
      const mapEx = [];
      add(s.reviewFolder || 'Reviews', (v) => (s.reviewFolder = v), 'Reviews');
      add(s.inboxPath || 'Inbox.md', (v) => (s.inboxPath = v), 'Inbox.md');
      add(s.bridgeFolder || 'Bridges', (v) => (s.bridgeFolder = v), 'Bridges');
      const tasks = await sat('neon-tasks');
      if (tasks) {
        add(tasks.s.quickTasksPath || 'Quick tasks.md', (v) => (tasks.s.quickTasksPath = v), 'Quick tasks.md');
        add(tasks.s.backupPath || 'Neon/Global tasks backup.md', (v) => (tasks.s.backupPath = v), 'Neon/Global tasks backup.md');
        saves.push(tasks.save);
      }
      const tickets = await sat('neon-tickets');
      if (tickets) {
        add(tickets.s.ticketFolder || 'Tickets', (v) => (tickets.s.ticketFolder = v), 'Tickets');
        saves.push(tickets.save);
      }
      const time = await sat('neon-time');
      if (time) {
        add(time.s.logFolder || 'Time Log', (v) => (time.s.logFolder = v), 'Time Log');
        saves.push(time.save);
      }
      const daily = await coreJson('daily-notes.json', 'folder', '', 'Daily notes → New file location');
      if (daily.cur) add(daily.cur, daily.set);
      const tpl = await coreJson('templates.json', 'folder', '', 'Templates → Template folder location');
      add(tpl.cur || 'Templates', (v) => (tpl.cur ? tpl.set(v) : null));
      for (const p of s.excludeFolders.split(',').map((x) => x.trim()).filter(Boolean)) add(p, (v) => mapEx.push([normalizePath(p), v]));
      for (const p of ['Neon Deck Guide.md', 'Welcome.md']) add(p, () => null);

      // the same folder can come from two places (templates + excluded)
      const seen = new Map();
      for (const it of items) {
        if (!seen.has(it.cur)) seen.set(it.cur, []);
        seen.get(it.cur).push(it.set);
      }
      const ensure = async (dir) => {
        let acc = '';
        for (const part of dir.split('/')) {
          acc = acc ? `${acc}/${part}` : part;
          if (!get(acc)) await app.vault.createFolder(acc);
        }
      };
      let moved = 0;
      const clash = [];
      for (const [cur, sets] of seen) {
        const target = normalizePath(`${root}/${cur}`);
        const f = get(cur);
        if (f && get(target)) {
          clash.push(cur);
          continue;
        }
        if (f) {
          const parent = f.parent;
          await ensure(target.slice(0, target.lastIndexOf('/')));
          await app.fileManager.renameFile(f, target);
          moved++;
          // drop a folder the move left empty (e.g. Neon/ after its backup moved)
          if (parent && parent.path !== '/' && !inCore(parent.path) && parent.children && !parent.children.length) await app.vault.delete(parent, true);
        }
        for (const set of sets) set(target);
      }
      if (mapEx.length) {
        s.excludeFolders = s.excludeFolders
          .split(',')
          .map((x) => {
            const hit = mapEx.find(([a]) => a === normalizePath(x.trim()));
            return hit ? hit[1] : x.trim();
          })
          .filter(Boolean)
          .join(', ');
      }
      if (!get(root)) await app.vault.createFolder(root);
      s.coreTidied = true;
      this._ex = null;
      await this.saveSettings();
      for (const fn of saves) await fn();
      if (coreHints.length) new Notice(`Neon Deck: update these in Settings so they point into ${root}/:\n${coreHints.join('\n')}`, 0);
      if (moved || manual) new Notice(moved ? `Neon Deck: moved ${moved} item${moved === 1 ? '' : 's'} into ${root}/.` + (clash.length ? ` Skipped (already in ${root}): ${clash.join(', ')}.` : '') : `Neon Deck: everything is already in ${root}/.`, 8000);
      else if (clash.length) new Notice(`Neon Deck: not moved, already in ${root}/: ${clash.join(', ')}`, 8000);
    } catch (e) {
      console.error('Neon Deck: tidy into Core', e);
      new Notice('Neon Deck: could not move everything into the Core folder. See the console.');
    } finally {
      this._tidying = false;
    }
  },

  async onReady() {
    const ws = this.app.workspace;
    if (!this.settings.coreTidied) await this.tidyIntoCore(false);
    this.lastFile = ws.getActiveFile();
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
    const folder = normalizePath(this.settings.reviewFolder || 'Core/Reviews');
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
    const tf = this.app.metadataCache.getFirstLinkpathDest('Templates/Weekly Review', '');
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
});
