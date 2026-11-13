Object.assign(DashboardView.prototype, {
  renderTicker(d) {
    d = d || this.lastData || this.plugin.collectVaultData();
    const p = this.plugin;
    const items = [];
    for (const fn of p.facts.values()) {
      try {
        items.push(...(fn() || []));
      } catch (e) {
        console.error('Neon Deck facts', e);
      }
    }
    items.push({ v: d.md.length, l: 'notes' }, { v: d.editedToday.length, l: 'edited today' });
    // about one line in ten is a sign-off
    const n = Math.max(1, Math.round(items.length / 9));
    for (let i = 0; i < n; i++) {
      const pos = Math.floor(((i + 1) * items.length) / (n + 1)) + i;
      items.splice(pos, 0, { me: SIGNOFFS[Math.floor(Math.random() * SIGNOFFS.length)] });
    }
    // group into lines of three facts (a sign-off gets its own line)
    const lines = [];
    let cur = [];
    for (const it of items) {
      if (it.me) {
        if (cur.length) lines.push(cur);
        lines.push([it]);
        cur = [];
        continue;
      }
      cur.push(it);
      if (cur.length === 3) (lines.push(cur), (cur = []));
    }
    if (cur.length) lines.push(cur);
    const first = !this.tickerLines;
    this.tickerLines = lines;
    if (first || this.tickerIdx >= lines.length) this.tickerIdx = 0;
    this.showTicker(false);
  },
  nextTicker() {
    if (!this.tickerLines || this.tickerLines.length < 2 || !this.tickerEl || !this.tickerEl.isConnected) return;
    if (this.tickerEl.matches(':hover')) return;
    this.tickerIdx = (this.tickerIdx + 1) % this.tickerLines.length;
    this.showTicker(true);
  },
  showTicker(fade) {
    const el = this.tickerEl;
    const line = this.tickerLines && this.tickerLines[this.tickerIdx];
    el.empty();
    if (!line) return;
    const row = el.createDiv('nd-ticker-line' + (fade ? ' is-fresh' : ''));
    line.forEach((it, i) => {
      if (i) row.createSpan({ cls: 'nd-ticker-star', text: '✦' });
      const s = row.createSpan('nd-ticker-item' + (it.me ? ' is-me' : ''));
      if (it.me) s.setText(it.me);
      else {
        s.createEl('b', { text: String(it.v) });
        s.appendText(' ' + it.l);
      }
    });
  },

  /** Totals card: live counts from Neon Time, Tickets, Tasks and the vault. The first tile spans the card. */
  renderTotals(d) {
    if (!this.totals) return;
    d = d || this.lastData || this.plugin.collectVaultData();
    const b = this.totals.body;
    b.empty();
    const tiles = b.createDiv('nd-tiles nd-totals' + (this.totalsShown ? '' : ' is-intro'));
    this.totalsShown = true;
    let i = 0;
    /** value: a number, or [number, format] for minutes and the like; numbers count up when they change */
    const tile = (value, label, accent, sub, hint) => {
      const t = tiles.createDiv('nd-tile');
      t.style.setProperty('--tile-accent', accent);
      t.style.setProperty('--i', String(i++));
      const v = t.createDiv({ cls: 'nd-tile-value' });
      const [n, fmt] = Array.isArray(value) ? value : [value, null];
      if (typeof n === 'number') this.countTo(v, `totals:${label.replace(/s$/, '')}`, n, fmt);
      else v.setText(n);
      t.createDiv({ cls: 'nd-tile-label', text: label });
      if (sub) t.createDiv({ cls: 'nd-tile-sub', text: sub });
      if (hint) tip(t, hint);
    };
    const now = moment();
    const monthStart = now.clone().startOf('month');
    const thisMonth = (ms) => ms >= monthStart.valueOf();
    const month = now.format('MMM');

    // time worked (Neon Time)
    const tm = neonPlugin(this.app, 'neon-time');
    if (tm && tm.days) {
      const todayKey = now.format('YYYY-MM-DD');
      let total = 0;
      let monthMin = 0;
      let worked = 0;
      let tasks = 0;
      let tasksMonth = 0;
      for (const [key, day] of Object.entries(tm.days)) {
        // the day total includes the Start day / End day timer (issue 54), not only logged entries
        const min = tm.summary ? tm.summary(key, key === todayKey).total : (day.entries || []).reduce((s, e) => s + (e.ms || 0), 0) / 60000;
        total += min;
        if (key >= monthStart.format('YYYY-MM-DD')) monthMin += min;
        if (min >= 1) worked++;
        for (const x of day.done || []) {
          if (x.kind !== 'task') continue;
          tasks++;
          if (thisMonth(x.t || 0)) tasksMonth++;
        }
      }
      let bal = null;
      try {
        if (tm.balance) bal = tm.balance(moment(0), now).balance;
      } catch (e) {
        console.error('Neon Deck totals', e);
      }
      tile([Math.round(total), (x) => fmtMin(Math.round(x))], 'time worked', 'var(--nd-accent)', `${fmtMin(Math.round(monthMin))} in ${month}${bal ? ` · ${bal > 0 ? '+' : ''}${fmtMin(bal)} balance` : ''}`, 'All time tracked in Neon Time, automatic and manual');
      tile(worked, worked === 1 ? 'day worked' : 'days worked', 'var(--nd-info)', null, 'Days with tracked time');
      tile(tasks, 'tasks done', 'var(--nd-go)', `${tasksMonth} in ${month}`, 'Tasks ticked since Neon Time started counting');
    } else {
      const ts = neonPlugin(this.app, 'neon-tasks');
      const log = ts && ts.settings && ts.settings.doneLog;
      if (log) tile(log.length, 'tasks done', 'var(--nd-go)', `${log.filter((x) => thisMonth(x.t)).length} in ${month}`, 'Tasks ticked in the last 120 days');
    }

    // projects (Neon Projects)
    const tk = neonPlugin(this.app, 'neon-tickets');
    if (tk && tk.collectProjects) {
      const all = tk.collectProjects();
      const done = all.filter((t) => t.status === 'done');
      const doneMonth = done.filter((t) => t.completed && t.completed.isSame(now, 'month')).length;
      tile(done.length, 'projects closed', 'var(--nd-warn)', `${doneMonth} in ${month} · ${all.length - done.length} open`, 'Projects closed, by completed or cancelled date');
    }

    // notes (vault)
    const created = d.md.filter((f) => thisMonth(f.stat.ctime)).length;
    tile(d.md.length, 'notes', 'var(--nd-text)', `${created} created in ${month}`, 'Notes in the vault, without excluded folders');
  },
});
