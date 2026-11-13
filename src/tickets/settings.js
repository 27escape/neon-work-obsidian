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
      .setName('Customers folder')
      .setDesc('Each folder inside it is a customer. A project’s customer is its customer property, else the customer folder it is in.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('1.Customers').setValue(s.customersFolder).onChange((v) => ((s.customersFolder = normalizePath(v.trim() || '1.Customers')), proj())), 'folder'));
    new Setting(containerEl)
      .setName('Projects folder name')
      .setDesc('New projects for a customer go in <customers folder>/<customer>/<this folder>/.')
      .addText((t) => t.setPlaceholder('Projects').setValue(s.projectsFolderName).onChange((v) => ((s.projectsFolderName = v.trim() || 'Projects'), save())));
    new Setting(containerEl)
      .setName('Project folder')
      .setDesc(`Where new projects without a customer go. Empty: ${basePath('Projects')} (in the base folder).`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Projects')).setValue(s.projectFolder).onChange((v) => ((s.projectFolder = v.trim() ? normalizePath(v.trim()) : ''), save())), 'folder'));
    new Setting(containerEl)
      .setName('Project template')
      .setDesc('Note that new projects start from; {{title}}, {{date}}, <% tp.file.title %> and <% tp.date.now() %> are filled in. Empty: title, tags, started, due, completed and status.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('templates/project_template.md').setValue(s.projectTemplate).onChange((v) => ((s.projectTemplate = v.trim()), save())), 'file'));

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
