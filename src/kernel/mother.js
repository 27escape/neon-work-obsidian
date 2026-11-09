/* ---- Neon Deck 2: one plugin; each module is a child Plugin ------------------------
 * The former six plugins run unchanged as children (same command ids, view types and data).
 * Obsidian's own Plugin/Component lifecycle removes everything a child registered when it
 * stops, so a module can be switched off at runtime without leaks. NEON_MODULES is filled
 * in by the build (tools/build.mjs). */
const KERNEL_FILE = 'modules.json'; // { off: { 'neon-time': true }, starting: bool, safe: bool }

class NeonMother extends Plugin {
  async onload() {
    this.modules = new Map(); // id -> running child plugin
    this.failed = new Map(); // id -> error message
    this.state = Object.assign({ off: {}, starting: false, safe: false }, await this.readState());
    const crashed = this.state.starting; // the last start never finished
    this.state.starting = true;
    if (crashed) this.state.safe = true; // stays on until turned off in settings
    // coming from 1.x (old plugin data present): keep the hotkeys 1.x set by default, once
    this.upgrading = !this.state.keysKept && (await Promise.all(NEON_MODULES.map((m) => this.app.vault.adapter.exists(`${this.app.vault.configDir}/plugins/${m.id}/data.json`)))).some(Boolean);
    this.state.keysKept = true;
    await this.writeState();
    this.addSettingTab(new NeonModulesTab(this.app, this));
    this.addCommand({ id: 'safe-mode', name: 'Restart in safe mode (modules off)', callback: () => this.setSafe(true) });
    if (crashed || this.state.safe) {
      new Notice(crashed ? 'Neon Deck did not finish starting last time: safe mode, modules are off. Turn safe mode off in Settings → Neon Deck modules.' : 'Neon Deck safe mode: modules are off.', 0);
    } else for (const m of NEON_MODULES) await this.start(m);
    // modules finish starting asynchronously: only call the start done once the workspace is ready
    this.app.workspace.onLayoutReady(() => (this.doneTimer = window.setTimeout(() => this.startDone(), 3000)));
  }
  onunload() {
    // a normal unload (quit, reload, switched off) is not a crash, however soon after the start
    window.clearTimeout(this.doneTimer);
    this.startDone();
  }
  startDone() {
    if (!this.state.starting) return;
    this.state.starting = false;
    return this.writeState();
  }
  /** Core API for the modules (same object Neon Deck 1.x exposed). */
  get api() {
    const deck = this.modules.get('neon-deck');
    return (deck && deck.api) || null;
  }
  isOn(id) {
    return !this.state.off[id];
  }
  async start(m) {
    if (this.modules.has(m.id) || !this.isOn(m.id)) return;
    // the old separate plugin is still on: never run two copies
    if (m.id !== 'neon-deck' && this.app.plugins.enabledPlugins.has(m.id)) {
      this.failed.set(m.id, `turn off the old "${m.old}" plugin, then reload`);
      new Notice(`${m.name} is now part of Neon Deck. Turn off the old ${m.old} plugin in Community plugins, then reload.`, 0);
      return;
    }
    const dir = m.id === 'neon-deck' ? this.manifest.dir : `${this.manifest.dir}/${m.id.replace('neon-', '')}`;
    try {
      await this.adoptData(m.id, dir);
      const child = new m.cls(this.app, { ...this.manifest, id: m.id, name: m.name, dir, fontsInCss: true });
      // no default hotkeys (community rule); people upgrading from 1.x get them as their own, once
      const add = child.addCommand;
      child.addCommand = (c) => {
        if (c.hotkeys) {
          if (this.upgrading) this.keepHotkey(`${m.id}:${c.id}`, c.hotkeys);
          delete c.hotkeys;
        }
        return add.call(child, c);
      };
      // a failing start stops only this module
      const load = child.onload;
      child.onload = async () => {
        try {
          await load.call(child);
        } catch (e) {
          console.error(`Neon Deck: ${m.name} failed to start`, e);
          this.failed.set(m.id, String((e && e.message) || e));
          new Notice(`Neon Deck: ${m.name} failed to start and was stopped. Details in the console.`);
          window.setTimeout(() => this.stop(m.id), 0);
        }
      };
      this.modules.set(m.id, child);
      this.failed.delete(m.id);
      this.addChild(child); // runs child.load() -> onload()
    } catch (e) {
      console.error(`Neon Deck: ${m.name} failed to start`, e);
      this.failed.set(m.id, String((e && e.message) || e));
    }
  }
  stop(id) {
    const child = this.modules.get(id);
    if (!child) return;
    this.modules.delete(id);
    this.removeChild(child); // runs child.unload() -> onunload() + every register() cleanup
  }
  async setOn(id, on) {
    if (on) delete this.state.off[id];
    else this.state.off[id] = true;
    await this.writeState();
    const m = NEON_MODULES.find((x) => x.id === id);
    if (on) await this.start(m);
    else this.stop(id);
  }
  async setSafe(on) {
    this.state.safe = on;
    await this.writeState();
    new Notice(on ? 'Neon Deck: safe mode on. Reload Obsidian (or the plugin) to apply.' : 'Neon Deck: safe mode off. Reload to start the modules.');
  }
  /** A 1.x default hotkey becomes the user's own (unless they already set one for that command). */
  keepHotkey(id, keys) {
    const hm = this.app.hotkeyManager;
    if (!hm || !hm.setHotkeys || hm.getHotkeys(id)) return;
    hm.setHotkeys(id, keys);
    if (hm.save) hm.save();
  }
  /** First start of a module: copy the settings of the old separate plugin (never move or delete it). */
  async adoptData(id, dir) {
    const fs = this.app.vault.adapter;
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
    if (id === 'neon-deck' || (await fs.exists(`${dir}/data.json`))) return;
    const old = normalizePath(`${this.app.vault.configDir}/plugins/${id}/data.json`);
    if (await fs.exists(old)) {
      await fs.write(`${dir}/data.json`, await fs.read(old));
    }
  }
  async readState() {
    try {
      return JSON.parse(await this.app.vault.adapter.read(`${this.manifest.dir}/${KERNEL_FILE}`));
    } catch (e) {
      return {};
    }
  }
  async writeState() {
    await this.app.vault.adapter.write(`${this.manifest.dir}/${KERNEL_FILE}`, JSON.stringify(this.state, null, 2));
  }
}

/** Settings: one switch per module, with its state. Each module keeps its own settings tab. */
class NeonModulesTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // its own id: the Deck module's settings tab already uses 'neon-deck'
    this.id = 'neon-deck-modules';
    this.name = 'Neon Deck modules';
  }
  display() {
    const p = this.plugin;
    const el = this.containerEl;
    el.empty();
    el.addClass('nd-settings');
    new Setting(el).setName('Modules').setHeading();
    for (const m of NEON_MODULES) {
      const why = p.failed.get(m.id);
      const state = p.modules.has(m.id) ? 'running' : why ? `stopped: ${why}` : p.state.safe ? 'off (safe mode)' : 'off';
      new Setting(el)
        .setName(m.name)
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
      .setDesc('Start with every module off. Turns on by itself if Neon Deck crashed while starting.')
      .addToggle((t) => t.setValue(p.state.safe).onChange((v) => p.setSafe(v)));
    madeWith(el, 'Neon Deck');
  }
}
