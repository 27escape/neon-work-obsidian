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
    new Setting(containerEl).setName('Tasks').setHeading();
    new Setting(containerEl).setDesc('The Tasks card shows open tasks ([ ] and [/]) across your notes, grouped by 📅 due or ⏳ scheduled date: checkbox lines with the task tag anywhere, every checkbox in notes tagged “tasks” and in recent daily notes. Excluded folders are skipped.');
    new Setting(containerEl)
      .setName('Task tag')
      .setDesc('A checkbox line with this tag is a task wherever it is, as in the Tasks plugin. Empty: only tagged notes, daily notes and the Todo note.')
      .addText((t) => t.setPlaceholder('#task').setValue(s.taskTag).onChange((v) => ((s.taskTag = v.trim() && !v.trim().startsWith('#') ? '#' + v.trim() : v.trim()), save(), p.emit())));
    numSetting(new Setting(containerEl).setName('Carry over unfinished daily-note tasks (days)').setDesc('Open tasks from earlier daily or weekly notes show under Today. 0 = only the current note.'), s, 'carryDays', 0, 90, save);
    new Setting(containerEl)
      .setName('Stamp completion date')
      .setDesc('Adds ✅ YYYY-MM-DD when you tick a task on the dashboard (Tasks-plugin compatible).')
      .addToggle((t) => t.setValue(s.stampDone).onChange((v) => ((s.stampDone = v), save())));
    new Setting(containerEl).setName('Todo').setHeading();
    new Setting(containerEl)
      .setName('Todo note')
      .setDesc('Its open tasks fill the Todo card. Tasks you add on the dashboard go at the head of this note as “- [ ] #task … ➕ date”.')
      .addText((t) => t.setPlaceholder('Todo.md').setValue(s.quickTasksPath).onChange((v) => ((s.quickTasksPath = v.trim() || TASKS_DEFAULTS.quickTasksPath), save(), p.emit())));
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

