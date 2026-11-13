/* ---- settings ---------------------------------------------------------- */
class NeonTimeSettingTab extends PluginSettingTab {
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
    new Setting(containerEl).setName('Tracking').setHeading();
    new Setting(containerEl)
      .setName('Track time automatically')
      .setDesc('Counts while a note is the focused tab and you type, scroll or click in it. Category comes from the projects / school / admin / operations checkbox (or tag). untracked: true notes are never logged.')
      .addToggle((t) => t.setValue(s.tracking).onChange((v) => p.setTracking(v)));
    numSetting(new Setting(containerEl).setName('Idle cutoff (minutes)').setDesc('Time keeps counting while you are in another app. After this long without typing, scrolling or clicking in Obsidian it stops at your last activity, and the idle time is dropped.'), s, 'idleMin', 1, 120, () => (save(), p.readmeSoon()));
    numSetting(new Setting(containerEl).setName('End an idle workday after (hours)').setDesc('A started workday ends by itself at your last activity after this long without input in Obsidian.'), s, 'workIdleH', 1, 12, () => save());
    numSetting(new Setting(containerEl).setName('Workday (hours)').setDesc('Weekday target. Time past it counts as overtime. Weekend time is all overtime.'), s, 'dayHours', 1, 16, () => (save(), p.emit(), p.readmeSoon()));
    numSetting(new Setting(containerEl).setName('Wrap up shows (minutes before the target)'), s, 'wrapLead', 0, 240, save);
    new Setting(containerEl).setName('Log notes').setHeading();
    new Setting(containerEl)
      .setName('Write a log note per day')
      .setDesc('Totals, a Done today list and a table of entries, for your AI agent to send to Jira. Neon Time itself never connects to Jira or the network.')
      .addToggle((t) => t.setValue(s.writeNotes).onChange((v) => ((s.writeNotes = v), save())));
    new Setting(containerEl)
      .setName('Log folder')
      .addText((t) => t.setValue(s.logFolder).onChange((v) => ((s.logFolder = normalizePath(v.trim() || 'Neon/Time Log')), save())))
      .addExtraButton((b) => b.setIcon('refresh-cw').setTooltip('Write today’s note now').onClick(() => p.writeDay(moment().format('YYYY-MM-DD'), true)));
    madeWith(containerEl, 'Neon Time');
  }
}

