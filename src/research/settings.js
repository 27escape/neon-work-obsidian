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
      .setDesc('Each section is a folder shown as its own tree (folders are topics, notes are notes) with its own quiz and history. Switch between them at the top of the tab.');
    // only re-read notes once the user stops typing a folder path
    const rescan = debounce(async () => {
      s.root = s.roots[0].path;
      save();
      await p.refreshCardText();
      p.emitSoon();
      p.updateLinkHint();
    }, 600, true);
    s.roots.forEach((r, i) => {
      const row = new Setting(containerEl)
        .addText((t) => t.setPlaceholder('Name').setValue(r.name).onChange((v) => ((r.name = v.trim() || r.path.split('/').pop()), save(), p.emitSoon())))
        .addText((t) => t.setPlaceholder('Folder, e.g. Learning/School').setValue(r.path).onChange((v) => ((r.path = normalizePath(v.trim() || r.path)), rescan())));
      if (s.roots.length > 1)
        row.addExtraButton((b) =>
          b.setIcon('trash-2').setTooltip('Remove this section (its notes stay)').onClick(() => {
            s.roots.splice(i, 1);
            if (s.activeRoot >= s.roots.length) s.activeRoot = 0;
            rescan();
            this.display();
          }),
        );
    });
    new Setting(containerEl).addButton((b) =>
      b.setButtonText('Add section').onClick(async () => {
        const path = `Learning/Section ${s.roots.length + 1}`;
        s.roots.push({ name: `Section ${s.roots.length + 1}`, path });
        await ensureFolder(p.app, path);
        rescan();
        this.display();
      }),
    );
    new Setting(containerEl)
      .setName('Count research as work time')
      .setDesc('Off: new research notes get “untracked: true”, so Neon Time never counts them as work.')
      .addToggle((t) => t.setValue(s.countAsWork).onChange((v) => ((s.countAsWork = v), save())));
    new Setting(containerEl)
      .setName('Link suggestions')
      .setDesc('In research notes, the status bar offers to link words that match other research note titles.')
      .addToggle((t) => t.setValue(s.linkSuggest).onChange((v) => ((s.linkSuggest = v), save(), p.updateLinkHint())));
    madeWith(containerEl, 'Neon Study');
  }
}

