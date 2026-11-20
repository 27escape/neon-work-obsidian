/* ---- Project plans (fork): where a Planning report is saved -----------------------------------------------------
 * Setting "Save Planning reports" (planReportsWhere): 'folder' (the default) saves every report in the reports
 * folder (planReportsFolder; empty: <base folder>/Reports); 'project' saves it next to the project, in a folder named
 * by planReportsSubfolder (default Reports): beside the note for a single-note project (e.g.
 * 1.Customers/E2I/Projects/Reports), inside the folder for a project folder (e.g. 1.Projects/Website/Reports). So a
 * customer's reports stay with that customer and move with it when it is archived.
 * Falls back to the reports folder when the place next to the project is unsuitable: a note at the vault root, a
 * note sitting directly in the Project folders root (a Reports folder there would itself count as a project), or a
 * path through a `Core` or `Neon` folder, which the plugin never writes. planReportFolder is pure (tested). */

/** The folder name for reports next to a project: one plain folder name (no slashes), default Reports. */
function planReportSubName(v) {
  const s = String(v == null ? '' : v).replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s && s !== '.' && s !== '..' ? s : 'Reports';
}
/** True for a path through a folder the plugin never writes (Core, or Neon at the top). */
function planReportForbidden(path) {
  const parts = String(path || '').split('/');
  return parts.includes('Core') || parts[0] === 'Neon';
}
/**
 * The folder a report is saved in (pure). o: { where ('folder' | 'project'), folder (planReportsFolder),
 * sub (planReportsSubfolder), scope ({ kind: 'note' | 'folder', path }), projectFolders (the Project folders setting) }.
 */
function planReportFolder(o) {
  const fixed = locPath(o.folder, 'Reports');
  if (o.where !== 'project' || !o.scope || !o.scope.path) return fixed;
  const sub = planReportSubName(o.sub);
  const path = normalizePath(o.scope.path);
  let at;
  if (o.scope.kind === 'folder') at = path;
  else {
    const i = path.lastIndexOf('/');
    if (i <= 0) return fixed; // a project note at the vault root
    at = path.slice(0, i);
    if (at === folderSetting(o.projectFolders)) return fixed; // a Reports folder there would be a project folder itself
  }
  const out = normalizePath(`${at}/${sub}`);
  return planReportForbidden(out) ? fixed : out;
}

Object.assign(PlanView.prototype, {
  /** Where this plan's report goes, from the settings. */
  reportFolder() {
    const s = this.plugin.settings;
    return planReportFolder({ where: s.planReportsWhere, folder: s.planReportsFolder, sub: s.planReportsSubfolder, scope: this.plan, projectFolders: s.projectFolders });
  },
});
