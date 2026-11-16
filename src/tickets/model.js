Object.assign(NeonProjects.prototype, {
  /* collecting ------------------------------------------------------------- */
  /** Every project note (excluded folders skipped), cached until a project note changes or the day turns. */
  collectProjects() {
    if (this.cache && this.cache.day === dayKey(Date.now())) return this.cache.list;
    const out = [];
    const today = moment().startOf('day');
    const deck = neonPlugin(this.app, 'neon-deck');
    for (const { file: f, cache } of noteIndex(this.app).projects()) {
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      out.push(this.toProject(f, cache, today));
    }
    out.push(...this.folderProjects(out, today, deck)); // fork: PARA project folders
    out.sort(projectSort);
    this.cache = { day: dayKey(Date.now()), list: out, paths: new Set(out.map((t) => t.file.path)) };
    return out;
  },
  /** A project from its note's properties. */
  toProject(f, cache, today) {
    const fm = (cache && cache.frontmatter) || {};
    const text = (v) => (v != null && typeof v !== 'object' ? String(v).trim() : '');
    const started = parseDay(fm.started);
    const created = parseDay(fm.created) || started || moment(f.stat.ctime);
    const due = parseDay(fm.due);
    const remindRaw = text(fm.remind);
    const statusRaw = text(fm.status);
    const status = projectKind(statusRaw);
    const t = {
      file: f,
      title: projectTitle(f.basename),
      statusRaw,
      status,
      customer: projectCustomer(f.path, fm, this.settings.customersFolder),
      stage: text(fm.stage),
      note: text(fm.note),
      category: noteCategory(cache, f.path) || 'other',
      created,
      startedOn: started,
      due,
      remind: parseDay(remindRaw),
      completed: parseDay(fm.completed) || parseDay(fm.cancelled),
      daysLeft: due ? daysFromToday(due) : null,
      age: Math.max(0, today.diff((started || created).clone().startOf('day'), 'days')),
      progress: 0,
    };
    if (due) {
      const from = started || created;
      const span = due.clone().endOf('day').diff(from, 'minutes');
      t.progress = span > 0 ? clamp(moment().diff(from, 'minutes') / span, 0, 1) : 1;
    }
    t.bucket = status === 'done' ? 'done' : !due ? 'nodate' : t.daysLeft < 0 ? 'overdue' : t.daysLeft === 0 ? 'today' : t.daysLeft <= 7 ? 'week' : 'later';
    return t;
  },
  /**
   * fork: with "Project folders" set (e.g. 1.Projects), each folder directly inside it is a project too, unless a
   * tagged project note already lives in it. Its note is <folder>/<folder name>.md, else a note there with a status,
   * else its index note (0.Index, index, README), else its first note; the project's status and dates come from it.
   */
  folderProjects(tagged, today, deck) {
    const root = folderSetting(this.settings.projectFolders);
    const top = root && this.app.vault.getAbstractFileByPath(root);
    if (!(top instanceof TFolder)) return [];
    const out = [];
    for (const folder of top.children) {
      if (!(folder instanceof TFolder)) continue;
      if (deck && deck.isExcluded && deck.excludedPaths && deck.excludedPaths().some((p) => folder.path === p || folder.path.startsWith(p + '/'))) continue;
      if (tagged.some((t) => t.file.path.startsWith(folder.path + '/'))) continue;
      const rep = projectFolderNote(this.app, folder);
      if (!rep) continue;
      const t = this.toProject(rep.file, this.app.metadataCache.getFileCache(rep.file), today);
      t.title = folder.name;
      t.folder = folder.path;
      if (!rep.own) {
        // fork: its note is only for opening (e.g. a generated index): no status of its own, nothing written there
        Object.assign(t, { noNote: true, statusRaw: '', status: 'open', stage: '', note: '', due: null, daysLeft: null, remind: null, completed: null, bucket: 'nodate', progress: 0 });
      }
      if (!t.customer) t.customer = projectCustomer(folder.path + '/x.md', null, this.settings.customersFolder);
      out.push(t);
    }
    return out;
  },
  /** fork: is this path inside a project folder (so a change there may change the folder projects)? */
  inProjectFolders(path) {
    const root = folderSetting(this.settings.projectFolders);
    return !!root && !!path && path.startsWith(root + '/') && path.slice(root.length + 1).includes('/');
  },
  activeProjects() {
    return this.collectProjects().filter((t) => t.status !== 'done');
  },
  projectFor(file) {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return isProjectCache(cache) ? this.toProject(file, cache, moment().startOf('day')) : null;
  },
  closedIn(m) {
    return this.collectProjects().filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
  },
  renderCounter(el, all) {
    el.empty();
    const now = moment();
    const last = now.clone().subtract(1, 'month');
    const closed = (m) => all.filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
    el.createSpan({ cls: 'tk-counter-n', text: String(closed(now)) });
    el.createSpan({ cls: 'tk-counter-l', text: `closed in ${now.format('MMMM')} · ${closed(last)} in ${last.format('MMMM')}` });
  },
});
