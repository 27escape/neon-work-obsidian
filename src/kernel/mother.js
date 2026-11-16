/* ---- Neon Deck 2: one plugin; each module is a child Plugin ------------------------
 * The former six plugins run unchanged as children (same command ids, view types and data).
 * Obsidian's own Plugin/Component lifecycle removes everything a child registered when it
 * stops, so a module can be switched off at runtime without leaks. NEON_MODULES is filled
 * in by the build (tools/build.mjs). */
const KERNEL_FILE = 'modules.json'; // { off: { 'neon-time': true }, readOnly: bool, baseFolder } — synced with the vault
// fork: start-up checks and safe mode are per device (this vault's local storage on this device), never synced:
// a phone and a laptop sharing .obsidian must not put each other into safe mode.
const LOCAL_KEYS = { unfinished: 'neon-work-unfinished-starts', safe: 'neon-work-safe-mode', error: 'neon-work-last-error', section: 'neon-work-settings-section', stoppedAt: 'neon-work-stopped-at', timing: 'neon-work-start-timing', step: 'neon-work-start-step' };
const UNFINISHED_LIMIT = 2; // two starts in a row that never finished (closing the app once is not a crash)

class NeonMother extends Plugin {
  async onload() {
    this.modules = new Map(); // id -> running child plugin
    this.moduleTabs = new Map(); // fork: id -> the module's settings tab, shown inside this plugin's one settings page
    neonMother = this;
    this.failed = new Map(); // id -> error message
    this.t0 = Date.now(); // fork: start-up timing, kept per device and shown in settings
    this.timing = [];
    NEON_APP.name = this.manifest.name; // fork: the UI names the plugin by its manifest name
    NEON_APP.app = this.app;
    this.state = Object.assign({ off: {}, readOnly: true }, await this.readState());
    // fork: modules get a write-guarded app; only the plugin's own folder may be written while read-only
    NEON_GUARD.allowDir = normalizePath(this.manifest.dir);
    NEON_GUARD.readOnly = this.state.readOnly !== false;
    NEON_BASE.folder = this.state.baseFolder || ''; // fork: asked on first start (see BaseFolderModal)
    this.guardedApp = guardApp(this.app);
    // fork: one shared, event-kept list of notes for every module (src/shared/note-index.js)
    neonIndex = new NoteIndex(this.app);
    this.registerEvent(this.app.metadataCache.on('changed', (f) => neonIndex && neonIndex.changed(f)));
    this.registerEvent(this.app.vault.on('delete', (f) => neonIndex && neonIndex.deleted(f)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => neonIndex && neonIndex.renamed(f, old)));
    const resolved = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(resolved);
      if (neonIndex) neonIndex.map = null; // the first full index: rebuild once from it
    });
    this.registerEvent(resolved);
    const gesture = () => (NEON_GUARD.lastGesture = Date.now());
    this.registerDomEvent(document, 'pointerdown', gesture, true);
    this.registerDomEvent(document, 'keydown', gesture, true);
    if (NEON_MOBILE.on) installLongPress(this); // fork: long press opens the row menus on phones and tablets
    // fork: count starts that never finished on this device; two in a row turn on safe mode here only
    const unfinished = Number(this.local('unfinished')) || 0;
    this.setLocal('unfinished', unfinished + 1);
    const crashed = unfinished >= UNFINISHED_LIMIT && !this.safeMode();
    if (unfinished) this.setLocal('stoppedAt', this.local('step')); // where the last unfinished start got to
    this.step('starting');
    if (crashed) this.setLocal('safe', true); // stays on (on this device) until turned off in settings
    // enabled community plugins, from the public config file (old 1.x copies must not run twice)
    try {
      this.enabled = new Set(JSON.parse(await this.app.vault.adapter.read(`${this.app.vault.configDir}/community-plugins.json`)));
    } catch (e) {
      this.enabled = new Set();
    }
    // fork: upstream Neon Deck uses the same views, commands and module ids, so the two must never run together
    if (this.manifest.id !== 'neon-deck' && this.enabled.has('neon-deck')) {
      new Notice(`${this.manifest.name}: the original Neon Deck plugin is also on. Turn one of them off in Community plugins, then reload.`, 0);
      await this.startDone(); // not a crash: no safe mode next time
      return;
    }
    await readDailyOpts(this.app);
    this.addSettingTab(new NeonModulesTab(this.app, this));
    this.addCommand({ id: 'safe-mode', name: 'Restart in safe mode (modules off)', callback: () => this.setSafe(true) });
    if (this.safeMode()) {
      const err = this.local('error');
      new Notice(
        crashed
          ? `${appName()} did not finish starting twice in a row on this device, so its modules are off here (safe mode).${this.local('stoppedAt') ? ` It stopped during: ${this.local('stoppedAt')}.` : ''}${err ? ` Last error: ${err}.` : ''} Turn safe mode off in the plugin’s settings.`
          : `${appName()} safe mode on this device: modules are off. Turn it off in the plugin’s settings.`,
        0,
      );
    } else for (const m of NEON_MODULES) await this.start(m);
    // modules finish starting asynchronously: only call the start done once the workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.step('workspace ready, opening views');
      this.doneTimer = window.setTimeout(() => this.startDone(), 3000);
      // fork: first start — ask where Neon Deck may keep what it makes for itself
      if (this.state.baseFolder === undefined) new BaseFolderModal(this).open();
    });
  }
  /** fork: the base folder for everything Neon Deck makes for itself ('' = vault root). */
  async setBaseFolder(path) {
    const v = String(path || '').trim().replace(/^\/+|\/+$/g, '');
    this.state.baseFolder = v ? normalizePath(v) : '';
    NEON_BASE.folder = this.state.baseFolder;
    await this.writeState();
  }
  onunload() {
    // a normal unload (quit, reload, switched off) is not a crash, however soon after the start
    window.clearTimeout(this.doneTimer);
    this.startDone();
    if (neonMother === this) neonMother = null;
    neonIndex = null;
  }
  /** fork: the start-up step reached, kept on the device so a hang can be traced afterwards (no console on phones). */
  step(what) {
    if (this.startedUp) return; // only while starting
    this.setLocal('step', `${what} (${((Date.now() - this.t0) / 1000).toFixed(1)} s)`);
  }
  startDone() {
    this.startedUp = true;
    this.setLocal('unfinished', 0);
    this.setLocal('step', null);
    if (this.timing) this.setLocal('timing', `${this.timing.join(' · ')}${this.timing.length ? ' · ' : ''}ready after ${((Date.now() - this.t0) / 1000).toFixed(1)} s (${moment().format('D MMM HH:mm')})`);
  }
  /* fork: per-device values (Obsidian keeps them per vault on this device; not in .obsidian, so not synced) */
  local(key) {
    const k = LOCAL_KEYS[key];
    try {
      if (this.app.loadLocalStorage) return this.app.loadLocalStorage(k);
      return JSON.parse(window.localStorage.getItem(`${this.app.vault.getName()}:${k}`));
    } catch (e) {
      return null;
    }
  }
  setLocal(key, value) {
    const k = LOCAL_KEYS[key];
    try {
      if (this.app.saveLocalStorage) this.app.saveLocalStorage(k, value == null ? null : value);
      else if (value == null) window.localStorage.removeItem(`${this.app.vault.getName()}:${k}`);
      else window.localStorage.setItem(`${this.app.vault.getName()}:${k}`, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable: start-up checks just don't persist */
    }
  }
  safeMode() {
    return this.local('safe') === true || this.local('safe') === 'true';
  }
  /** The last start-up error on this device, shown in settings (phones have no console). */
  noteError(where, e) {
    this.setLocal('error', `${where}: ${String((e && e.message) || e).slice(0, 300)} (${moment().format('D MMM HH:mm')})`);
  }
  /** Core API for the modules (same object Neon Deck 1.x exposed). */
  get api() {
    const deck = this.modules.get('neon-deck');
    return (deck && deck.api) || null;
  }
  isOn(id) {
    if (NEON_MOBILE.on && DESKTOP_ONLY_MODULES.has(id)) return false; // fork: not on phones and tablets (the saved switch is kept)
    return !this.state.off[id];
  }
  async start(m) {
    if (this.modules.has(m.id) || !this.isOn(m.id)) return;
    // the old separate plugin is still on: never run two copies
    if (m.id !== 'neon-deck' && this.enabled.has(m.id)) {
      this.failed.set(m.id, `turn off the old "${m.old}" plugin, then reload`);
      new Notice(`${m.name} is now part of ${appName()}. Turn off the old ${m.old} plugin in Community plugins, then reload.`, 0);
      return;
    }
    const dir = m.id === 'neon-deck' ? this.manifest.dir : `${this.manifest.dir}/${m.id.replace('neon-', '')}`;
    try {
      await this.adoptData(m.id, dir);
      // fork: a module is named "<plugin name> – <section>" (command palette, notices)
      const child = new m.cls(this.guardedApp, { ...this.manifest, id: m.id, name: `${this.manifest.name} – ${SECTION_LABEL[m.id] || m.name}`, dir });
      // fork: a module's settings appear as a section of this plugin's settings page, not a page of their own
      child.addSettingTab = (tab) => {
        this.moduleTabs.set(m.id, tab);
        child.register(() => this.moduleTabs.get(m.id) === tab && this.moduleTabs.delete(m.id));
      };
      // a failing start stops only this module
      const load = child.onload;
      child.onload = async () => {
        const t = Date.now();
        const label = SECTION_LABEL[m.id] || m.name;
        try {
          this.step(`${label} starting`);
          await load.call(child);
          this.step(`${label} started`);
          this.timing.push(`${label} ${Date.now() - t} ms`);
        } catch (e) {
          console.error(`Neon Deck: ${m.name} failed to start`, e);
          this.failed.set(m.id, String((e && e.message) || e));
          this.noteError(m.name, e);
          new Notice(`${appName()}: ${m.name} failed to start and was stopped. Details in the console.`);
          window.setTimeout(() => this.stop(m.id), 0);
        }
      };
      this.modules.set(m.id, child);
      this.failed.delete(m.id);
      this.addChild(child); // runs child.load() -> onload()
    } catch (e) {
      console.error(`Neon Deck: ${m.name} failed to start`, e);
      this.failed.set(m.id, String((e && e.message) || e));
      this.noteError(m.name, e);
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
  async setReadOnly(on) {
    this.state.readOnly = on;
    NEON_GUARD.readOnly = on;
    await this.writeState();
    new Notice(on ? `${appName()}: read-only on. Nothing in your vault will be changed.` : `${appName()}: read-only off. Features that write to notes now work.`);
  }
  async setSafe(on) {
    this.setLocal('safe', on ? true : null);
    if (!on) this.setLocal('unfinished', 0);
    new Notice(on ? `${appName()}: safe mode on for this device. Reload Obsidian (or the plugin) to apply.` : `${appName()}: safe mode off for this device. Reload to start the modules.`);
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
    // fork: older versions kept starting / safe / settingsSection here, so they synced between devices
    const { starting, safe, settingsSection, ...keep } = this.state;
    void starting, void safe, void settingsSection;
    await this.app.vault.adapter.write(`${this.manifest.dir}/${KERNEL_FILE}`, JSON.stringify(keep, null, 2));
  }
}
