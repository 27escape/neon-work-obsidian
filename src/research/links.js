Object.assign(NeonResearch.prototype, {
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
  },
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
  },
  async showLinkSuggestions(fromUser) {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const hits = this.inRoot(f) ? await this.linkHits(f) : [];
    if (!hits.length) return fromUser && new Notice('No unlinked mentions of research notes here.');
    new LinkSuggestModal(this, f, hits).open();
  },
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
  },

});
