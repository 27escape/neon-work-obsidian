/* ---- Project plans (fork): the printable Report note ------------------------------------------------------------------
 * Report (Planning view) writes a snapshot of the plan into the reports folder (setting; empty: <base folder>/Reports):
 * a note with the summary, forecast, phases, what needs attention, risks / issues / decisions, the critical path,
 * workload and every task, plus the Gantt chart as an SVG file the note embeds, in the plan's colours. Print it with
 * Obsidian's Export to PDF. Written only when you press Report, and refused while read-only is on; a second report on
 * the same day replaces that day's files. planReportText is pure (tested). */

const planCell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * The report's Markdown (pure). r: { title, note (the project note's name), today, summary, forecast, baseline, svg
 * (file name), phases: [{ name, total, done, start, end, state }], attention: [text], marks: [{ sign, label, text, owner,
 * state }], crit: [{ id, text, start, end }], load: [text], tasks: [{ phase, id, text, owner, state, days, start, end, deps }] }
 */
function planReportText(r) {
  const L = [];
  const d = (x) => (x ? planShortDate(x) : '');
  L.push('---', `title: "Plan report: ${r.title.replace(/"/g, "'")}"`, `created: ${r.today}`, 'tags:', '  - plan-report', `project: "[[${r.note}]]"`, '---', '');
  L.push(`# Plan report: ${r.title}`, '');
  L.push(`Made on ${d(r.today)} from [[${r.note}]]. A snapshot: it doesn't change with the plan; make a new report for the latest.`, '');
  L.push('## Summary', '');
  if (r.forecast) L.push(`- **Forecast:** ${r.forecast}${r.baseline ? ` ${r.baseline}` : ''}`);
  if (r.summary) L.push(`- **Tasks:** ${r.summary}`);
  if (r.crit.length) L.push(`- **Critical path:** ${r.crit.length} tasks, ${d(r.crit[0].start)} to ${d(r.crit[r.crit.length - 1].end)}`);
  L.push('');
  if (r.svg) L.push('## Timeline', '', `![[${r.svg}]]`, '', '*Arrows: what waits for what (dashed: starts with / ends with). 2/4: steps done. Outlined bars: the critical path.*', '');
  if (r.phases.length) {
    L.push('## Phases', '', '| Phase | Done | Start | Finish | State |', '|---|---|---|---|---|');
    for (const p of r.phases) L.push(`| ${planCell(p.name)} | ${p.done}/${p.total} | ${d(p.start)} | ${d(p.end)} | ${planCell(p.state)} |`);
    L.push('');
  }
  L.push('## Needs attention', '');
  if (r.attention.length) for (const a of r.attention) L.push(`- ${a}`);
  else L.push('Nothing overdue, blocked or late.');
  L.push('');
  if (r.marks.length) {
    L.push('## Risks, issues and decisions', '');
    for (const m of r.marks) L.push(`- ${m.sign} **${m.label}:** ${m.text}${m.owner ? ` (${m.owner})` : ''} · ${m.state}`);
    L.push('');
  }
  if (r.crit.length) {
    L.push('## Critical path', '', 'The chain of tasks that sets the finish date: a day lost on any of them is a day lost on the project.', '');
    r.crit.forEach((c, i) => L.push(`${i + 1}. ${c.id ? `\`${c.id}\` ` : ''}${c.text} (${d(c.start)} to ${d(c.end)})`));
    L.push('');
  }
  if (r.load.length) {
    L.push('## Workload', '');
    for (const l of r.load) L.push(`- ${l}`);
    L.push('');
  }
  L.push('## All tasks', '', '| Phase | Task | Owner | State | Days | Start | Finish | Waits for |', '|---|---|---|---|---|---|---|---|');
  for (const t of r.tasks) L.push(`| ${planCell(t.phase)} | ${planCell((t.id ? `${t.id} ` : '') + t.text)} | ${planCell(t.owner)} | ${planCell(t.state)} | ${t.days} | ${d(t.start)} | ${d(t.end)} | ${planCell(t.deps)} |`);
  L.push('');
  return L.join('\n');
}

Object.assign(PlanView.prototype, {
  /** The report's contents, from the plan as the view has it (real dates when the project has a started date). */
  reportData(svgName) {
    const today = this.today;
    const plan = this.dated || planGanttText(this.tasks, { weeks: true, today });
    const { byId } = planIndex(this.tasks);
    const bars = new Map(plan.bars.filter((b) => b.task).map((b) => [b.task, b]));
    const own = this.tasks.filter((t) => !t.external);
    const label = (st) => PLAN_STATE_LABEL[st] || st;
    const phases = [];
    for (const t of own) {
      const name = t.phase || 'Tasks';
      let p = phases.find((x) => x.name === name);
      if (!p) phases.push((p = { name, total: 0, done: 0, start: null, end: null, kinds: [] }));
      const b = bars.get(t);
      p.total++;
      if (planClosed(t)) p.done++;
      if (b && (!p.start || b.start < p.start)) p.start = b.start;
      if (b && (!p.end || b.end > p.end)) p.end = b.end;
      if (b) p.kinds.push(b.kind);
    }
    const worst = (kinds) => PLAN_KINDS.find(([k]) => k === (PLAN_WORST.find((w) => kinds.includes(w)) || 'ready'))[1];
    const attention = [];
    for (const t of own) {
      const st = planState(t, byId, today);
      const name = `${t.id ? `\`${t.id}\` ` : ''}${planText(t.raw)}`;
      if (planOverdue(t, today)) attention.push(`**Overdue:** ${name} (📅 ${planShortDate(t.due)})`);
      else if (st === 'blocked') attention.push(`**Blocked:** ${name}, ${planBlockedText(t, byId, today)}`);
    }
    for (const w of planWarnings(this.tasks, this.ends, today)) attention.push(`**Schedule:** ${w.text}`);
    for (const t of own.filter(planStepsDone)) attention.push(`**Steps done:** ${t.id ? `\`${t.id}\` ` : ''}${planText(t.raw)}: all ${t.steps.total} steps are ticked, the task isn't`);
    for (const p of planProblems(this.tasks, plan.sched)) attention.unshift(`**Plan:** ${p.text}`); // broken links first: they make the dates unreliable
    if (this.dated && this.dated.late) attention.unshift(`**Late:** ${planForecastText(this.dated.end, this.due, this.dated.late)}`);
    const marks = [];
    for (const t of own)
      for (const [k, sign, lab] of PLAN_MARKS) if ((t.marks || []).includes(k)) marks.push({ sign, label: lab, text: planText(t.raw), owner: (t.owners || []).map((o) => o.name).join(', '), state: label(planState(t, byId, today)) });
    const crit = plan.sched.rows.filter((r) => r.crit && !r.task.external && !planClosed(r.task)).map((r) => ({ id: r.task.id, text: planText(r.task.raw), start: (bars.get(r.task) || {}).start, end: (bars.get(r.task) || {}).end }));
    return {
      title: planScopeTitle(this.plan),
      note: (this.scopeFile() || { basename: planScopeTitle(this.plan) }).basename,
      today,
      summary: planSummaryText(planCounts(this.tasks, today)) + (planMarkText(this.tasks) ? ` · ${planMarkText(this.tasks)}` : ''),
      forecast: this.dated ? planForecastText(this.dated.end, this.due, this.dated.late) : `about ${Math.ceil(plan.sched.length / 5)} weeks of work (no started date, so no dates)`,
      baseline: (this.forecastSummary().match(/\((?:[+-]?\d+ since|as) the baseline[^)]*\)/) || [''])[0],
      svg: svgName,
      phases: phases.map((p) => ({ name: p.name, total: p.total, done: p.done, start: p.start, end: p.end, state: p.done === p.total ? 'Done' : worst(p.kinds) })),
      attention,
      marks,
      crit,
      load: this.loadLines(plan.sched),
      tasks: own.map((t) => {
        const b = bars.get(t) || {};
        return { phase: t.phase || 'Tasks', id: t.id, text: planText(t.raw), owner: (t.owners || []).map((o) => o.name).join(', '), state: label(planState(t, byId, today)), days: t.milestone ? 'milestone' : planDays(t), start: b.start, end: b.end, deps: t.deps.join(', ') };
      }),
    };
  },
  /** The Gantt for the report: every task (no filter), drawn off screen, as SVG text with the colours written in. */
  reportSvg() {
    const g = this.dated ? planGanttText(this.tasks, { base: this.base, today: this.today, due: this.due }) : planGanttText(this.tasks, { weeks: true, today: this.today });
    const lay = planGanttLayout(g.rows, { today: this.today, relative: g.relative, width: 1100, labelW: 340, minDay: 2 });
    if (!lay) return '';
    const host = document.body.createDiv({ attr: { style: 'position:absolute;left:-20000px;top:0;' } });
    try {
      // as on screen: the dependency arrows, and each task's steps (2/4, with the progress line in its bar)
      const svg = planDrawGantt(host, lay, { colours: planColourMap(), links: true });
      return planSvgText(svg);
    } finally {
      host.remove();
    }
  },
  /** Write the report note and its chart into the reports folder, then open it. */
  async writeReport() {
    const folder = locPath(this.plugin.settings.planReportsFolder, 'Reports');
    const base = `${safeName(planScopeTitle(this.plan))} – plan ${this.today}`;
    const svgName = `${base}.svg`;
    const svgText = this.reportSvg();
    const md = planReportText(this.reportData(svgText ? svgName : ''));
    try {
      await ensureFolder(this.app, folder);
      const put = async (name, text) => {
        const path = normalizePath(`${folder}/${name}`);
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f instanceof TFile) await this.app.vault.process(f, () => text); // today's report again: replaced
        else await this.app.vault.create(path, text);
        return this.app.vault.getAbstractFileByPath(path);
      };
      if (svgText) await put(svgName, svgText);
      const note = await put(`${base}.md`, md);
      if (note instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(note);
      new Notice('Report saved. To print it: ⋯ menu (or the command palette) → Export to PDF.', 6000);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not write the report', e);
        new Notice('Could not write the report. Details in the console.');
      }
    }
  },
});
