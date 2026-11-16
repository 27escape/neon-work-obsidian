class NeonProjectsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = () => p.saveSettings();
    const proj = () => (p.applyProjectSettings(), save(), p.emitSoon());
    containerEl.empty();
    containerEl.addClass('nd-settings');

    new Setting(containerEl).setName('Projects').setHeading();
    new Setting(containerEl)
      .setName('Project tag')
      .setDesc('Notes with this tag in their tags property are projects, wherever they are.')
      .addText((t) => t.setPlaceholder('project').setValue(s.projectTag).onChange((v) => ((s.projectTag = v.trim().replace(/^#/, '')), proj())));
    new Setting(containerEl)
      .setName('Group name')
      .setDesc('What the groups that projects and notes belong to are called: Customer by default, Area for a PARA vault, or Client, Team…')
      .addText((t) => t.setPlaceholder('Customer').setValue(s.groupLabel).onChange((v) => ((s.groupLabel = v.trim() || 'Customer'), proj())));
    new Setting(containerEl)
      .setName('Group properties')
      .setDesc('The properties that name a note’s group, tried in order (e.g. area, parent). A value can be a name (acme), a link ([[Photography]]) or a link to a note inside a group folder. Without one, the folder the note is in decides.')
      .addText((t) => t.setPlaceholder('customer').setValue(s.groupProperty).onChange((v) => ((s.groupProperty = v.trim() || 'customer'), proj())));
    new Setting(containerEl)
      .setName('Groups folder')
      .setDesc('Each folder inside it is a group (a customer, or an area or project folder in a PARA vault). A note in one of them, at any depth, belongs to that group.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('1.Customers').setValue(s.customersFolder).onChange((v) => ((s.customersFolder = normalizePath(v.trim() || '1.Customers')), proj())), 'folder'));
    new Setting(containerEl)
      .setName('Not groups')
      .setDesc('Comma-separated folders inside the groups folder that are not groups, e.g. Dailynotes, Tasks.')
      .addText((t) => t.setPlaceholder('Dailynotes, Tasks').setValue(s.groupSkip).onChange((v) => ((s.groupSkip = v), proj())));
    new Setting(containerEl)
      .setName('Project folders')
      .setDesc('Optional. Each folder directly inside this one is a project too, unless it already holds a tagged project note (PARA: 1.Projects). Its status and dates come from a note named like the folder, else one with a status, else its index note.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('e.g. 1.Projects').setValue(s.projectFolders).onChange((v) => ((s.projectFolders = v.trim() ? normalizePath(v.trim()) : ''), proj())), 'folder'));
    new Setting(containerEl)
      .setName('Projects folder name')
      .setDesc('New projects for a group go in <groups folder>/<group>/<this folder>/.')
      .addText((t) => t.setPlaceholder('Projects').setValue(s.projectsFolderName).onChange((v) => ((s.projectsFolderName = v.trim() || 'Projects'), save())));
    new Setting(containerEl)
      .setName('Project folder')
      .setDesc(`Where new projects without a group go. Empty: ${basePath('Projects')} (in the base folder).`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Projects')).setValue(s.projectFolder).onChange((v) => ((s.projectFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'));
    new Setting(containerEl)
      .setName('Project template')
      .setDesc('Note that new projects start from; {{title}}, {{date}}, <% tp.file.title %> and <% tp.date.now() %> are filled in. Empty: title, tags, started, due, completed and status.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('templates/project_template.md').setValue(s.projectTemplate).onChange((v) => ((s.projectTemplate = v.trim()), save())), 'file'));

    new Setting(containerEl)
      .setName('Planning reports folder')
      .setDesc(`Where Report (in the Planning view) saves a plan's report note and its chart. Empty: ${basePath('Reports')} (in the base folder).`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Reports')).setValue(s.planReportsFolder || '').onChange((v) => ((s.planReportsFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'));

    new Setting(containerEl).setName('Status values').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Comma-separated, in the order they are offered. The group decides how a project is counted and coloured; unknown values count as not started. Changing a status only updates properties.' });
    const statuses = (name, key, desc, ph) => new Setting(containerEl).setName(name).setDesc(desc).addText((t) => t.setPlaceholder(ph).setValue(s[key]).onChange((v) => ((s[key] = v), proj())));
    statuses('Not started', 'statusNotStarted', 'The first one is used for new projects.', 'init, created');
    statuses('Active', 'statusActive', '', 'inprogress, ongoing');
    statuses('On hold', 'statusOnHold', '', 'paused, blocked');
    statuses('Closed', 'statusClosed', 'Choosing one writes today’s date in the completed property.', 'completed, cancelled');
    new Setting(containerEl)
      .setName('Cancelled status')
      .setDesc('Closing with this value writes a cancelled date property instead of completed.')
      .addText((t) => t.setPlaceholder('cancelled').setValue(s.statusCancelled).onChange((v) => ((s.statusCancelled = v.trim()), proj())));

    new Setting(containerEl)
      .setName('Timeline on the Projects tab')
      .setDesc('A Gantt chart (Mermaid) above the list, one section per group (customer): a bar from started to due, or to the closed date. “Copy as Mermaid” pastes it into a note.')
      .addToggle((t) => t.setValue(s.showTimeline !== false).onChange((v) => ((s.showTimeline = v), save(), p.emitSoon())));

    new Setting(containerEl).setName('Dashboard and reminders').setHeading();
    for (const k of ['done', 'waiting', 'in-progress'])
      new Setting(containerEl)
        .setName(`Recently done: ${PROJECT_KIND_LABEL[k].toLowerCase()}`)
        .setDesc(k === 'done' ? 'Projects closed in the last 14 days (by their completed or cancelled date, however the status was changed) appear in the dashboard’s Recently done card.' : '')
        .addToggle((t) =>
          t.setValue(s.activityStatuses.includes(k)).onChange((v) => {
            s.activityStatuses = v ? [...new Set([...s.activityStatuses, k])] : s.activityStatuses.filter((x) => x !== k);
            save();
          }),
        );
    new Setting(containerEl)
      .setName('Reminders')
      .setDesc('A notice inside Obsidian, once a day per project: overdue, due soon, or past its remind date. Nothing is written to notes.')
      .addToggle((t) => t.setValue(s.reminders).onChange((v) => ((s.reminders = v), save())));
    numSetting(new Setting(containerEl).setName('Remind this many days before due'), s, 'remindDays', 0, 30, save);
  }
}
