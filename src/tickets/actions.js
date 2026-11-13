Object.assign(NeonProjects.prototype, {
  /* writing: properties only ------------------------------------------------- */
  /** Set properties; null removes one, except keys your template keeps empty (they stay, empty). */
  async patch(t, patch) {
    await this.app.fileManager.processFrontMatter(t.file, (fm) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v !== null && v !== '') fm[k] = v;
        else if (k === 'cancelled' || k === 'note' || k === 'remind') delete fm[k];
        else if (k in fm) fm[k] = null;
      }
    });
    this.app.workspace.trigger('neon:project-changed', { file: t.file, title: t.title, change: Object.keys(patch).join(', ') });
  },
  /**
   * A project's status. `target` is one of your status values, or a group ('open', 'in-progress',
   * 'waiting', 'done') meaning the first value of that group. Writes status, and completed / cancelled dates.
   */
  async setStatus(t, target) {
    const value = PROJECT_KINDS.includes(target) ? this.statusChoices(target)[0] || target : target;
    if (!value || (t.statusRaw && value.toLowerCase() === t.statusRaw.toLowerCase())) return false;
    const { kind, patch } = projectStatusPatch(value, t.status, moment().format('YYYY-MM-DD'), NEON_PROJECTS);
    await this.patch(t, patch);
    this.logStatus(t, kind, value);
    if (kind === 'done') new Notice(`✓ ${t.title} — ${value}`);
    return true;
  },
  /**
   * Recently done on the dashboard (fork): projects closed in the last 14 days, read from their `completed` /
   * `cancelled` date, however the status was changed; plus projects put on hold from these menus (still logged).
   */
  closedActivity() {
    const cut = moment().startOf('day').subtract(13, 'days');
    const out = [];
    const open = (path) => () => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) this.openProject(f);
    };
    if (this.settings.activityStatuses.includes('done'))
      for (const t of this.collectProjects())
        if (t.status === 'done' && t.completed && !t.completed.isBefore(cut))
          out.push({ t: t.completed.clone().startOf('day').valueOf(), allDay: true, kind: 'ticket', text: t.title, src: t.customer || '', status: 'done', label: t.statusRaw || 'Closed', open: open(t.file.path) });
    for (const x of this.settings.statusLog)
      if (projectKind(x.status) === 'waiting' && this.settings.activityStatuses.includes('waiting')) out.push({ t: x.t, kind: 'ticket', text: x.title, src: '', status: 'waiting', label: x.status, open: open(x.path) });
    return out;
  },
  /** Projects set to a status group chosen in settings, from these menus (only 'on hold' is shown; closed comes from the notes). */
  logStatus(t, kind, value) {
    if (!this.settings.activityStatuses.includes(kind)) return;
    const log = this.settings.statusLog;
    log.push({ t: Date.now(), title: t.title, status: value, path: t.file.path });
    if (log.length > 200) log.splice(0, log.length - 200);
    this.saveSettings();
    const api = deckApi(this.app);
    if (api && api.activityChanged) api.activityChanged();
  },
  async postpone(t, days) {
    const base = t.due && !t.due.isBefore(moment(), 'day') ? t.due.clone() : moment();
    await this.patch(t, { due: base.add(days, 'days').format('YYYY-MM-DD') });
  },
  /** Ask for a date (YYYY-MM-DD) for a date property: due or remind. */
  promptDate(t, key) {
    const cur = key === 'due' ? t.due : t.remind;
    new PromptModal(this.app, {
      title: key === 'due' ? `Due date for ${t.title}` : `Remind me about ${t.title}`,
      value: cur ? cur.format('YYYY-MM-DD') : moment().add(7, 'days').format('YYYY-MM-DD'),
      placeholder: 'YYYY-MM-DD (empty clears it)',
      cta: 'Save',
      onSubmit: (v) => {
        const d = v.trim() ? moment(v.trim(), ['YYYY-MM-DD', 'D/M/YYYY', 'D MMM YYYY'], true) : null;
        if (v.trim() && !(d && d.isValid())) return new Notice('Use a date like 2026-11-20');
        this.patch(t, { [key]: d ? d.format('YYYY-MM-DD') : null });
      },
    }).open();
  },
  openProject(file, e) {
    openFile(this.app, file, e);
  },
});

/** Right-click / ⋯ menu of a project. */
function projectMenu(plugin, t, m) {
  m.addItem((i) => i.setTitle('Open').setIcon('briefcase').onClick(() => plugin.openProject(t.file)));
  m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => plugin.app.workspace.getLeaf('tab').openFile(t.file)));
  m.addSeparator();
  for (const v of plugin.statusChoices()) m.addItem((i) => i.setTitle(`Status: ${v}`).setChecked((t.statusRaw || '').toLowerCase() === v.toLowerCase()).onClick(() => plugin.setStatus(t, v)));
  m.addSeparator();
  m.addItem((i) => i.setTitle('Set note…').setIcon('message-square').onClick(() => plugin.promptNote(t)));
  for (const [n, label] of [[1, '+1 day'], [7, '+1 week'], [14, '+2 weeks']]) m.addItem((i) => i.setTitle(`Postpone ${label}`).setIcon('calendar-clock').onClick(() => plugin.postpone(t, n)));
  m.addItem((i) => i.setTitle('Set due date…').setIcon('calendar').onClick(() => plugin.promptDate(t, 'due')));
  m.addItem((i) => i.setTitle('Remind me on…').setIcon('bell').onClick(() => plugin.promptDate(t, 'remind')));
}
