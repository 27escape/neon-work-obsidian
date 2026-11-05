/* ---- Time tab ------------------------------------------------------------ */
class TimeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.cursor = moment().startOf('day');
  }
  getViewType() {
    return VIEW_TIME;
  }
  getDisplayText() {
    return 'Time';
  }
  getIcon() {
    return 'clock';
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'tm-view');
    this.scroller = this.contentEl.createDiv('tm-scroll');
    this.first = true;
    this.mountPattern();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountPattern()));
    const soon = debounce(() => this.render(), 300, true);
    this.register(this.plugin.onChange((now) => (now ? this.render() : soon())));
    this.registerInterval(window.setInterval(() => this.render(), 60 * 1000));
    this.render();
  }
  async onClose() {
    this.unmountPattern();
    this.contentEl.empty();
  }
  /** The dashboard's dot pattern behind the cards, when Neon Deck is on. */
  mountPattern() {
    this.unmountPattern();
    const api = deckApi(this.app);
    if (api && api.mountPattern) this.pattern = api.mountPattern(this.contentEl, this.scroller, '.tm-panel');
  }
  unmountPattern() {
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }
  /** A dashboard-style card. Returns the card parts; body gets cls. */
  card(parent, cls, title, ic, sub) {
    const w = widget(parent, 'tm-panel', title, ic, sub);
    w.body.addClass(cls);
    return w;
  }
  render() {
    const p = this.plugin;
    const sc = this.scroller;
    const scroll = sc.scrollTop;
    sc.empty();
    const root = sc.createDiv('tm-inner');
    if (this.first) {
      this.first = false;
      root.addClass('is-entering');
      window.setTimeout(() => root.removeClass('is-entering'), 900);
    }
    const key = this.cursor.format('YYYY-MM-DD');
    const isToday = this.cursor.isSame(moment(), 'day');
    const sum = p.summary(key, isToday);

    const head = root.createDiv('nd-hero tm-head');
    const nav = head.createDiv('tm-nav');
    nav.createDiv({ cls: 'nd-hero-greet', text: 'Time' });
    button(nav, { icon: 'chevron-left', cls: 'nd-icon-btn', title: 'Previous day', onClick: () => this.go(-1) });
    nav.createDiv({ cls: 'nd-hero-date tm-date', text: this.cursor.format('dddd D MMM YYYY') });
    button(nav, { icon: 'chevron-right', cls: 'nd-icon-btn', title: 'Next day', onClick: () => this.go(1) });
    if (!isToday) button(nav, { text: 'Today', onClick: () => ((this.cursor = moment().startOf('day')), this.render()) });
    const acts = head.createDiv('tm-acts');
    button(acts, { icon: 'plus', text: 'Add time', cls: 'mod-cta', onClick: () => p.newEntry({ start: isToday ? undefined : this.cursor.clone().hour(9).valueOf() }) });
    if (isToday) p.workButton(acts);
    if (isToday) button(acts, { icon: 'sunset', text: 'Wrap up', onClick: () => new WrapUpModal(p).open() });
    button(acts, { icon: 'file-text', text: 'Log note', onClick: () => p.openDayNote(key) });

    const top = root.createDiv('tm-top');
    const today = this.card(top, 'tm-today', isToday ? 'Today' : 'This day', 'pie-chart', sum.target ? `${fmtMin(sum.total)} of ${fmtMin(sum.target)}` : fmtMin(sum.total)).body;
    // a new day on screen (or the tab just opened): the ring draws in and entries rise in
    const intro = key !== this.shownKey;
    this.shownKey = key;
    p.donut(today, sum, 150, intro);
    p.legend(today.createDiv('tm-legend'), sum);

    const bal = this.card(top, 'tm-balance', 'Balance', 'scale').body;
    const wk = p.balance(this.cursor.clone().startOf('isoWeek'), this.cursor.clone().endOf('isoWeek'));
    const mo = p.balance(this.cursor.clone().startOf('month'), this.cursor.clone().endOf('month'));
    const bl = (v, l) => {
      const b = bal.createDiv(`tm-bal ${v > 0 ? 'is-over' : v < 0 ? 'is-under' : ''}`);
      b.createDiv({ cls: 'tm-bal-v', text: `${v > 0 ? '+' : ''}${fmtMin(v)}` });
      b.createDiv({ cls: 'tm-label', text: l });
    };
    bl(wk.balance, `week ${this.cursor.isoWeek()} balance`);
    bl(mo.balance, `${this.cursor.format('MMMM')} balance`);
    bal.createDiv({ cls: 'tm-hint', text: `${fmtMin(wk.total)} this week · only days with tracked time count` });

    // week strip
    const week = this.card(root, 'tm-week', `Week ${this.cursor.isoWeek()}`, 'calendar-days', 'click a day to open it').body;
    const ws = this.cursor.clone().startOf('isoWeek');
    const days = [...Array(7)].map((_, i) => ws.clone().add(i, 'days'));
    const sums = days.map((d) => p.summary(d.format('YYYY-MM-DD'), d.isSame(moment(), 'day')));
    // scale to the weekday target (not today's, which is 0 on weekends) so the target line stays inside the bar
    const max = Math.max(Math.round(p.settings.dayHours * 60), ...sums.map((s) => s.total)) || 1;
    for (let i = 0; i < 7; i++) {
      const d = days[i];
      const s = sums[i];
      const col = week.createDiv('tm-col' + (d.isSame(this.cursor, 'day') ? ' is-cursor' : ''));
      const bar = col.createDiv('tm-col-bar');
      if (s.target) bar.createDiv('tm-col-target').style.bottom = `${(s.target / max) * 100}%`;
      for (const k of TIME_CATS) {
        if (!s.by[k]) continue;
        const seg = bar.createDiv('tm-col-seg');
        seg.style.height = `${(s.by[k] / max) * 100}%`;
        seg.style.background = catColor(k);
      }
      col.createDiv({ cls: 'tm-col-v', text: s.total ? fmtMin(s.total) : '·' });
      col.createDiv({ cls: 'tm-col-d', text: d.format('dd D') });
      tip(col, `${d.format('ddd D MMM')} · ${fmtMin(s.total)}${s.over ? ` · +${fmtMin(s.over)} over` : ''}`);
      col.addEventListener('click', () => ((this.cursor = d.clone()), this.render()));
    }

    // entries
    const ec = this.card(root, 'tm-entries', 'Entries', 'list');
    const list = ec.body;
    if (isToday && p.session) ec.actions.createDiv({ cls: 'tm-live', text: `● tracking ${p.session.name}` });
    const entries = p.entriesOf(key, isToday).reverse(); // newest on top; entriesOf returns a fresh array
    const scale = p.workScale(key, isToday); // on screen, entries add up to the worked time
    if (!entries.length) emptyState(list, isToday ? 'Nothing tracked yet today. Work in a note and time counts by itself.' : 'Nothing tracked on this day.');
    entries.forEach((e, idx) => {
      const r = list.createDiv('tm-entry' + (e.live ? ' is-live' : '') + (intro ? ' is-intro' : ''));
      r.style.setProperty('--i', String(idx));
      r.style.setProperty('--cat', catColor(e.cat));
      r.createSpan({ cls: 'tm-entry-at', text: moment(e.start).format('HH:mm') });
      r.createSpan({ cls: 'tm-entry-min', text: fmtMin(Math.round(entryMin(e) * scale)) });
      r.createSpan({ cls: 'tm-entry-cat', text: CAT_LABEL[e.cat] || 'Other' });
      const t = r.createSpan({ cls: 'tm-entry-note', text: e.note || (e.path ? e.path.split('/').pop().replace(/\.md$/, '') : '—') });
      if (e.path) {
        t.addClass('is-link');
        t.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(e.path);
          if (f instanceof TFile) openFile(this.app, f);
        });
      }
      if (e.jira) r.createSpan({ cls: 'tm-entry-jira', text: e.jira });
      r.createSpan({ cls: `tm-entry-src s-${e.source}`, text: e.live ? 'live' : e.source });
      const a = r.createDiv('tm-entry-acts');
      if (!e.live) button(a, { icon: 'pencil', cls: 'nd-icon-btn', title: 'Edit', onClick: () => new EntryModal(p, e, false).open() });
      button(a, { icon: 'trash-2', cls: 'nd-icon-btn', title: e.live && !e.savedId ? 'Discard live time' : 'Delete', onClick: () => p.deleteEntry(e) });
    });
    const day = p.days[key];
    if (day && day.tomorrow) {
      const t = this.card(root, 'tm-tomorrow', 'Note for tomorrow', 'sunrise').body;
      t.createDiv({ text: day.tomorrow });
    }
    madeWith(root.createDiv('tm-foot'), 'Neon Time');
    sc.scrollTop = scroll;
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  go(n) {
    this.cursor.add(n, 'days');
    this.render();
  }
}

