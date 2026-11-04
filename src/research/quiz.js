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
    this.scope.register([], ' ', () => (this.showBtn && this.showBtn.click(), false));
    ['1', '2', '3'].forEach((k, i) => this.scope.register([], k, () => (this.answerShown && this.grade(['again', 'hard', 'easy'][i]), false)));
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
    this.showBtn = button(r, {
      text: 'Show answer (space)',
      cls: 'mod-cta',
      onClick: () => {
        a.show();
        this.answerShown = true;
        r.empty();
        button(r, { text: 'Again (1)', cls: 'nr-again', onClick: () => this.grade('again') });
        button(r, { text: 'Hard (2)', onClick: () => this.grade('hard') });
        button(r, { text: 'Easy (3)', cls: 'mod-cta', onClick: () => this.grade('easy') });
        this.showBtn = null;
      },
    });
  }
  async grade(how) {
    const card = this.card;
    if (!card || this.grading) return;
    this.grading = true; // a quick double key press grades once
    this.card = null;
    try {
      await this.plugin.gradeCard(card, how);
    } catch (e) {
      console.error('Neon Research: could not save grade', e);
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
/** Add `question :: answer` cards to a note; stays open to add several. */
class FlashcardModal extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.added = 0;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-card-modal');
    this.titleEl.setText(`Flashcards · ${this.file.basename}`);
    const c = this.contentEl;
    const field = (label, ph) => {
      const w = c.createDiv('nr-card-field');
      w.createDiv({ cls: 'nr-card-label', text: label });
      return w.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: ph } });
    };
    const q = field('Question', 'e.g. What does the mitochondrion do?');
    const a = field('Answer', 'e.g. Makes energy (ATP) for the cell');
    const foot = c.createDiv('nd-modal-row');
    const info = foot.createSpan({ cls: 'nr-card-info', text: 'Enter adds the card · Esc closes' });
    const add = async () => {
      // one line per card, and " :: " is the separator, so neither may appear inside
      const clean = (v) => v.replace(/\s+/g, ' ').replace(/\s::\s/g, ' : ').trim();
      const qv = clean(q.value).replace(/^#+\s*/, '');
      const av = clean(a.value);
      if (!qv || !av) return (qv ? a : q).focus();
      try {
        await this.plugin.appendCard(this.file, `${qv} :: ${av}`);
      } catch (e) {
        console.error('Neon Research: could not add card', e);
        return new Notice('Could not add the card');
      }
      this.added++;
      info.setText(`✦ ${this.added} card${this.added === 1 ? '' : 's'} added · Enter adds another · Esc closes`);
      q.value = a.value = '';
      q.focus();
    };
    q.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), a.value.trim() ? add() : a.focus()));
    a.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), add()));
    button(foot, { text: 'Done', onClick: () => this.close() });
    button(foot, { text: 'Add card', cls: 'mod-cta', onClick: add });
    window.setTimeout(() => q.focus(), 10);
  }
  onClose() {
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

