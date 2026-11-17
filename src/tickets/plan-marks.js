/* ---- Project plans (fork): plan problems underlined in the note while you edit it -----------------------------
 * In a project note, a ⛔ id no task has, a 🆔 used by two tasks and the links of a dependency loop get a wavy
 * underline, with the reason on hover (planProblems, the same check as the Planning view). The note's own tasks
 * are read live from the editor as you type; the rest of the plan (the project folder's other notes, and other
 * projects' tasks linked to it) from the saved notes, refreshed when they change. Only the display changes:
 * nothing is written, so it works with read-only on. Setting: "Underline plan problems in project notes". */
let planCmView = null;
try {
  planCmView = require('@codemirror/view'); // provided by Obsidian at runtime
} catch (e) {
  planCmView = null; // no editor marks; the Planning view still lists the problems
}
const PLAN_DEP_RE = /⛔️?\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u;
const PLAN_ID_RE = /🆔\s*([\w-]+)/u;

/**
 * Where to underline in one line: [{ from, to, text }] (offsets in the line). problems: planProblems for this task.
 * A missing id is underlined in the ⛔ list; an id used twice at its 🆔; a loop's ⛔ list as a whole.
 */
function planLineMarks(line, problems) {
  const out = [];
  const dep = line.match(PLAN_DEP_RE);
  const depAt = dep ? dep.index + dep[0].length - dep[1].length : -1;
  for (const p of problems) {
    if (p.kind === 'missing') {
      // in the ⛔ list, and in the [starts-with:: ] / [ends-with:: ] fields
      const spans = [];
      if (dep) spans.push([depAt, dep[1]]);
      for (const f of line.matchAll(/\[(?:starts-with|ends-with)::([^\]]*)\]/giu)) spans.push([f.index + f[0].indexOf('::') + 2, f[1]]);
      for (const [at, text] of spans) {
        const re = /[\w-]+/g;
        let m;
        while ((m = re.exec(text))) if (p.ids.includes(m[0])) out.push({ from: at + m.index, to: at + m.index + m[0].length, text: p.text });
      }
    } else if (p.kind === 'dup') {
      const id = line.match(PLAN_ID_RE);
      if (id) out.push({ from: id.index + id[0].length - id[1].length, to: id.index + id[0].length, text: p.text });
    } else if (p.kind === 'loop' && dep) out.push({ from: depAt, to: depAt + dep[1].length, text: p.text });
    else if (p.kind === 'nested') {
      // what makes the line a task: its task tag, else its id
      const tags = String(NEON_PLAN.taskTag || '#task').split(/[,\s]+/).filter(Boolean).map((x) => (x.startsWith('#') ? x : `#${x}`));
      const tag = tags.map((x) => line.indexOf(x)).find((i) => i >= 0);
      const id = line.match(PLAN_ID_RE);
      if (tag != null) out.push({ from: tag, to: tag + tags.find((x) => line.indexOf(x) === tag).length, text: p.text });
      else if (id) out.push({ from: id.index, to: id.index + id[0].length, text: p.text });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
/** The plan tasks in a note's text (a checkbox with a task tag or a 🆔 id), with their 0-based line numbers. */
function planTextTasks(lines, file) {
  const out = [];
  lines.forEach((text, n) => {
    if (!text.includes('[')) return;
    const t = planTask(text, { file, line: n });
    if (t && (t.id || planHasTag(t.raw, NEON_PLAN.taskTag))) out.push(t);
  });
  return planAddSteps(lines, out);
}

Object.assign(NeonProjects.prototype, {
  hookPlanMarks() {
    if (!planCmView || !this.registerEditorExtension) return;
    this.markOutside = new Map(); // note path -> { tasks } (null while loading): the plan's tasks from other notes
    this.markGen = 0;
    const plugin = this;
    const { ViewPlugin, Decoration } = planCmView;
    const ext = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.gen = -1;
          this.decorations = Decoration.none;
          this.build(view);
        }
        update(u) {
          if (u.docChanged || this.gen !== plugin.markGen) this.build(u.view);
        }
        build(view) {
          this.gen = plugin.markGen;
          this.decorations = Decoration.none;
          try {
            const info = obsidian.editorInfoField ? view.state.field(obsidian.editorInfoField, false) : null;
            const file = info && info.file;
            if (!file || plugin.settings.planMarks === false) return;
            const scope = planScopeOf(plugin.app, file);
            if (!scope) return;
            const outside = plugin.planMarkOutside(file, scope);
            if (!outside) return; // still reading the rest of the plan: no marks rather than wrong ones
            const doc = view.state.doc;
            const lines = [];
            for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
            const own = planTextTasks(lines, file);
            if (!own.length) return;
            const byTask = new Map();
            for (const p of planProblems([...own, ...outside])) {
              const hit = p.kind === 'missing' || p.kind === 'nested' ? [p.task] : own.filter((t) => (p.kind === 'dup' ? t.id === p.ids[0] : p.kind === 'loop' && t.id && p.ids.includes(t.id)));
              for (const t of hit) if (own.includes(t)) byTask.set(t, [...(byTask.get(t) || []), p]);
            }
            const ranges = [];
            for (const [t, ps] of byTask) {
              const line = doc.line(t.line + 1);
              for (const m of planLineMarks(line.text, ps)) ranges.push(Decoration.mark({ class: 'np-bad-ref', attributes: { title: `Planning: ${m.text}` } }).range(line.from + m.from, line.from + m.to));
            }
            this.decorations = Decoration.set(ranges, true);
          } catch (e) {
            console.error(`${appName()} – Projects: plan marks`, e);
          }
        }
      },
      { decorations: (v) => v.decorations },
    );
    this.registerEditorExtension(ext);
    // the rest of the plan is read again when a note of the plan is saved (debounced), or the note is reopened
    const redo = debounce(() => this.planMarksRefresh(), 1500, true);
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (!this.markOutside.size) return;
        const scope = planScopeOf(this.app, f);
        let gone = false;
        for (const key of [...this.markOutside.keys()])
          if (key === f.path || (scope && scope.kind === 'folder' && key.startsWith(scope.path + '/'))) gone = this.markOutside.delete(key) || gone;
        if (gone) redo();
      }),
    );
    this.registerEvent(this.app.workspace.on('file-open', (f) => f && this.markOutside.delete(f.path)));
  },
  /** The plan's tasks outside this note (cached), or null while they are being read (then the marks redraw). */
  planMarkOutside(file, scope) {
    const had = this.markOutside.get(file.path);
    if (had) return had.tasks;
    const entry = { tasks: null };
    this.markOutside.set(file.path, entry);
    planCollect(this.app, scope)
      .then((tasks) => (entry.tasks = tasks.filter((t) => t.file.path !== file.path)))
      .catch((e) => {
        console.error(`${appName()} – Projects: plan marks`, e);
        entry.tasks = [];
      })
      .then(() => this.planMarksRefresh());
    return null;
  },
  /** Redraw the marks in every open editor. */
  planMarksRefresh() {
    this.markGen++;
    this.app.workspace.updateOptions();
  },
});
