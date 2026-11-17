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
      .setName('Task tags')
      .setDesc('A checkbox line with one of these tags is a task wherever it is, as in the Tasks plugin. Several: separate with commas (#task, #todo); new tasks get the first. Empty: only tagged notes, daily notes and the Todo note.')
      .addText((t) => t.setPlaceholder('#task').setValue(s.taskTag).onChange((v) => ((s.taskTag = taskTags(v).join(', ')), (NEON_PLAN.taskTag = s.taskTag), save(), p.emit())));
    new Setting(containerEl)
      .setName('Tasks in projects')
      .setDesc('Tasks in project notes (and in project folders) belong to the project: its plan and the counts on the Projects card and tab. Show them on the Tasks card and tab as well?')
      .addDropdown((d) => d.addOption('none', 'No: only in the project').addOption('all', 'Yes: with the other tasks').setValue(s.projectTasks === 'all' ? 'all' : 'none').onChange((v) => ((s.projectTasks = v), save(), p.emit())));
    numSetting(new Setting(containerEl).setName('Carry over unfinished daily-note tasks (days)').setDesc('Open tasks from earlier daily or weekly notes show under Today. 0 = only the current note.'), s, 'carryDays', 0, 90, save);
    new Setting(containerEl)
      .setName('Stamp completion date')
      .setDesc('Adds ✅ YYYY-MM-DD when you tick a task on the dashboard (Tasks-plugin compatible).')
      .addToggle((t) => t.setValue(s.stampDone).onChange((v) => ((s.stampDone = v), save())));
    new Setting(containerEl)
      .setName('Timeline on the Tasks tab')
      .setDesc('A Gantt chart (Mermaid) of open tasks with a due date: bars where a task also has a 🛫 start date. “Copy as Mermaid” pastes it into a note.')
      .addToggle((t) => t.setValue(s.showTimeline !== false).onChange((v) => ((s.showTimeline = v), save())));
    new Setting(containerEl).setName('Todo').setHeading();
    new Setting(containerEl)
      .setName('Todo note')
      .setDesc(`Its open tasks fill the Todo card. Tasks you add on the dashboard go at the head of this note as “- [ ] #task … ➕ date”. Empty: ${basePath('Todo.md')}.`)
      .addText((t) => suggestPaths(p.app, t.setPlaceholder(basePath('Todo.md')).setValue(s.quickTasksPath).onChange((v) => ((s.quickTasksPath = v.trim()), save(), p.emit())), 'file'));
    new Setting(containerEl).setName('New notes').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'With a groups folder (Projects section), New note asks for a name, a group and a type. In a folder, {group} stands for <groups folder>/<group>; without a group chosen, such notes go in the folder for notes without a group. Templates fill {{title}}, {{date}} and {{time}}; without one the note gets title, created, modified, the group property and the tag. Projects always go through New project.' });
    const types = s.noteTypes;
    const box = containerEl.createDiv('nt-types');
    const drawTypes = () => {
      box.empty();
      types.forEach((ty, i) => {
        const row = new Setting(box).setClass('nt-type-row');
        row.addText((t) => t.setPlaceholder('Name').setValue(ty.name || '').onChange((v) => ((ty.name = v.trim()), save())));
        row.addText((t) => t.setPlaceholder('Folder, e.g. {group}/Meetings').setValue(ty.folder || '').onChange((v) => ((ty.folder = v.trim()), save())));
        row.addText((t) => suggestPaths(p.app, t.setPlaceholder('Template (optional)').setValue(ty.template || '').onChange((v) => ((ty.template = v.trim()), save())), 'file'));
        row.addText((t) => t.setPlaceholder('Tag').setValue(ty.tag || '').onChange((v) => ((ty.tag = v.trim().replace(/^#/, '')), save())));
        row.addToggle((t) => t.setTooltip('Person: named @Name, with aliases').setValue(!!ty.person).onChange((v) => ((ty.person = v), save())));
        row.addExtraButton((b) =>
          b.setIcon('trash-2').setTooltip('Remove this type').onClick(() => {
            if (types.length <= 1) return new Notice('Keep at least one type');
            types.splice(i, 1);
            save();
            drawTypes();
          }),
        );
      });
      new Setting(box).addButton((b) =>
        b.setButtonText('Add a type').onClick(() => {
          types.push({ name: '', folder: '{group}', template: '', tag: '', person: false });
          save();
          drawTypes();
        }),
      );
    };
    drawTypes();
    new Setting(containerEl)
      .setName('Folder for notes without a group')
      .setDesc('Empty: the vault root.')
      .addText((t) => suggestPaths(p.app, t.setPlaceholder('e.g. 2.Resources').setValue(s.noCustomerFolder).onChange((v) => ((s.noCustomerFolder = v.trim()), save())), 'folder'));
    new Setting(containerEl)
      .setName('Ask a few questions when I create a note')
      .setDesc('Name, kind and category. Close the card to skip it.')
      .addToggle((t) => t.setValue(s.askOnCreate).onChange((v) => ((s.askOnCreate = v), save())));
    new Setting(containerEl)
      .setName('“No category yet” reminder')
      .setDesc('A small bar on new notes without a category. Only notes created since the plugin was installed, and never with customer folders (the folder is the customer).')
      .addToggle((t) => t.setValue(s.showNoCategoryBar).onChange((v) => ((s.showNoCategoryBar = v), save(), p.updateBar())));
    madeWith(containerEl);
  }
}

