Object.assign(NeonTasks.prototype, {
  /* collecting tasks ----------------------------------------------------- */
  isTaskSource(f, cache) {
    if (isTicketCache(cache)) return false;
    return fmTags(cache && cache.frontmatter).includes('tasks');
  },
  async collectTasks() {
    const app = this.app;
    const today = moment().startOf('day');
    const todayKey = today.format('YYYY-MM-DD');
    const sources = new Map();
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache.getFileCache(f);
      if (!cache || !cache.listItems) continue;
      if (isTicketCache(cache)) continue;
      if (this.isTaskSource(f, cache) || f.path === this.quickPath()) {
        sources.set(f.path, { f, cache, daily: null });
        continue;
      }
      const d = dailyDateOf(app, f);
      if (d && !d.isAfter(today) && today.diff(d, 'days') <= this.settings.carryDays) sources.set(f.path, { f, cache, daily: d });
    }
    const out = [];
    for (const { f, cache, daily } of sources.values()) {
      const lis = cache.listItems.filter((li) => li.task === ' ');
      if (!lis.length) continue;
      const lines = (await app.vault.cachedRead(f)).split('\n');
      for (const li of lis) {
        const line = (lines[li.position.start.line] || '').replace(/\r$/, '');
        const m = line.match(TASK_LINE_RE);
        if (!m || !m[1].trim()) continue;
        const raw = m[1];
        const { due, group } = taskGroup(raw, daily, todayKey);
        out.push({
          file: f,
          line: li.position.start.line,
          raw,
          due,
          group,
          carried: daily && !daily.isSame(today, 'day') ? daily : null,
          display: taskDisplay(raw),
          quick: f.path === this.quickPath(),
        });
      }
    }
    out.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.file.stat.mtime - a.file.stat.mtime || a.line - b.line);
    this.sourcePaths = new Set(sources.keys());
    return out;
  },
  quickPath() {
    const p = this.settings.quickTasksPath;
    return normalizePath(p.endsWith('.md') ? p : p + '.md');
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
      console.error('Neon Tasks: could not add task', e);
      new Notice('Could not add the task');
      this.pendingQuick = this.pendingQuick.filter((x) => x !== pend);
      this.emit();
    }
  },
  async writeQuickTask(text) {
    const path = this.quickPath();
    let f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) {
      await ensureFolder(this.app, path.split('/').slice(0, -1).join('/'));
      f = await this.app.vault.create(path, `---\ntags:\n  - tasks\n---\n# Quick tasks\n\nAdded from the dashboard. Stays until ticked.\n\n`);
    }
    await this.app.vault.process(f, (d) => d.replace(/\s*$/, '') + `\n- [ ] ${text}\n`);
  },
  /** Rewrite one open task line in its note (item 15); the line must still be the task that was shown. */
  async editTask(t, raw) {
    let ok = false;
    await this.app.vault.process(t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      if (l === undefined || !/\[ \]/.test(l) || !l.includes(t.raw)) return data;
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
    await this.app.vault.process(t.file, (data) => {
      const lines = data.split('\n');
      const l = lines[t.line];
      // the line must still be this open task (the note may have changed since the list was drawn)
      if (l === undefined || !/\[ \]/.test(l) || !l.includes(t.raw)) return data;
      const cr = l.endsWith('\r') ? '\r' : '';
      const body = cr ? l.slice(0, -1) : l;
      lines[t.line] = body.replace('[ ]', '[x]') + stamp + cr;
      ok = true;
      return lines.join('\n');
    });
    if (ok) this.logDone(t.display, t.file.path, t.due);
    else new Notice('That task changed in the meantime — refreshed');
  },

});
