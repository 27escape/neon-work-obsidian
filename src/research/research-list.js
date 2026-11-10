const RESEARCH_TOPIC_MAX = 200;

function researchTopicText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeResearchTopics(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const text = researchTopicText(item.text);
    const key = text.toLowerCase();
    if (!text || text.length > RESEARCH_TOPIC_MAX || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, done: item.done === true });
  }
  return out;
}

Object.assign(NeonResearch.prototype, {
  /** Research list changed: tell the views now (no debounce), so a new row shows on the same frame. */
  researchChanged() {
    this.saveSoon();
    this.listeners.forEach((fn) => fn('research'));
  },
  addResearchTopic(value, quiet) {
    const text = researchTopicText(value);
    if (!text || text.length > RESEARCH_TOPIC_MAX) return false;
    if (this.settings.researchTopics.some((t) => t.text.toLowerCase() === text.toLowerCase())) return false;
    this.settings.researchTopics.push({ text, done: false });
    if (!quiet) this.researchChanged();
    return true;
  },
  toggleResearchTopic(topic) {
    if (!this.settings.researchTopics.includes(topic)) return;
    topic.done = !topic.done;
    this.researchChanged();
  },
  removeResearchTopic(topic) {
    const i = this.settings.researchTopics.indexOf(topic);
    if (i < 0) return;
    this.settings.researchTopics.splice(i, 1);
    this.researchChanged();
  },
});

Object.assign(ResearchView.prototype, {
  /** The research tab: the add box is built once and kept; only the rows below it redraw (issue: laggy adding). */
  renderResearchList(panel) {
    const p = this.plugin;
    const add = panel.createDiv('nr-research-add');
    const input = add.createEl('input', {
      cls: 'nd-input',
      attr: { type: 'text', placeholder: 'What do you want to research? (Enter adds, paste a list for many)', maxlength: RESEARCH_TOPIC_MAX, 'aria-label': 'New research topic' },
    });
    // why a topic was refused: a duplicate used to show the "200 characters" message (issue 38)
    const why = (v) => {
      const text = researchTopicText(v);
      if (!text) return 'Enter a topic first';
      return text.length > RESEARCH_TOPIC_MAX ? `Topics can be ${RESEARCH_TOPIC_MAX} characters or fewer` : `“${text}” is already on the list`;
    };
    const submit = () => {
      if (!p.addResearchTopic(input.value)) {
        new Notice(why(input.value));
        input.focus();
        return;
      }
      input.value = '';
      input.focus(); // the box stays, so focus and typing carry on (issue 37)
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submit();
    });
    // pasting several lines adds one topic per line, then redraws once
    input.addEventListener('paste', (e) => {
      const lines = (e.clipboardData ? e.clipboardData.getData('text/plain') : '').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return;
      e.preventDefault();
      const skipped = lines.filter((l) => !p.addResearchTopic(l, true));
      if (skipped.length < lines.length) p.researchChanged();
      new Notice(`Added ${lines.length - skipped.length} topic${lines.length - skipped.length === 1 ? '' : 's'}${skipped.length ? ` · skipped ${skipped.length} (duplicate, empty or too long)` : ''}`);
    });
    if (this.researchFocus) {
      this.researchFocus = false;
      window.setTimeout(() => input.isConnected && input.focus(), 0);
    }
    button(add, { icon: 'plus', text: 'Add', cls: 'mod-cta', title: 'Add research topic', onClick: submit });
    this.researchList = panel.createDiv('nr-research-list');
    this.drawResearchRows();
  },
  /** Called on every research change: the rows and the "to research" count, nothing else. */
  refreshResearch() {
    if (this.tab !== 'research' || !this.researchList || !this.researchList.isConnected) return;
    const p = this.plugin;
    const remaining = p.settings.researchTopics.filter((t) => !t.done).length;
    if (this.researchSub) this.researchSub.setText(`${remaining} to research · ${p.settings.researchTopics.length - remaining} researched`);
    this.drawResearchRows();
  },
  drawResearchRows() {
    const p = this.plugin;
    const list = this.researchList;
    list.empty();
    if (!p.settings.researchTopics.length) {
      emptyState(list, 'Nothing queued — add a topic you want to understand');
      return;
    }
    // only rows that weren't there last time slide in; the one just ticked pops
    const seen = this.researchSeen;
    this.researchSeen = new Set(p.settings.researchTopics.map((t) => t.text));
    const flipped = this.researchFlipped;
    this.researchFlipped = null;
    p.settings.researchTopics.forEach((topic, i) => {
      const fresh = seen && !seen.has(topic.text);
      const row = list.createDiv('nr-research-row' + (topic.done ? ' is-done' : '') + (fresh ? ' is-new' : '') + (flipped === topic.text ? ' is-flipped' : ''));
      // a new row appears at once instead of waiting for its place in the stagger
      row.style.setProperty('--i', String(fresh ? 0 : Math.min(i, 10)));
      const label = row.createEl('label', { cls: 'nr-research-topic' });
      const check = label.createEl('input', { attr: { type: 'checkbox' } });
      check.checked = topic.done;
      check.addEventListener('change', () => {
        this.researchFlipped = topic.text;
        p.toggleResearchTopic(topic);
      });
      label.createSpan({ cls: 'nr-research-name', text: topic.text });
      button(row, {
        icon: 'x',
        cls: 'nd-icon-btn nr-research-delete',
        title: 'Remove research topic',
        onClick: () => {
          if (prefersReducedMotion() || row.hasClass('is-leaving')) return p.removeResearchTopic(topic);
          row.addClass('is-leaving');
          window.setTimeout(() => p.removeResearchTopic(topic), 180);
        },
      });
    });
  },
});
