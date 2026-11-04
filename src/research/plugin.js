/* ---- plugin ------------------------------------------------------------------ */
class NeonResearch extends Plugin {
  async onload() {
    const raw = (await this.loadData()) || {};
    this.settings = Object.assign({}, NR_DEFAULTS, raw);
    if (!Array.isArray(this.settings.open)) this.settings.open = [];
    if (!this.settings.cards || typeof this.settings.cards !== 'object') this.settings.cards = {};
    const s = this.settings;
    if (!Array.isArray(s.roots) || !s.roots.length) s.roots = [{ name: 'Research', path: normalizePath(s.root || NR_DEFAULTS.root) }, { name: 'School', path: 'Learning/School' }];
    s.roots = s.roots.filter((r) => r && typeof r.path === 'string' && r.path.trim()).map((r) => ({ name: String(r.name || r.path.split('/').pop()), path: normalizePath(r.path) }));
    if (!s.roots.length) s.roots = [{ name: 'Research', path: NR_DEFAULTS.root }];
    if (!(s.activeRoot >= 0 && s.activeRoot < s.roots.length)) s.activeRoot = 0;
    s.root = s.roots[0].path;
    this.cardCache = new Map(); // path -> { text, cards }: each note is parsed once per change
    this.listeners = new Set();
    this.cardText = new Map();
    this.registerView(VIEW_RESEARCH, (leaf) => new ResearchView(leaf, this));
    this.addRibbonIcon('library', 'Research', () => this.openTab());
    this.addCommand({ id: 'open-research', name: 'Open the Research tab', callback: () => this.openTab() });
    this.addCommand({ id: 'new-topic', name: 'New topic', callback: () => this.newTopic(this.rootFolder()) });
    this.addCommand({ id: 'quiz-all', name: 'Quiz me…', callback: () => new QuizPickModal(this).open() });
    this.addCommand({
      id: 'add-flashcard',
      name: 'Add flashcard to this note',
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== 'md' || !this.inRoot(f)) return false;
        if (!checking) new FlashcardModal(this, f).open();
        return true;
      },
    });
    // a Flashcards button in the header of notes inside a section
    const syncButtons = () => this.app.workspace.getLeavesOfType('markdown').forEach((l) => this.syncCardButton(l.view));
    this.registerEvent(this.app.workspace.on('file-open', syncButtons));
    this.registerEvent(this.app.workspace.on('active-leaf-change', syncButtons));
    this.app.workspace.onLayoutReady(syncButtons);
    this.register(() => this.app.workspace.getLeavesOfType('markdown').forEach((l) => l.view.nrCardBtn && (l.view.nrCardBtn.remove(), (l.view.nrCardBtn = null))));
    this.addCommand({ id: 'link-suggestions', name: 'Suggest links in this note', callback: () => this.showLinkSuggestions(true) });
    this.addSettingTab(new NeonResearchSettingTab(this.app, this));

    // status bar: "N possible links" for the open research note
    this.linkEl = this.addStatusBarItem();
    this.linkEl.addClass('nd-status', 'nr-status', 'mod-clickable');
    this.linkEl.addEventListener('click', () => this.showLinkSuggestions(true));
    this.linkEl.hide();
    const hint = debounce(() => this.updateLinkHint(), 800, true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', hint));
    // quiz-card text cache, kept current from the change event (it hands over the note's text)
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, data) => {
        if (!this.inRoot(f)) return;
        this.noteText(f, data);
        hint();
      }),
    );
    const anyChange = (f) => (this.inRoot(f) || f instanceof TFolder) && this.emitSoon();
    this.registerEvent(this.app.vault.on('create', anyChange));
    this.registerEvent(
      this.app.vault.on('delete', (f) => {
        for (const p of [...this.cardText.keys()]) if (p === f.path || p.startsWith(f.path + '/')) (this.cardText.delete(p), this.cardCache.delete(p));
        // forget quiz history of deleted notes, and the open state of deleted folders
        for (const id of Object.keys(this.settings.cards)) if (id.startsWith(f.path + '|') || id.startsWith(f.path + '/')) delete this.settings.cards[id];
        this.settings.open = this.settings.open.filter((x) => x !== f.path && !x.startsWith(f.path + '/'));
        this.saveSoon();
        this.emitSoon();
      }),
    );
    this.registerEvent(this.app.vault.on('rename', (f, old) => this.onRename(f, old)));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookDeck()));
    this.app.workspace.onLayoutReady(async () => {
      this.hookDeck();
      this.updateLinkHint();
      await this.refreshCardText();
      this.emitSoon();
    });
  }
  onunload() {
    if (this._save) (this._save.cancel(), this.saveData(this.settings)); // don't lose the last 1.5 s of changes
    const api = deckApi(this.app);
    if (api) api.unregisterAction('research');
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  saveSoon() {
    if (!this._save) this._save = debounce(() => this.saveData(this.settings), 1500, true);
    this._save();
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit) this._emit = debounce(() => this.listeners.forEach((fn) => fn()), 120, true);
    this._emit();
  }
  hookDeck() {
    const api = deckApi(this.app);
    if (api) api.registerAction({ id: 'research', icon: 'library', label: 'Research', order: 45, view: VIEW_RESEARCH, run: () => this.openTab() });
  }
  openTab() {
    return activateView(this.app, VIEW_RESEARCH, 'tab');
  }

  /* ---- the tree ---- */
  /** Path of the root shown in the tab. */
  get root() {
    return this.settings.roots[this.settings.activeRoot].path;
  }
  rootFolder(path = this.root) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFolder ? f : null;
  }
  /** The root a file lives in (any root, not only the shown one), or null. */
  rootOf(f) {
    return (f && this.settings.roots.find((r) => f.path.startsWith(r.path + '/'))) || null;
  }
  inRoot(f) {
    return !!this.rootOf(f);
  }
  setActiveRoot(i) {
    if (i === this.settings.activeRoot || !this.settings.roots[i]) return;
    this.settings.activeRoot = i;
    this.saveSoon();
    this.emitSoon();
  }
  notesUnder(folder) {
    if (!folder) return [];
    const out = [];
    const walk = (x) => {
      for (const c of x.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') out.push(c);
      }
    };
    walk(folder);
    return out;
  }
  researchNotes(path = this.root) {
    return this.notesUnder(this.rootFolder(path));
  }
  allNotes() {
    return this.settings.roots.flatMap((r) => this.researchNotes(r.path));
  }
  isOpen(path) {
    return this.settings.open.includes(path);
  }
  /** Remember a folder's open state without redrawing (the tree updates itself). */
  setOpen(path, open) {
    this.settings.open = this.settings.open.filter((x) => x !== path);
    if (open) this.settings.open.push(path);
    this.saveSoon();
  }
  toggleOpen(path, force) {
    const open = force != null ? force : !this.isOpen(path);
    this.settings.open = this.settings.open.filter((x) => x !== path);
    if (open) this.settings.open.push(path);
    this.saveSoon();
    this.emitSoon();
  }
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
  }
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
  }
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
  }
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
  }
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
  }

  /* ---- link suggestions ---- */
  async linkHits(file) {
    const text = await this.app.vault.cachedRead(file);
    const mask = plainMask(text);
    const linked = this.app.metadataCache.resolvedLinks[file.path] || {};
    const r = this.rootOf(file);
    const targets = (r ? this.researchNotes(r.path) : []).filter((t) => t !== file && !linked[t.path] && t.basename.length >= 4);
    if (!targets.length) return [];
    // one pass over the note for all titles (longest first), instead of one regex per research note
    const byName = new Map();
    for (const t of targets) if (!byName.has(t.basename.toLowerCase())) byName.set(t.basename.toLowerCase(), t);
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escRe);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${names.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    const hits = [];
    for (const m of mask.matchAll(re)) {
      const t = byName.get(m[2].toLowerCase());
      if (!t || hits.some((h) => h.target === t)) continue;
      const at = m.index + m[1].length;
      const match = text.slice(at, at + m[2].length);
      hits.push({ target: t, at, match, before: text.slice(Math.max(0, at - 40), at).replace(/\s+/g, ' '), after: text.slice(at + match.length, at + match.length + 40).replace(/\s+/g, ' ') });
    }
    return hits;
  }
  async updateLinkHint() {
    const el = this.linkEl;
    if (!el) return;
    const f = this.app.workspace.getActiveFile();
    if (!this.settings.linkSuggest || !f || !this.inRoot(f)) return el.hide();
    const hits = await this.linkHits(f);
    if (this.app.workspace.getActiveFile() !== f) return;
    el.empty();
    if (!hits.length) return el.hide();
    setIcon(el.createSpan('nd-status-icon'), 'link');
    el.createSpan({ cls: 'nd-status-text', text: `${hits.length} possible link${hits.length === 1 ? '' : 's'}` });
    tip(el, 'Words that match other research notes — click to link them');
    el.show();
  }
  async showLinkSuggestions(fromUser) {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const hits = this.inRoot(f) ? await this.linkHits(f) : [];
    if (!hits.length) return fromUser && new Notice('No unlinked mentions of research notes here.');
    new LinkSuggestModal(this, f, hits).open();
  }
  async linkMention(file, target) {
    await writeNote(this.app, file, (text) => {
      const mask = plainMask(text);
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escRe(target.basename)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
      const m = re.exec(mask);
      if (!m) return text;
      const at = m.index + m[1].length;
      const as = text.slice(at, at + target.basename.length);
      const link = as === target.basename ? `[[${target.basename}]]` : `[[${target.basename}|${as}]]`;
      return text.slice(0, at) + link + text.slice(at + as.length);
    });
    window.setTimeout(() => this.updateLinkHint(), 600);
  }

  syncCardButton(view) {
    const want = !!(view && view.file && this.inRoot(view.file));
    if (want && !view.nrCardBtn) view.nrCardBtn = view.addAction('layers', 'Add flashcards', () => view.file && new FlashcardModal(this, view.file).open());
    else if (!want && view && view.nrCardBtn) (view.nrCardBtn.remove(), (view.nrCardBtn = null));
  }
  /** Append one card line to a note: through the editor when it's open (keeps cursor and undo), else in the file. */
  async appendCard(file, line) {
    const leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === file && l.view.editor);
    if (leaf) {
      const ed = leaf.view.editor;
      const last = ed.lastLine();
      const end = { line: last, ch: ed.getLine(last).length };
      ed.replaceRange((ed.getLine(last).trim() ? '\n' : '') + line + '\n', end);
      return;
    }
    await writeNote(this.app, file, (d) => d.replace(/\s*$/, '') + `\n${line}\n`);
  }

  /* ---- quiz cards ---- */
  parseCards(f, text) {
    const out = [];
    let fence = false;
    for (const line of stripFrontmatter(text).split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence || /^\s*%%/.test(line)) continue;
      // a "::" inside inline code doesn't make a card
      if (!/\s::\s/.test(line.replace(/`[^`]*`/g, (c) => ' '.repeat(c.length)))) continue;
      const m = line.match(CARD_RE);
      if (!m || /^#/.test(m[1])) continue;
      const q = m[1].trim();
      // the same question twice in a note: each keeps its own history
      const n = out.filter((c) => c.q === q).length;
      out.push({ file: f, q, a: m[2].trim(), id: `${f.path}|${q}${n ? `#${n + 1}` : ''}` });
    }
    return out;
  }
  cardsIn(file) {
    const text = this.cardText.get(file.path);
    if (text == null) return [];
    const c = this.cardCache.get(file.path);
    if (c && c.text === text && c.file === file) return c.cards;
    const cards = this.parseCards(file, text);
    this.cardCache.set(file.path, { text, file, cards });
    return cards;
  }
  /** New text of a research note: keep quiz history when a question was edited; redraw only if the cards changed. */
  noteText(f, text) {
    const before = this.cardsIn(f).map((c) => c.id);
    this.cardText.set(f.path, text);
    const after = this.cardsIn(f).map((c) => c.id);
    if (before.join('\n') === after.join('\n')) return this.listeners.forEach((fn) => fn(f)); // light update
    // edited questions: unchanged cards keep their history; changed ones are paired in order
    const h = this.settings.cards;
    const gone = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    if (gone.length && gone.length === added.length) {
      const old = gone.map((id) => h[id]);
      gone.forEach((id) => delete h[id]);
      added.forEach((id, i) => old[i] && !h[id] && (h[id] = old[i]));
      this.saveSoon();
    }
    this.emitSoon();
  }
  cardsUnder(folder) {
    return this.notesUnder(folder).flatMap((f) => this.cardsIn(f));
  }
  async refreshCardText() {
    const notes = this.allNotes();
    const texts = await Promise.all(notes.map((f) => this.app.vault.cachedRead(f).catch(() => '')));
    notes.forEach((f, i) => this.cardText.set(f.path, texts[i]));
  }
  dueCards(cards) {
    const now = Date.now();
    return cards.filter((c) => {
      const s = this.settings.cards[c.id];
      return !s || s.due <= now;
    });
  }
  async quiz(folder, label, allCards = false) {
    // card text is kept current by the 'changed' event; no need to re-read every note here
    const cards = folder ? this.cardsUnder(folder) : [];
    new QuizModal(this, allCards ? cards : this.dueCards(cards), label).open();
  }
  async gradeCard(card, how) {
    const cur = this.settings.cards[card.id] || { ivl: 0 };
    let ivl = cur.ivl || 0;
    let due;
    if (how === 'again') {
      ivl = 0;
      due = Date.now() + 10 * 60000;
    } else if (how === 'hard') {
      ivl = Math.max(1, Math.round(ivl * 1.2));
      due = Date.now() + ivl * DAY;
    } else {
      ivl = ivl ? Math.round(ivl * 2.5) : 3;
      due = Date.now() + ivl * DAY;
    }
    this.settings.cards[card.id] = { ivl, due };
    await this.saveSettings();
  }
}
