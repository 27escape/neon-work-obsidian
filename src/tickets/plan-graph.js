/* ---- Project plans (fork): the dependency graph (Mermaid flowchart) -----------------------------------------------
 * One box per task, an arrow from each task to the tasks that depend on it, one group per phase, outside tasks in
 * their own group. Boxes take the bar colours (planBarKind); thick arrows join the critical path. Clicking a box
 * opens the task's line. Colours are written into the text, so a copied or saved graph keeps them. */

/** Text for a box: quotes and brackets Mermaid would read as syntax swapped out, clipped. */
const planNodeLabel = (t, max = 40) => planClip(((t.external ? '↗ ' : '') + planText(t.raw)).replace(/"/g, "'").replace(/[[\]{}<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled', max);

/**
 * { text, nodes: [{ id, task }] }. kinds: Map task → bar kind; colours: { kind: '#hex' }; edge: colour of the
 * critical path's outline. sched: planSchedule(tasks) (its rows give the critical path).
 */
function planGraphText(tasks, sched, { kinds = new Map(), colours = {}, edge = '#222222', dir = 'LR' } = {}) {
  const { byId } = planIndex(tasks);
  const crit = new Map(sched.rows.map((r) => [r.task, r]));
  const ids = new Map(tasks.map((t, i) => [t, `n${i + 1}`]));
  const lines = [`flowchart ${dir}`];
  const groups = new Map();
  for (const t of tasks) {
    const k = t.external ? PLAN_OUTSIDE : t.phase || 'Tasks';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  if (groups.has(PLAN_OUTSIDE)) {
    const out = groups.get(PLAN_OUTSIDE);
    groups.delete(PLAN_OUTSIDE);
    groups.set(PLAN_OUTSIDE, out);
  }
  let g = 0;
  for (const [name, list] of groups) {
    lines.push(`  subgraph s${++g}["${planNodeLabel({ raw: name }, 60)}"]`);
    for (const t of list) lines.push(`    ${ids.get(t)}["${planNodeLabel(t)}"]`);
    lines.push('  end');
  }
  const onPath = (a, b) => {
    const ra = crit.get(a);
    const rb = crit.get(b);
    return ra && rb && ra.crit && rb.crit && !planClosed(b) && !a.external && !b.external && ra.ef === rb.es;
  };
  for (const t of tasks)
    for (const d of t.deps) {
      const from = byId.get(d);
      if (from) lines.push(`  ${ids.get(from)} ${onPath(from, t) ? '==>' : '-->'} ${ids.get(t)}`);
    }
  const byKind = new Map();
  for (const t of tasks) {
    const k = kinds.get(t) || 'ready';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(ids.get(t));
  }
  for (const [k, list] of byKind) {
    const fill = colours[k] || '#888888';
    const ink = k === 'soon' || k === 'outside' ? '#000000' : '#ffffff';
    lines.push(`  classDef ${k} fill:${fill},stroke:${fill},color:${ink}`, `  class ${list.join(',')} ${k}`);
  }
  const critIds = sched.rows.filter((r) => r.crit && !r.task.external && !planClosed(r.task)).map((r) => ids.get(r.task));
  if (critIds.length) lines.push(`  classDef crit stroke:${edge},stroke-width:3px`, `  class ${critIds.join(',')} crit`);
  return { text: tasks.length ? lines.join('\n') : '', nodes: tasks.map((t) => ({ id: ids.get(t), task: t })) };
}

Object.assign(PlanView.prototype, {
  /** Draw the graph and make each box open its task. */
  renderGraph(sched) {
    const colours = Object.fromEntries(PLAN_KINDS.map(([k]) => [k, planColour(k)]));
    const edge = planCssHex('--text-normal', '#222222');
    const { text, nodes } = planGraphText(this.tasks, sched, { kinds: this.kinds, colours, edge });
    this.src = text;
    const chart = this.bodyEl.createDiv('np-chart np-graph');
    renderMermaid(this.app, chart, text, this).then(() => this.linkNodes(chart, nodes));
  },
  async linkNodes(chart, nodes) {
    let svg = chart.querySelector('svg');
    for (let i = 0; !svg && i < 30 && chart.isConnected; i++) {
      await new Promise((r) => window.setTimeout(r, 100));
      svg = chart.querySelector('svg');
    }
    if (!svg) return;
    for (const { id, task } of nodes) {
      const g = svg.querySelector(`g.node[id*="-flowchart-${id}-"], g.node[id^="flowchart-${id}-"]`);
      if (!g) continue;
      g.addClass('np-node');
      g.addEventListener('click', (e) => openFile(this.app, task.file, e, task.line));
    }
  },
});
