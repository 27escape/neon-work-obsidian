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
      .setName('Your name')
      .setDesc('Used in the dashboard greeting.')
      .addText((t) => t.setValue(s.name).onChange((v) => ((s.name = v.trim()), save())));
    new Setting(containerEl).setName('Open dashboard on startup').addToggle((t) => t.setValue(s.openDashboardOnStartup).onChange((v) => ((s.openDashboardOnStartup = v), save())));

    new Setting(containerEl).setName('Locations').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Each location is used only when you use that feature; nothing is created or moved in advance. Paths are relative to the vault root. Ticket, time log, quick tasks and image locations are in each module’s own settings.' });
    const loc = (name, desc, key, def) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => t.setPlaceholder(def).setValue(s[key]).onChange((v) => ((s[key] = normalizePath(v.trim() || def)), save())));
    loc('Weekly review folder', 'Optional template: a note named Weekly Review in your templates folder with {{weekLine}} and {{weekNotes}}.', 'reviewFolder', 'Neon/Reviews');
    loc('Pin board note', 'One pin per line. Made the first time you pin something.', 'pinBoardPath', 'Neon/Pin board.md');
    loc('Pinned files folder', 'Where files dropped onto the pin board from outside Obsidian are saved.', 'pinnedFolder', 'Neon/Pinned');
    loc('Bridge note folder', 'Where the graph saves bridge notes.', 'bridgeFolder', 'Neon/Bridges');
    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Comma-separated, e.g. an archive folder. Ignored by stats, the graph, tasks and projects.')
      .addText((t) => t.setPlaceholder('4.Archive').setValue(s.excludeFolders).onChange((v) => ((s.excludeFolders = v), (p._ex = null), save())));
    new Setting(containerEl)
      .setName('Ignore the templates folder')
      .setDesc(`The folders set in the core Templates plugin and Templater${p.tplFolders.length ? ` (${p.tplFolders.join(', ')})` : ''}, so template tasks and properties never count.`)
      .addToggle((t) => t.setValue(s.excludeTemplates).onChange((v) => ((s.excludeTemplates = v), (p._ex = null), save())));

    new Setting(containerEl)
      .setName('Ignore archive folders')
      .setDesc('Top-level folders with “archive” in their name (e.g. 4.Archive).')
      .addToggle((t) => t.setValue(s.excludeArchive).onChange((v) => ((s.excludeArchive = v), (p._ex = null), save())));

    new Setting(containerEl).setName('Daily notes').setHeading();
    const coreDaily = corePluginOn(p.app, 'daily-notes');
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: coreDaily
        ? `Obsidian’s core Daily notes plugin is on, so its settings are used (folder “${dailyOpts(p.app).folder || '/'}”, format “${dailyOpts(p.app).format}”). The settings below apply only when it is off.`
        : 'Obsidian’s core Daily notes plugin is off, so these settings are used. A format may include folders, e.g. YYYY/YYYY-ww for weekly notes.',
    });
    const daily = (name, key, ph) =>
      new Setting(containerEl).setName(name).addText((t) => t.setPlaceholder(ph).setValue(s[key]).onChange((v) => ((s[key] = v.trim()), p.applyDailyFallback(), save())));
    daily('Folder', 'dailyFolder', 'e.g. Daily');
    daily('File name format', 'dailyFormat', 'YYYY-MM-DD');
    daily('Template', 'dailyTemplate', 'e.g. templates/daily.md');

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
    madeWith(containerEl, 'Neon Deck');
  }
}

