/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

class NeonSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    const s = p.settings;
    containerEl.empty();
    containerEl.addClass('nd-settings');
    const save = () => p.saveSettings();
    const num = (setting, key, min, max) => numSetting(setting, s, key, min, max, save);

    new Setting(containerEl).setName('Look').setHeading();
    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Also in the dashboard header. Every theme has a light and a dark version.')
      .addDropdown((d) => d.addOptions(THEME_LABEL).setValue(s.theme).onChange((v) => p.setLook({ theme: v })));
    new Setting(containerEl)
      .setName('Pattern')
      .setDesc('The live background behind the dashboard and the card explorer. “Theme default” follows the theme.')
      .addDropdown((d) => d.addOptions({ auto: 'Theme default', ...PATTERN_LABEL }).setValue(s.pattern).onChange((v) => p.setLook({ pattern: v })));
    new Setting(containerEl)
      .setName('Pattern strength')
      .addDropdown((d) => d.addOptions(STRENGTH_LABEL).setValue(s.patternStrength).onChange((v) => p.setLook({ patternStrength: v })));
    new Setting(containerEl)
      .setName('Pattern motion')
      .setDesc('The pattern drifts very slowly. It always pauses when Obsidian is in the background and when your system asks for reduced motion.')
      .addToggle((t) => t.setValue(s.patternMotion).onChange((v) => p.setLook({ patternMotion: v })));
    new Setting(containerEl)
      .setName('Light / dark mode')
      .addButton((b) => b.setButtonText('Toggle').onClick(() => p.toggleLightDark()));
    new Setting(containerEl)
      .setName('Your name')
      .setDesc('Used in the dashboard greeting.')
      .addText((t) => t.setValue(s.name).onChange((v) => ((s.name = v.trim()), save())));
    new Setting(containerEl).setName('Open dashboard on startup').addToggle((t) => t.setValue(s.openDashboardOnStartup).onChange((v) => ((s.openDashboardOnStartup = v), save())));

    new Setting(containerEl).setName('Notes').setHeading();
    new Setting(containerEl)
      .setName('Core folder')
      .setDesc('Tickets, time log, reviews, quick tasks, daily notes and templates live in here. Your own folders sit next to it.')
      .addText((t) => t.setValue(s.coreFolder).onChange((v) => ((s.coreFolder = normalizePath(v.trim() || 'Core')), save())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('Move Neon files into this folder now').onClick(() => p.tidyIntoCore(true)));
    new Setting(containerEl)
      .setName('Weekly review folder')
      .setDesc('Optional template: a note named Weekly Review in your templates folder with {{weekLine}} and {{weekNotes}}.')
      .addText((t) => t.setValue(s.reviewFolder).onChange((v) => ((s.reviewFolder = v.trim() || 'Core/Reviews'), save())));
    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Comma-separated. Ignored by stats and the graph.')
      .addText((t) => t.setValue(s.excludeFolders).onChange((v) => ((s.excludeFolders = v), save())));

    new Setting(containerEl).setName('Card explorer').setHeading();
    new Setting(containerEl)
      .setName('Quick capture card')
      .setDesc('Show the Quick capture card on the dashboard. The capture command works either way.')
      .addToggle((t) =>
        t.setValue(s.showCapture).onChange(async (v) => {
          s.showCapture = v;
          await save();
          p.app.workspace.getLeavesOfType(VIEW_DASH).forEach((l) => l.rebuildView());
        }),
      );
    new Setting(containerEl).setName('Show cards in the left sidebar').addToggle((t) => t.setValue(s.cardsInSidebar).onChange((v) => ((s.cardsInSidebar = v), save())));
    new Setting(containerEl)
      .setName('Replace the file explorer')
      .setDesc('Closes the tree-view file explorer on startup. Get it back with “Files: Show file explorer”.')
      .addToggle((t) => t.setValue(s.replaceFileExplorer).onChange((v) => ((s.replaceFileExplorer = v), save())));
    num(new Setting(containerEl).setName('Revisit school notes after (days)').setDesc('School notes you haven’t opened for this long get a Revisit badge.'), 'revisitDays', 1, 365);

    new Setting(containerEl).setName('Graph').setHeading();
    num(new Setting(containerEl).setName('Max notes').setDesc('The graph shows up to twice this many notes.'), 'graphMaxNodes', 20, 400);
    new Setting(containerEl).setName('Bridge note folder').addText((t) => t.setValue(s.bridgeFolder).onChange((v) => ((s.bridgeFolder = v.trim()), save())));
    madeWith(containerEl, 'Neon Deck');
  }
}

