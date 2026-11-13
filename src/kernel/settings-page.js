/* ---- fork: one settings page ----------------------------------------------------
 * The plugin has a single page in Settings, with a section per module (Overview, Dashboard, Tasks,
 * Projects, Research, Time, Write). Each module's own settings tab is drawn inside its section, so
 * the modules keep their code; they no longer add pages of their own to the sidebar. */
const SECTION_LABEL = { 'neon-deck': 'Dashboard', 'neon-tasks': 'Tasks', 'neon-tickets': 'Projects', 'neon-research': 'Research', 'neon-time': 'Time', 'neon-write': 'Write' };

class NeonModulesTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // Obsidian finds a plugin's settings by the plugin's own id
    this.id = plugin.manifest.id;
    this.name = plugin.manifest.name;
  }
  display() {
    const p = this.plugin;
    const el = this.containerEl;
    el.empty();
    el.addClass('nd-settings', 'nd-settings-page');
    const sections = [['overview', 'Overview'], ...NEON_MODULES.map((m) => [m.id, SECTION_LABEL[m.id] || m.name])];
    let cur = p.state.settingsSection || 'overview';
    if (!sections.some(([k]) => k === cur)) cur = 'overview';
    const bar = el.createDiv('nd-pills nd-settings-sections');
    for (const [k, label] of sections) {
      const off = k !== 'overview' && !p.modules.has(k);
      const b = bar.createEl('button', { cls: 'nd-pill-btn' + (k === cur ? ' is-on' : '') + (off ? ' is-off' : ''), text: label });
      if (off) b.setAttr('aria-label', `${label} is off (switch it on in Overview)`);
      b.addEventListener('click', () => {
        p.state.settingsSection = k;
        p.writeState();
        this.display();
      });
    }
    const box = el.createDiv('nd-settings-section');
    if (cur === 'overview') return this.overview(box);
    const tab = p.moduleTabs.get(cur);
    const m = NEON_MODULES.find((x) => x.id === cur);
    if (!p.modules.has(cur) || !tab) {
      box.createEl('p', { cls: 'setting-item-description', text: `${m ? m.name : cur} is off. Switch it on in Overview to see its settings.` });
      return;
    }
    // the module's own tab draws into this section (and redraws there when it calls this.display())
    tab.containerEl = box;
    try {
      tab.display();
    } catch (e) {
      console.error(`Neon Deck: ${cur} settings`, e);
      box.createEl('p', { text: 'These settings could not be shown. Details in the console.' });
    }
  }
  overview(el) {
    const p = this.plugin;
    new Setting(el).setName('Protect my notes').setHeading();
    new Setting(el)
      .setName('Read-only')
      .setDesc('On: the plugin only reads your vault. It never creates, changes, moves, renames or deletes notes, folders or images; features that would write show a notice instead. Its own settings are still saved.')
      .addToggle((t) => t.setValue(p.state.readOnly !== false).onChange((v) => p.setReadOnly(v)));

    new Setting(el).setName('Base folder').setHeading();
    new Setting(el)
      .setName('Base folder')
      .setDesc('Where the plugin keeps what it makes for itself when a location is left empty: Projects (without a customer), Reviews, Time Log, the Todo note, the pin board and graph bridges. Empty: the vault root.')
      .addText((t) =>
        suggestPaths(
          p.app,
          t.setPlaceholder('e.g. 2.Resources').setValue(p.state.baseFolder || '').onChange(debounce((v) => p.setBaseFolder(v), 500, true)),
          'folder',
        ),
      );

    new Setting(el).setName('Modules').setHeading();
    for (const m of NEON_MODULES) {
      const why = p.failed.get(m.id);
      const state = p.modules.has(m.id) ? 'running' : why ? `stopped: ${why}` : p.state.safe ? 'off (safe mode)' : 'off';
      new Setting(el)
        .setName(SECTION_LABEL[m.id] || m.name)
        .setDesc(`${m.desc} · ${state}`)
        .addToggle((t) =>
          t.setValue(p.isOn(m.id)).onChange(async (v) => {
            await p.setOn(m.id, v);
            this.display();
          }),
        );
    }
    new Setting(el)
      .setName('Safe mode')
      .setDesc('Start with every module off. Turns on by itself if the plugin crashed while starting.')
      .addToggle((t) => t.setValue(p.state.safe).onChange((v) => p.setSafe(v)));
    madeWith(el, p.manifest.name);
  }
}

/** First start: where may Neon Deck keep what it makes for itself? */
class BaseFolderModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(`${p.manifest.name}: base folder`);
    const c = this.contentEl;
    c.createEl('p', { text: 'The plugin can keep the notes it makes for itself (projects without a customer, weekly reviews, time logs, the Todo note, the pin board) in one folder of your choice. Nothing is created until you use a feature that needs it, and every location can be changed later in the settings.' });
    const input = c.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. 2.Resources (empty: the vault root)' } });
    input.style.width = '100%';
    if (PathSuggestBase) new PathSuggest(this.app, input, 'folder');
    const row = c.createDiv('modal-button-container');
    button(row, { text: 'Use the vault root', onClick: () => this.save('') });
    button(row, { text: 'Use this folder', cls: 'mod-cta', onClick: () => this.save(input.value) });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && this.save(input.value));
    window.setTimeout(() => input.focus(), 20);
  }
  async save(v) {
    await this.plugin.setBaseFolder(v);
    this.saved = true;
    new Notice(`${appName()} base folder: ${this.plugin.state.baseFolder || 'the vault root'}`);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    // closed without choosing: ask again next start
  }
}
