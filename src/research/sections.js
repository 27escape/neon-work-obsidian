/** Pick a folder for a new section: any vault folder, or a new one named by what you type. */
class SectionPickModal extends SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setPlaceholder('Folder for the new section (type to search, or a new folder path)');
  }
  getSuggestions(q) {
    const t = q.trim().toLowerCase();
    const folders = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== '/' && f.path.toLowerCase().includes(t));
    const out = folders.slice(0, 100).map((f) => ({ path: f.path }));
    if (t && !folders.some((f) => f.path.toLowerCase() === t)) out.unshift({ path: normalizePath(q.trim()), create: true });
    return out;
  }
  renderSuggestion(s, el) {
    el.setText(s.create ? `Create folder “${s.path}”` : s.path);
  }
  onChooseSuggestion(s) {
    this.plugin.addSection(s.path);
  }
}

Object.assign(NeonResearch.prototype, {
  /** + in the section switch: choose or create a folder, then switch to it. */
  pickSection() {
    new SectionPickModal(this).open();
  },
  async addSection(path) {
    const s = this.settings;
    path = normalizePath(path);
    const have = s.roots.findIndex((r) => r.path === path);
    if (have >= 0) return this.setActiveRoot(have); // already a section: just go there
    // nested sections would claim the same notes twice (quiz counts, history)
    const clash = s.roots.find((r) => path.startsWith(r.path + '/') || r.path.startsWith(path + '/'));
    if (clash) return new Notice(`“${path}” overlaps the section “${clash.name}” (${clash.path})`);
    await ensureFolder(this.app, path);
    s.roots.push({ name: path.split('/').pop(), path });
    s.activeRoot = s.roots.length - 1;
    await this.saveSettings();
    await this.refreshCardText(); // quiz cards of the new section
    this.emitSoon();
  },
  /** Right-click on a section: rename it, or take it out of the switch (its notes stay). */
  sectionMenu(i, e) {
    const s = this.settings;
    const r = s.roots[i];
    const m = new Menu();
    m.addItem((it) =>
      it.setTitle('Rename section…').setIcon('pencil').onClick(() =>
        new PromptModal(this.app, {
          title: 'Rename section',
          value: r.name,
          cta: 'Rename',
          onSubmit: async (v) => {
            if (!v.trim()) return;
            r.name = v.trim();
            await this.saveSettings();
            this.emitSoon();
          },
        }).open(),
      ),
    );
    if (s.roots.length > 1)
      m.addItem((it) =>
        it.setTitle('Remove from the switch (notes stay)').setIcon('x').onClick(async () => {
          s.roots.splice(i, 1);
          if (s.activeRoot >= s.roots.length || s.activeRoot === i) s.activeRoot = 0;
          else if (s.activeRoot > i) s.activeRoot--;
          s.root = s.roots[0].path;
          await this.saveSettings();
          this.emitSoon();
        }),
      );
    m.showAtMouseEvent(e);
  },
});
