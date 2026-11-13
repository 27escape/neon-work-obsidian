/* ---- the Projects tab ---------------------------------------------------------- */
class ProjectsView extends ItemView {
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
    return 'Projects';
  }
  getIcon() {
    return 'briefcase';
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'tk-tracker', 'tk-host');
    const sc = root.createDiv('tk-scroll');
    // one panel that grows and shrinks with the projects in it
    this.island = sc.createDiv('tk-island');
    const inner = this.island.createDiv('tk-island-inner');
    const bar = inner.createDiv('tk-bar');
    const head = bar.createDiv('tk-bar-head');
    head.createDiv({ cls: 'tk-k', text: 'Projects' });
    this.dateEl = head.createDiv({ cls: 'tk-bar-date' });
    this.counterEl = bar.createDiv('tk-counter');
    this.summary = bar.createDiv('tk-summary');
    const tools = bar.createDiv('tk-tools');
    const seg = tools.createDiv('nd-seg');
    this.segBtns = {};
    for (const [k, label] of [['active', 'Active'], ['waiting', 'On hold'], ['done', 'Closed'], ['all', 'All']]) {
      const b = seg.createEl('button', { cls: 'nd-seg-btn', text: label });
      b.addEventListener('click', () => {
        if (this.filter !== k) this.filterChanged = true;
        this.filter = k;
        this.render();
      });
      this.segBtns[k] = b;
    }
    // fork: the timeline (a Mermaid Gantt chart above the list), on unless switched off here or in settings
    this.timelineBtn = button(tools, {
      icon: 'calendar-range',
      text: 'Timeline',
      cls: 'tk-mode',
      title: 'Show or hide the timeline',
      onClick: () => {
        this.plugin.settings.showTimeline = this.plugin.settings.showTimeline === false;
        this.plugin.saveSettings();
        this.render();
      },
    });
    const sort = tools.createEl('select', { cls: 'dropdown tk-sort', attr: { 'aria-label': 'Sort or group projects' } });
    for (const [k, label] of PROJECT_SORTS) sort.createEl('option', { value: k, text: label });
    sort.value = this.plugin.settings.tabSort;
    sort.addEventListener('change', () => {
      this.plugin.settings.tabSort = sort.value;
      this.plugin.saveSettings();
      this.filterChanged = true;
      this.render();
    });
    const search = tools.createEl('input', { cls: 'nd-input tk-search', attr: { type: 'search', placeholder: 'Filter projects…' } });
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.render();
    });
    button(tools, { icon: 'plus', text: 'New project', cls: 'mod-cta', onClick: () => this.plugin.newProject() });
    this.timelineEl = inner.createDiv('tk-timeline');
    this.listEl = inner.createDiv('tk-list');
    this.fitIsland = () => {
      const h = Math.ceil(inner.offsetHeight);
      if (Math.abs(h - (parseFloat(this.island.style.height) || 0)) < 1) return;
      this.island.style.height = `${h}px`;
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
    const all = p.collectProjects();
    const active = all.filter((t) => t.status !== 'done');
    const count = (b) => active.filter((t) => t.bucket === b).length;
    this.dateEl.setText(`${moment().format('dddd D MMM YYYY')} · week ${moment().isoWeek()}`);
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
    stat(count('overdue'), 'overdue', 'is-overdue');
    stat(count('today'), 'due today', 'is-today');
    stat(count('week'), 'next 7 days', 'is-week');
    stat(active.filter((t) => t.status === 'in-progress').length, 'active', 'is-active');
    stat(active.filter((t) => t.status === 'waiting').length, 'on hold', 'is-waiting', () => ((this.filter = 'waiting'), this.render()));
    for (const [k, b] of Object.entries(this.segBtns)) b.toggleClass('is-active', k === this.filter);
    let items = all;
    if (this.filter === 'active') items = active;
    else if (this.filter === 'waiting') items = active.filter((t) => t.status === 'waiting');
    else if (this.filter === 'done') items = all.filter((t) => t.status === 'done');
    if (this.query) items = items.filter((t) => `${t.title} ${t.file.path} ${t.statusRaw} ${t.customer} ${t.stage} ${t.note}`.toLowerCase().includes(this.query));
    // fork: the timeline shows the same projects as the list below it
    const timeline = p.settings.showTimeline !== false;
    this.timelineBtn.toggleClass('is-active', timeline);
    this.timelineEl.toggle(timeline);
    if (timeline) this.showTimeline(items);
    this.listEl.empty();
    const calm = !!this.rendered && !this.filterChanged;
    this.listEl.toggleClass('is-calm', calm);
    this.listEl.toggleClass('is-refilter', !!this.filterChanged);
    this.filterChanged = false;
    this.rendered = true;
    const before = this.rowState || null;
    this.rowState = new Map();
    this.rowCalm = calm ? before : null;
    if (!items.length) {
      const e = this.listEl.createDiv('tk-empty');
      e.createDiv({ text: all.length ? 'Nothing matches this filter.' : `No projects yet. A project is a note with “${NEON_PROJECTS.tag}” in its tags.` });
      if (!all.length) button(e, { icon: 'plus', text: 'Create your first project', cls: 'mod-cta', onClick: () => p.newProject() });
      return;
    }
    let idx = 0;
    for (const [key, label, group] of projectGroups(items, p.settings.tabSort)) {
      if (!group.length) continue;
      const sec = this.listEl.createDiv(`tk-group is-${key}`);
      const gh = sec.createDiv('tk-group-head');
      gh.createSpan({ cls: 'tk-group-title', text: label });
      gh.createSpan({ cls: 'tk-group-count', text: String(group.length).padStart(2, '0') });
      for (const t of group) this.renderRow(sec, t, idx++);
    }
  }
  renderRow(parent, t, i) {
    const p = this.plugin;
    const row = parent.createDiv(`tk-row is-${t.bucket} status-${t.status}`);
    row.style.setProperty('--i', String(Math.min(i, 20)));
    const state = `${t.statusRaw}|${t.bucket}`;
    if (this.rowState) this.rowState.set(t.file.path, state);
    if (this.rowCalm) {
      const was = this.rowCalm.get(t.file.path);
      if (was === undefined) row.addClass('is-new');
      else if (was !== state) row.addClass('is-changed');
    }
    const main = row.createDiv('tk-row-main');
    const top = main.createDiv('tk-row-top');
    top.createSpan({ cls: 'tk-row-title', text: t.title });
    const meta = main.createDiv('tk-row-meta');
    const st = meta.createSpan({ cls: `tk-st s-${t.status}`, text: t.statusRaw || PROJECT_KIND_LABEL[t.status] });
    tip(st, 'Click to choose a status');
    st.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = new Menu();
      for (const v of p.statusChoices()) m.addItem((it) => it.setTitle(v).setChecked((t.statusRaw || '').toLowerCase() === v.toLowerCase()).onClick(() => p.setStatus(t, v)));
      m.showAtMouseEvent(e);
    });
    if (t.customer && p.settings.tabSort !== 'customer') meta.createSpan({ cls: 'tk-age tk-customer', text: t.customer });
    if (t.stage) meta.createSpan({ cls: 'tk-age', text: `stage: ${t.stage}` });
    meta.createSpan({ cls: 'tk-age', text: `${t.startedOn ? 'started' : 'created'} ${(t.startedOn || t.created).format('D MMM')} · ${t.age}d` });
    if (t.remind && t.status !== 'done') meta.createSpan({ cls: 'tk-age', text: `🔔 ${t.remind.format('D MMM')}` });
    if (t.note) tip(main.createDiv({ cls: 'tk-row-note', text: t.note }), 'The project’s note property');
    if (t.due && t.status !== 'done') {
      const prog = main.createDiv('tk-progress');
      prog.createDiv('tk-progress-fill').style.width = `${Math.round(t.progress * 100)}%`;
      tip(prog, `${Math.round(t.progress * 100)}% of the time from start to due has passed`);
    }
    const due = row.createDiv('tk-row-due');
    due.createDiv({ cls: 'tk-row-due-main', text: projectDueText(t) });
    if (t.due) due.createDiv({ cls: 'tk-row-due-date', text: t.due.format('ddd D MMM') });
    const acts = row.createDiv('tk-row-acts');
    const menu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = new Menu();
      projectMenu(p, t, m);
      m.showAtMouseEvent(e);
    };
    button(acts, { icon: 'more-horizontal', cls: 'nd-icon-btn', title: 'More', onClick: menu });
    row.addEventListener('click', (e) => p.openProject(t.file, e));
    row.addEventListener('contextmenu', menu);
  }
}
