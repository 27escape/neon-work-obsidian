/* ---- Areas card (fork) -------------------------------------------------------------
 * One row per group (areas in a PARA vault, customers otherwise): active projects, open tasks, notes
 * edited in the last 30 days and when it was last touched. Areas left alone longest come first, so the
 * ones you may be neglecting stand out. Read only. Takes the Claude card's place on the dashboard. */
const AREA_QUIET_DAYS = 30;

/**
 * Rows for the card (pure). groups: [[key, label]]; notes: [{ group, mtime }]; projects: [{ group }]
 * (active ones); tasks: [{ group }] (open ones). Returns rows sorted by last touched, oldest first.
 */
function areaRows(groups, notes, projects, tasks, now) {
  const month = now - AREA_QUIET_DAYS * 86400000;
  const rows = groups.map(([key, label]) => ({ key, label, projects: 0, tasks: 0, notes: 0, recent: 0, last: 0 }));
  const by = new Map(rows.map((r) => [r.key, r]));
  for (const n of notes) {
    const r = by.get(n.group);
    if (!r) continue;
    r.notes++;
    if (n.mtime >= month) r.recent++;
    if (n.mtime > r.last) r.last = n.mtime;
  }
  for (const p of projects) if (by.has(p.group)) by.get(p.group).projects++;
  for (const t of tasks) if (by.has(t.group)) by.get(t.group).tasks++;
  for (const r of rows) r.quiet = !r.last || r.last < month;
  return rows.sort((a, b) => a.last - b.last || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

Object.assign(NeonDeck.prototype, {
  /** The data behind the Areas card, from the vault, the Projects module and the Tasks module. */
  areaData() {
    const app = this.app;
    const groupOf = (f) => noteCategory(app.metadataCache.getFileCache(f), f.path);
    const groups = NEON_CATS.customers ? CATS.map((k) => [k, CAT_LABEL[k] || k]) : [];
    const notes = app.vault
      .getMarkdownFiles()
      .filter((f) => !this.isExcluded(f))
      .map((f) => ({ group: groupOf(f), mtime: f.stat.mtime }));
    const tk = neonPlugin(app, 'neon-tickets');
    const projects = tk && tk.activeProjects ? tk.activeProjects().map((t) => ({ group: String(t.customer || '').toLowerCase() })) : [];
    const ts = neonPlugin(app, 'neon-tasks');
    const tasks = ts && Array.isArray(ts.openTasks) ? ts.openTasks.map((t) => ({ group: groupOf(t.file) })) : [];
    return areaRows(groups, notes, projects, tasks, Date.now());
  },
  /** Open a group: its index note (0.Index, index, README or a note named like it), else show the folder. */
  openArea(label, e) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(`${NEON_CATS.customersFolder}/${label}`));
    if (!(folder instanceof TFolder)) return;
    const note = folder.children.find((c) => c instanceof TFile && c.extension === 'md' && (c.basename.toLowerCase() === label.toLowerCase() || /^(0\.?\s*index|index|readme)$/i.test(c.basename)));
    if (note) return openFile(this.app, note, e);
    const fx = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('file-explorer');
    if (fx && fx.enabled && fx.instance && fx.instance.revealInFolder) fx.instance.revealInFolder(folder);
  },
  mountAreas(card, comp) {
    const owner = comp || this; // the dashboard view: its listeners go when it closes
    const list = card.body.createDiv('nd-areas');
    const render = () => {
      if (!list.isConnected) return;
      const rows = this.areaData();
      const quiet = rows.filter((r) => r.quiet).length;
      card.badge.setText(quiet ? `${quiet} quiet` : '');
      list.empty();
      if (!rows.length) return void emptyState(list, `No ${groupWord(true, true)} yet: set the groups folder in Projects settings ✦`);
      for (const r of rows) {
        const row = list.createDiv('nd-area-row' + (r.quiet ? ' is-quiet' : ''));
        const dot = row.createSpan('nd-area-dot');
        dot.style.background = catColor(r.key);
        const main = row.createDiv('nd-area-main');
        main.createDiv({ cls: 'nd-area-name', text: r.label });
        const bits = [];
        if (r.projects) bits.push(`${r.projects} project${r.projects === 1 ? '' : 's'}`);
        if (r.tasks) bits.push(`${r.tasks} task${r.tasks === 1 ? '' : 's'}`);
        bits.push(r.recent ? `${r.recent} note${r.recent === 1 ? '' : 's'} this month` : `${r.notes} note${r.notes === 1 ? '' : 's'}`);
        main.createDiv({ cls: 'nd-area-meta', text: bits.join(' · ') });
        row.createSpan({ cls: 'nd-area-when', text: r.last ? shortAgoDeck(r.last) : 'never' });
        tip(row, r.quiet ? `Not touched for over ${AREA_QUIET_DAYS} days` : `Last touched ${r.last ? moment(r.last).format('D MMM YYYY') : 'never'}`);
        row.addEventListener('click', (e) => this.openArea(r.label, e));
      }
    };
    const soon = debounce(render, 1500, true);
    owner.registerEvent(this.app.metadataCache.on('changed', soon));
    owner.registerEvent(this.app.vault.on('delete', soon));
    owner.registerEvent(this.app.vault.on('rename', soon));
    owner.registerEvent(this.app.workspace.on('neon-deck:facts-changed', soon));
    render();
    return { destroy() {} };
  },
});
