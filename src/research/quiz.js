/* ---- quiz ------------------------------------------------------------------- */
class QuizModal extends Modal {
  constructor(plugin, cards, label) {
    super(plugin.app);
    this.plugin = plugin;
    this.queue = cards.slice();
    this.label = label;
    this.done = 0;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-study');
    this.titleEl.setText(`Quiz · ${this.label}`);
    // keys through the modal's scope: they work wherever focus is, and space never also presses a button
    // returning true lets the key through, so an exercise's answer box can still take spaces and digits
    this.scope.register([], ' ', () => (this.showBtn ? (this.showBtn.click(), false) : true));
    ['1', '2', '3'].forEach((k, i) => this.scope.register([], k, () => (this.answerShown ? (this.grade(['again', 'hard', 'easy'][i]), false) : true)));
    this.next();
  }
  next() {
    const c = this.contentEl;
    c.empty();
    this.answerShown = false;
    this.showBtn = null;
    const card = (this.card = this.queue.shift());
    if (!card) {
      c.createDiv({
        cls: 'nr-study-done',
        text: this.done ? `✦ Done — ${this.done} card${this.done === 1 ? '' : 's'} reviewed.` : 'Nothing to quiz right now ✦',
      });
      const r = c.createDiv('nd-modal-row');
      button(r, { text: 'Close', cls: 'mod-cta', onClick: () => this.close() });
      return;
    }
    c.createDiv({ cls: 'nr-study-meta', text: `${card.file.basename} · ${this.queue.length + 1} left` });
    c.createDiv({ cls: 'nr-study-q', text: card.q });
    const a = c.createDiv({ cls: 'nr-study-a', text: card.a });
    a.hide();
    const r = c.createDiv('nd-modal-row');
    const grades = () => {
      a.show();
      this.answerShown = true;
      r.empty();
      button(r, { text: 'Again (1)', cls: 'nr-again', onClick: () => this.grade('again') });
      button(r, { text: 'Hard (2)', onClick: () => this.grade('hard') });
      button(r, { text: 'Easy (3)', cls: 'mod-cta', onClick: () => this.grade('easy') });
      this.showBtn = null;
    };
    if (!card.type) {
      this.showBtn = button(r, { text: 'Show answer (space)', cls: 'mod-cta', onClick: grades });
      return;
    }
    // an exercise: type an answer first, then compare (issue 56)
    const input = c.createEl('input', { cls: 'nd-input nr-study-input', attr: { type: 'text', placeholder: 'Your answer', 'aria-label': 'Your answer' } });
    c.insertBefore(input, a);
    const check = button(r, { text: 'Check (Enter)', cls: 'mod-cta', onClick: () => submit() });
    check.disabled = true;
    input.addEventListener('input', () => (check.disabled = !input.value.trim()));
    const norm = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();
    const submit = () => {
      if (!input.value.trim() || this.answerShown) return;
      input.disabled = true;
      const same = norm(input.value) === norm(card.a);
      a.after(createDiv({ cls: `nr-study-verdict ${same ? 'is-match' : 'is-diff'}`, text: same ? '✓ Match' : '≠ Different — compare with the answer' }));
      grades();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a space or 1–3 must not answer or grade
      if (e.key === 'Enter' && !e.isComposing) (e.preventDefault(), submit());
    });
    window.setTimeout(() => input.focus(), 10);
  }
  async grade(how) {
    const card = this.card;
    if (!card || this.grading) return;
    this.grading = true; // a quick double key press grades once
    this.card = null;
    try {
      await this.plugin.gradeCard(card, how);
    } catch (e) {
      console.error('Neon Study: could not save grade', e);
      new Notice('Could not save this grade');
    } finally {
      this.grading = false;
    }
    if (!this.containerEl.isConnected) return; // closed during the save
    this.done++;
    if (how === 'again') this.queue.push(card); // seen again in this session
    this.next();
  }
  onClose() {
    this.contentEl.empty();
    this.plugin.emitSoon();
  }
}

/** Quiz me: pick which topic (or all) to quiz, and whether only due cards or all of them. */
/** A note's flashcards and exercises: list, edit, delete, add, quiz, and move cards off the page (issue 56). */
class FlashcardModal extends Modal {
  constructor(plugin, file, exercise) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.exercise = !!exercise;
    this.focusAdd = exercise != null; // opened to add: focus the question
    this.added = 0;
    this.editing = null;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-card-modal');
    this.titleEl.setText(`Cards · ${this.file.basename}`);
    this.off = this.plugin.onChange((f) => (!f || f === this.file) && this.drawList());
    const c = this.contentEl;
    this.listEl = c.createDiv('nr-card-list');
    this.toolsEl = c.createDiv('nd-modal-row');
    const field = (label, ph) => {
      const w = c.createDiv('nr-card-field');
      w.createDiv({ cls: 'nr-card-label', text: label });
      return w.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: ph, 'aria-label': label } });
    };
    const q = (this.q = field('Question', 'e.g. What does the mitochondrion do?'));
    const a = (this.a = field('Answer', 'e.g. Makes energy (ATP) for the cell'));
    this.kind = pills(c, [['card', 'Flashcard'], ['exercise', 'Exercise (type the answer)']], this.exercise ? 'exercise' : 'card', (v) => (this.exercise = v === 'exercise'), 'nr-card-types');
    c.insertBefore(this.kind.el, q.parentElement);
    const foot = c.createDiv('nd-modal-row');
    this.info = foot.createSpan({ cls: 'nr-card-info', text: 'Enter adds the card · Esc closes' });
    const save = async () => {
      // one line per card, and " :: " / " ::: " separate the sides, so neither may appear inside
      const clean = (v) => v.replace(/\s+/g, ' ').replace(/\s:::?\s/g, ' : ').trim();
      const qv = clean(q.value).replace(/^#+\s*/, '');
      const av = clean(a.value);
      if (!qv || !av) return (qv ? a : q).focus();
      const line = `${qv} ${this.exercise ? ':::' : '::'} ${av}`;
      try {
        if (this.editing) await this.plugin.setCard(this.editing, line);
        else await this.plugin.appendCard(this.file, line);
      } catch (e) {
        console.error('Neon Study: could not save card', e);
        return new Notice('Could not save the card');
      }
      if (this.editing) this.info.setText('✦ Card saved');
      else this.info.setText(`✦ ${++this.added} card${this.added === 1 ? '' : 's'} added · Enter adds another · Esc closes`);
      this.editing = null;
      this.saveBtn.querySelector('.nd-btn-label').setText('Add card');
      q.value = a.value = '';
      q.focus();
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), a.value.trim() ? save() : a.focus()));
    a.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), save()));
    button(foot, { text: 'Done', onClick: () => this.close() });
    this.saveBtn = button(foot, { text: 'Add card', cls: 'mod-cta', onClick: save });
    this.drawList();
    if (this.focusAdd || !this.plugin.cardsIn(this.file).length) window.setTimeout(() => q.focus(), 10);
  }
  drawList() {
    const p = this.plugin;
    const cards = p.cardsIn(this.file);
    const list = this.listEl;
    list.empty();
    list.toggle(!!cards.length);
    for (const card of cards) {
      const r = list.createDiv({ cls: 'nr-card-row' + (this.editing && this.editing.id === card.id ? ' is-editing' : ''), attr: { tabindex: '0', role: 'button' } });
      r.createSpan({ cls: 'nr-card-kind', text: card.type ? 'Exercise' : 'Card' });
      r.createSpan({ cls: 'nr-card-row-q', text: card.q });
      r.createSpan({ cls: 'nr-card-row-a', text: card.a });
      const edit = () => {
        this.editing = card;
        this.q.value = card.q;
        this.a.value = card.a;
        this.kind.set(card.type ? 'exercise' : 'card');
        this.exercise = card.type;
        this.saveBtn.querySelector('.nd-btn-label').setText('Save card');
        this.drawList();
        this.q.focus();
      };
      r.addEventListener('click', edit);
      r.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), edit()));
      button(r, {
        icon: 'x',
        cls: 'nd-icon-btn',
        title: 'Delete card',
        onClick: async (e) => {
          e.stopPropagation();
          if (this.editing && this.editing.id === card.id) this.editing = null;
          await p.setCard(card, null);
        },
      });
    }
    const t = this.toolsEl;
    t.empty();
    const inline = cards.filter((c) => !c.hidden).length;
    if (inline) button(t, { icon: 'eye-off', text: `Move ${inline} card${inline === 1 ? '' : 's'} off the page`, onClick: () => p.moveCardsOffPage(this.file) });
    if (cards.length)
      button(t, {
        icon: 'graduation-cap',
        text: 'Quiz this note',
        onClick: () => {
          this.close();
          p.quizNote(this.file);
        },
      });
  }
  onClose() {
    if (this.off) this.off();
    this.contentEl.empty();
  }
}

class QuizPickModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.onlyDue = true;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-pick');
    this.titleEl.setText('Quiz me');
    const top = this.contentEl.createDiv('nr-pick-top');
    const sw = top.createEl('label', { cls: 'nr-pick-switch' });
    const box = sw.createEl('input', { attr: { type: 'checkbox' } });
    box.checked = this.onlyDue;
    sw.appendText(' Only cards that are due');
    box.addEventListener('change', () => ((this.onlyDue = box.checked), this.draw()));
    this.list = this.contentEl.createDiv('nr-pick-list');
    this.draw();
  }
  draw() {
    const p = this.plugin;
    const list = this.list;
    list.empty();
    const root = p.rootFolder();
    const row = (folder, label, depth) => {
      const all = p.cardsUnder(folder);
      const due = p.dueCards(all);
      const n = this.onlyDue ? due.length : all.length;
      const r = list.createDiv('nr-pick-row' + (n ? '' : ' is-empty'));
      r.style.setProperty('--depth', String(depth));
      icon(r, depth < 0 ? 'library' : 'folder', 'nd-ico nr-folder-ico');
      r.createSpan({ cls: 'nr-name', text: label });
      r.createSpan({ cls: 'nr-pick-n', text: `${all.length} card${all.length === 1 ? '' : 's'}` });
      r.createSpan({ cls: 'nr-pick-due' + (due.length ? ' has-due' : ''), text: `${due.length} due` });
      if (n)
        r.addEventListener('click', () => {
          this.close();
          p.quiz(folder, label, !this.onlyDue);
        });
    };
    if (!root) return;
    row(root, 'All topics', -1);
    const walk = (f, depth) => {
      const subs = (f.children || []).filter((c) => c instanceof TFolder).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const c of subs) {
        row(c, c.name, depth);
        walk(c, depth + 1);
      }
    };
    walk(root, 0);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Open (true) or close a folder's children with a short height slide; a closed box is removed. */
function slide(el, open) {
  if (prefersReducedMotion()) return open || el.remove();
  const h = el.scrollHeight;
  const a = el.animate(open ? [{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }] : [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: open ? 200 : 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  el.style.overflow = 'hidden';
  a.onfinish = () => (open ? (el.style.overflow = '') : el.remove());
}

