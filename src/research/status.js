/* ---- research status (fork): read from a property in each note, never written ----------------------
 * Replaces the old "research list" kept in plugin data. A note's status is the value of the status
 * property (setting, default `status`). Values listed in "Done statuses" count as researched; any other
 * value is still being researched; notes without the property are "no status". */
const NO_STATUS = '';

/** The setting's comma list as lower-case values. */
function statusList(text) {
  return String(text || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
/** A property value as one status: first item of a list, trimmed; '' when missing. */
function statusValue(v) {
  if (Array.isArray(v)) v = v[0];
  if (v == null || typeof v === 'object') return NO_STATUS;
  return String(v).trim();
}
/** 'done' | 'open' | 'none' for a status value. */
function statusKind(value, doneList) {
  if (!value) return 'none';
  return doneList.includes(value.toLowerCase()) ? 'done' : 'open';
}
/**
 * Notes grouped by status: open groups first (most notes first), then done groups, then "no status".
 * `entries` is [{ file, status }]. Returns { groups: [{ status, kind, files }], open, done, none }.
 */
function statusGroups(entries, doneList) {
  const by = new Map();
  for (const e of entries) {
    const key = e.status.toLowerCase();
    if (!by.has(key)) by.set(key, { status: e.status, kind: statusKind(e.status, doneList), files: [] });
    by.get(key).files.push(e.file);
  }
  const rank = { open: 0, done: 1, none: 2 };
  const groups = [...by.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || b.files.length - a.files.length || a.status.localeCompare(b.status));
  const count = (k) => groups.filter((g) => g.kind === k).reduce((n, g) => n + g.files.length, 0);
  return { groups, open: count('open'), done: count('done'), none: count('none') };
}
/** Hero line: "3 to research · 2 researched · 4 without status". */
function statusLine(sum) {
  const parts = [`${sum.open} to research`, `${sum.done} researched`];
  if (sum.none) parts.push(`${sum.none} without status`);
  return parts.join(' · ');
}

Object.assign(NeonResearch.prototype, {
  /** A note's status value (from the metadata cache; no file reads). */
  statusOf(file) {
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    return statusValue(fm[this.settings.statusProperty || 'status']);
  },
  doneStatuses() {
    return statusList(this.settings.doneStatuses);
  },
  /** Status summary of the notes under a folder (or of the shown section). */
  statusSummary(folder = this.rootFolder()) {
    return statusGroups(this.notesUnder(folder).map((file) => ({ file, status: this.statusOf(file) })), this.doneStatuses());
  },
});

Object.assign(ResearchView.prototype, {
  /** The "By status" tab: the section's notes grouped by their status property. */
  renderStatus(panel) {
    const p = this.plugin;
    const folder = p.rootFolder();
    const sum = p.statusSummary(folder);
    if (!sum.groups.length) return emptyState(panel, folder ? 'No notes in this section yet' : 'Choose a folder for this section in the settings');
    const prop = p.settings.statusProperty || 'status';
    for (const g of sum.groups) {
      const box = panel.createDiv(`nr-status-group is-${g.kind}`);
      const head = box.createDiv('nr-status-head');
      head.createSpan({ cls: `nr-status-pill is-${g.kind}`, text: g.status || `no ${prop}` });
      head.createSpan({ cls: 'nr-status-count', text: `${g.files.length} note${g.files.length === 1 ? '' : 's'}` });
      const list = box.createDiv('nr-tree');
      const sorted = g.files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
      for (const f of sorted) {
        const row = list.createDiv('nr-row is-note');
        row.style.setProperty('--depth', '0');
        row.createSpan('nr-chev-space');
        icon(row, 'file-text', 'nd-ico nr-note-ico');
        row.createSpan({ cls: 'nr-name', text: f.basename });
        // fork: in a pattern section the path starts at the matched folder, shown by its label (e.g. the customer)
        const base = folder && folder.isPattern ? patternBase(folder.path, f.path) : folder && folder.path;
        const rel = f.parent && base && f.parent.path !== base ? f.parent.path.slice(base.length + 1) : '';
        const where = folder && folder.isPattern ? [patternStar(folder.path, base), rel].filter(Boolean).join(' / ') : rel;
        row.createSpan({ cls: 'nr-col nr-c-count', text: where });
        const when = row.createSpan({ cls: 'nr-col nr-c-when', text: shortAgo(f.stat.mtime) });
        tip(when, `Edited ${moment(f.stat.mtime).format('D MMM YYYY, HH:mm')}`);
        row.addEventListener('click', (e) => openFile(this.app, f, e));
        row.addEventListener('contextmenu', (e) => (e.preventDefault(), this.noteMenu(f, e)));
      }
    }
  },
});
