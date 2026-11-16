/* ---- Project plans (fork): the Planning view, one project's plan in its own tab -----------------------------------------
 * Opened from the buttons on a project note's header (plan-actions.js). Modes: Gantt (Mermaid, drawn by Obsidian),
 * Board (plan-board.js), Graph (plan-graph.js) and List. Follows changes in the notes; only the board writes. */

const PLAN_MODES = [
  ['gantt', 'Gantt'],
  ['board', 'Board'],
  ['graph', 'Graph'],
  ['list', 'List'],
];
const PLAN_STATE_LABEL = { ready: 'Ready', blocked: 'Blocked', doing: 'In progress', done: 'Done' };

/** The plan's title: the project note's name, or the project folder's. */
function planScopeTitle(scope) {
  const last = scope.path.split('/').pop();
  return scope.kind === 'note' ? projectTitle(last.replace(/\.md$/i, '')) : last;
}
/** The project's start date (its `started` property) as YYYY-MM-DD, or null. */
function planBaseDate(app, scope) {
  let f = app.vault.getAbstractFileByPath(scope.path);
  if (scope.kind === 'folder') {
    const rep = f instanceof TFolder ? projectFolderNote(app, f) : null;
    f = rep ? rep.file : null;
  }
  const fm = f instanceof TFile ? (app.metadataCache.getFileCache(f) || {}).frontmatter || {} : {};
  const m = String(fm.started || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

class PlanView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.plan = null;
    this.mode = 'gantt';
    this.weeks = false;
    this.graph = { dir: 'TB', phases: false, fit: false }; // graph layout: Down / Across, phase groups, fit or full size
    this.tasks = [];
    this.paths = new Set();
    this.src = '';
  }
  getViewType() {
    return VIEW_PLAN;
  }
  getDisplayText() {
    return this.plan ? `Planning: ${planScopeTitle(this.plan)}` : 'Planning';
  }
  getIcon() {
    return 'calendar-range';
  }
  getState() {
    return Object.assign(super.getState(), this.plan ? { kind: this.plan.kind, path: this.plan.path, mode: this.mode, weeks: this.weeks, graph: this.graph } : {});
  }
  async setState(state, result) {
    if (state && state.path) this.plan = { kind: state.kind === 'folder' ? 'folder' : 'note', path: state.path };
    if (state && PLAN_MODES.some(([k]) => k === state.mode)) this.mode = state.mode;
    if (state && typeof state.weeks === 'boolean') this.weeks = state.weeks;
    if (state && state.graph && typeof state.graph === 'object') Object.assign(this.graph, state.graph);
    await super.setState(state, result);
    this.build();
    await this.refresh();
  }
  async onOpen() {
    this.contentEl.addClass('nd-root', 'np-plan');
    const soon = debounce(() => this.refresh(), 600, true);
    this.registerEvent(this.app.metadataCache.on('changed', (f) => this.touches(f.path) && soon()));
    this.registerEvent(this.app.vault.on('rename', () => soon()));
    this.build();
    await this.refresh();
  }
  /** Is this note part of the plan (or one of its outside neighbours)? */
  touches(path) {
    if (!this.plan) return false;
    if (this.paths.has(path)) return true;
    return this.plan.kind === 'note' ? path === this.plan.path : path.startsWith(this.plan.path + '/');
  }
  build() {
    const root = this.contentEl;
    root.empty();
    const bar = root.createDiv('np-bar');
    const head = bar.createDiv('np-head');
    head.createDiv({ cls: 'tk-k', text: 'Planning' });
    this.titleEl = head.createDiv({ cls: 'np-title', text: this.plan ? planScopeTitle(this.plan) : '' });
    this.sumEl = head.createDiv('np-sum');
    const tools = bar.createDiv('np-tools');
    pills(tools, PLAN_MODES, this.mode, (v) => {
      this.mode = v || 'gantt';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    this.weeksEl = pills(tools, [['dates', 'Dates'], ['weeks', 'Weeks']], this.weeks ? 'weeks' : 'dates', (v) => {
      this.weeks = v === 'weeks';
      this.app.workspace.requestSaveLayout();
      this.render();
    });
    button(tools, { icon: 'file-text', cls: 'nd-icon-btn', title: 'Open the project note', onClick: (e) => this.openScope(e) });
    this.copyBtn = button(tools, { icon: 'copy', cls: 'nd-icon-btn', title: 'Copy the chart as a Mermaid block', onClick: () => this.src && copyMermaid(this.src) });
    const g = this.graph;
    const saveGraph = () => (this.app.workspace.requestSaveLayout(), this.render());
    this.dirEl = pills(tools, [['TB', 'Down'], ['LR', 'Across']], g.dir, (v) => ((g.dir = v || 'TB'), saveGraph()));
    this.phaseEl = pills(tools, [['on', 'Phases']], g.phases ? 'on' : null, (v) => ((g.phases = v === 'on'), saveGraph()), 'can-clear');
    tip(this.phaseEl.el, 'Group the boxes by phase (wider)');
    this.fitEl = pills(tools, [['fit', 'Fit'], ['full', 'Full size']], g.fit ? 'fit' : 'full', (v) => ((g.fit = v === 'fit'), saveGraph()));
    this.svgBtn = button(tools, { icon: 'image-down', text: 'SVG', cls: 'np-save', title: 'Save the chart as an SVG file', onClick: () => planExport(this.bodyEl, this.getDisplayText()) });
    this.issuesEl = root.createDiv('np-issues');
    this.bodyEl = root.createDiv('np-body');
  }
  openScope(e) {
    if (!this.plan) return;
    let f = this.app.vault.getAbstractFileByPath(this.plan.path);
    if (f instanceof TFolder) f = (projectFolderNote(this.app, f) || {}).file;
    if (f instanceof TFile) openFile(this.app, f, e);
  }
  async refresh() {
    if (!this.plan || !this.bodyEl) return;
    try {
      this.tasks = await planCollect(this.app, this.plan);
    } catch (e) {
      console.error('Plan: could not read the project', e);
      this.tasks = [];
    }
    this.paths = new Set(this.tasks.map((t) => t.file.path));
    this.base = planBaseDate(this.app, this.plan);
    this.titleEl.setText(planScopeTitle(this.plan));
    this.leaf.updateHeader && this.leaf.updateHeader();
    this.render();
  }
  render() {
    if (!this.bodyEl) return;
    if (this.dragActive) return void (this.redrawAfterDrag = true); // a card is being dragged: redraw when it lands
    const weeks = this.weeks || !this.base;
    const { text, sched, bars } = planGanttText(this.tasks, { base: this.base, weeks, today: moment().format('YYYY-MM-DD') });
    this.src = text;
    this.sched = sched;
    this.kinds = new Map(bars.map((b) => [b.task, b.kind]));
    const own = this.tasks.filter((t) => !t.external);
    this.sumEl.setText(planSummaryText(planCounts(this.tasks, moment().format('YYYY-MM-DD'))) + (own.length ? ` · about ${Math.ceil(sched.length / 5)} weeks of work` : ''));
    this.weeksEl.el.toggleClass('is-hidden', this.mode !== 'gantt' && this.mode !== 'list');
    this.weeksEl.set(weeks ? 'weeks' : 'dates');
    this.weeksEl.btns.get('dates').disabled = !this.base;
    if (!this.base) tip(this.weeksEl.btns.get('dates'), 'Set the project’s started date to see dates');
    for (const b of [this.copyBtn, this.svgBtn]) b.toggleClass('is-hidden', this.mode !== 'gantt' && this.mode !== 'graph');
    for (const p of [this.dirEl, this.phaseEl, this.fitEl]) p.el.toggleClass('is-hidden', this.mode !== 'graph');
    this.renderIssues(sched);
    this.bodyEl.empty();
    if (!own.length) {
      emptyState(this.bodyEl, 'No tasks in this project yet. A task is a checkbox line with the task tag or a 🆔 id.');
      return;
    }
    this.renderLegend(bars);
    if (this.mode === 'list') return this.renderList(sched, weeks);
    if (this.mode === 'board') return this.renderBoard();
    if (this.mode === 'graph') return this.renderGraph(sched);
    const chart = this.bodyEl.createDiv('np-chart');
    tip(chart, 'Click a bar for its menu: open, move, duration, milestone');
    renderMermaid(this.app, chart, text, this).then(() => planPaint(chart, bars, (e, b) => this.taskMenu(e, b.task)));
  }
  /** Colour key for the kinds in this plan; outlined bars are on the critical path. */
  renderLegend(bars) {
    const used = new Set(bars.map((b) => b.kind));
    const el = this.bodyEl.createDiv('np-legend');
    for (const [kind, label] of PLAN_KINDS) {
      if (!used.has(kind)) continue;
      const item = el.createSpan('np-key');
      item.createSpan({ cls: 'np-swatch' }).style.backgroundColor = planColour(kind);
      item.createSpan({ text: label });
    }
    if (this.mode === 'gantt' && bars.some((b) => b.crit)) el.createSpan({ cls: 'np-key np-key-crit', text: 'Outlined: critical path' });
    if (this.mode === 'graph' && bars.some((b) => b.crit)) el.createSpan({ cls: 'np-key np-key-crit', text: 'Outlined, thick arrows: critical path' });
  }
  renderIssues(sched) {
    const el = this.issuesEl;
    el.empty();
    const lines = [];
    if (sched.cycles.length) lines.push(`Dependency loop around: ${sched.cycles.map((t) => t.id || planText(t.raw)).join(', ')}`);
    if (sched.missing.length) lines.push(`Unknown ids: ${[...new Set(sched.missing.map((m) => m.id))].join(', ')}`);
    if (sched.dups.length) lines.push(`Ids used more than once: ${sched.dups.join(', ')}`);
    for (const l of lines) el.createDiv({ cls: 'np-issue', text: `⚠ ${l}` });
  }
  /** The list's Days cell: − days + (click the number to type one); a milestone shows ◆. */
  daysCell(td, t) {
    if (t.milestone) return void tip(td.createSpan({ cls: 'np-ms', text: '◆' }), 'Milestone (#milestone)');
    if (t.external) return void td.setText(String(planDays(t)));
    const step = (d, label, title) => {
      const b = td.createEl('button', { cls: 'np-step', text: label, attr: { type: 'button', 'aria-label': title } });
      b.addEventListener('click', () => this.setDuration(t, Math.max(0, planDays(t) + d)));
    };
    step(-1, '−', 'One day less');
    const n = td.createSpan({ cls: `np-days-n${t.days == null ? ' is-unset' : ''}`, text: String(planDays(t)) });
    tip(n, t.days == null ? 'No estimate yet (counts as 1 day): click to set' : 'Click to type a duration');
    n.addEventListener('click', () => this.askDuration(t));
    step(1, '+', 'One day more');
  }
  renderList(sched, weeks) {
    const { byId } = planIndex(this.tasks);
    const table = this.bodyEl.createEl('table', { cls: 'np-table' });
    const hr = table.createEl('thead').createEl('tr');
    for (const h of ['', 'Task', 'State', 'Id', 'Depends on', 'Days', 'Start', 'Finish', 'Slack']) hr.createEl('th', { text: h });
    const body = table.createEl('tbody');
    let phase = null;
    for (const r of sched.rows) {
      const t = r.task;
      const ph = t.external ? PLAN_OUTSIDE : t.phase || 'Tasks';
      if (ph !== phase) {
        phase = ph;
        body.createEl('tr', { cls: 'np-phase' }).createEl('td', { text: ph, attr: { colspan: '9' } });
      }
      const st = planState(t, byId);
      const tr = body.createEl('tr', { cls: `np-row is-${st}${r.crit && st !== 'done' && !t.external ? ' is-crit' : ''}${t.external ? ' is-external' : ''}` });
      tr.addEventListener('contextmenu', (e) => this.taskMenu(e, t));
      tip(tr.createEl('td', { cls: 'np-crit', text: r.crit && st !== 'done' && !t.external ? '●' : '' }), 'On the critical path');
      const name = tr.createEl('td', { cls: 'np-name' });
      const a = name.createEl('a', { text: (t.external ? '↗ ' : '') + planText(t.raw), href: '#' });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openFile(this.app, t.file, e, t.line);
      });
      if (t.external) name.createSpan({ cls: 'np-file', text: ` · ${t.file.basename}` });
      const kind = this.kinds.get(t) || st;
      const chip = tr.createEl('td').createSpan({ cls: `np-state is-${st}`, text: PLAN_STATE_LABEL[st] });
      planFill(chip, kind);
      if (kind === 'overdue' || kind === 'soon') tip(chip, PLAN_KINDS.find(([k]) => k === kind)[1]);
      tr.createEl('td', { cls: 'np-id', text: t.id || '' });
      tr.createEl('td', { cls: 'np-id', text: t.deps.join(', ') });
      this.daysCell(tr.createEl('td', { cls: 'np-num np-days' }), t);
      tr.createEl('td', { text: planDayLabel(r.es, this.base, weeks) });
      tr.createEl('td', { text: planDayLabel(Math.max(r.es, r.ef - 1), this.base, weeks) });
      tr.createEl('td', { cls: 'np-num', text: r.slack ? `${r.slack}d` : '' });
    }
  }
}
