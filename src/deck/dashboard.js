/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/** Default 4×4 layout; satellite slots fall back to their neighbours. */
const DASH_LAYOUT = [
  ['totals', 'pulse', 'pulse', 'tickets'],
  ['totals', 'tasks', 'global', 'tickets'],
  ['capture', 'tasks', 'global', 'time'],
  ['recent', 'activity', 'activity', 'time'],
];
/** Smallest grid height: the row minimums in styles.css (120 + 150 + 150 + 140) plus 3 gaps of 14. */
const DASH_GRID_MIN = 752; // the row minimums in styles-dashboard.css plus 3 gaps; Activity needs 290 for six full weeks
const SLOT_FALLBACK = { tasks: 'global', global: 'tasks', tickets: 'time', time: 'tickets', capture: 'recent' };

function dashAreas(present) {
  const resolve = (name) => {
    const seen = new Set();
    let n = name;
    while (n && !present.has(n) && !seen.has(n)) {
      seen.add(n);
      n = SLOT_FALLBACK[n] || null;
    }
    if (n && present.has(n)) return n;
    if (name === 'tasks' || name === 'tickets') return 'activity';
    return null;
  };
  let rows = DASH_LAYOUT.map((r) => r.map(resolve));
  const cols = rows[0].map((_, c) => rows.some((r) => r[c] !== null));
  rows = rows.map((r) => r.filter((_, c) => cols[c]));
  return { areas: rows.map((r) => `"${r.join(' ')}"`).join(' '), cols: rows[0].length };
}

class DashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.dataToken = 0;
    this.slotCards = new Map();
    // last numbers shown, so tiles count from there when a value changes
    this.prevNums = new Map();
  }
  getViewType() {
    return VIEW_DASH;
  }
  getDisplayText() {
    return 'Dashboard';
  }
  getIcon() {
    return 'layout-dashboard';
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-dash', 'nd-pattern-host');
    this.scroller = root.createDiv('nd-dash-scroll');
    const inner = this.scroller.createDiv('nd-dash-inner');
    this.buildHero(inner);
    this.tickerEl = inner.createDiv('nd-ticker');
    this.grid = inner.createDiv('nd-dash-grid is-entering');
    window.setTimeout(() => this.grid && this.grid.removeClass('is-entering'), 900);
    this.totals = this.place(widget(this.grid, 'nd-w-totals', 'Totals', 'sigma', 'everything tracked so far'), 'totals');
    this.stats = this.place(widget(this.grid, 'nd-w-stats', 'Vault pulse', 'activity'), 'pulse');
    if (this.plugin.settings.showCapture) this.buildCapture(this.grid);
    this.recent = this.place(widget(this.grid, 'nd-w-recent', 'Recently done', 'history'), 'recent');
    button(this.recent.actions, { icon: 'files', cls: 'nd-icon-btn', title: 'Recently touched files', onClick: () => new FileListModal(this.plugin, (this.lastData?.md || []).slice().sort((a, b) => b.stat.mtime - a.stat.mtime), 'Recently touched files').open() });
    this.heat = this.place(widget(this.grid, 'nd-w-heat', 'Activity', 'flame'), 'activity');
    this.heat.body.addClass('nd-act');
    this.footEl = inner.createDiv('nd-dash-foot');
    this.mountSlots();

    this.pattern = new PatternLayer(this.plugin, root, this.scroller, '.nd-card, .nd-hero');
    this.register(() => this.pattern && this.pattern.destroy());
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(root);
    ro.observe(this.heroEl); // the hero wraps to more lines on narrow widths
    this.register(() => ro.disconnect());

    // Vault changes re-render only while the dashboard is visible; a hidden tab catches up when shown.
    const refresh = debounce(() => {
      if (this.contentEl.offsetParent) this.renderData();
      else this.stale = true;
    }, 1200, true);
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf && this.stale) {
          this.stale = false;
          this.renderData();
        }
      }),
    );
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.registerEvent(this.app.workspace.on('neon-deck:slots-changed', () => this.mountSlots()));
    // Task, Ticket, Time… buttons arrive as the other Neon plugins load
    this.registerEvent(this.app.workspace.on('neon-deck:captures-changed', () => this.capRow && this.renderCaptureTargets()));
    // a module offered new activity (ticks, ticket changes) or started late: the log and the Activity calendar both follow
    this.registerEvent(this.app.workspace.on('neon-deck:activity-changed', debounce(() => this.lastData && (this.renderRecent(this.lastData), this.renderHeat(this.lastData)), 200, true)));
    this.registerEvent(
      this.app.workspace.on(
        'neon-deck:facts-changed',
        debounce(() => (this.renderTicker(), this.renderTotals()), 500, true),
      ),
    );
    // the ticker stands still and swaps to the next few facts every 10 s
    this.registerInterval(window.setInterval(() => this.nextTicker(), 10000));
    this.register(this.plugin.onLook(() => this.syncLook()));
    this.renderData();
    this.syncLook();
  }
  async onClose() {
    for (const inst of this.slotCards.values()) this.destroySlot(inst);
    this.slotCards.clear();
  }

  /** Show a number in el, counting from what this tile showed last (0 the first time). */
  countTo(el, key, n, fmt) {
    const from = this.prevNums.has(key) ? this.prevNums.get(key) : 0;
    this.prevNums.set(key, n);
    countUp(el, from, n, fmt || ((x) => Math.round(x).toLocaleString()), from ? 500 : 900);
  }
  place(card, area) {
    card.w.addClass(`nd-area-${area}`);
    card.w.dataset.area = area;
    return card;
  }
  onResize() {
    const w = this.contentEl.clientWidth;
    this.grid.toggleClass('is-narrow', w < 880);
    this.fitGrid();
  }

  /** Grid height = the visible space under the hero, so the dashboard fills any screen. Never below the row minimums (then the page scrolls). */
  fitGrid() {
    if (!this.grid || this.grid.hasClass('is-narrow')) return;
    const sc = this.scroller;
    const top = this.grid.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const pad = parseFloat(getComputedStyle(this.grid.parentElement).paddingBottom) || 0;
    const h = Math.max(DASH_GRID_MIN, Math.floor(sc.clientHeight - top - pad));
    if (h !== this.gridH) {
      this.gridH = h;
      this.grid.style.setProperty('--nd-grid-h', `${h}px`);
    }
  }

  /* satellite widgets ------------------------------------------------ */
  destroySlot(inst) {
    try {
      if (inst.handle && inst.handle.destroy) inst.handle.destroy();
    } catch (e) {
      console.error('Neon Deck widget', e);
    }
    inst.card.w.remove();
  }
  mountSlots() {
    const defs = this.plugin.widgets;
    for (const [id, inst] of this.slotCards) {
      if (defs.get(id) !== inst.def) {
        this.destroySlot(inst);
        this.slotCards.delete(id);
      }
    }
    for (const def of defs.values()) {
      if (this.slotCards.has(def.id)) continue;
      const card = this.place(widget(this.grid, `nd-w-${def.id}`, def.title, def.icon, def.sub), def.slot);
      let handle = null;
      try {
        handle = def.mount(card, this) || null;
      } catch (e) {
        console.error(`Neon Deck widget ${def.id}`, e);
        emptyState(card.body, 'This widget failed to load — see console');
      }
      this.slotCards.set(def.id, { def, card, handle });
    }
    const present = new Set(['totals', 'pulse', 'recent', 'activity', ...[...defs.values()].map((d) => d.slot)]);
    if (this.plugin.settings.showCapture) present.add('capture'); // off: Recently done / touched takes its place
    const { areas, cols } = dashAreas(present);
    this.grid.style.gridTemplateAreas = areas;
    this.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    this.renderHeroActions();
    this.renderTicker();
  }

  /* hero ------------------------------------------------------------- */
  buildHero(parent) {
    const hero = (this.heroEl = parent.createDiv('nd-hero'));
    this.greetEl = hero.createDiv('nd-hero-greet');
    this.dateEl = hero.createDiv('nd-hero-date');
    this.clockEl = hero.createDiv('nd-hero-clock');
    this.actionsEl = hero.createDiv('nd-hero-actions');
    const looks = hero.createDiv('nd-hero-looks');
    const sel = (label, opts, get, set) => {
      const wrap = looks.createEl('label', { cls: 'nd-look-select' });
      wrap.createSpan({ cls: 'nd-look-k', text: label });
      const s = wrap.createEl('select', { cls: 'dropdown' });
      for (const [v, l] of opts) s.createEl('option', { value: v, text: l });
      s.value = get();
      s.addEventListener('change', () => set(s.value));
      return s;
    };
    const p = this.plugin;
    this.themeSel = sel('Theme', THEMES.map((t) => [t, THEME_LABEL[t]]), () => p.settings.theme, (v) => p.setLook({ theme: v }));
    this.patSel = sel(
      'Pattern',
      [['auto', 'Theme default'], ...PATTERNS.map((x) => [x, PATTERN_LABEL[x]])],
      () => p.settings.pattern,
      (v) => p.setLook({ pattern: v }),
    );
    this.strSel = sel('Strength', STRENGTHS.map((x) => [x, STRENGTH_LABEL[x]]), () => p.settings.patternStrength, (v) => p.setLook({ patternStrength: v }));
    this.modeBtn = button(looks, { cls: 'nd-icon-btn nd-mode-toggle', title: 'Light / dark', onClick: () => p.toggleLightDark() });
    this.registerEvent(this.app.workspace.on('css-change', () => this.syncLook()));
    this.updateClock();
    this.registerInterval(window.setInterval(() => this.updateClock(), 1000));
  }
  renderHeroActions() {
    const el = this.actionsEl;
    el.empty();
    const p = this.plugin;
    const acts = [
      { icon: 'file-plus', label: 'New note', run: () => p.newNote('/') },
      { icon: 'calendar-days', label: 'Today', run: () => p.openToday() },
      ...[...p.actions.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50)),
      { icon: 'layout-grid', label: 'Cards', run: () => p.activate(VIEW_CARDS, 'tab') },
      { icon: 'waypoints', label: 'Graph', run: () => p.activate(VIEW_GRAPH, 'tab') },
      { icon: 'search', label: 'Search', run: () => p.openSearch('') },
    ];
    for (const a of acts) button(el, { icon: a.icon, text: a.label, cls: 'nd-action', onClick: () => a.run() });
  }
  syncLook() {
    const s = this.plugin.settings;
    if (this.themeSel) this.themeSel.value = s.theme;
    if (this.patSel) this.patSel.value = s.pattern;
    if (this.strSel) this.strSel.value = s.patternStrength;
    if (this.modeBtn) {
      this.modeBtn.empty();
      icon(this.modeBtn, this.plugin.isDark() ? 'sun' : 'moon');
    }
    if (this.footEl) {
      this.footEl.empty();
      const pat = this.plugin.activePattern();
      this.footEl.createSpan({ text: `Neon Deck ${ND_VERSION} · ${THEME_LABEL[s.theme]}${pat !== 'none' && s.patternStrength !== 'off' ? ' · ' + PATTERN_LABEL[pat] : ''}` });
      this.footEl.createSpan({ cls: 'nd-madewith', text: 'Made with Claude' });
    }
  }
  updateClock() {
    const m = moment();
    const key = m.format('YYYY-MM-DD');
    if (this.clockDay && this.clockDay !== key) {
      // a new day while the dashboard stays open: Activity, the done log and day counts follow (issue 31)
      if (this.actMonth && this.actMonth.isSame(moment(this.clockDay, 'YYYY-MM-DD'), 'month')) this.actMonth = null;
      if (this.contentEl.offsetParent) this.renderData();
      else this.stale = true;
    }
    this.clockDay = key;
    const h = m.hour();
    const g = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const name = this.plugin.settings.name;
    this.greetEl.setText(`${g}${name ? ', ' + name : ''} ✦`);
    this.dateEl.setText(m.format('dddd D MMM'));
    this.clockEl.setText(m.format('HH:mm:ss') + ` · week ${m.isoWeek()}`);
  }

  /* capture ------------------------------------------------------------ */
  buildCapture(grid) {
    const { body } = this.place(widget(grid, 'nd-w-capture', 'Quick capture', 'zap'), 'capture');
    this.capInput = body.createEl('textarea', { cls: 'nd-input nd-capture', attr: { placeholder: 'Dump a thought…', rows: '3' } });
    this.capRow = body.createDiv('nd-pills nd-capture-row');
    this.capInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Ctrl+Enter sends to the first target (Task when Neon Tasks is on)
        this.sendCapture(this.plugin.captureTargets()[0]);
      }
    });
    this.renderCaptureTargets();
  }
  renderCaptureTargets() {
    const row = this.capRow;
    row.empty();
    const targets = this.plugin.captureTargets();
    this.capInput.setAttr('placeholder', targets.length ? `Dump a thought… (Ctrl+Enter → ${targets[0].label})` : 'Dump a thought… (turn on Neon Tasks, Tickets or Time to send it somewhere)');
    targets.forEach((t, i) => {
      const b = row.createEl('button', { cls: 'nd-pill-btn' + (i === 0 ? ' is-on' : ''), text: t.short || t.label });
      tip(b, t.label);
      b.addEventListener('click', () => this.sendCapture(t));
    });
  }
  async sendCapture(t) {
    const ta = this.capInput;
    const v = ta.value.trim();
    if (!t || (!v && !t.allowEmpty)) {
      ta.focus();
      return;
    }
    try {
      await t.run(v);
    } catch (e) {
      console.error('Neon Deck capture', e);
      new Notice('Capture failed — see console');
      return;
    }
    ta.value = '';
    ta.addClass('nd-flash');
    window.setTimeout(() => ta.removeClass('nd-flash'), 600);
  }

  /* data widgets -------------------------------------------------------- */
  async renderData() {
    const token = ++this.dataToken;
    const d = this.plugin.collectVaultData();
    this.lastData = d;
    this.renderStats(d);
    this.renderRecent(d);
    this.renderHeat(d);
    if (this.capRow) this.renderCaptureTargets();
    this.renderTicker(d);
    this.renderTotals(d);
    const words = await this.plugin.totalWords(d.md);
    if (token === this.dataToken && this.wordsEl) this.countTo(this.wordsEl, 'pulse:words', words);
  }
  perDay(list, key) {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const k = moment().subtract(i, 'days').format('YYYY-MM-DD');
      out.push(list.filter((x) => dayKey(key(x)) === k).length);
    }
    return out;
  }
  renderStats(d) {
    const b = this.stats.body;
    b.empty();
    // first paint: sparklines draw in and tiles rise one after another
    const tiles = b.createDiv('nd-tiles' + (this.statsShown ? '' : ' is-intro'));
    this.statsShown = true;
    let i = 0;
    const tile = (value, label, accent, onClick, hint, spark) => {
      const t = tiles.createDiv('nd-tile' + (onClick ? ' is-clickable' : ''));
      t.style.setProperty('--tile-accent', accent);
      t.style.setProperty('--i', String(i++));
      const v = t.createDiv({ cls: 'nd-tile-value' });
      if (typeof value === 'number') this.countTo(v, `pulse:${label}`, value);
      else v.setText(value);
      t.createDiv({ cls: 'nd-tile-label', text: label });
      if (spark) sparkline(t, spark);
      if (onClick) t.addEventListener('click', onClick);
      if (hint) tip(t, hint);
      return v;
    };
    tile(d.md.length, 'notes', 'var(--nd-text)', () => this.plugin.activate(VIEW_CARDS, 'tab'), 'Open the card explorer · line: notes created per day', this.perDay(d.md, (f) => f.stat.ctime));
    this.wordsEl = tile('…', 'words', 'var(--nd-text)');
    tile(d.links, 'links', 'var(--nd-info)', () => this.plugin.openGraph('notes'), 'Open the note graph');
    tile(d.orphans.length, 'orphans', 'var(--nd-accent)', () => new FileListModal(this.plugin, d.orphans, 'Orphan notes — no links in or out').open(), 'Notes with no links in or out');
    tile(d.editedToday.length, 'edited today', 'var(--nd-go)', () => new FileListModal(this.plugin, d.editedToday, 'Edited today').open(), 'Line: notes edited per day', this.perDay(d.md, (f) => f.stat.mtime));
  }
  renderRecent() {
    const b = this.recent.body;
    b.empty();
    this.renderDoneLog(b);
    if (!this.plugin.activity.size) emptyState(b, 'Nothing done yet — completed work appears here');
  }
}

