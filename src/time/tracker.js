Object.assign(NeonTime.prototype, {
  /* ---- tracking -------------------------------------------------------- */
  isLogFile(f) {
    const folder = normalizePath(this.settings.logFolder || 'Core/Time Log');
    return !!f && (f.path === folder || f.path.startsWith(folder + '/'));
  },
  /** Category a file's time goes to, or null when it must not be logged. */
  trackCat(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.isLogFile(file)) return null;
    const c = fileCategory(this.app, file);
    if (c === 'untracked') return null;
    return c || 'other';
  },
  touch(e) {
    this.workSeen();
    if (!this.settings.tracking || document.hidden) return;
    const now = Date.now();
    // cheap throttle: one check every 3 s is plenty for minute-level time
    if (this.session && now - this.session.last < 3000) return;
    const view = this.activeFileView();
    if (!view || !view.file || (e && e.target instanceof Node && !view.containerEl.contains(e.target))) return;
    const file = view.file;
    const idle = this.settings.idleMin * 60000;
    const s = this.session;
    if (s && s.path === file.path && now - s.last <= idle) {
      // re-read the category: the note may have been set to untracked or moved category mid-session
      const cat = this.trackCat(file);
      if (cat === s.cat) {
        s.last = now;
        return;
      }
      if (!cat) return this.dropTracking(file.path);
    }
    this.closeSession();
    const cat = this.trackCat(file);
    if (!cat) return;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    this.session = { path: file.path, name: file.basename, cat, jira: fm.jira ? String(fm.jira) : '', start: now, last: now };
    this.updateStatus();
  },
  /** The focused note's view (markdown, ticket view, …), or null. */
  activeFileView() {
    const ws = this.app.workspace;
    const v = ws.getActiveViewOfType(FileView);
    if (v && v.file) return v;
    const leaf = ws.activeLeaf;
    return leaf && leaf.view && leaf.view.file instanceof TFile ? leaf.view : null;
  },
  tick() {
    this.workIdleCheck();
    const s = this.session;
    if (s && Date.now() - s.last > this.settings.idleMin * 60000) this.closeSession();
    else if (s && dayKey(s.start) !== dayKey(Date.now())) {
      // past midnight: save the old day's part and keep tracking on the new day
      this.closeSession();
      const f = this.app.vault.getAbstractFileByPath(s.path);
      const t = Math.max(s.last, moment().startOf('day').valueOf());
      if (!(f instanceof TFile) || this.trackCat(f)) this.session = { ...s, start: t, last: t };
      this.updateStatus();
    } else if (s) this.updateStatus();
  },
  /** End the running session at its last activity, merging into the previous entry when it's the same note. */
  closeSession() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    // the note was set to untracked before the session ended: keep none of it
    const f = this.app.vault.getAbstractFileByPath(s.path);
    if (f instanceof TFile && !this.trackCat(f)) {
      this.pending.delete(s.path);
      return this.emit();
    }
    if (s.last - s.start <= 0) return this.updateStatus();
    // a session past midnight is split, so each day gets its own part
    let from = s.start;
    while (dayKey(from) !== dayKey(s.last)) {
      const midnight = moment(from).add(1, 'day').startOf('day').valueOf();
      this.savePiece(s, from, midnight);
      from = midnight;
    }
    this.savePiece(s, from, s.last);
  },
  /** Save one day's part of a session: merge into the previous entry, or add up as short bits until they reach a minute. */
  savePiece(s, start, end) {
    const ms = end - start;
    if (ms <= 0) return;
    const key = dayKey(start);
    const day = this.day(key);
    const prev = day.entries[day.entries.length - 1];
    const idle = this.settings.idleMin * 60000;
    if (prev && prev.source === 'auto' && prev.path === s.path && prev.cat === s.cat && start - prev.end <= idle) {
      prev.ms += ms;
      prev.end = end;
      this.changed(key);
      return;
    }
    // short sessions on the same note (e.g. between glances at the dashboard) add up;
    // once they reach a minute they become one entry
    let pend = this.pending.get(s.path);
    if (!pend || pend.key !== key) pend = { key, start, end, ms: 0, cat: s.cat, name: s.name, jira: s.jira };
    pend.cat = s.cat;
    pend.ms += ms;
    pend.end = end;
    if (pend.ms >= 60000) {
      this.pending.delete(s.path);
      day.entries.push({ id: newId(), start: pend.start, end: pend.end, ms: pend.ms, cat: s.cat, note: '', path: s.path, jira: s.jira, source: 'auto' });
      day.entries.sort((a, b) => a.start - b.start);
      this.addDone({ kind: 'note', ref: s.path, text: s.name }, true, key);
      this.changed(key);
    } else {
      this.pending.set(s.path, pend);
      this.emit();
    }
  },

  /** Save the short bits of work not saved yet as entries (on pause and unload). Returns the day keys touched. */
  flushPending() {
    const keys = new Set();
    for (const [path, pd] of this.pending) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile && !this.trackCat(f)) continue;
      const entries = this.day(pd.key).entries;
      entries.push({ id: newId(), start: pd.start, end: pd.end, ms: pd.ms, cat: pd.cat, note: '', path, jira: pd.jira, source: 'auto' });
      entries.sort((a, b) => a.start - b.start);
      keys.add(pd.key);
    }
    this.pending.clear();
    return keys;
  },
  /** Turn automatic tracking on or off. Pausing saves what was tracked so far. */
  setTracking(on) {
    this.settings.tracking = on;
    if (!on) {
      this.closeSession();
      for (const k of this.flushPending()) this.dirty.add(k);
      this.changed(moment().format('YYYY-MM-DD'));
    } else this.emit();
    this.saveSettings();
  },
  /** Throw away time not saved yet for a note (it was set to untracked). */
  dropTracking(path) {
    if (this.session && this.session.path === path) this.session = null;
    this.pending.delete(path);
    this.emit();
  },

});
