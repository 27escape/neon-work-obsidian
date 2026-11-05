/* ---- tracker -------------------------------------------------------------- */
class TicketsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.filter = 'active';
    this.query = '';
  }
  getViewType() {
    return VIEW_TICKETS;
  }
  getDisplayText() {
    return 'Tickets';
  }
  getIcon() {
    return 'ticket';
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'tk-tracker', 'tk-host');
    const sc = root.createDiv('tk-scroll');
    // dynamic island: one panel that grows and shrinks with the tickets in it
    this.island = sc.createDiv('tk-island');
    const inner = this.island.createDiv('tk-island-inner');
    const bar = inner.createDiv('tk-bar');
    const head = bar.createDiv('tk-bar-head');
    head.createDiv({ cls: 'tk-k', text: 'Ticket tracker' });
    this.dateEl = head.createDiv({ cls: 'tk-bar-date' });
    this.counterEl = bar.createDiv('tk-counter');
    this.summary = bar.createDiv('tk-summary');
    const tools = bar.createDiv('tk-tools');
    const seg = tools.createDiv('nd-seg');
    this.segBtns = {};
    for (const [k, label] of [['active', 'Active'], ['waiting', 'Waiting'], ['done', 'Done'], ['all', 'All'], ['templates', 'Templates']]) {
      const b = seg.createEl('button', { cls: 'nd-seg-btn', text: label });
      b.addEventListener('click', () => {
        if (this.filter !== k) this.filterChanged = true; // rows rise in again for the new filter
        this.filter = k;
        this.render();
      });
      this.segBtns[k] = b;
    }
    // sort / group (remembered; the dashboard card keeps its own order)
    const sort = tools.createEl('select', { cls: 'dropdown tk-sort', attr: { 'aria-label': 'Sort or group tickets' } });
    for (const [k, label] of TICKET_SORTS) sort.createEl('option', { value: k, text: label });
    sort.value = this.plugin.settings.tabSort;
    sort.addEventListener('change', () => {
      this.plugin.settings.tabSort = sort.value;
      this.plugin.saveSettings();
      this.filterChanged = true; // rows rise in for the new order
      this.render();
    });
    const search = tools.createEl('input', { cls: 'nd-input tk-search', attr: { type: 'search', placeholder: 'Filter tickets…' } });
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    });
    button(tools, { icon: 'plus', text: 'New ticket', cls: 'mod-cta', onClick: () => this.plugin.newTicket() });
    this.listEl = inner.createDiv('tk-list');
    this.fitIsland = () => {
      const h = Math.ceil(inner.offsetHeight);
      if (Math.abs(h - (parseFloat(this.island.style.height) || 0)) < 1) return;
      this.island.style.height = `${h}px`;
      // let the pattern follow the panel while it moves
      const end = performance.now() + 560;
      const step = () => {
        if (this.pattern) this.pattern.kick();
        if (performance.now() < end) window.requestAnimationFrame(step);
      };
      step();
    };
    const iro = new ResizeObserver(() => this.fitIsland());
    iro.observe(inner);
    this.register(() => iro.disconnect());
    // the same live pattern as the dashboard, stats and rows are its windows
    const mount = () => {
      if (this.pattern) this.pattern.destroy();
      const api = deckApi(this.app);
      this.pattern = api && api.mountPattern ? api.mountPattern(root, sc, '.tk-island, .tk-stat, .tk-row') : null;
    };
    mount();
    this.register(() => this.pattern && this.pattern.destroy());
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', mount));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.pattern && (this.pattern.destroy(), (this.pattern = null))));
    const refresh = debounce(() => this.render(), 400, true);
    this.register(this.plugin.onChange(refresh));
    this.registerInterval(window.setInterval(() => this.render(), 10 * 60 * 1000));
    this.render();
  }
  render() {
    if (this.pattern) this.pattern.kick();
    const p = this.plugin;
    const all = p.collectTickets();
    const active = all.filter((t) => t.status !== 'done');
    if (this.island) {
      const n = active.length;
      if (this.lastCount !== undefined && n !== this.lastCount) {
        const cls = n > this.lastCount ? 'is-grow' : 'is-shrink';
        this.island.removeClass('is-grow', 'is-shrink');
        void this.island.offsetWidth;
        this.island.addClass(cls);
      }
      this.lastCount = n;
    }
    const count = (b) => active.filter((t) => t.bucket === b).length;
    this.dateEl.setText(`${moment().format('dddd D MMM YYYY')} · week ${moment().isoWeek()}`);
    // numbers count from what they showed last (0 on first open); tiles rise in on first open only
    if (!this.prevNums) this.prevNums = new Map();
    const countTo = (el, key, n) => {
      const from = this.prevNums.has(key) ? this.prevNums.get(key) : 0;
      this.prevNums.set(key, n);
      countUp(el, from, n, (x) => String(Math.round(x)), from ? 450 : 800);
    };
    p.renderCounter(this.counterEl, all);
    const cn = this.counterEl.querySelector('.tk-counter-n');
    if (cn) countTo(cn, 'counter', Number(cn.textContent) || 0);
    this.summary.empty();
    this.summary.toggleClass('is-intro', !this.rendered);
    let si = 0;
    const stat = (n, label, cls, onClick) => {
      const s = this.summary.createDiv(`tk-stat ${cls}${n ? ' has-value' : ''}`);
      s.style.setProperty('--i', String(si++));
      countTo(s.createDiv({ cls: 'tk-stat-n' }), `stat:${label}`, n);
      s.createDiv({ cls: 'tk-stat-l', text: label });
      if (onClick) s.addEventListener('click', onClick);
    };
    stat(count('followup'), 'follow up', 'is-followup');
    stat(count('overdue'), 'overdue', 'is-overdue');
    stat(count('today'), 'due today', 'is-today');
    stat(count('week'), 'next 7 days', 'is-week');
    stat(active.length, 'active', 'is-active');
    stat(active.filter((t) => t.status === 'waiting').length, 'waiting', 'is-waiting', () => ((this.filter = 'waiting'), this.render()));
    for (const [k, b] of Object.entries(this.segBtns)) b.toggleClass('is-active', k === this.filter);
    if (this.filter === 'templates') {
      this.filterChanged = false;
      this.rendered = true;
      return this.renderTemplates();
    }
    let items = all;
    if (this.filter === 'active') items = active;
    else if (this.filter === 'waiting') items = active.filter((t) => t.status === 'waiting');
    else if (this.filter === 'done') items = all.filter((t) => t.status === 'done');
    if (this.query) items = items.filter((t) => `${t.id} ${t.title} ${t.file.path} ${t.status} ${t.priority} ${t.jira}`.toLowerCase().includes(this.query));
    this.listEl.empty();
    // calm = a refresh: only new or changed rows move. A first open or a new filter animates the list.
    const calm = !!this.rendered && !this.filterChanged;
    this.listEl.toggleClass('is-calm', calm);
    this.listEl.toggleClass('is-refilter', !!this.filterChanged);
    this.filterChanged = false;
    this.rendered = true;
    const before = this.rowState || null;
    this.rowState = new Map();
    this.rowCalm = calm ? before : null;
    if (this.filter === 'done' && items.length) {
      const bar = this.listEl.createDiv('tk-clear-bar');
      bar.createSpan({ cls: 'tk-faint', text: `${items.length} done ticket${items.length === 1 ? '' : 's'}` });
      button(bar, { icon: 'trash-2', text: 'Clear done…', cls: 'tk-clear-btn', onClick: () => new ClearDoneModal(p, all.filter((t) => t.status === 'done')).open() });
    }
    if (!items.length) {
      const e = this.listEl.createDiv('tk-empty');
      e.createDiv({ text: all.length ? 'Nothing matches this filter.' : 'No tickets yet.' });
      if (!all.length) button(e, { icon: 'plus', text: 'Create your first ticket', cls: 'mod-cta', onClick: () => p.newTicket() });
      return;
    }
    let idx = 0;
    for (const [bucket, label, group] of ticketGroups(items, p.settings.tabSort)) {
      if (!group.length) continue;
      const sec = this.listEl.createDiv(`tk-group is-${bucket}`);
      const gh = sec.createDiv('tk-group-head');
      gh.createSpan({ cls: 'tk-group-title', text: label });
      gh.createSpan({ cls: 'tk-group-count', text: String(group.length).padStart(2, '0') });
      for (const t of group) this.renderRow(sec, t, idx++);
    }
  }
  /** Templates tab: the ticket blueprints, kept in Neon Tickets' own data. */
  renderTemplates() {
    const p = this.plugin;
    const el = this.listEl;
    const list = p.settings.templates;
    const q = this.query;
    const shown = q ? list.filter((x) => `${x.name} ${x.steps.join(' ')}`.toLowerCase().includes(q)) : list;
    el.empty();
    el.removeClass('is-calm', 'is-refilter');
    const head = el.createDiv('tk-group-head tk-tpl-head');
    head.createSpan({ cls: 'tk-group-title', text: 'Templates' });
    head.createSpan({ cls: 'tk-group-count', text: String(list.length).padStart(2, '0') });
    button(head, { icon: 'plus', text: 'New template', cls: 'mod-cta tk-tpl-new', onClick: () => new TemplateModal(p).open() });
    if (!shown.length) {
      el.createDiv({ cls: 'tk-empty', text: list.length ? 'No template matches the filter.' : 'No templates yet. A template is a ready-made ticket: pick it in New ticket and its steps (plus an optional description, priority and due date) are filled in.' });
      return;
    }
    shown.forEach((tpl, i) => {
      const r = el.createDiv('tk-row tk-tpl');
      r.style.setProperty('--i', String(Math.min(i, 20)));
      setIcon(r.createDiv('tk-tpl-icon'), 'layout-template');
      const main = r.createDiv('tk-row-main');
      main.createDiv({ cls: 'tk-tpl-name', text: tpl.name });
      const meta = [`${tpl.steps.length} step${tpl.steps.length === 1 ? '' : 's'}`];
      if (tpl.priority && tpl.priority !== 'normal') meta.push(tpl.priority);
      if (tpl.dueDays != null) meta.push(tpl.dueDays === 0 ? 'due today' : `due in ${tpl.dueDays}d`);
      main.createDiv({ cls: 'tk-tpl-meta', text: meta.join(' · ') });
      if (tpl.steps.length) main.createDiv({ cls: 'tk-tpl-steps', text: tpl.steps.slice(0, 4).join(' · ') + (tpl.steps.length > 4 ? ' …' : '') });
      const acts = r.createDiv('tk-tpl-acts');
      const stop = (fn) => (e) => (e.stopPropagation(), fn());
      button(acts, { icon: 'plus', text: 'Use', cls: 'mod-cta', title: 'New ticket from this template', onClick: stop(() => p.newTicket({ template: tpl.id })) });
      button(acts, { icon: 'pencil', cls: 'nd-icon-btn', title: 'Edit template', onClick: stop(() => new TemplateModal(p, tpl).open()) });
      button(acts, { icon: 'copy', cls: 'nd-icon-btn', title: 'Duplicate', onClick: stop(() => p.duplicateTemplate(tpl.id)) });
      button(acts, { icon: 'trash-2', cls: 'nd-icon-btn', title: 'Delete template', onClick: stop(() => new ConfirmModal(this.app, { title: 'Delete template?', text: tpl.name, cta: 'Delete', onConfirm: () => p.deleteTemplate(tpl.id) }).open()) });
      r.addEventListener('click', () => new TemplateModal(p, tpl).open());
    });
  }
  renderRow(parent, t, i) {
    const p = this.plugin;
    const row = parent.createDiv(`tk-row is-${t.bucket} prio-${t.priority} status-${t.status}`);
    row.style.setProperty('--i', String(Math.min(i, 20)));
    // on a refresh: a ticket that wasn't listed slides in, one whose status or due bucket changed flashes
    const state = `${t.status}|${t.bucket}`;
    if (this.rowState) this.rowState.set(t.file.path, state);
    if (this.rowCalm) {
      const was = this.rowCalm.get(t.file.path);
      if (was === undefined) row.addClass('is-new');
      else if (was !== state) row.addClass('is-changed');
    }
    const check = row.createDiv('tk-row-check');
    tip(check, t.status === 'done' ? 'Reopen' : 'Mark done');
    check.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (t.status === 'done') return p.setStatus(t, 'open');
      if (await p.openSteps(t)) {
        check.removeClass('is-shake');
        void check.offsetWidth; // reflow, so a second click shakes again
        check.addClass('is-shake');
        return p.setStatus(t, 'done'); // refuses, with a notice
      }
      row.addClass('is-completing');
      setIcon(check, 'check');
      await new Promise((r) => window.setTimeout(r, 420)); // let the checkmark draw before the list redraws
      p.setStatus(t, 'done');
    });
    const main = row.createDiv('tk-row-main');
    const top = main.createDiv('tk-row-top');
    if (t.id) top.createSpan({ cls: 'tk-id', text: t.id });
    top.createSpan({ cls: 'tk-row-title', text: t.title });
    const meta = main.createDiv('tk-row-meta');
    const st = meta.createSpan({ cls: `tk-st s-${t.status}`, text: TICKET_STATUS_LABEL[t.status] });
    tip(st, 'Click to cycle status');
    st.addEventListener('click', (e) => {
      e.stopPropagation();
      const order = ['open', 'in-progress', 'waiting'];
      p.setStatus(t, t.status === 'done' ? 'open' : order[(order.indexOf(t.status) + 1) % order.length]);
    });
    if (t.priority !== 'normal') meta.createSpan({ cls: `tk-pr p-${t.priority}`, text: t.priority });
    meta.createSpan({ cls: 'tk-age', text: `opened ${t.created.format('D MMM')} · ${t.age}d` });
    if (t.status === 'waiting' && t.waitingOn) meta.createSpan({ cls: 'tk-age', text: `waiting on ${t.waitingOn}` });
    if (t.remind && t.status !== 'done') meta.createSpan({ cls: 'tk-age', text: `🔔 ${t.remind.format('D MMM')}` });
    if (t.due && t.status !== 'done') {
      const prog = main.createDiv('tk-progress');
      prog.createDiv('tk-progress-fill').style.width = `${Math.round(t.progress * 100)}%`;
      tip(prog, `${Math.round(t.progress * 100)}% of the time between created and due has passed`);
    }
    const due = row.createDiv('tk-row-due');
    due.createDiv({ cls: 'tk-row-due-main', text: ticketDueText(t) });
    if (t.due) due.createDiv({ cls: 'tk-row-due-date', text: t.due.format('ddd D MMM') });
    const acts = row.createDiv('tk-row-acts');
    button(acts, {
      icon: 'more-horizontal',
      cls: 'nd-icon-btn',
      title: 'More',
      onClick: (e) => {
        e.stopPropagation();
        const m = new Menu();
        ticketMenu(p, t, m);
        m.showAtMouseEvent(e);
      },
    });
    row.addEventListener('click', (e) => p.showTicket(t.file, e));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const m = new Menu();
      ticketMenu(p, t, m);
      m.showAtMouseEvent(e);
    });
  }
}

