
/* ------------------------------------------------------------------ */
/* Neon Tasks                                                          */
/* ------------------------------------------------------------------ */

const TASKS_DEFAULTS = {
  // fork: one Todo note replaces both "Quick tasks" and the Global tasks list kept in plugin data
  quickTasksPath: 'Todo.md', // the Todo note: new tasks go at its head; its open tasks fill the Todo card
  taskTag: '#task', // fork: a checkbox line with this tag is a task wherever it is (Tasks-plugin style); empty = off
  backupPath: 'Neon/Global tasks backup.md', // unused since the fork (Global tasks are the Todo note)
  askOnCreate: true,
  stampDone: true,
  carryDays: 14,
  showNoCategoryBar: true,
  installedAt: 0,
  globalTasks: [],
  doneLog: [],
  lastBackup: '',
};
const SYSTEM_FOLDERS = ['Neon']; // fork: plus the review, time log and ticket folders from settings (see isSystemPath)
const PROP_ORDER = [
  'type', 'title', 'ticket', 'status', 'priority', 'tags', 'aliases',
  'projects', 'school', 'admin', 'operations', 'untracked',
  'created', 'due', 'remind', 'completed', 'waiting_on', 'follow_up', 'waiting_since', 'jira', 'cover',
];
// fork: "[/]" (in progress, Tasks plugin) is an open task too
const TASK_LINE_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[[ /]\]\s+(.*)$/;
const OPEN_BOX_RE = /\[[ /]\]/;
const escTag = (tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Does a task's text carry the task tag (e.g. #task, not #tasks or #task/sub)? */
function hasTaskTag(raw, tag) {
  if (!tag) return false;
  return new RegExp(`(^|\\s)${escTag(tag)}(?=$|\\s)`, 'iu').test(raw);
}
/** A note's text with a new task line at its head: after the properties, above the first task there. */
function addTaskAtHead(text, line) {
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
  const head = fm ? fm[0] : '';
  let rest = text.slice(head.length);
  const blank = rest.match(/^(?:[ \t]*\r?\n)*/)[0];
  rest = rest.slice(blank.length);
  const nextIsTask = TASK_LINE_RE.test(rest.split('\n')[0] || '') || /^\s*[-*+]\s+\[[^\]]\]/.test(rest);
  return head + (head ? '\n' : '') + line + '\n' + (rest && !nextIsTask ? '\n' : '') + rest;
}

/** Clean display text of a task line (Tasks-plugin emoji and the task tag stripped). */
function taskDisplay(raw, tag = '#task') {
  return excerptOf(
    raw
      .replace(tag ? new RegExp(`(^|\\s)${escTag(tag)}(?=$|\\s)`, 'giu') : /$^/, '$1')
      .replace(/(?:📅|⏳|🛫|✅|➕)\s*\d{4}-\d{2}-\d{2}/gu, '')
      .replace(/🔁[^📅⏳🛫✅➕]*/gu, '')
      .replace(/[⏫🔼🔽🔺⏬]/gu, ''),
    140,
  );
}

/**
 * Group of a task: by its 📅 due date; else ⏳ scheduled on or before today → Today (fork);
 * else Today for a daily note; else Later. `due` is the date shown (due, else scheduled).
 */
function taskGroup(raw, daily, todayKey) {
  const date = (e) => (raw.match(new RegExp(`${e}\\s*(\\d{4}-\\d{2}-\\d{2})`, 'u')) || [])[1] || null;
  const due = date('📅');
  if (due) return { due, group: due < todayKey ? 'overdue' : due === todayKey ? 'today' : 'later' };
  const sched = date('⏳');
  if (sched) return { due: sched, group: sched <= todayKey ? 'today' : 'later' };
  return { due: null, group: daily ? 'today' : 'later' };
}
/** Quick shake, e.g. Enter on an empty add box. */
function shake(el) {
  el.removeClass('is-shake');
  void el.offsetWidth; // restart the animation
  el.addClass('is-shake');
}
/** True while the user types in an edit field inside `list`: don't touch the list then. */
const editingIn = (list) => !!(document.activeElement && document.activeElement.matches('.nt-edit') && list.contains(document.activeElement));
/** Collapse a row out of its list, then remove it. */
function leaveRow(el) {
  if (prefersReducedMotion() || !el.hasClass('nt-task')) return el.remove();
  el.style.height = `${el.offsetHeight}px`;
  void el.offsetHeight; // start the collapse from the current height
  el.addClass('is-leaving');
  window.setTimeout(() => el.remove(), 260);
}
/**
 * Make `list` show `want` (elements, in order) without redrawing: kept rows stay, new ones are
 * inserted, the rest collapse out, and rows that move glide to their new place.
 */
function patchList(list, want) {
  const keep = new Set(want);
  const top = new Map([...list.children].map((el) => [el, el.getBoundingClientRect().top]));
  for (const el of [...list.children]) if (!keep.has(el) && !el.hasClass('is-leaving')) leaveRow(el);
  let cur = list.firstChild;
  for (const el of want) {
    while (cur && cur !== el && cur.hasClass('is-leaving')) cur = cur.nextSibling;
    if (cur === el) cur = cur.nextSibling;
    else list.insertBefore(el, cur);
  }
  if (prefersReducedMotion()) return;
  for (const el of want) {
    const t0 = top.get(el);
    const dy = t0 == null ? 0 : t0 - el.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}

class NewNoteModal extends Modal {
  /** opts: { folder, file (existing empty note), name } */
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const { file } = this.opts;
    this.modalEl.addClass('nd-modal', 'nt-newnote');
    this.titleEl.setText(file ? 'New note · a few questions' : 'New note');
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
    const kinds = [['note', 'Note'], ['tasks', 'Task list']];
    if (this.plugin.ticketService()) kinds.push(['ticket', 'Project']);
    this.kind = pills(field('Kind'), kinds, 'note', (v) => sync());
    this.cat = pills(
      field('Category', 'for the time tracker · optional'),
      [...CATS.map((k) => [k, CAT_LABEL[k]]), ['untracked', 'Untracked']],
      null,
      null,
      'can-clear nt-cats',
    );
    for (const k of CATS) this.cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
    this.cat.btns.get('untracked').style.setProperty('--pill-accent', 'var(--nd-muted)');
    const folderField = field('Folder');
    const folder = folderField.createEl('input', { cls: 'nd-input', attr: { type: 'text', list: 'nt-folders', placeholder: '/ (vault root)' } });
    const dl = folderField.createEl('datalist', { attr: { id: 'nt-folders' } });
    for (const f of this.app.vault.getAllLoadedFiles()) if (f instanceof TFolder && f.path !== '/') dl.createEl('option', { value: f.path });
    folder.value = file ? (file.parent && file.parent.path !== '/' ? file.parent.path : '') : this.opts.folder && this.opts.folder !== '/' ? this.opts.folder : '';
    const note = c.createDiv({ cls: 'nt-note', text: 'You can close this and just type — the note keeps a small “No category yet” reminder.' });
    const row = c.createDiv('nd-modal-row');
    row.createDiv({ cls: 'nt-keys', text: 'Enter / Ctrl+Enter creates · Esc skips' });
    button(row, { text: file ? 'Skip' : 'Cancel', onClick: () => this.close() });
    const go = button(row, { text: file ? 'Save' : 'Create', cls: 'mod-cta', onClick: () => this.submit(name.value, folder.value) });
    const sync = () => {
      const t = this.kind.get() === 'ticket';
      folderField.toggle(!t);
      note.setText(t ? 'Opens the New project form with this name as the title.' : 'You can close this and just type — the note keeps a small “No category yet” reminder.');
      go.querySelector('.nd-btn-label').setText(t ? 'Continue' : file ? 'Save' : 'Create');
    };
    c.addEventListener('keydown', (e) => {
      // Enter creates from anywhere in the card (also right after clicking a category pill)
      // (Enter on a focused Skip / Cancel / Create button keeps that button's own action)
      const inFooter = e.target instanceof HTMLElement && e.target.closest('.nd-modal-row');
      if (e.key === 'Enter' && !e.isComposing && !inFooter) {
        e.preventDefault();
        this.submit(name.value, folder.value);
      }
    });
    sync();
    window.setTimeout(() => {
      name.focus();
      name.select();
    }, 20);
  }
  async submit(nameRaw, folderRaw) {
    const name = safeName(nameRaw) || 'Untitled';
    const kind = this.kind.get();
    const cat = this.cat.get();
    this.close();
    const { file } = this.opts;
    if (kind === 'ticket') {
      if (file && !(await this.app.vault.read(file)).trim()) await this.app.fileManager.trashFile(file);
      return this.plugin.ticketService()({ title: name, category: CATS.includes(cat) ? cat : null });
    }
    const props = (fm) => {
      if (kind === 'tasks') fm.tags = [...new Set([...fmTags(fm), 'tasks'])];
      if (CATS.includes(cat)) fm[cat] = true;
      if (cat === 'untracked') fm.untracked = true;
      if (!fm.created) fm.created = moment().format('YYYY-MM-DD');
    };
    let target = file;
    if (target) {
      const dest = normalizePath(`${folderRaw.trim() && folderRaw.trim() !== '/' ? folderRaw.trim() + '/' : ''}${name}.md`);
      if (dest !== target.path) {
        if (this.app.vault.getAbstractFileByPath(dest)) new Notice('A note with that name already exists — kept the old name');
        else {
          await ensureFolder(this.app, dest.split('/').slice(0, -1).join('/'));
          await this.app.fileManager.renameFile(target, dest);
        }
      }
    } else {
      this.plugin.selfCreated.add('pending');
      try {
        target = await createUnique(this.app, folderRaw.trim() || '/', name, kind === 'tasks' ? '\n- [ ] ' : '\n');
      } finally {
        this.plugin.selfCreated.delete('pending');
      }
    }
    await this.app.fileManager.processFrontMatter(target, (fm) => {
      props(fm);
      reorderProps(fm);
    });
    if (!file) await reusableLeaf(this.app).openFile(target, { active: true, state: { mode: 'source' } });
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Put known properties in a fixed order; others keep their order after them. */
function reorderProps(fm) {
  const entries = Object.entries(fm);
  for (const [k] of entries) delete fm[k];
  const rank = (k) => {
    const i = PROP_ORDER.indexOf(k);
    return i < 0 ? PROP_ORDER.length : i;
  };
  entries
    .map((e, i) => [e, i])
    .sort((a, b) => rank(a[0][0]) - rank(b[0][0]) || a[1] - b[1])
    .forEach(([[k, v]]) => (fm[k] = v));
}

class UncategorisedModal extends SuggestModal {
  constructor(plugin, files) {
    super(plugin.app);
    this.files = files;
    this.setPlaceholder('Notes without a category — pick one to open it');
    this.modalEl.addClass('nd-modal');
  }
  getSuggestions(q) {
    q = q.toLowerCase();
    return this.files.filter((f) => f.path.toLowerCase().includes(q));
  }
  renderSuggestion(f, el) {
    el.createDiv({ cls: 'nd-suggest-title', text: f.basename });
    el.createDiv({ cls: 'nd-suggest-meta', text: `${f.parent && f.parent.path !== '/' ? f.parent.path + ' · ' : ''}created ${moment(f.stat.ctime).fromNow()}` });
  }
  onChooseSuggestion(f, evt) {
    openFile(this.app, f, evt);
  }
}

