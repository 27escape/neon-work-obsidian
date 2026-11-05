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
        const body = this.settings.countAsWork ? '' : '---\nuntracked: true\n---\n';
        const f = await createUnique(this.app, folder.path, v, body);
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
    if (this.cardText.has(old)) (this.cardText.set(f.path, this.cardText.get(old)), this.cardText.delete(old));
    // quiz history and open folders follow a rename or move (also of a parent folder)
    const move = (p) => (p === old ? f.path : p.startsWith(old + '/') ? f.path + p.slice(old.length) : p);
    const cards = this.settings.cards;
    for (const id of Object.keys(cards)) {
      const [path, ...q] = id.split('|');
      const np = move(path);
      if (np !== path) ((cards[[np, ...q].join('|')] = cards[id]), delete cards[id]);
    }
    for (const k of [...this.cardText.keys()]) {
      const nk = move(k);
      if (nk !== k) (this.cardText.set(nk, this.cardText.get(k)), this.cardText.delete(k));
    }
    this.settings.open = this.settings.open.map(move);
    this.saveSoon();
    this.emitSoon();
  },

});
