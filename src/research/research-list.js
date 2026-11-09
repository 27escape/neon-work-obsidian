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
  addResearchTopic(value) {
    const text = researchTopicText(value);
    if (!text || text.length > RESEARCH_TOPIC_MAX) return false;
    if (this.settings.researchTopics.some((t) => t.text.toLowerCase() === text.toLowerCase())) return false;
    this.settings.researchTopics.push({ text, done: false });
    this.saveSoon();
    this.emitSoon();
    return true;
  },
  toggleResearchTopic(topic) {
    if (!this.settings.researchTopics.includes(topic)) return;
    topic.done = !topic.done;
    this.saveSoon();
    this.emitSoon();
  },
  removeResearchTopic(topic) {
    const i = this.settings.researchTopics.indexOf(topic);
    if (i < 0) return;
    this.settings.researchTopics.splice(i, 1);
    this.saveSoon();
    this.emitSoon();
  },
});

Object.assign(ResearchView.prototype, {
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
      this.researchFocus = true; // the list redraws; keep typing in the new box (issue 37)
      input.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submit();
    });
    // pasting several lines adds one topic per line
    input.addEventListener('paste', (e) => {
      const lines = (e.clipboardData ? e.clipboardData.getData('text/plain') : '').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return;
      e.preventDefault();
      const skipped = lines.filter((l) => !p.addResearchTopic(l));
      new Notice(`Added ${lines.length - skipped.length} topic${lines.length - skipped.length === 1 ? '' : 's'}${skipped.length ? ` · skipped ${skipped.length} (duplicate, empty or too long)` : ''}`);
      this.researchFocus = true;
    });
    if (this.researchFocus) {
      this.researchFocus = false;
      window.setTimeout(() => input.isConnected && input.focus(), 0);
    }
    button(add, { icon: 'plus', text: 'Add', cls: 'mod-cta', title: 'Add research topic', onClick: submit });

    const list = panel.createDiv('nr-research-list');
    if (!p.settings.researchTopics.length) {
      emptyState(list, 'Nothing queued — add a topic you want to understand');
      return;
    }
    for (const topic of p.settings.researchTopics) {
      const row = list.createDiv('nr-research-row' + (topic.done ? ' is-done' : ''));
      const label = row.createEl('label', { cls: 'nr-research-topic' });
      const check = label.createEl('input', { attr: { type: 'checkbox' } });
      check.checked = topic.done;
      check.addEventListener('change', () => p.toggleResearchTopic(topic));
      label.createSpan({ cls: 'nr-research-name', text: topic.text });
      button(row, { icon: 'x', cls: 'nd-icon-btn nr-research-delete', title: 'Remove research topic', onClick: () => p.removeResearchTopic(topic) });
    }
  },
});
