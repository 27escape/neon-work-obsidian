class NeonTicketsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    const save = () => p.saveSettings();
    // templates live in <ticket folder>/Templates: reload the list once typing stops
    const reloadTpl = debounce(() => p.loadTemplates(), 600, true);
    containerEl.empty();
    containerEl.addClass('nd-settings');
    // fork: projects
    const proj = () => (p.applyProjectSettings(), save(), p.emitSoon());
    new Setting(containerEl).setName('Projects').setHeading();
    new Setting(containerEl)
      .setName('Project tag')
      .setDesc('Notes with this tag in their tags property are projects, wherever they are. (Upstream ticket notes, “type: ticket” or #ticket, still count.)')
      .addText((t) => t.setPlaceholder('project').setValue(s.projectTag).onChange((v) => ((s.projectTag = v.trim().replace(/^#/, '')), proj())));
    const statuses = (name, key, desc, ph) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) => t.setPlaceholder(ph).setValue(s[key]).onChange((v) => ((s[key] = v), proj())));
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Status values, comma-separated, in the order they are offered. Each group decides how a project is counted and coloured. Unknown values count as not started.' });
    statuses('Not started', 'statusNotStarted', 'The first one is used for new projects.', 'init, created');
    statuses('Active', 'statusActive', '', 'inprogress, ongoing');
    statuses('On hold', 'statusOnHold', '', 'paused, blocked');
    statuses('Closed', 'statusClosed', 'Choosing one writes today’s date in the completed property.', 'completed, cancelled');
    new Setting(containerEl)
      .setName('Cancelled status')
      .setDesc('Closing with this value writes a cancelled date property instead of completed.')
      .addText((t) => t.setPlaceholder('cancelled').setValue(s.statusCancelled).onChange((v) => ((s.statusCancelled = v.trim()), proj())));
    new Setting(containerEl)
      .setName('Customers folder')
      .setDesc('Each folder inside it is a customer. A project’s customer is its customer property, else the customer folder it is in.')
      .addText((t) => t.setPlaceholder('1.Customers').setValue(s.customersFolder).onChange((v) => ((s.customersFolder = normalizePath(v.trim() || '1.Customers')), proj())));
    new Setting(containerEl)
      .setName('Projects folder name')
      .setDesc('New projects go in <customers folder>/<customer>/<this folder>/.')
      .addText((t) => t.setPlaceholder('Projects').setValue(s.projectsFolderName).onChange((v) => ((s.projectsFolderName = v.trim() || 'Projects'), save())));
    new Setting(containerEl)
      .setName('Project template')
      .setDesc('Note that new projects start from; {{title}}, {{date}} and {{time}} are filled in. Empty: title, tags, started, due, completed and status.')
      .addText((t) => t.setPlaceholder('2.Resources/templates/project_template.md').setValue(s.projectTemplate).onChange((v) => ((s.projectTemplate = v.trim()), save())));
    new Setting(containerEl)
      .setName('Write a log in project notes')
      .setDesc('Off: changing a status only updates properties. On: also adds a dated line under ## Log.')
      .addToggle((t) => t.setValue(s.writeLog).onChange((v) => ((s.writeLog = v), save())));

    new Setting(containerEl).setName('Upstream tickets').setHeading();
    new Setting(containerEl)
      .setName('Ticket folder')
      .setDesc('Used for ticket templates and for projects without a customer.')
      .addText((t) => t.setValue(s.ticketFolder).onChange((v) => ((s.ticketFolder = v.trim() || 'Neon/Tickets'), save(), reloadTpl())));
    new Setting(containerEl)
      .setName('Screenshot folder')
      .setDesc('Where screenshots pasted or dropped on a project are saved.')
      .addText((t) => t.setPlaceholder('Neon/Images/Tickets').setValue(s.screenshotFolder).onChange((v) => ((s.screenshotFolder = normalizePath(v.trim() || 'Neon/Images/Tickets')), save())));
    new Setting(containerEl)
      .setName('File done projects')
      .setDesc('Done projects move to <project folder>/Done/YYYY-MM/, and back when reopened. Links keep working.')
      .addToggle((t) => t.setValue(s.autoFile).onChange((v) => ((s.autoFile = v), save())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('File all done projects now').onClick(() => p.fileAllDone(true)));
    new Setting(containerEl)
      .setName('Open projects in the project view')
      .setDesc('Off: projects open as plain notes. “Edit as note” always shows the text.')
      .addToggle((t) => t.setValue(s.openInTicketView).onChange((v) => ((s.openInTicketView = v), save())));
    new Setting(containerEl)
      .setName('Open projects as a pop-up')
      .setDesc('Clicking a project on the dashboard, in the tracker or in the card explorer opens it on top of what you are doing. Ctrl+click opens a tab.')
      .addToggle((t) => t.setValue(s.popup).onChange((v) => ((s.popup = v), save())));
    // which status changes show in the dashboard's Recently done / touched card
    for (const st of TICKET_STATUS)
      new Setting(containerEl)
        .setName(`Recently done: ${TICKET_STATUS_LABEL[st]}`)
        .setDesc(st === 'done' ? 'Projects set to this status appear in the dashboard’s Recently done / touched card.' : '')
        .addToggle((t) =>
          t.setValue(s.activityStatuses.includes(st)).onChange((v) => {
            s.activityStatuses = v ? [...new Set([...s.activityStatuses, st])] : s.activityStatuses.filter((x) => x !== st);
            save();
          }),
        );
    numSetting(new Setting(containerEl).setName('Default due in (days)').setDesc('Pre-filled in the New project form. 0 = no date.'), s, 'defaultDays', 0, 365, save);
    new Setting(containerEl)
      .setName('Default time category')
      .addDropdown((d) => d.addOptions(Object.fromEntries(CATS.map((c) => [c, CAT_LABEL[c]]))).setValue(s.defaultCategory).onChange((v) => ((s.defaultCategory = v), save())));
    new Setting(containerEl).setName('Reminders').setHeading();
    new Setting(containerEl)
      .setName('Reminders')
      .setDesc('Once a day per project (checked at startup and every 15 min): overdue, due soon, past its remind time, or a follow-up day.')
      .addToggle((t) => t.setValue(s.reminders).onChange((v) => ((s.reminders = v), save())))
      .addExtraButton((b) => b.setIcon('bell').setTooltip('Check now').onClick(() => p.checkReminders(true)));
    numSetting(new Setting(containerEl).setName('Remind this many days before due').setDesc('0 = only on the due day.'), s, 'remindDays', 0, 30, save);
    numSetting(new Setting(containerEl).setName('Waiting without a follow-up date: follow up after (days)'), s, 'autoFollowUpDays', 1, 60, save);
    madeWith(containerEl, 'Neon Projects');
  }
}

