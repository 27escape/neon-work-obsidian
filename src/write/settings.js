/* ---- settings ---------------------------------------------------------- */
class NeonWriteSettingTab extends PluginSettingTab {
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
    new Setting(containerEl).setName('Slash menu').setDesc('Type / at the start of a line or after a space: table, headings, lists, callout, code, divider, date.').addToggle((t) => t.setValue(s.slashMenu).onChange((v) => ((s.slashMenu = v), p.saveSettings())));
    new Setting(containerEl).setName('Toolbar on selected text').setDesc('Bold, italic, strikethrough, highlight, code, link, heading and callout.').addToggle((t) => t.setValue(s.toolbar).onChange((v) => ((s.toolbar = v), p.saveSettings(), p.toolbar && p.toolbar.hide())));
    new Setting(containerEl)
      .setName('Move new images to the image folder')
      .setDesc('New .png, .jpg and .jpeg files (pasted, dragged or copied in) move to the image folder below. Links to them keep working. Off by default.')
      .addToggle((t) => t.setValue(s.moveImages).onChange((v) => ((s.moveImages = v), p.saveSettings())))
      .addExtraButton((b) => b.setIcon('folder-input').setTooltip('Move existing images there now').onClick(() => p.moveExistingImages()));
    new Setting(containerEl)
      .setName('Image folder')
      .setDesc('Used only by the two image options above.')
      .addText((t) => t.setPlaceholder('Neon/Images').setValue(s.imageFolder).onChange((v) => ((s.imageFolder = normalizePath(v.trim() || 'Neon/Images')), p.saveSettings())));
    new Setting(containerEl)
      .setName('Lifted writing window')
      .setDesc('The note sits on a rounded, slightly raised card, with the pattern around it.')
      .addToggle((t) => t.setValue(s.liftedWindow).onChange((v) => ((s.liftedWindow = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Theme fonts in notes')
      .setDesc('Body text, headings and code use the fonts of the Neon theme you picked on the dashboard.')
      .addToggle((t) => t.setValue(s.themeFonts).onChange((v) => ((s.themeFonts = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Styled tables')
      .setDesc('Tables in notes get a rounded card, a tinted header and soft row lines in the theme colours.')
      .addToggle((t) => t.setValue(s.styledTables).onChange((v) => ((s.styledTables = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Lime dividers')
      .setDesc('A --- line in a note is drawn as a thin lime line that fades out at both ends. Also keeps --- typed under text a divider instead of a heading.')
      .addToggle((t) => t.setValue(s.limeDividers).onChange((v) => ((s.limeDividers = v), p.saveSettings(), p.applyLook())));
    new Setting(containerEl)
      .setName('Pattern behind notes')
      .setDesc('The dashboard pattern, dimmed right down, behind the note you are writing. Needs Neon Deck.')
      .addToggle((t) => t.setValue(s.notePattern).onChange((v) => ((s.notePattern = v), p.saveSettings(), p.mountNotePattern())));
    new Setting(containerEl)
      .setName('Pattern strength behind notes')
      .setDesc('Percent of the dashboard pattern. Low values are barely visible.')
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(s.patternOpacity).setDynamicTooltip().onChange((v) => ((s.patternOpacity = v), p.saveSettings(), p.applyPatternOpacity())));
    madeWith(containerEl, 'Neon Write');
  }
}

