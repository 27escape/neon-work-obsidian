Object.assign(NeonResearch.prototype, {
  /** Study notes get a cards button on the side (when they have cards) and a cards menu top left (issue 56). */
  syncCardButton(view) {
    const file = view && view.file && this.inRoot(view.file) ? view.file : null;
    if (!file) return this.dropCardButtons(view);
    // the menu sits after back / forward; Obsidian has no API for that spot, so fall back to a header action
    if (!view.nrCardMenu || !view.nrCardMenu.isConnected) {
      const left = view.containerEl.querySelector('.view-header-left');
      const open = (e) => this.cardMenu(view, e);
      view.nrCardMenu = left ? left.createDiv({ cls: 'clickable-icon nr-card-menu', attr: { 'aria-label': 'Flashcards and exercises' } }) : view.addAction('layers', 'Flashcards and exercises', open);
      if (left) {
        icon(view.nrCardMenu, 'layers');
        icon(view.nrCardMenu, 'chevron-down', 'nr-card-menu-chev');
        view.nrCardMenu.addEventListener('click', open);
      }
    }
    const n = this.cardsIn(file).length;
    if (!n) return view.nrCardPill && (view.nrCardPill.remove(), (view.nrCardPill = null));
    if (!view.nrCardPill || !view.nrCardPill.isConnected) {
      view.nrCardPill = view.contentEl.createDiv({ cls: 'nr-card-pill', attr: { role: 'button', tabindex: '0' } });
      icon(view.nrCardPill, 'layers');
      view.nrCardPill.createSpan('nr-card-pill-n');
      const go = () => view.file && new FlashcardModal(this, view.file).open();
      view.nrCardPill.addEventListener('click', go);
      view.nrCardPill.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go()));
    }
    view.nrCardPill.querySelector('.nr-card-pill-n').setText(String(n));
    tip(view.nrCardPill, `${n} card${n === 1 ? '' : 's'} in this note`);
  },
  dropCardButtons(view) {
    if (!view) return;
    if (view.nrCardMenu) (view.nrCardMenu.remove(), (view.nrCardMenu = null));
    if (view.nrCardPill) (view.nrCardPill.remove(), (view.nrCardPill = null));
  },
  cardMenu(view, e) {
    const f = view.file;
    if (!f) return;
    const n = this.cardsIn(f).length;
    const m = new Menu();
    m.addItem((i) => i.setTitle('Add flashcard').setIcon('layers').onClick(() => new FlashcardModal(this, f, false).open()));
    m.addItem((i) => i.setTitle('Add exercise').setIcon('pencil-line').onClick(() => new FlashcardModal(this, f, true).open()));
    m.addSeparator();
    m.addItem((i) => i.setTitle(`Show cards (${n})`).setIcon('list').onClick(() => new FlashcardModal(this, f).open()));
    m.addItem((i) => i.setTitle('Quiz this note').setIcon('graduation-cap').setDisabled(!n).onClick(() => this.quizNote(f)));
    m.showAtMouseEvent(e);
  },
  quizNote(f) {
    new QuizModal(this, this.cardsIn(f), f.basename).open();
  },
  /** Add one card line to the note's hidden card block (through the editor when it's open: keeps undo). */
  async appendCard(file, line) {
    await writeNote(this.app, file, (t) => addToCardBlock(t, line));
  },
  /** Edit (line) or delete (null) one card of a note. */
  async setCard(card, line) {
    await writeNote(this.app, card.file, (t) => setCardLine(t, card, line));
  },
  async moveCardsOffPage(file) {
    await writeNote(this.app, file, (t) => moveCardsToBlock(t, this.parseCards(file, t)));
  },

  /* ---- quiz cards ---- */
  parseCards(f, text) {
    const out = [];
    const lines = text.split('\n');
    const start = text.slice(0, text.length - stripFrontmatter(text).length).split('\n').length - 1;
    let fence = null; // null, 'cards' (the hidden neon-cards block) or 'other' (code: no cards)
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) {
        fence = fence ? null : CARD_FENCE_RE.test(line) ? 'cards' : 'other';
        continue;
      }
      if (fence === 'other' || /^\s*%%/.test(line)) continue;
      // a "::" inside inline code doesn't make a card
      if (!/\s:::?\s/.test(line.replace(/`[^`]*`/g, (c) => ' '.repeat(c.length)))) continue;
      const m = line.match(CARD_RE);
      if (!m || /^#/.test(m[1])) continue;
      const q = m[1].trim();
      // the same question twice in a note: each keeps its own history
      const n = out.filter((c) => c.q === q).length;
      out.push({ file: f, q, a: m[3].trim(), type: m[2] === ':::', hidden: fence === 'cards', ln: i, raw: line, id: `${f.path}|${q}${n ? `#${n + 1}` : ''}` });
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
    if (before.join('\n') !== after.join('\n')) this.syncButtons(f);
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
