Object.assign(NeonResearch.prototype, {
  /** A topic (or a subtopic inside `parent`): a folder. */
  newTopic(parent) {
    new PromptModal(this.app, {
      title: parent && parent.path !== this.root ? `New subtopic in ${parent.name}` : 'New topic',
      placeholder: 'e.g. Biology',
      cta: 'Create',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name) return;
        const base = parent ? parent.path : this.root;
        if (!base) return new Notice('Choose a folder for this section first');
        if (base.includes('*')) return new Notice('This section covers several folders: use + on one of them (e.g. a customer) to add a topic there');
        await ensureFolder(this.app, base);
        const path = normalizePath(`${base}/${name}`);
        if (this.app.vault.getAbstractFileByPath(path)) return new Notice(`“${name}” already exists here`);
        await this.app.vault.createFolder(path);
        if (parent) this.toggleOpen(parent.path, true);
        this.toggleOpen(path, true);
      },
    }).open();
  },
  newNote(folder) {
    new PromptModal(this.app, {
      title: `New note in ${folder.name}`,
      placeholder: 'e.g. Cell membrane',
      cta: 'Create',
      onSubmit: async (v) => {
        if (!v.trim()) return;
        const f = await createUnique(this.app, folder.path, v, await this.newNoteBody(v.trim()));
        this.toggleOpen(folder.path, true);
        openFile(this.app, f);
      },
    }).open();
  },
  rename(item) {
    const isFile = item instanceof TFile;
    new PromptModal(this.app, {
      title: `Rename ${isFile ? 'note' : 'topic'}`,
      value: isFile ? item.basename : item.name,
      cta: 'Rename',
      onSubmit: async (v) => {
        const name = safeName(v);
        if (!name || name === (isFile ? item.basename : item.name)) return;
        const dest = normalizePath(`${item.parent.path}/${name}${isFile ? '.' + item.extension : ''}`);
        if (this.app.vault.getAbstractFileByPath(dest)) return new Notice(`“${name}” already exists here`);
        await this.app.fileManager.renameFile(item, dest); // links to it are updated
      },
    }).open();
  },
  /** Delete a note or a topic (with everything inside) — to the system trash, after asking. */
  remove(item) {
    const isFile = item instanceof TFile;
    const n = isFile ? 1 : this.notesUnder(item).length;
    const subs = isFile ? 0 : (() => {
      let k = 0;
      const walk = (x) => (x.children || []).forEach((c) => c instanceof TFolder && (k++, walk(c)));
      walk(item);
      return k;
    })();
    new ConfirmModal(this.app, {
      title: isFile ? `Delete “${item.basename}”?` : `Delete topic “${item.name}”?`,
      text: isFile
        ? 'The note goes to the system trash; you can restore it from there.'
        : `It goes to the system trash with ${n} note${n === 1 ? '' : 's'}${subs ? ` and ${subs} subtopic${subs === 1 ? '' : 's'}` : ''} inside; you can restore it from there.`,
      cta: 'Delete',
      onConfirm: async () => {
        await this.app.vault.trash(item, true);
        new Notice(`Deleted “${isFile ? item.basename : item.name}” (system trash)`);
      },
    }).open();
  },
  onRename(f, old) {
    // open folders follow a rename or move (also of a parent folder)
    const move = (p) => (p === old ? f.path : p.startsWith(old + '/') ? f.path + p.slice(old.length) : p);
    this.settings.open = this.settings.open.map(move);
    this.saveSoon();
    this.emitSoon();
  },
  /**
   * Text of a note made from the Research tab (fork). With a template note set: its text, with
   * {{title}}, {{date}} and {{time}} filled in (Templater, if you use it, runs on the new file as usual).
   * Without one: properties in the vault's usual shape (title, created, modified, status, tags).
   */
  async newNoteBody(title) {
    const s = this.settings;
    const now = moment();
    if (s.noteTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.noteTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.noteTemplate));
      try {
        if (tf instanceof TFile) return applyTemplate(await this.app.vault.read(tf), now, title);
      } catch (e) {
        console.error('Neon Research: could not read the template', e);
      }
      new Notice(`Research template “${s.noteTemplate}” not found: using the standard properties`);
    }
    return researchFrontmatter(title, now.format('YYYY-MM-DD'), s);
  },

});

/** Properties for a new research note without a template (fork). */
function researchFrontmatter(title, day, s) {
  const q = (v) => (/^[\w .-]+$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v));
  const lines = ['---', `title: ${q(title)}`, `created: ${day}`, `modified: ${day}`];
  if (s.newStatus) lines.push(`${s.statusProperty || 'status'}: ${q(s.newStatus)}`);
  const tags = statusList(s.newNoteTags);
  if (tags.length) lines.push('tags:', ...tags.map((t) => `  - ${q(t.replace(/^#/, ''))}`));
  if (!s.countAsWork) lines.push('untracked: true');
  lines.push('---', '');
  return lines.join('\n');
}
