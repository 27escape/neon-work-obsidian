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
    containerEl.empty();
    containerEl.addClass('nd-settings');
    new Setting(containerEl).setName('Tickets').setHeading();
    new Setting(containerEl)
      .setName('Ticket folder')
      .setDesc('Where new tickets go. Any note with “type: ticket” or the #ticket tag counts as a ticket, wherever it lives.')
      .addText((t) => t.setValue(s.ticketFolder).onChange((v) => ((s.ticketFolder = v.trim() || 'Core/Tickets'), save())));
    new Setting(containerEl)
      .setName('File done tickets')
      .setDesc('Done tickets move to <ticket folder>/Done/YYYY-MM/, and back when reopened. Links keep working.')
      .addToggle((t) => t.setValue(s.autoFile).onChange((v) => ((s.autoFile = v), save())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('File all done tickets now').onClick(() => p.fileAllDone(true)));
    new Setting(containerEl)
      .setName('Open tickets in the ticket view')
      .setDesc('Off: tickets open as plain notes. “Edit as note” always shows the text.')
      .addToggle((t) => t.setValue(s.openInTicketView).onChange((v) => ((s.openInTicketView = v), save())));
    new Setting(containerEl)
      .setName('Open tickets as a pop-up')
      .setDesc('Clicking a ticket on the dashboard, in the tracker or in the card explorer opens it on top of what you are doing. Ctrl+click opens a tab.')
      .addToggle((t) => t.setValue(s.popup).onChange((v) => ((s.popup = v), save())));
    // which status changes show in the dashboard's Recently done / touched card
    for (const st of TICKET_STATUS)
      new Setting(containerEl)
        .setName(`Recently done: ${TICKET_STATUS_LABEL[st]}`)
        .setDesc(st === 'done' ? 'Tickets set to this status appear in the dashboard’s Recently done / touched card.' : '')
        .addToggle((t) =>
          t.setValue(s.activityStatuses.includes(st)).onChange((v) => {
            s.activityStatuses = v ? [...new Set([...s.activityStatuses, st])] : s.activityStatuses.filter((x) => x !== st);
            save();
          }),
        );
    numSetting(new Setting(containerEl).setName('Default due in (days)').setDesc('Pre-filled in the New ticket form. 0 = no date.'), s, 'defaultDays', 0, 365, save);
    new Setting(containerEl)
      .setName('Default time category')
      .addDropdown((d) => d.addOptions(Object.fromEntries(CATS.map((c) => [c, CAT_LABEL[c]]))).setValue(s.defaultCategory).onChange((v) => ((s.defaultCategory = v), save())));
    new Setting(containerEl).setName('Reminders').setHeading();
    new Setting(containerEl)
      .setName('Reminders')
      .setDesc('Once a day per ticket (checked at startup and every 15 min): overdue, due soon, past its remind time, or a follow-up day.')
      .addToggle((t) => t.setValue(s.reminders).onChange((v) => ((s.reminders = v), save())))
      .addExtraButton((b) => b.setIcon('bell').setTooltip('Check now').onClick(() => p.checkReminders(true)));
    numSetting(new Setting(containerEl).setName('Remind this many days before due').setDesc('0 = only on the due day.'), s, 'remindDays', 0, 30, save);
    numSetting(new Setting(containerEl).setName('Waiting without a follow-up date: follow up after (days)'), s, 'autoFollowUpDays', 1, 60, save);
    madeWith(containerEl, 'Neon Tickets');
  }
}

