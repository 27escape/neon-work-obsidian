/* ---- /flashcard: write cards in a popup with a live preview, then insert them at the cursor ---- */
class FlashcardInsertModal extends Modal {
  constructor(app, ed) {
    super(app);
    this.ed = ed;
    this.line = ed.getCursor().line;
    this.orig = ed.getLine(this.line);
    this.cards = []; // { line, fromLine }: fromLine = this card replaces the cursor line
    this.discarded = false;
  }
  onOpen() {
    const c = this.contentEl;
    this.modalEl.addClass('nd-modal', 'nw-fc-modal');
    this.titleEl.empty();
    setIcon(this.titleEl.createSpan('nw-fc-ico'), 'layers');
    this.titleEl.createSpan({ text: 'Flashcards' });

    const prev = c.createDiv('nw-fc-preview');
    const side = (cls, tag) => {
      const s = prev.createDiv(`nw-fc-side ${cls}`);
      s.createSpan({ cls: 'nw-fc-tag', text: tag });
      return s.createDiv('nw-fc-text');
    };
    const pq = side('is-q', 'Q');
    const pa = side('is-a', 'A');
    const field = (label, ph) => {
      const w = c.createDiv('nw-fc-field');
      w.createEl('label', { cls: 'nw-fc-label', text: label });
      return w.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: ph, 'aria-label': label } });
    };
    const q = field('Question', 'What does the mitochondrion do?');
    const a = field('Answer', 'Makes energy (ATP) for the cell');
    this.q = q;
    this.a = a;
    // the cursor line starts the first card: a plain line is its question, an existing card is edited
    const [oq, oa, isCard] = splitCard(this.orig);
    q.value = oq;
    a.value = oa;
    let fromNext = isCard || !!oq; // the next added card may replace the cursor line
    const list = c.createDiv('nw-fc-list');
    const foot = c.createDiv('nd-modal-row nw-fc-foot');
    const info = foot.createSpan({ cls: 'nw-fc-info', text: 'Enter: next field / add to list · Ctrl+Enter: insert' });
    button(foot, { text: 'Discard', onClick: () => ((this.discarded = true), this.close()) });
    const ins = button(foot, { text: 'Insert', cls: 'mod-cta', onClick: () => this.close() });

    const sync = () => {
      pq.setText(q.value.trim() || 'Your question');
      pa.setText(a.value.trim() || 'The answer');
      pq.toggleClass('is-empty', !q.value.trim());
      pa.toggleClass('is-empty', !a.value.trim());
      const n = this.cards.length + (cardLine(q.value, a.value) ? 1 : 0);
      ins.setText(n ? `Insert ${n} card${n === 1 ? '' : 's'}` : 'Insert');
      ins.disabled = !n;
      info.toggleClass('is-hidden', this.cards.length > 0);
    };
    const add = () => {
      const line = cardLine(q.value, a.value);
      if (!line) return void (q.value.trim() ? a : q).focus();
      // a plain cursor line is only replaced while its text is still the question
      const fromLine = fromNext && (isCard || q.value.trim() === oq);
      fromNext = false;
      this.cards.push({ line, fromLine });
      q.value = a.value = '';
      draw(true);
      q.focus();
    };
    const draw = (added) => {
      list.empty();
      list.toggleClass('is-empty', !this.cards.length);
      this.cards.forEach((k, i) => {
        const [kq, ka] = splitCard(k.line);
        const r = list.createDiv('nw-fc-row' + (added && i === this.cards.length - 1 ? ' is-new' : ''));
        r.createSpan({ cls: 'nw-fc-n', text: String(i + 1).padStart(2, '0') });
        r.createSpan({ cls: 'nw-fc-rq', text: kq });
        r.createSpan({ cls: 'nw-fc-ra', text: ka });
        r.setAttr('title', 'Click to edit');
        r.addEventListener('click', () => {
          if (cardLine(q.value, a.value)) add(); // keep what's in the fields first
          const j = this.cards.indexOf(k);
          if (j < 0) return;
          this.cards.splice(j, 1);
          [q.value, a.value] = splitCard(k.line);
          fromNext = k.fromLine;
          draw();
          a.focus();
        });
        button(r, { icon: 'x', cls: 'nd-icon-btn nw-fc-del', title: 'Remove card', onClick: (e) => (e.stopPropagation(), this.cards.splice(this.cards.indexOf(k), 1), draw()) });
      });
      sync();
    };
    for (const el of [q, a]) el.addEventListener('input', sync);
    const keys = (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return this.close();
      if (e.target === q && !a.value.trim()) return a.focus();
      add();
    };
    q.addEventListener('keydown', keys);
    a.addEventListener('keydown', keys);
    this.fromNext = () => fromNext && (isCard || q.value.trim() === oq);
    draw();
    window.setTimeout(() => (oq && !oa ? a : q).focus(), 20);
  }
  onClose() {
    // closing keeps the cards (Esc too), including a finished pair still in the fields; only Discard drops them
    if (!this.discarded) {
      const last = this.q && cardLine(this.q.value, this.a.value);
      if (last) this.cards.push({ line: last, fromLine: this.fromNext() });
      this.insert();
    }
    this.contentEl.empty();
  }
  insert() {
    if (!this.cards.length) return;
    const ed = this.ed;
    const l = Math.min(this.line, ed.lastLine()); // the note may have got shorter meanwhile
    const place = placeCards(this.orig, this.cards, l === this.line ? ed.getLine(l) : null);
    if (!place) return;
    const { replace, text } = place;
    const end = { line: l, ch: ed.getLine(l).length };
    ed.replaceRange(replace ? text : '\n' + text, replace ? { line: l, ch: 0 } : end, end);
    const last = l + (replace ? 0 : 1) + this.cards.length - 1;
    ed.setCursor({ line: last, ch: ed.getLine(last).length });
    ed.focus();
    new Notice(`✦ ${this.cards.length} flashcard${this.cards.length === 1 ? '' : 's'} added`);
  }
}
