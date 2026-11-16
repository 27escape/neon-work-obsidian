/* ---- New note, by group and type (fork) ----------------------------------------
 * When the vault has a groups folder (customers: 1.Customers/<customer>/…; PARA: 2.Areas/<area>), the New note
 * card asks for a name, a group and a type, and puts the note in the type's folder from its template. */
/* fork: the kinds of note New note offers are a list in the settings (noteTypes). A type has a name, a folder
 * ({group} = <groups folder>/<group>), a template, a tag for notes made without a template, and person
 * behaviour (@Name, aliases). Projects always go through New project. Older settings become this list once. */
const NOTE_TYPE_ICONS = { note: 'file-text', meeting: 'users', person: 'user', research: 'library', resource: 'archive', project: 'briefcase' };

/** The New note types from the settings, or built from the older per-kind settings (pure). */
function noteTypesFrom(s) {
  if (Array.isArray(s.noteTypes) && s.noteTypes.length) return s.noteTypes;
  const sub = (f) => (f ? `{group}/${f}` : '{group}');
  return [
    { name: 'Note', folder: '{group}', template: s.noteTemplate || '', tag: '', person: false },
    { name: 'Meeting', folder: sub(s.meetingsFolder || 'Meetings'), template: s.meetingTemplate || '', tag: 'meeting', person: false },
    { name: 'Person', folder: sub(s.peopleFolder || 'People'), template: s.personTemplate || '', tag: 'person', person: true },
    { name: 'Research', folder: sub(s.researchFolder || 'Research'), template: s.researchTemplate || '', tag: 'research', person: false },
  ];
}
/** Does a type's folder depend on the group? */
const typeUsesGroup = (type) => /\{group\}/i.test(type.folder || '');
/**
 * Where a new note of a type goes (pure). {group} needs a group; without one the note goes in the fallback
 * folder ('' = vault root). People notes get an @ in front of the name.
 */
function newNotePath(type, groupsFolder, group, name, fallback) {
  let folder;
  if (typeUsesGroup(type)) folder = group ? (type.folder || '').replace(/\{group\}/gi, `${groupsFolder}/${group}`) : fallback || '/';
  else folder = type.folder || fallback || '/';
  folder = normalizePath(folder.replace(/^\/+|\/+$/g, '') || '/');
  const file = type.person && !name.startsWith('@') ? `@${name}` : name;
  return { folder: !folder || folder === '.' ? '/' : folder, file };
}
/** Properties for a new note without a template (pure). */
function newNoteFrontmatter(type, title, day, group) {
  const lines = ['---', `title: ${JSON.stringify(title)}`, `created: ${day}`, `modified: ${day}`];
  if (type.person) {
    const plain = title.replace(/^@/, '');
    const first = plain.split(/\s+/)[0];
    lines.push('aliases:', `  - ${JSON.stringify(plain)}`);
    if (first && first !== plain) lines.push(`  - ${JSON.stringify(first)}`);
  }
  if (group) lines.push(`${groupProps()[0] || 'customer'}: ${JSON.stringify(group.toLowerCase())}`); // fork: the first group property
  const tag = String(type.tag || '').trim().replace(/^#/, '');
  if (tag) lines.push('tags:', `  - ${tag}`);
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
    this.types = noteTypesFrom(s);
    const kinds = this.types.map((t, i) => [String(i), t.name || 'Note']);
    if (p.ticketService()) kinds.push(['project', 'Project']);
    this.kind = pills(field('Kind'), kinds, '0', () => sync());
    const customers = CATS.map((k) => [k, CAT_LABEL[k] || k]);
    const here = this.opts.folder || (file && file.parent ? file.parent.path : '');
    const guess = pathCustomer(`${here}/x.md`) || '';
    const sel = field(groupWord()).createEl('select', { cls: 'dropdown' });
    for (const [k, l] of customers) sel.createEl('option', { value: k, text: l });
    sel.createEl('option', { value: '', text: `No ${groupWord(false, true)} (${s.noCustomerFolder || 'vault root'})` });
    sel.value = guess;
    const where = c.createDiv({ cls: 'nt-note' });
    const row = c.createDiv('nd-modal-row');
    row.createDiv({ cls: 'nt-keys', text: 'Enter creates · Esc cancels' });
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const go = button(row, { text: 'Create', cls: 'mod-cta', onClick: () => this.submit(name.value, sel.value) });
    const label = (k) => CAT_LABEL[k] || k;
    const sync = () => {
      const kind = this.kind.get();
      if (kind === 'project') where.setText(`Opens New project with this name and ${groupWord(false, true)}.`);
      else {
        const type = this.types[Number(kind)] || this.types[0];
        const { folder, file: fname } = newNotePath(type, NEON_CATS.customersFolder, sel.value ? label(sel.value) : '', safeName(name.value) || 'Untitled', s.noCustomerFolder);
        where.setText(`Creates ${folder === '/' ? '' : folder + '/'}${fname}.md${(type.template || '').trim() ? ` from ${type.template.trim()}` : ''}`);
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
      const type = this.types[Number(kind)] || this.types[0];
      const { folder, file: fname } = newNotePath(type, NEON_CATS.customersFolder, customer, title, p.settings.noCustomerFolder);
      const day = moment();
      const tpl = await p.templateText(type.template, fname, day);
      const body = tpl != null ? tpl : newNoteFrontmatter(type, fname, day.format('YYYY-MM-DD'), customer);
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
  /** A template note's text with {{title}}, {{date}}, {{time}} filled in, or null without one. */
  async templateText(path, title, day) {
    path = String(path || '').trim();
    if (!path) return null;
    const tf = this.app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(tf instanceof TFile)) {
      new Notice(`Template “${path}” not found: using standard properties`);
      return null;
    }
    return applyTemplate(await this.app.vault.read(tf), day, title);
  },
});
