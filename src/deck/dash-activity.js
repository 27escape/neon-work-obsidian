Object.assign(DashboardView.prototype, {
  /** Top of Recently done / touched: ticked tasks and tickets set to Done/Waiting, last 14 days, by day. */
  renderDoneLog(b) {
    const cut = moment().startOf('day').subtract(13, 'days').valueOf();
    const items = [];
    for (const [id, fn] of this.plugin.activity) {
      try {
        for (const x of fn() || []) if (x && x.t >= cut) items.push(x);
      } catch (e) {
        console.error(`Neon Deck activity ${id}`, e);
      }
    }
    items.sort((a, b2) => b2.t - a.t);
    const today = items.filter((x) => moment(x.t).isSame(moment(), 'day')).length;
    this.recent.badge.setText(today ? `${today} today` : '');
    if (!this.plugin.activity.size) return; // Tasks and Tickets both off: only the notes list
    const box = b.createDiv('nd-done-log');
    if (!items.length) return void box.createDiv({ cls: 'nd-done-empty', text: 'Nothing done yet today' });
    let day = '';
    const seen = this.doneSeen; // rows drawn last time: only new ones slide in
    this.doneSeen = new Set();
    for (const x of items.slice(0, 200)) {
      const m = moment(x.t);
      const k = m.format('YYYY-MM-DD');
      if (k !== day) {
        day = k;
        const label = m.isSame(moment(), 'day') ? 'Today' : m.isSame(moment().subtract(1, 'day'), 'day') ? 'Yesterday' : moment().diff(m.clone().startOf('day'), 'days') < 7 ? m.format('dddd') : m.format('ddd D MMM');
        box.createDiv({ cls: 'nd-done-day', text: label });
      }
      const key = `${x.kind}|${x.t}|${x.text}`;
      this.doneSeen.add(key);
      const r = box.createDiv('nd-done-row' + (x.open ? ' is-clickable' : '') + (seen && !seen.has(key) ? ' is-new' : ''));
      icon(r, x.kind === 'ticket' ? 'ticket' : 'check', 'nd-ico nd-done-ico');
      r.createSpan({ cls: 'nd-done-text', text: x.text });
      if (x.status) r.createSpan({ cls: `nd-done-chip is-${x.status}`, text: x.status === 'done' ? 'Done' : 'Waiting' });
      if (x.src) r.createSpan({ cls: 'nd-done-src', text: x.src });
      r.createSpan({ cls: 'nd-done-at', text: m.format('HH:mm') });
      tip(r, x.text);
      if (x.open) r.addEventListener('click', (e) => x.open(e));
    }
  },
  /** Activity: a Month view (stats + calendar) and a Week view per week of the month (each day's entries). */
  renderHeat(d) {
    const b = this.heat.body;
    b.empty();
    const p = this.plugin;
    const month = (this.actMonth = this.actMonth || moment().startOf('month'));
    const days = actDays(p, d, month);
    // header: month switch + Month / week chips
    const acts = this.heat.actions;
    acts.empty();
    button(acts, { icon: 'chevron-left', cls: 'nd-icon-btn', title: 'Previous month', onClick: () => ((this.actMonth = month.clone().subtract(1, 'month')), (this.actView = 'month'), this.renderHeat(d)) });
    acts.createSpan({ cls: 'nd-act-month', text: month.format('MMM YYYY') });
    button(acts, { icon: 'chevron-right', cls: 'nd-icon-btn', title: 'Next month', onClick: () => ((this.actMonth = month.clone().add(1, 'month')), (this.actView = 'month'), this.renderHeat(d)) });
    const weeks = [];
    for (let w = month.clone().startOf('isoWeek'); w.isBefore(month.clone().endOf('month')); w.add(1, 'week')) weeks.push(w.clone());
    const view = this.actView == null || (this.actView !== 'month' && !weeks[this.actView]) ? 'month' : this.actView;
    // rise-in only when the month or view changes, not on every data refresh
    const animKey = `${month.format('YYYY-MM')}|${view}`;
    b.toggleClass('is-anim', this.actAnimKey !== animKey);
    this.actAnimKey = animKey;
    const tabs = pills(acts, [['month', 'Month'], ...weeks.map((w, i) => [i, `W${w.isoWeek()}`])], view, (v) => ((this.actView = v), this.renderHeat(d)), 'nd-act-tabs');
    acts.prepend(tabs.el);
    if (view === 'month') this.renderActMonth(b, month, days, weeks);
    else this.renderActWeek(b, weeks[view], days);
  },
  renderActMonth(b, month, days, weeks) {
    const wrap = b.createDiv('nd-act-monthview');
    const stats = wrap.createDiv('nd-act-stats');
    for (const st of ACTIVITY_STATS) {
      const r = st.get(days, month, this.plugin);
      if (!r) continue;
      const t = stats.createDiv('nd-act-stat');
      t.style.setProperty('--stat-accent', st.accent);
      t.createDiv({ cls: 'nd-act-stat-v', text: r.v });
      t.createDiv({ cls: 'nd-act-stat-l', text: r.sub ? `${st.label} · ${r.sub}` : st.label });
      tip(t, st.how);
    }
    if (!stats.childElementCount) stats.createDiv({ cls: 'nd-act-none', text: 'No stats yet this month' });
    const cal = wrap.createDiv('nd-act-cal');
    cal.style.gridTemplateRows = `auto repeat(${weeks.length}, minmax(30px, 1fr))`;
    for (const n of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) cal.createDiv({ cls: 'nd-act-dow', text: n });
    const todayKey = dayKey(Date.now());
    const max = Math.max(1, ...[...days.values()].map(actCount));
    weeks.forEach((w, wi) => {
      for (let i = 0; i < 7; i++) {
        const m = w.clone().add(i, 'days');
        const k = m.format('YYYY-MM-DD');
        const x = days.get(k);
        const n = x ? actCount(x) : 0;
        const c = cal.createDiv('nd-act-day' + (m.month() !== month.month() ? ' is-out' : '') + (k === todayKey ? ' is-today' : '') + (n ? ' is-clickable' : ''));
        c.style.setProperty('--i', String(wi * 7 + i));
        c.style.setProperty('--lvl', String(n ? 0.15 + (0.85 * n) / max : 0));
        c.createSpan({ cls: 'nd-act-num', text: String(m.date()) });
        const dots = c.createDiv('nd-act-dots');
        if (x) for (const [kind, list] of [['task', x.tasks], ['ticket', x.tickets], ['time', x.time], ['note', x.notes]]) if (list.length) dots.createSpan(`nd-act-dot is-${kind}`);
        tip(c, `${m.format('ddd D MMM')} · ${x ? `${x.tasks.length} tasks · ${x.tickets.length} tickets · ${x.time.length} time entries · ${x.notes.length} notes` : 'nothing'}`);
        if (n) c.addEventListener('click', () => new ActivityDayModal(this.plugin, m, x).open());
      }
    });
  },
  renderActWeek(b, w, days) {
    const wk = b.createDiv('nd-act-week');
    const todayKey = dayKey(Date.now());
    for (let i = 0; i < 7; i++) {
      const m = w.clone().add(i, 'days');
      const k = m.format('YYYY-MM-DD');
      const x = days.get(k);
      const col = wk.createDiv('nd-act-col' + (k === todayKey ? ' is-today' : ''));
      col.style.setProperty('--i', String(i));
      const head = col.createDiv({ cls: 'nd-act-col-head is-clickable', text: m.format('ddd D') });
      head.addEventListener('click', () => new ActivityDayModal(this.plugin, m, x).open());
      const list = col.createDiv('nd-act-col-list');
      const rows = x ? [...x.tasks, ...x.tickets, ...x.time, ...x.notes].sort((a, b2) => a.t - b2.t) : [];
      if (!rows.length) list.createDiv({ cls: 'nd-act-none', text: '·' });
      for (const r of rows) {
        const el = list.createDiv(`nd-act-item is-${r.kind}` + (r.open ? ' is-clickable' : ''));
        icon(el, { task: 'check', ticket: 'ticket', time: 'clock', note: 'file-text' }[r.kind], 'nd-ico');
        el.createSpan({ cls: 'nd-act-item-text', text: r.text });
        tip(el, `${moment(r.t).format('HH:mm')} · ${r.text}${r.extra ? ' · ' + r.extra : ''}`);
        if (r.open) el.addEventListener('click', (e) => r.open(e));
      }
    }
  },

});
