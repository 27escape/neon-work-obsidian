/* ---- New note, customer layout (fork) -----------------------------------------
 * When the vault has a customers folder (1.Customers/<customer>/Meetings|People|Projects|Research), the
 * New note card asks for a name, a customer and a kind, and puts the note in the right folder from the
 * kind's template. People notes get the @ prefix and an aliases property; projects go through New project. */
const NOTE_KINDS = [
  ['note', 'Note', 'file-text'],
  ['meeting', 'Meeting', 'users'],
  ['person', 'Person', 'user'],
  ['project', 'Project', 'briefcase'],
  ['research', 'Research', 'library'],
];

/** Where a new note of a kind goes (pure). Empty customer → the fallback folder. */
function newNotePath(s, customersFolder, customer, kind, name) {
  const sub = { meeting: s.meetingsFolder, person: s.peopleFolder, research: s.researchFolder }[kind] || '';
  const base = customer ? normalizePath(`${customersFolder}/${customer}${sub ? '/' + sub : ''}`) : normalizePath(s.noCustomerFolder || '/');
  const file = kind === 'person' && !name.startsWith('@') ? `@${name}` : name;
  return { folder: base === '.' ? '/' : base, file };
}
/** Properties for a new note without a template (pure). */
function newNoteFrontmatter(kind, title, day, customer) {
  const lines = ['---', `title: ${JSON.stringify(title)}`, `created: ${day}`, `modified: ${day}`];
  if (kind === 'person') {
    const plain = title.replace(/^@/, '');
    const first = plain.split(/\s+/)[0];
    lines.push('aliases:', `  - ${JSON.stringify(plain)}`);
    if (first && first !== plain) lines.push(`  - ${JSON.stringify(first)}`);
  }
  if (customer) lines.push(`customer: ${JSON.stringify(customer.toLowerCase())}`);
  if (kind !== 'note') lines.push('tags:', `  - ${kind}`);
  lines.push('---', '');
  return lines.join('\n');
}

class CustomerNoteModal extends Modal {
  /** opts: { folder, file (an existing empty note), name } */
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    const s = p.settings;
    const { file } = this.opts;
    this.modalEl.addClass('nd-modal', 'nt-newnote');
    this.titleEl.setText('New note');
    const c = this.contentEl;
    const field = (label, hint) => {
      const f = c.createDiv('nt-field');
      const l = f.createDiv('nt-label');
      l.createSpan({ text: label });
      if (hint) l.createSpan({ cls: 'nt-hint', text: hint });
      return f;
    };
    const name = field('Name').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Untitled' } });
    name.value = file ? file.basename : this.opts.name || '';
    const kinds = NOTE_KINDS.filter(([k]) => k !== 'project' || p.ticketService());
    this.kind = pills(field('Kind'), kinds.map(([k, l]) => [k, l]), 'note', () => sync());
    const customers = CATS.map((k) => [k, CAT_LABEL[k] || k]);
    const here = this.opts.folder || (file && file.parent ? file.parent.path : '');
    const guess = pathCustomer(`${here}/x.md`) || '';
    const sel = field('Customer').createEl('select', { cls: 'dropdown' });
    for (const [k, l] of customers) sel.createEl('option', { value: k, text: l });
    sel.createEl('option', { value: '', text: `No customer (${s.noCustomerFolder || 'vault root'})` });
    sel.value = guess;
    const where = c.createDiv({ cls: 'nt-note' });
    const row = c.createDiv('nd-modal-row');
    row.createDiv({ cls: 'nt-keys', text: 'Enter creates · Esc cancels' });
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const go = button(row, { text: 'Create', cls: 'mod-cta', onClick: () => this.submit(name.value, sel.value) });
    const label = (k) => CAT_LABEL[k] || k;
    const sync = () => {
      const kind = this.kind.get();
      if (kind === 'project') where.setText('Opens New project with this name and customer.');
      else {
        const { folder, file: fname } = newNotePath(s, NEON_CATS.customersFolder, sel.value ? label(sel.value) : '', kind, safeName(name.value) || 'Untitled');
        where.setText(`Creates ${folder === '/' ? '' : folder + '/'}${fname}.md${p.kindTemplate(kind) ? ` from ${p.kindTemplate(kind)}` : ''}`);
      }
      go.querySelector('.nd-btn-label').setText(kind === 'project' ? 'Continue' : 'Create');
    };
    sel.addEventListener('change', sync);
    name.addEventListener('input', sync);
    c.addEventListener('keydown', (e) => {
      const inFooter = e.target instanceof HTMLElement && e.target.closest('.nd-modal-row');
      if (e.key === 'Enter' && !e.isComposing && !inFooter) {
        e.preventDefault();
        this.submit(name.value, sel.value);
      }
    });
    sync();
    window.setTimeout(() => (name.focus(), name.select()), 20);
  }
  async submit(nameRaw, customerKey) {
    const p = this.plugin;
    const kind = this.kind.get();
    const title = safeName(nameRaw) || 'Untitled';
    const customer = customerKey ? CAT_LABEL[customerKey] || customerKey : '';
    this.close();
    try {
      const { file } = this.opts;
      if (kind === 'project') {
        if (file && !(await this.app.vault.read(file)).trim()) await this.app.fileManager.trashFile(file);
        return p.ticketService()({ title, customer });
      }
      const { folder, file: fname } = newNotePath(p.settings, NEON_CATS.customersFolder, customer, kind, title);
      const day = moment();
      const tpl = await p.kindTemplateText(kind, fname, day);
      const body = tpl != null ? tpl : newNoteFrontmatter(kind, fname, day.format('YYYY-MM-DD'), customer);
      p.selfCreated.add('pending');
      let target;
      try {
        target = await createUnique(this.app, folder, fname, body);
      } finally {
        p.selfCreated.delete('pending');
      }
      if (file && file !== target && !(await this.app.vault.read(file)).trim()) await this.app.fileManager.trashFile(file);
      await reusableLeaf(this.app).openFile(target, { active: true, state: { mode: 'source' } });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Neon Tasks: could not create the note', e);
        new Notice('Could not create the note');
      }
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}

Object.assign(NeonTasks.prototype, {
  /** The template note set for a kind of note ('' when none). */
  kindTemplate(kind) {
    return ({ note: this.settings.noteTemplate, meeting: this.settings.meetingTemplate, person: this.settings.personTemplate, research: this.settings.researchTemplate }[kind] || '').trim();
  },
  /** A kind's template text with {{title}}, {{date}}, {{time}} filled in, or null without one. */
  async kindTemplateText(kind, title, day) {
    const path = this.kindTemplate(kind);
    if (!path) return null;
    const tf = this.app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(tf instanceof TFile)) {
      new Notice(`Template “${path}” not found: using standard properties`);
      return null;
    }
    return applyTemplate(await this.app.vault.read(tf), day, title);
  },
});
