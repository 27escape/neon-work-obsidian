/* ---- shared note index (fork) ---------------------------------------------------
 * One list of the vault's markdown notes with what the modules ask about each (its metadata, open
 * and ticked tasks, tags), kept current from Obsidian's events by the kernel. Modules ask the index instead of
 * each walking every note: projects(), withOpenTasks(), withDoneTasks(since), withProperty(key). Read only. */
let neonIndex = null; // the kernel's live index; null when the kernel isn't running (tests)

class NoteIndex {
  constructor(app) {
    this.app = app;
    this.map = null; // path -> entry, built on first use
  }
  /** What we keep per note: the file, its metadata, and flags that are cheap to filter on. */
  entry(file) {
    const cache = this.app.metadataCache.getFileCache(file) || null;
    const fm = (cache && cache.frontmatter) || null;
    const lis = (cache && cache.listItems) || [];
    return { file, cache, fm, tags: fmTags(fm), openTasks: lis.some((li) => li.task === ' ' || li.task === '/'), doneTasks: lis.some((li) => li.task === 'x' || li.task === 'X') };
  }
  build() {
    this.map = new Map();
    for (const f of this.app.vault.getMarkdownFiles()) this.map.set(f.path, this.entry(f));
  }
  ensure() {
    if (!this.map) this.build();
    return this.map;
  }
  /* kept current by the kernel */
  changed(file) {
    if (!this.map || !file || file.extension !== 'md') return;
    this.map.set(file.path, this.entry(file));
  }
  deleted(file) {
    if (this.map && file) for (const p of [...this.map.keys()]) if (p === file.path || p.startsWith(file.path + '/')) this.map.delete(p);
  }
  renamed(file, old) {
    if (!this.map) return;
    if (file && file.extension === 'md') {
      this.map.delete(old);
      this.map.set(file.path, this.entry(file));
    } else this.map = null; // a folder moved: rebuild on next use
  }
  /* questions */
  entries() {
    return [...this.ensure().values()];
  }
  /** Notes with the project tag in their tags property. */
  projects() {
    const tag = (NEON_PROJECTS.tag || '').replace(/^#/, '').toLowerCase();
    return tag ? this.entries().filter((e) => e.tags.includes(tag)) : [];
  }
  /** Notes with at least one open checkbox ([ ] or [/]). */
  withOpenTasks() {
    return this.entries().filter((e) => e.openTasks);
  }
  /** Notes with a ticked checkbox ([x]), changed since `since` (ms): ticking a task changes the note. */
  withDoneTasks(since = 0) {
    return this.entries().filter((e) => e.doneTasks && e.file.stat.mtime >= since);
  }
  /** Notes with a property (whatever its value). */
  withProperty(key) {
    return this.entries().filter((e) => e.fm && e.fm[key] != null);
  }
}
/** The shared index: the kernel's live one, or a one-off for this call (tests, kernel not running). */
function noteIndex(app) {
  return neonIndex || new NoteIndex(app);
}
