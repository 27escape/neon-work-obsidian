Object.assign(NeonResearch.prototype, {
  syncCardButton(view) {
    const want = !!(view && view.file && this.inRoot(view.file));
    if (want && !view.nrCardBtn) view.nrCardBtn = view.addAction('layers', 'Add flashcards', () => view.file && new FlashcardModal(this, view.file).open());
    else if (!want && view && view.nrCardBtn) (view.nrCardBtn.remove(), (view.nrCardBtn = null));
  },
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
  },

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
  },
  cardsIn(file) {
    const text = this.cardText.get(file.path);
    if (text == null) return [];
    const c = this.cardCache.get(file.path);
    if (c && c.text === text && c.file === file) return c.cards;
    const cards = this.parseCards(file, text);
    this.cardCache.set(file.path, { text, file, cards });
    return cards;
  },
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
  },
  cardsUnder(folder) {
    return this.notesUnder(folder).flatMap((f) => this.cardsIn(f));
  },
  async refreshCardText() {
    const notes = this.allNotes();
    const texts = await Promise.all(notes.map((f) => this.app.vault.cachedRead(f).catch(() => '')));
    notes.forEach((f, i) => this.cardText.set(f.path, texts[i]));
  },
  dueCards(cards) {
    const now = Date.now();
    return cards.filter((c) => {
      const s = this.settings.cards[c.id];
      return !s || s.due <= now;
    });
  },
  async quiz(folder, label, allCards = false) {
    // card text is kept current by the 'changed' event; no need to re-read every note here
    const cards = folder ? this.cardsUnder(folder) : [];
    new QuizModal(this, allCards ? cards : this.dueCards(cards), label).open();
  },
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
  },
});
