Object.assign(NeonTasks.prototype, {
  /* collecting tasks ----------------------------------------------------- */
  /** Old-style ticket notes keep their steps to themselves; projects' #task lines are normal tasks (fork). */
  isLegacyTicket(cache) {
    const fm = cache && cache.frontmatter;
    return !!fm && /^ticket$/i.test(String(fm.type || '').trim());
  },
  /** A note whose every open checkbox counts: tagged “tasks” in its properties. */
  isTaskSource(f, cache) {
    if (this.isLegacyTicket(cache)) return false;
    return fmTags(cache && cache.frontmatter).includes('tasks');
  },
  /** Could this note hold tasks we show? (cheap: metadata only) */
  mayHoldTasks(f, cache) {
    return !!(cache && cache.listItems && cache.listItems.some((li) => li.task === ' ' || li.task === '/'));
  },
  /**
   * Open tasks ([ ] and [/]) from: lines with the task tag anywhere (fork, Tasks-plugin style), notes tagged
   * “tasks”, the Todo note and recent daily/weekly notes. Excluded folders (archive, templates) are skipped.
   */
  async collectTasks() {
    const app = this.app;
    const today = moment().startOf('day');
    const todayKey = today.format('YYYY-MM-DD');
    const tag = (this.settings.taskTag || '').trim();
    const todo = this.quickPath();
    const deck = neonPlugin(app, 'neon-deck');
    const sources = new Map();
    for (const { file: f, cache } of noteIndex(app).withOpenTasks()) {
      if (this.isLegacyTicket(cache)) continue;
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      const d = dailyDateOf(app, f);
      const daily = d && !d.isAfter(today) && today.diff(d, 'days') <= this.settings.carryDays ? d : null;
      // every open checkbox counts here; elsewhere only lines with the task tag
      const all = f.path === todo || this.isTaskSource(f, cache) || !!daily;
      if (!all && !tag) continue;
      sources.set(f.path, { f, cache, daily, all });
    }
    const out = [];
    for (const { f, cache, daily, all } of sources.values()) {
      const lis = cache.listItems.filter((li) => li.task === ' ' || li.task === '/');
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of lis) {
        const line = (lines[li.position.start.line] || '').replace(/\r$/, '');
        const m = line.match(TASK_LINE_RE);
        if (!m || !m[1].trim()) continue;
        const raw = m[1];
        if (!all && !hasTaskTag(raw, tag)) continue;
        const { due, group } = taskGroup(raw, daily, todayKey);
        out.push({
          file: f,
          line: li.position.start.line,
          raw,
          due,
          group,
          doing: li.task === '/',
          carried: daily && !daily.isSame(today, 'day') ? daily : null,
          display: taskDisplay(raw, tag),
          quick: f.path === todo,
        });
      }
    }
    out.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.file.stat.mtime - a.file.stat.mtime || a.line - b.line);
    this.sourcePaths = new Set(sources.keys());
    return out;
  },
  /** The Todo note's path (setting “Todo note”; the old Quick tasks setting). */
  quickPath() {
    const p = locPath(this.settings.quickTasksPath, 'Todo.md');
    return normalizePath(p.endsWith('.md') ? p : p + '.md');
  },
  todoFile() {
    const f = this.app.vault.getAbstractFileByPath(this.quickPath());
    return f instanceof TFile ? f : null;
  },
  /** Open tasks of the Todo note, in file order. */
  async collectTodo() {
    const f = this.todoFile();
    if (!f) return [];
    const cache = this.app.metadataCache.getFileCache(f);
    if (!cache || !cache.listItems) return [];
    const tag = (this.settings.taskTag || '').trim();
    const todayKey = moment().format('YYYY-MM-DD');
    const lines = (await this.app.vault.cachedRead(f)).split('\n');
    const out = [];
    for (const li of cache.listItems) {
      if (li.task !== ' ' && li.task !== '/') continue;
      const m = (lines[li.position.start.line] || '').replace(/\r$/, '').match(TASK_LINE_RE);
      if (!m || !m[1].trim()) continue;
      out.push({ file: f, line: li.position.start.line, raw: m[1], ...taskGroup(m[1], null, todayKey), doing: li.task === '/', carried: null, display: taskDisplay(m[1], tag), quick: true });
    }
    return out;
  },
  /** A new task line in Tasks-plugin form: “#task text ➕ YYYY-MM-DD” (tag and date only when missing). */
  taskLine(text) {
    const tag = (this.settings.taskTag || '').trim();
    const withTag = tag && !hasTaskTag(text, tag) ? `${tag} ${text}` : text;
    const created = /➕\s*\d{4}-\d{2}-\d{2}/u.test(withTag) ? '' : ` ➕ ${moment().format('YYYY-MM-DD')}`;
    return `- [ ] ${withTag}${created}`;
  },
  async addQuickTask(text) {
    text = String(text || '').trim();
    if (!text) return;
    // shown at once; the real row takes its place once Obsidian has indexed the note
    const pend = { text, at: Date.now() };
    (this.pendingQuick = this.pendingQuick || []).push(pend);
    this.emit();
    try {
      await this.writeQuickTask(text);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Neon Tasks: could not add task', e);
        new Notice('Could not add the task');
      }
      this.pendingQuick = this.pendingQuick.filter((x) => x !== pend);
      this.emit();
    }
  },
  /** fork: new tasks go at the head of the Todo note (made with a title if it doesn't exist yet). */
  async writeQuickTask(text) {
    const path = this.quickPath();
    let f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      await ensureFolder(this.app, path.split('/').slice(0, -1).join('/'));
      const day = moment().format('YYYY-MM-DD');
      f = await this.app.vault.create(path, `---\ntitle: Todo\ncreated: ${day}\nmodified: ${day}\n---\n`);
    }
    const line = this.taskLine(text);
    await writeNote(this.app, f, (d) => addTaskAtHead(d, line));
  },
  /** Rewrite one open task line in its note (item 15); the line must still be the task that was shown. */
  async editTask(t, raw) {
    let ok = false;
    await writeNote(this.app, t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      if (l === undefined || !OPEN_BOX_RE.test(l) || !l.includes(t.raw)) return data;
      lines[t.line] = l.replace(t.raw, () => raw);
      ok = true;
      return lines.join('\n');
    });
    if (!ok) new Notice('That task changed in the meantime — refreshed');
    return ok;
  },
  async completeTask(t) {
    const stamp = this.settings.stampDone ? ` ✅ ${moment().format('YYYY-MM-DD')}` : '';
    let ok = false;
    await writeNote(this.app, t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      // the line must still be this open task (the note may have changed since the list was drawn)
      if (l === undefined || !OPEN_BOX_RE.test(l) || !l.includes(t.raw)) return data;
      const cr = l.endsWith('\r') ? '\r' : '';
      const body = cr ? l.slice(0, -1) : l;
      lines[t.line] = body.replace(OPEN_BOX_RE, '[x]') + stamp + cr;
      ok = true;
      return lines.join('\n');
    });
    if (ok) this.logDone(t.display, t.file.path, t.due);
    else new Notice('That task changed in the meantime — refreshed');
    return ok;
  },
});
