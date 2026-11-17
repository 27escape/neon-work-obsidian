/* ---- Project plans (fork): which tasks belong to a project ---------------------------------------------------
 * A project's plan is the tasks in its note, or in every note of its folder for a project folder (the Projects
 * section's "Project folders"), plus outside tasks linked to them by a dependency in either direction: those are
 * marked `external` and their own chains are not followed. A task is a checkbox line with a task tag or a 🆔 id. */

// filled by the modules that own the settings: Tasks (task tags) and Projects (project folders)
const NEON_PLAN = { taskTag: '#task', folders: '' };

/** The project folder a path sits in (<project folders>/<folder>), or null. */
function planFolderOf(path) {
  const root = folderSetting(NEON_PLAN.folders);
  if (!root || !path || !path.startsWith(root + '/')) return null;
  const rest = path.slice(root.length + 1);
  const i = rest.indexOf('/');
  return i > 0 ? `${root}/${rest.slice(0, i)}` : null;
}
/** The plan a note belongs to: { kind: 'folder' | 'note', path }, or null for a note outside any project. */
function planScopeOf(app, file, cache) {
  if (!file || !file.path) return null;
  const folder = planFolderOf(file.path);
  if (folder) return { kind: 'folder', path: folder };
  const c = cache || app.metadataCache.getFileCache(file);
  return isProjectCache(c) ? { kind: 'note', path: file.path } : null;
}
/** The notes of a plan. */
function planScopeFiles(app, scope) {
  if (scope.kind === 'note') {
    const f = app.vault.getAbstractFileByPath(scope.path);
    return f instanceof TFile ? [f] : [];
  }
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(scope.path + '/'));
}
/** The plan tasks of one note, each with file, line and phase (the nearest heading above it). */
async function planReadFile(app, f) {
  const cache = app.metadataCache.getFileCache(f);
  if (!cache || !cache.listItems || !cache.listItems.some((li) => li.task !== undefined)) return [];
  const lines = (await app.vault.cachedRead(f)).split('\n');
  const heads = (cache.headings || []).map((h) => ({ line: h.position.start.line, text: h.heading }));
  const out = [];
  for (const li of cache.listItems) {
    if (li.task === undefined) continue;
    const n = li.position.start.line;
    const h = heads.filter((x) => x.line < n).pop();
    const t = planTask(lines[n], { file: f, line: n, phase: h ? h.text : '' });
    if (t && (t.id || planHasTag(t.raw, NEON_PLAN.taskTag))) out.push(t);
  }
  return planAddSteps(lines, out); // fork: each task's steps (the checkboxes under it), and tasks inside tasks
}
/**
 * All tasks of a plan. With neighbours (the default), outside tasks that a plan task depends on, or that depend on
 * one, are added after them, marked external. Excluded folders (archive, templates) are skipped.
 */
async function planCollect(app, scope, { neighbours = true } = {}) {
  const files = planScopeFiles(app, scope);
  const tasks = [];
  for (const f of files) tasks.push(...(await planReadFile(app, f)));
  if (!neighbours) return tasks;
  const ids = new Set(tasks.filter((t) => t.id).map((t) => t.id));
  const wanted = new Set(tasks.flatMap((t) => t.deps).filter((d) => !ids.has(d)));
  if (!ids.size && !wanted.size) return tasks;
  const inside = new Set(files.map((f) => f.path));
  const deck = neonPlugin(app, 'neon-deck');
  for (const f of app.vault.getMarkdownFiles()) {
    if (inside.has(f.path) || (deck && deck.isExcluded && deck.isExcluded(f))) continue;
    const cache = app.metadataCache.getFileCache(f);
    if (!cache || !cache.listItems || !cache.listItems.some((li) => li.task !== undefined)) continue;
    const text = await app.vault.cachedRead(f);
    if (!text.includes('🆔') && !text.includes('⛔')) continue;
    for (const t of await planReadFile(app, f))
      if ((t.id && wanted.has(t.id)) || t.deps.some((d) => ids.has(d))) tasks.push(Object.assign(t, { external: true }));
  }
  return tasks;
}
