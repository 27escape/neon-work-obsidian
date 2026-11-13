/* ---- settings --------------------------------------------------------------- */
class NeonResearchSettingTab extends PluginSettingTab {
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
    new Setting(containerEl)
      .setName('Sections')
      .setDesc('Each section is a folder shown as its own tree (folders are topics, notes are notes). Switch between them at the top of the tab. A * in the path stands for any one folder, so 1.Customers/*/Research gathers every customer’s Research folder into one section. Removing a section never touches its notes.');
    // only re-read notes once the user stops typing a folder path
    const rescan = debounce(async () => {
      s.root = s.roots.length ? s.roots[0].path : '';
      save();
      p.emitSoon();
      p.updateLinkHint();
    }, 600, true);
    s.roots.forEach((r, i) => {
      const row = new Setting(containerEl)
        .addText((t) => t.setPlaceholder('Name').setValue(r.name).onChange((v) => ((r.name = v.trim() || r.path.split('/').pop()), save(), p.emitSoon())))
        .addText((t) => t.setPlaceholder('Folder, or a pattern like 1.Customers/*/Research').setValue(r.path).onChange((v) => ((r.path = normalizePath(v.trim() || r.path)), rescan())));
      row.addExtraButton((b) =>
          b.setIcon('trash-2').setTooltip('Remove this section (its notes stay)').onClick(() => {
            s.roots.splice(i, 1);
            if (s.activeRoot >= s.roots.length) s.activeRoot = 0;
            rescan();
            this.display();
          }),
        );
    });
    if (!s.roots.length) containerEl.createEl('p', { cls: 'setting-item-description', text: 'No sections yet: add one to see your research in the Research tab.' });
    // fork: pick an existing folder (or type a new path) instead of making Learning/Section N
    new Setting(containerEl).addButton((b) =>
      b.setButtonText('Add section').onClick(() => {
        const modal = new SectionPickModal(p);
        modal.after = () => this.display();
        modal.open();
      }),
    );

    new Setting(containerEl).setName('Status').setHeading();
    new Setting(containerEl)
      .setName('Status property')
      .setDesc('The note property that holds a research note’s status. Only read, never written (except for new notes made from the tab).')
      .addText((t) => t.setPlaceholder('status').setValue(s.statusProperty).onChange((v) => ((s.statusProperty = v.trim() || 'status'), save(), p.emitSoon())));
    new Setting(containerEl)
      .setName('Done statuses')
      .setDesc('Comma-separated values that count as researched. Any other value counts as still to research.')
      .addText((t) => t.setPlaceholder('completed, done, evergreen').setValue(s.doneStatuses).onChange((v) => ((s.doneStatuses = v), save(), p.emitSoon())));

    new Setting(containerEl).setName('New notes').setHeading();
    new Setting(containerEl)
      .setName('Template note')
      .setDesc('Optional: a note whose text new research notes start from. {{title}}, {{date}} and {{time}} are filled in. Empty: title, created, modified, status and tags properties.')
      .addText((t) => t.setPlaceholder('2.Resources/templates/research_template.md').setValue(s.noteTemplate).onChange((v) => ((s.noteTemplate = v.trim()), save())));
    new Setting(containerEl)
      .setName('Status for new notes')
      .setDesc('Used when there is no template. Empty: no status property.')
      .addText((t) => t.setPlaceholder('init').setValue(s.newStatus).onChange((v) => ((s.newStatus = v.trim()), save())));
    new Setting(containerEl)
      .setName('Tags for new notes')
      .setDesc('Comma-separated. Used when there is no template.')
      .addText((t) => t.setPlaceholder('research').setValue(s.newNoteTags).onChange((v) => ((s.newNoteTags = v), save())));

    new Setting(containerEl).setName('Other').setHeading();
    new Setting(containerEl)
      .setName('Count research as work time')
      .setDesc('Off: new research notes (without a template) get “untracked: true”, so Neon Time never counts them as work.')
      .addToggle((t) => t.setValue(s.countAsWork).onChange((v) => ((s.countAsWork = v), save())));
    new Setting(containerEl)
      .setName('Link suggestions')
      .setDesc('In research notes, the status bar offers to link words that match other research note titles.')
      .addToggle((t) => t.setValue(s.linkSuggest).onChange((v) => ((s.linkSuggest = v), save(), p.updateLinkHint())));
    madeWith(containerEl, 'Neon Research');
  }
}

