Object.assign(NeonTime.prototype, {
  /* ---- data ------------------------------------------------------------- */
  day(key) {
    let d = this.days[key];
    if (!d) d = this.days[key] = { entries: [], done: [], tomorrow: '', wrapped: false };
    return d;
  },
  /** Entries of a day, sorted, with the running session added when live. */
  entriesOf(key, live) {
    const d = this.days[key];
    const out = d ? [...d.entries] : [];
    if (live) for (const [path, pd] of this.pending) if (pd.key === key) out.push({ start: pd.start, ms: pd.ms, cat: pd.cat, note: '', path, jira: pd.jira, source: 'auto', live: true, pendingPath: path });
    const s = this.session;
    if (live && s && dayKey(s.start) === key && s.last - s.start >= 1000) {
      const prev = out[out.length - 1];
      const liveMs = s.last - s.start;
      // the live row continues a saved entry: show them as one; deleting it removes both (savedId)
      if (prev && prev.source === 'auto' && prev.path === s.path && prev.cat === s.cat && s.start - prev.end <= this.settings.idleMin * 60000)
        out[out.length - 1] = { ...prev, id: undefined, savedId: prev.id, ms: prev.ms + liveMs, liveMs, live: true, sessionLive: true };
      else out.push({ start: s.start, ms: liveMs, liveMs, cat: s.cat, note: '', path: s.path, jira: s.jira, source: 'auto', live: true, sessionLive: true });
    }
    return out.sort((a, b) => a.start - b.start);
  },
  targetMin(m) {
    const wd = (m || moment()).isoWeekday();
    return wd <= 5 ? Math.round(this.settings.dayHours * 60) : 0;
  },
  /** Minutes per category as logged; with a started workday the total is the larger of logged time and the
   *  work timer (issue 48), the difference is "untracked", breaks are reported but never counted (issue 52). */
  summary(key, live) {
    const by = Object.fromEntries(timeCats().map((k) => [k, 0]));
    for (const e of this.entriesOf(key, live)) by[timeCats().includes(e.cat) ? e.cat : 'other'] += e.ms / 60000;
    for (const k of timeCats()) by[k] = Math.round(by[k]);
    const tracked = timeCats().reduce((s, k) => s + by[k], 0);
    const w = this.workOf(key);
    // a past day never ended stops at its last activity instead of growing forever
    const now = w ? w.end || (live ? Date.now() : w.last) : 0;
    const total = w ? Math.max(tracked, this.workMin(key, now)) : tracked;
    const breaks = w ? Math.round(w.breaks.reduce((n, [a, b]) => n + Math.max(0, Math.min(b == null ? now : b, now) - a), 0) / 60000) : 0;
    const target = this.targetMin(moment(key, 'YYYY-MM-DD'));
    return { key, by, tracked, untracked: total - tracked, breaks, total, target, over: Math.max(0, total - target), work: this.workState(key) };
  },

  /** Overtime balance over a range: only days with tracked time count; today counts once it's past the target. */
  balance(from, to) {
    const todayKey = moment().format('YYYY-MM-DD');
    let balance = 0;
    let total = 0;
    let over = 0;
    for (const key of Object.keys(this.days)) {
      const m = moment(key, 'YYYY-MM-DD');
      if (m.isBefore(from, 'day') || m.isAfter(to, 'day') || key > todayKey) continue;
      const s = this.summary(key, key === todayKey);
      if (!s.total) continue;
      total += s.total;
      over += s.over;
      balance += key === todayKey ? s.over : s.total - s.target;
    }
    return { balance, total, over };
  },
  addEntry(v, quiet) {
    const e = { id: newId(), start: v.start, end: v.start + v.ms, ms: v.ms, cat: v.cat, note: v.note || '', path: v.path || '', jira: v.jira || '', source: v.source || 'manual' };
    const key = dayKey(e.start);
    const day = this.day(key);
    day.entries.push(e);
    day.entries.sort((a, b) => a.start - b.start);
    this.changed(key);
    if (!quiet) new Notice(`⏱ ${fmtMin(entryMin(e))} ${CAT_LABEL[e.cat] || 'Other'} logged`);
  },
  findEntry(e) {
    for (const [key, d] of Object.entries(this.days)) {
      const i = d.entries.findIndex((x) => x.id === e.id);
      if (i !== -1) return { key, d, i };
    }
    return null;
  },
  updateEntry(e, v) {
    const hit = this.findEntry(e);
    if (!hit) return;
    const cur = hit.d.entries[hit.i];
    Object.assign(cur, v, { end: v.start + v.ms, source: cur.source === 'auto' ? 'auto' : cur.source });
    const key = dayKey(cur.start);
    if (key !== hit.key) {
      hit.d.entries.splice(hit.i, 1);
      this.day(key).entries.push(cur);
      this.changed(hit.key);
    }
    this.day(key).entries.sort((a, b) => a.start - b.start);
    this.changed(key);
  },
  deleteEntry(e) {
    // live rows: drop the running session and/or the short bits not saved yet
    if (e.live) {
      if (e.sessionLive) this.session = null;
      if (e.pendingPath) this.pending.delete(e.pendingPath);
      if (!e.id && !e.savedId) {
        new Notice(`Discarded ${fmtMin((e.liveMs || e.ms) / 60000)} of live time`);
        return this.emit();
      }
    }
    const hit = this.findEntry({ id: e.id || e.savedId });
    if (!hit) return;
    const [gone] = hit.d.entries.splice(hit.i, 1);
    this.changed(hit.key);
    let undone = false;
    const notice = new Notice(createFragment((f) => {
      f.appendText(`Deleted ${fmtMin(entryMin(gone))} entry · `);
      const u = f.createEl('a', { text: 'Undo', href: '#' });
      u.addEventListener('click', (ev) => {
        ev.preventDefault();
        // only once, and not if it's back already
        if (undone || this.findEntry(gone)) return;
        undone = true;
        hit.d.entries.push(gone);
        hit.d.entries.sort((a, b) => a.start - b.start);
        this.changed(hit.key);
        notice.hide();
      });
    }), 6000);
  },
  addDone(item, quiet, key = moment().format('YYYY-MM-DD')) {
    const d = this.day(key);
    if (item.kind === 'note' && d.done.some((x) => x.kind === 'note' && x.ref === item.ref)) return;
    d.done.push({ t: Date.now(), ...item });
    if (d.done.length > 300) d.done.splice(0, d.done.length - 300);
    if (!quiet) this.changed(key);
  },
  newEntry(partial) {
    new EntryModal(this, { cat: 'operations', ...partial }, true).open();
  },

});
