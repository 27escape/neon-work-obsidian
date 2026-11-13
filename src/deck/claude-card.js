/* ---- Claude card (fork) ---------------------------------------------------------
 * Notes marked for Claude by a property (default `claude`): values asking Claude for work (process,
 * refine) under "Waiting for Claude", and notes Claude changed (updated) under "To review".
 * Read only: the card never writes to notes. */

/** The setting's comma list in lower case. */
const claudeList = (text) =>
  String(text || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
/** Group notes by their Claude property: { waiting: [{ file, value }], review: [...] } (pure). */
function claudeGroups(entries, waitList, reviewList) {
  const out = { waiting: [], review: [] };
  for (const e of entries) {
    const v = String(e.value || '').trim().toLowerCase();
    if (waitList.includes(v)) out.waiting.push(e);
    else if (reviewList.includes(v)) out.review.push(e);
  }
  const newest = (a, b) => b.file.stat.mtime - a.file.stat.mtime;
  out.waiting.sort(newest);
  out.review.sort(newest);
  return out;
}

Object.assign(NeonDeck.prototype, {
  claudeEntries() {
    const key = (this.settings.claudeProperty || 'claude').trim();
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.isExcluded(f)) continue;
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (!fm || fm[key] == null) continue;
      const v = Array.isArray(fm[key]) ? fm[key][0] : fm[key];
      if (v != null && typeof v !== 'object') out.push({ file: f, value: String(v) });
    }
    return out;
  },
  registerClaudeCard() {
    // the Quick capture card uses the same place on the dashboard: when it is on, it wins
    if (!this.settings.claudeCard || this.settings.showCapture) return this.api.unregisterWidget('claude');
    this.api.registerWidget({ id: 'claude', slot: 'claude', title: 'Claude', icon: 'bot', sub: `Notes by their ${this.settings.claudeProperty || 'claude'} property`, mount: (card) => this.mountClaude(card) });
  },
  mountClaude(card) {
    const list = card.body.createDiv('nd-claude');
    const render = () => {
      if (!list.isConnected) return;
      const g = claudeGroups(this.claudeEntries(), claudeList(this.settings.claudeWaiting), claudeList(this.settings.claudeReview));
      card.badge.setText(g.waiting.length + g.review.length ? String(g.waiting.length + g.review.length) : '');
      list.empty();
      if (!g.waiting.length && !g.review.length) return void emptyState(list, 'Nothing waiting for Claude or for your review ✦');
      for (const [label, items, cls] of [['Waiting for Claude', g.waiting, 'is-waiting'], ['To review', g.review, 'is-review']]) {
        if (!items.length) continue;
        list.createDiv({ cls: `nd-claude-head ${cls}`, text: `${label} · ${items.length}` });
        for (const { file, value } of items.slice(0, 25)) {
          const r = list.createDiv('nd-claude-row');
          r.createSpan({ cls: `nd-claude-v ${cls}`, text: value });
          r.createSpan({ cls: 'nd-claude-name', text: file.basename });
          const where = r.createSpan({ cls: 'nd-claude-where', text: shortAgoDeck(file.stat.mtime) });
          tip(where, file.path);
          r.addEventListener('click', (e) => openFile(this.app, file, e));
        }
      }
    };
    const soon = debounce(render, 400, true);
    const ref = this.app.metadataCache.on('changed', soon);
    const ref2 = this.app.vault.on('delete', soon);
    const ref3 = this.app.vault.on('rename', soon);
    render();
    return {
      destroy: () => {
        this.app.metadataCache.offref(ref);
        this.app.vault.offref(ref2);
        this.app.vault.offref(ref3);
      },
    };
  },
});
/** "now", "5m", "3h", "2d", then the date. */
function shortAgoDeck(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return 'now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  if (d < 7 * 86400000) return `${Math.floor(d / 86400000)}d`;
  return moment(ms).format('D MMM');
}
