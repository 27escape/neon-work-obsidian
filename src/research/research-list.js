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
      attr: { type: 'text', placeholder: 'What do you want to research?', maxlength: RESEARCH_TOPIC_MAX, 'aria-label': 'New research topic' },
    });
    const submit = () => {
      if (!p.addResearchTopic(input.value)) {
        new Notice('Enter a new topic (200 characters or fewer)');
        input.focus();
        return;
      }
      input.value = '';
      input.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submit();
    });
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
