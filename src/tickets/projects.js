/* ---- projects (fork) --------------------------------------------------------
 * In this fork the Projects module (upstream: Tickets) tracks projects: notes tagged `project` (setting) with the vault's own
 * properties: status (values from settings, grouped into not started / active / on hold / closed),
 * started, due, completed, cancelled, stage, note and customer. The customer comes from the `customer`
 * property, else from the folder under the customers folder (1.Customers/<customer>/...). */

/** The setting's comma list, trimmed, without blanks or repeats (case kept for writing). */
function projectList(text) {
  const seen = new Set();
  return String(text || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}
/** NEON_PROJECTS from the settings: tag, value → kind map, the order offered, the cancelled value. */
function projectConfig(s) {
  const groups = [
    ['open', projectList(s.statusNotStarted)],
    ['in-progress', projectList(s.statusActive)],
    ['waiting', projectList(s.statusOnHold)],
    ['done', projectList(s.statusClosed)],
  ];
  const kinds = {};
  const order = [];
  for (const [kind, values] of groups)
    for (const v of values) {
      if (kinds[v.toLowerCase()]) continue;
      kinds[v.toLowerCase()] = kind;
      order.push(v);
    }
  return { tag: String(s.projectTag || '').trim().replace(/^#/, ''), kinds, order, cancelled: String(s.statusCancelled || '').trim() };
}
/** Customer of a note: its `customer` property, else the folder under the customers folder. */
function projectCustomer(path, fm, customersFolder) {
  // fork: the group properties (a name, link or path; see groupFromProps), shown as the group folder's name
  const g = groupFromProps(fm, path);
  if (g) return CAT_LABEL[g] || g;
  // a plain name that isn't a group folder is still shown as written (customer: acme widgets → acme widgets)
  const c = fm && fm[groupProps()[0]];
  if (c != null && typeof c !== 'object' && String(c).trim() && !/^\[\[|\//.test(String(c).trim())) return String(c).trim();
  const root = normalizePath(customersFolder || '');
  if (!root || !path.startsWith(root + '/')) return '';
  const rest = path.slice(root.length + 1).split('/');
  const k = rest.length > 1 ? rest[0] : '';
  return k && !(NEON_CATS.skip || []).some((x) => x.toLowerCase() === k.toLowerCase()) ? k : ''; // fork: not the "Not groups" folders
}
/**
 * fork: the note that stands for a project folder (see folderProjects): { file, own }, or null when the folder has
 * no notes. own: a note named like the folder, or one with a status, which may hold the project's status. Otherwise
 * file is only for opening (an index note, say) and is never written to: notes with an ignored tag (generated index
 * notes) are not "own".
 */
function projectFolderNote(app, folder) {
  const notes = [];
  const walk = (fd, depth) => {
    for (const c of fd.children || []) {
      if (c instanceof TFile && c.extension === 'md') notes.push({ file: c, depth });
      else if (c instanceof TFolder && depth < 2) walk(c, depth + 1);
    }
  };
  walk(folder, 0);
  if (!notes.length) return null;
  const top = notes.filter((n) => n.depth === 0).map((n) => n.file);
  const fm = (f) => (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
  const mine = top.filter((f) => !isIgnoredNote(app, f));
  const same = mine.find((f) => f.basename.toLowerCase() === folder.name.toLowerCase());
  if (same) return { file: same, own: true };
  const withStatus = mine.find((f) => fm(f).status != null && String(fm(f).status).trim());
  if (withStatus) return { file: withStatus, own: true };
  const index = top.find((f) => /^(0\.?\s*index|index|readme)$/i.test(f.basename));
  return { file: index || top[0] || notes[0].file, own: false };
}
/** A project's display title: the file name, without a leading "Project : ". */
function projectTitle(basename) {
  return basename.replace(/^project\s*:\s*/i, '') || basename;
}
/**
 * Property changes for moving a project to a status value (pure, testable).
 * Closing writes `completed` (or `cancelled` for the cancelled value) with today's date;
 * leaving a closed status removes them. Upstream waiting fields are cleared.
 */
function projectStatusPatch(value, prevKind, today, cfg) {
  const kind = cfg.kinds[String(value).toLowerCase()] || 'open';
  const patch = { status: value, waiting_on: null, follow_up: null, waiting_since: null };
  if (kind === 'done') {
    const cancelled = cfg.cancelled && String(value).toLowerCase() === cfg.cancelled.toLowerCase();
    if (cancelled) Object.assign(patch, { cancelled: today, completed: null });
    else Object.assign(patch, { completed: today, cancelled: null });
  } else if (prevKind === 'done') Object.assign(patch, { completed: null, cancelled: null });
  return { kind, patch };
}

Object.assign(NeonProjects.prototype, {
  applyProjectSettings() {
    Object.assign(NEON_PROJECTS, projectConfig(this.settings));
    NEON_PLAN.folders = this.settings.projectFolders || ''; // fork: project folders are plans too
    NEON_CATS.label = this.settings.groupLabel || 'Customer'; // fork
    NEON_CATS.prop = (this.settings.groupProperty || 'customer').trim() || 'customer';
    NEON_CATS.skip = String(this.settings.groupSkip || '').split(',').map((x) => x.trim()).filter(Boolean); // fork
    refreshCategories(this.app, this.settings.customersFolder); // fork: customers are the categories too
    this.cache = null;
  },
  /** Status values offered (in order); `kind` limits them to one group. */
  statusChoices(kind) {
    return NEON_PROJECTS.order.filter((v) => !kind || NEON_PROJECTS.kinds[v.toLowerCase()] === kind);
  },
  statusKind(value) {
    return projectKind(value);
  },
  /** Folders under the customers folder, A–Z. */
  customers() {
    const root = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.customersFolder || ''));
    if (!(root instanceof TFolder)) return [];
    return root.children.filter((c) => c instanceof TFolder).map((c) => c.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  },
  /** The free-text `note` property: what's happening right now. */
  promptNote(t) {
    new PromptModal(this.app, {
      title: `Note for ${t.title}`,
      value: t.note,
      placeholder: 'Current status or recent change',
      cta: 'Save',
      onSubmit: (v) => this.patch(t, { note: v.trim() || null }),
    }).open();
  },
  /** Where projects without a customer go: the setting, else <base folder>/Projects. */
  projectFolder() {
    return locPath(this.settings.projectFolder, 'Projects');
  },
  /** fork: a project folder without a note of its own gets one, <folder>/<folder name>.md, from the project template. */
  createFolderProjectNote(t) {
    if (!t.folder) return;
    return this.createProject(t.title, '', t.folder);
  },
  newProject(opts = {}) {
    new NewProjectModal(this, opts).open();
  },
  /** Make a project note from the template (or the standard properties) and open it. */
  async createProject(title, customer, inFolder) {
    const s = this.settings;
    const day = moment();
    const folder = inFolder || (customer ? normalizePath(`${s.customersFolder}/${customer}/${s.projectsFolderName || 'Projects'}`) : this.projectFolder());
    let body = '';
    if (s.projectTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.projectTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.projectTemplate));
      if (tf instanceof TFile) body = applyTemplate(await this.app.vault.read(tf), day, title);
      else new Notice(`Project template “${s.projectTemplate}” not found: using the standard properties`);
    }
    if (!body) {
      const first = this.statusChoices('open')[0] || 'init';
      body = ['---', `title: ${JSON.stringify(title)}`, 'tags:', `  - ${NEON_PROJECTS.tag || 'project'}`, `started: ${day.format('YYYY-MM-DD')}`, 'due:', 'completed:', `status: ${first}`, '---', '', `# ${title}`, ''].join('\n');
    }
    const f = await createUnique(this.app, folder, title, body);
    await openFile(this.app, f);
    return f;
  },
});

/** New project: a name and a customer (the folder it goes in). */
class NewProjectModal extends Modal {
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText('New project');
    const el = this.contentEl;
    const name = el.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Project name' } });
    name.value = this.opts.title || '';
    name.style.width = '100%';
    const list = p.customers();
    const active = this.app.workspace.getActiveFile();
    const guess = active ? projectCustomer(active.path, null, p.settings.customersFolder) : '';
    const sel = el.createEl('select', { cls: 'dropdown' });
    sel.style.marginTop = '10px';
    for (const c of list) sel.createEl('option', { value: c, text: c });
    sel.createEl('option', { value: '', text: list.length ? `No ${groupWord(false, true)} (project folder)` : `No ${groupWord(true, true)} found in ${p.settings.customersFolder}` });
    const want = this.opts.customer || guess;
    sel.value = list.includes(want) ? want : list[0] || '';
    const where = el.createDiv({ cls: 'setting-item-description' });
    const show = () => where.setText(`Goes in ${sel.value ? `${p.settings.customersFolder}/${sel.value}/${p.settings.projectsFolderName || 'Projects'}` : p.projectFolder()}/`);
    sel.addEventListener('change', show);
    show();
    const go = async () => {
      const t = name.value.trim();
      if (!t) return name.focus();
      this.close();
      try {
        await p.createProject(t, sel.value);
      } catch (e) {
        if (!(e && e.neonReadOnly)) {
          console.error('Neon Projects: could not create the project', e);
          new Notice('Could not create the project');
        }
      }
    };
    name.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && go());
    const foot = el.createDiv('modal-button-container');
    button(foot, { text: 'Create project', cls: 'mod-cta', onClick: go });
    window.setTimeout(() => name.focus(), 0);
  }
  onClose() {
    this.contentEl.empty();
  }
}
