/* ---- Project plans (fork): the Planning view, one project's plan in its own tab -----------------------------------------
 * Opened from the buttons on a project note's header (plan-actions.js). Modes: Gantt (Mermaid, drawn by Obsidian),
 * Board (plan-board.js), Graph (plan-graph.js) and List. Follows changes in the notes; only the board writes. */

const PLAN_MODES = [
  ['gantt', 'Gantt'],
  ['board', 'Board'],
  ['graph', 'Graph'],
  ['list', 'List'],
];
const PLAN_STATE_LABEL = { ready: 'Ready', waiting: 'Waiting', blocked: 'Blocked', doing: 'In progress', done: 'Done' };

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
    this.who = null; // one person's tasks (plan-people.js), or everyone
    this.lanes = 'phase'; // board rows: by phase or by person
    this.ganttPhases = false; // Gantt: one bar per phase (plan-forecast.js)
    this.markFilter = null; // List: only risks, issues or decisions
    this.listOrder = 'plan'; // List: the plan's order, or by priority within each phase
    this.selKey = null; // the selected task (planKey): New task follows it
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
    return Object.assign(super.getState(), this.plan ? { kind: this.plan.kind, path: this.plan.path, mode: this.mode, weeks: this.weeks, graph: this.graph, who: this.who, lanes: this.lanes, ganttPhases: this.ganttPhases, links: this.links } : {});
  }
  async setState(state, result) {
    if (state && state.path) this.plan = { kind: state.kind === 'folder' ? 'folder' : 'note', path: state.path };
    if (state && PLAN_MODES.some(([k]) => k === state.mode)) this.mode = state.mode;
    if (state && typeof state.weeks === 'boolean') this.weeks = state.weeks;
    if (state && typeof state.links === 'boolean') this.links = state.links;
    if (state && state.graph && typeof state.graph === 'object') Object.assign(this.graph, state.graph);
    if (state && 'who' in state) this.who = state.who || null;
    if (state && (state.lanes === 'phase' || state.lanes === 'person')) this.lanes = state.lanes;
    if (state && typeof state.ganttPhases === 'boolean') this.ganttPhases = state.ganttPhases;
    await super.setState(state, result);
    this.build();
    await this.refresh();
  }
  onResize() {
    // the Gantt fits its width: redraw when the tab changes size
    if (this.mode === 'gantt' && this.bodyEl) {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.render(), 200);
    }
  }
  async onOpen() {
    addHelpAction(this, 'planning'); // fork: the ? button in the header (src/shared/help.js)
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
    // the tab and view header already say "Planning: <project>": only the project's name here. Not this.titleEl:
    // that is Obsidian's own view-header title, which then stayed at "Planning"
    this.planTitleEl = head.createDiv({ cls: 'np-title', text: this.plan ? planScopeTitle(this.plan) : '' });
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
    this.newBtn = button(tools, { icon: 'plus', text: 'New task', cls: 'np-new', title: 'Add a task: after the selected task (the last one you opened), depending on it', onClick: () => this.newTask() });
    this.orderEl = pills(tools, [['plan', 'Plan order'], ['priority', 'By priority']], this.listOrder, (v) => ((this.listOrder = v || 'plan'), this.render()));
    tip(this.orderEl.el, 'List: the plan’s order, or highest priority first within each phase');
    this.markEl = pills(tools, PLAN_MARKS.map(([k, sign, label]) => [k, `${sign} ${label}s`]), this.markFilter, (v) => ((this.markFilter = v || null), this.render()), 'can-clear');
    tip(this.markEl.el, 'Only risks, issues or decisions (click again for all)');
    this.clearSelBtn = button(tools, { icon: 'x', cls: 'nd-icon-btn is-hidden', title: 'New tasks at the end of the plan instead (clear the selection)', onClick: () => this.select(null) });
    button(tools, { icon: 'file-text', cls: 'nd-icon-btn', title: 'Open the project note', onClick: (e) => this.openScope(e) });
    this.copyBtn = button(tools, { icon: 'copy', cls: 'nd-icon-btn', title: 'Copy the chart as a Mermaid block', onClick: () => this.src && copyMermaid(this.src) });
    this.buildPeopleTools(tools);
    this.buildForecastTools(tools);
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
  /** The note new tasks go in: the project note, or a project folder's own note. */
  scopeFile() {
    let f = this.app.vault.getAbstractFileByPath(this.plan.path);
    if (f instanceof TFolder) {
      const rep = projectFolderNote(this.app, f);
      f = rep && rep.own ? rep.file : null;
    }
    return f instanceof TFile ? f : null;
  }
  /** A new task: after `after` (or the selected task), depending on it, straight after its line; else at the end. */
  newTask(after = null) {
    const file = this.scopeFile();
    if (!file) return new Notice('This project folder has no project note to add tasks to');
    const sel = after || this.selected();
    const own = this.tasks.filter((t) => !t.external && t.file === file);
    const follow = sel && !sel.external && sel.file === file ? sel : null;
    this.plugin.openTaskEditor({ scope: this.plan, file, after: follow, phase: own.length ? own[own.length - 1].phase || '' : '', view: this });
  }
  /** The selected task (the last one opened or right-clicked): New task follows it. */
  selected() {
    return this.selKey ? this.tasks.find((t) => planKey(t) === this.selKey) || null : null;
  }
  select(t) {
    this.selKey = t ? planKey(t) : null;
    this.syncSelection();
  }
  syncSelection() {
    const sel = this.selected();
    this.newBtn.querySelector('.nd-btn-label').setText(sel ? `New task after ${sel.id || planClip(planText(sel.raw), 20)}` : 'New task');
    this.clearSelBtn.toggleClass('is-hidden', !sel);
    this.bodyEl.querySelectorAll('.is-selected').forEach((x) => x.removeClass('is-selected'));
    if (sel) this.bodyEl.querySelectorAll(`[data-key="${CSS.escape(this.selKey)}"]`).forEach((x) => x.addClass('is-selected'));
  }
  /** After the editor saves: select that task, so the next New task follows it. */
  async selectSaved(id) {
    if (id) this.selKey = id;
    await this.refresh();
  }
  /** Click on a task: the editor; Ctrl/Cmd-click: its line in the note. Outside tasks open their note. */
  openTask(e, t) {
    if (t.external || (e && (e.ctrlKey || e.metaKey))) return openFile(this.app, t.file, e, t.line);
    this.select(t);
    this.plugin.openTaskEditor({ scope: this.plan, file: t.file, line: t.line, view: this });
  }
  /** Replace a template's {{prefix}} throughout the project note with the plan's prefix. */
  async fillPrefix() {
    const file = this.scopeFile();
    if (!file) return;
    const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter || {};
    const prefix = planPrefix(fm, planScopeTitle(this.plan));
    try {
      await writeNote(this.app, file, (text) => planFillPrefix(text, prefix));
      new Notice(`Ids filled in: ${prefix}-1, ${prefix}-2…`);
    } catch (e) {
      if (!(e && e.neonReadOnly)) console.error('Planning: could not fill in the ids', e);
    }
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
    this.due = planDueDate(this.app, this.plan);
    this.planTitleEl.setText(planScopeTitle(this.plan));
    this.leaf.updateHeader && this.leaf.updateHeader();
    this.render();
  }
  render() {
    if (!this.bodyEl) return;
    if (this.dragActive) return void (this.redrawAfterDrag = true); // a card is being dragged: redraw when it lands
    const weeks = this.weeks || !this.base;
    this.today = moment().format('YYYY-MM-DD');
    const g = planGanttText(this.tasks, { base: this.base, weeks, today: this.today, show: (t) => this.shows(t), phases: this.mode === 'gantt' && this.ganttPhases, due: this.due });
    const { text, sched, bars } = g;
    this.dated = this.datedPlan(); // real dates whatever the switch: forecast, baseline, slip
    this.ends = new Map(((this.dated && this.dated.bars) || []).filter((b) => b.task).map((b) => [b.task, b.end]));
    this.src = text;
    this.sched = sched;
    this.kinds = new Map(bars.filter((b) => b.task).map((b) => [b.task, b.kind]));
    const own = this.tasks.filter((t) => !t.external);
    this.sumEl.setText([planSummaryText(planCounts(this.tasks, this.today)), planMarkText(this.tasks), own.length ? this.forecastSummary() || `about ${Math.ceil(sched.length / 5)} weeks of work` : ''].filter(Boolean).join(' · '));
    this.sumEl.toggleClass('is-late', !!(this.dated && this.dated.late));
    this.weeksEl.el.toggleClass('is-hidden', this.mode !== 'gantt' && this.mode !== 'list');
    this.weeksEl.set(weeks ? 'weeks' : 'dates');
    this.weeksEl.btns.get('dates').disabled = !this.base;
    if (!this.base) tip(this.weeksEl.btns.get('dates'), 'Set the project’s started date to see dates');
    for (const b of [this.copyBtn, this.svgBtn]) b.toggleClass('is-hidden', this.mode !== 'gantt' && this.mode !== 'graph');
    for (const p of [this.dirEl, this.phaseEl, this.fitEl]) p.el.toggleClass('is-hidden', this.mode !== 'graph');
    this.syncPeopleTools();
    this.syncForecastTools();
    this.renderIssues(sched);
    this.bodyEl.empty();
    if (!own.length) {
      emptyState(this.bodyEl, 'No tasks in this project yet. A task is a checkbox line with the task tag or a 🆔 id.');
      return;
    }
    this.renderLegend(bars);
    this.markEl.el.toggleClass('is-hidden', this.mode !== 'list' || !this.tasks.some((t) => (t.marks || []).length));
    this.orderEl.el.toggleClass('is-hidden', this.mode !== 'list');
    window.setTimeout(() => this.syncSelection(), 0); // after the chart or list is drawn
    if (this.mode === 'list') return this.renderList(sched, weeks);
    if (this.mode === 'board') return this.renderBoard();
    if (this.mode === 'graph') return this.renderGraph(sched);
    // the plugin draws the Gantt itself (Obsidian's chart engine takes no per-bar colours); Copy as Mermaid gives the text
    const chart = this.bodyEl.createDiv('np-chart np-gantt-wrap');
    const lay = planGanttLayout(g.rows, { today: this.today, relative: g.relative, width: this.bodyEl.clientWidth || 900 });
    if (!lay) return void emptyState(chart, 'Nothing to draw for this filter');
    const tasksDrawn = !this.ganttPhases;
    const svg = planDrawGantt(chart, lay, {
      colours: planColourMap(),
      onBar: (e, b) => !this.justDragged && this.taskMenu(e, b.task), // the click ending a drag isn't a click on the bar
      selKey: this.selKey,
      links: tasksDrawn && this.links !== false,
      onLink: (e, l) => this.linkMenu(e, l),
    });
    if (tasksDrawn) this.attachGanttDrag(svg, lay, g.bars); // drag to change dates and lengths, Alt-drag to link (plan-gantt-drag.js)
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
    for (const [k, sign, label, v, fb] of PLAN_MARKS) {
      if (!bars.some((b) => b.mark === k)) continue;
      const item = el.createSpan({ cls: 'np-key np-key-mark', text: `${sign} ${label}` });
      item.style.borderColor = planCssHex(v, fb);
    }
  }
  renderIssues(sched) {
    const el = this.issuesEl;
    el.empty();
    // each line: its text, and the task to open in its note when clicked (the line to fix)
    const lines = planProblems(this.tasks, sched).map((p) => ({ text: p.text, task: p.task }));
    lines.push(...this.loadLines(sched).map((text) => ({ text })));
    for (const w of planWeekendDates(this.tasks)) lines.push({ text: `${w.task.id || planClip(planText(w.task.raw), 30)}: ${w.sign} ${planShortDate(w.date)} is a ${w.day}`, task: w.task });
    // schedule warnings: a handful here, the rest counted (the List shows them on each task)
    const warn = planWarnings(this.tasks, this.ends, this.today);
    lines.push(...warn.slice(0, 5).map((w) => ({ text: w.text, task: w.task })));
    if (warn.length > 5) lines.push({ text: `${warn.length - 5} more schedule warnings: see the List` });
    this.warnings = new Map();
    for (const w of warn) this.warnings.set(w.task, [...(this.warnings.get(w.task) || []), w.text]);
    for (const l of lines) {
      const d = el.createDiv({ cls: 'np-issue', text: `⚠ ${l.text}` });
      const t = l.task;
      if (!t || !t.file) continue;
      d.addClass('is-link');
      tip(d, `Open ${t.file.basename} at this task`);
      d.addEventListener('click', (e) => openFile(this.app, t.file, e, t.line));
    }
    if (this.tasks.some((t) => !t.external && /\{\{\s*prefix\s*\}\}/.test(t.raw))) {
      // made from the plan template outside New project: its ids still read {{prefix}}-1
      const d = el.createDiv({ cls: 'np-issue', text: '⚠ This plan’s ids still read {{prefix}}: ' });
      button(d, { icon: 'wand', text: 'Fill in ids', cls: 'np-fill', onClick: () => this.fillPrefix() });
    }
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
    const slips = !!this.baseline();
    for (const h of ['', 'Task', 'Owner', 'Priority', 'State', 'Id', 'Depends on', 'Days', 'Start', 'Finish', 'Slack', ...(slips ? ['Slip'] : [])]) hr.createEl('th', { text: h });
    const body = table.createEl('tbody');
    let phase = null;
    // by priority: highest first within each phase (phases keep their order)
    const phaseAt = new Map();
    for (const r of sched.rows) {
      const k = r.task.external ? PLAN_OUTSIDE : r.task.phase || 'Tasks';
      if (!phaseAt.has(k)) phaseAt.set(k, phaseAt.size);
    }
    const ph = (r) => phaseAt.get(r.task.external ? PLAN_OUTSIDE : r.task.phase || 'Tasks');
    const ordered = this.listOrder === 'priority' ? sched.rows.map((r, i) => [r, i]).sort((a, b) => ph(a[0]) - ph(b[0]) || (b[0].task.priority ?? 2) - (a[0].task.priority ?? 2) || a[1] - b[1]).map(([r]) => r) : sched.rows;
    for (const r of ordered) {
      const t = r.task;
      if (!this.shows(t)) continue;
      if (this.markFilter && !(t.marks || []).includes(this.markFilter)) continue;
      const ph = t.external ? PLAN_OUTSIDE : t.phase || 'Tasks';
      if (ph !== phase) {
        phase = ph;
        body.createEl('tr', { cls: 'np-phase' }).createEl('td', { text: ph, attr: { colspan: slips ? '12' : '11' } });
      }
      const st = planState(t, byId, this.today);
      const tr = body.createEl('tr', { cls: `np-row is-${st}${r.crit && st !== 'done' && !t.external ? ' is-crit' : ''}${t.external ? ' is-external' : ''}`, attr: { 'data-key': planKey(t) } });
      tr.addEventListener('contextmenu', (e) => this.taskMenu(e, t));
      tip(tr.createEl('td', { cls: 'np-crit', text: r.crit && st !== 'done' && !t.external ? '●' : '' }), 'On the critical path');
      const name = tr.createEl('td', { cls: 'np-name' });
      const mark = planMark(t);
      if (mark) tip(name.createSpan({ cls: `np-mark-sign is-${mark[0]}`, text: `${mark[1]} ` }), mark[2]);
      const ws = this.warnings && this.warnings.get(t);
      if (ws) tip(name.createSpan({ cls: 'np-warn-sign', text: '⏰ ' }), ws.join('\n'));
      const a = name.createEl('a', { cls: mark && mark[0] !== 'decision' ? 'np-strong' : '', text: (t.external ? '↗ ' : '') + planText(t.raw), href: '#' }); // risks and issues in bold
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.openTask(e, t);
      });
      if (t.external) name.createSpan({ cls: 'np-file', text: ` · ${t.file.basename}` });
      tr.createEl('td', { cls: 'np-owner', text: (t.owners || []).map((o) => o.name).join(', ') });
      const pr = PLAN_PRIORITIES.find((p) => p[0] === (t.priority ?? 2));
      tr.createEl('td', { cls: 'np-owner', text: pr[0] === 2 ? '' : `${pr[1]} ${pr[2]}` });
      const kind = this.kinds.get(t) || st;
      const chip = tr.createEl('td').createSpan({ cls: `np-state is-${st}`, text: PLAN_STATE_LABEL[st] });
      planFill(chip, st === 'blocked' || st === 'waiting' ? st : kind);
      const why = planBlockedText(t, byId, this.today);
      if (why) tip(chip, why);
      if (kind === 'overdue' || kind === 'soon') tip(chip, PLAN_KINDS.find(([k]) => k === kind)[1]);
      tr.createEl('td', { cls: 'np-id', text: t.id || '' });
      tr.createEl('td', { cls: 'np-id', text: t.deps.join(', ') });
      this.daysCell(tr.createEl('td', { cls: 'np-num np-days' }), t);
      tr.createEl('td', { text: planDayLabel(r.es, this.base, weeks) });
      tr.createEl('td', { text: planDayLabel(Math.max(r.es, r.ef - 1), this.base, weeks) });
      tr.createEl('td', { cls: 'np-num', text: r.slack ? `${r.slack}d` : '' });
      if (slips) {
        const d = this.slip(t);
        tr.createEl('td', { cls: `np-num${d > 0 ? ' is-late' : ''}`, text: d == null ? '' : d ? `${d > 0 ? '+' : ''}${d}d` : '0' });
      }
    }
  }
}
