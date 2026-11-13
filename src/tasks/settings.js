class NeonTasksSettingTab extends PluginSettingTab {
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
    new Setting(containerEl).setName('Tasks widget').setHeading();
    new Setting(containerEl)
      .setDesc('Shows open tasks from notes with “tasks” in their tags property, today’s daily note and the quick-add note. Ticket notes are always skipped.');
    new Setting(containerEl)
      .setName('Quick tasks note')
      .setDesc('Where the quick-add box writes. Items stay until you tick them.')
      .addText((t) => t.setValue(s.quickTasksPath).onChange((v) => ((s.quickTasksPath = v.trim() || 'Neon/Quick tasks.md'), save())));
    numSetting(new Setting(containerEl).setName('Carry over unfinished daily tasks (days)').setDesc('Open tasks from earlier daily notes show under Today. 0 = only today’s note.'), s, 'carryDays', 0, 90, save);
    new Setting(containerEl)
      .setName('Stamp completion date')
      .setDesc('Adds ✅ YYYY-MM-DD when you tick a task on the dashboard (Tasks-plugin compatible).')
      .addToggle((t) => t.setValue(s.stampDone).onChange((v) => ((s.stampDone = v), save())));
    new Setting(containerEl).setName('Global tasks').setHeading();
    new Setting(containerEl)
      .setName('Backup note')
      .setDesc('Global tasks live in plugin data. A read-only copy is written here daily and when they change.')
      .addText((t) => t.setValue(s.backupPath).onChange((v) => ((s.backupPath = v.trim() || TASKS_DEFAULTS.backupPath), save())))
      .addExtraButton((b) => b.setIcon('save').setTooltip('Back up now').onClick(() => p.writeBackup(true)));
    new Setting(containerEl).setName('New notes').setHeading();
    new Setting(containerEl)
      .setName('Ask a few questions when I create a note')
      .setDesc('Name, kind and category. Close the card to skip it.')
      .addToggle((t) => t.setValue(s.askOnCreate).onChange((v) => ((s.askOnCreate = v), save())));
    new Setting(containerEl)
      .setName('“No category yet” reminder')
      .setDesc('A small bar on new notes without a category. Only notes created since Neon Tasks was installed.')
      .addToggle((t) => t.setValue(s.showNoCategoryBar).onChange((v) => ((s.showNoCategoryBar = v), save(), p.updateBar())));
    madeWith(containerEl, 'Neon Tasks');
  }
}

