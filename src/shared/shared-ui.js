/* ---- shared UI helpers: modals, path suggestions, long press (split from shared.js) ---- */

/* ---- modals --------------------------------------------------------- */
class PromptModal extends Modal {
  constructor(app, { title, value = '', placeholder = '', cta = 'OK', onSubmit }) {
    super(app);
    Object.assign(this, { title, value, placeholder, cta, onSubmit });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(this.title);
    const input = this.contentEl.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: this.placeholder } });
    input.value = this.value;
    const submit = () => {
      const v = input.value.trim();
      this.close();
      this.onSubmit(v);
    };
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    button(row, { text: this.cta, cls: 'mod-cta', onClick: submit });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}
class ConfirmModal extends Modal {
  constructor(app, { title, text, cta = 'Confirm', warning = true, onConfirm }) {
    super(app);
    Object.assign(this, { title, text, cta, warning, onConfirm });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.text });
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    button(row, {
      text: this.cta,
      cls: this.warning ? 'mod-warning' : 'mod-cta',
      onClick: () => {
        this.close();
        this.onConfirm();
      },
    });
  }
  onClose() {
    this.contentEl.empty();
  }
}
class DatePromptModal extends Modal {
  constructor(app, { title, value, time = false, onSubmit }) {
    super(app);
    Object.assign(this, { title, value, time, onSubmit });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal');
    this.titleEl.setText(this.title);
    const input = this.contentEl.createEl('input', { cls: 'nd-input', attr: { type: this.time ? 'datetime-local' : 'date' } });
    input.value = this.value || '';
    const done = (v) => {
      this.close();
      this.onSubmit(this.time && v ? v.replace('T', ' ') : v);
    };
    const row = this.contentEl.createDiv('nd-modal-row');
    button(row, { text: 'Clear', onClick: () => done('') });
    button(row, { text: 'Save', cls: 'mod-cta', onClick: () => done(input.value) });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        done(input.value);
      }
    });
    window.setTimeout(() => input.focus(), 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* ---- path suggestions (fork) ----------------------------------------------
 * As you type in a folder or file setting, matching vault paths drop down (Obsidian's own suggest UI). */
const PathSuggestBase = obsidian.AbstractInputSuggest || null;
class PathSuggest extends (PathSuggestBase || class {}) {
  /** kind: 'folder' | 'file' (markdown notes) */
  constructor(app, inputEl, kind, onPick) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.kind = kind;
    this.onPick = onPick;
  }
  getSuggestions(q) {
    const t = String(q || '').trim().toLowerCase();
    const all = this.kind === 'folder' ? this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== '/') : this.app.vault.getMarkdownFiles();
    return all
      .filter((f) => f.path.toLowerCase().includes(t))
      .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))
      .slice(0, 50);
  }
  renderSuggestion(f, el) {
    el.setText(f.path);
  }
  selectSuggestion(f) {
    this.inputEl.value = f.path;
    this.inputEl.dispatchEvent(new Event('input'));
    if (this.onPick) this.onPick(f.path);
    this.close();
  }
}
/** Attach folder/file suggestions to a Setting text field (no-op on Obsidian versions without the API). */
function suggestPaths(app, text, kind) {
  if (PathSuggestBase && text && text.inputEl) new PathSuggest(app, text.inputEl, kind);
  return text;
}

/* ---- long press = right-click on phones and tablets (fork) ------------------------------
 * Inside Neon Work's own views, holding a finger still for half a second sends the same
 * "contextmenu" event a right-click does, so every row menu works by touch. The tap that
 * ends the press is swallowed, and a native long-press menu (Android) is not shown twice. */
const LONG_PRESS_MS = 500;
function installLongPress(plugin) {
  let timer = null;
  let start = null;
  let firedAt = 0;
  const inNeon = (el) => !!(el && el.closest && el.closest('.workspace-leaf-content[data-type^="neon"], .nd-island'));
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };
  plugin.registerDomEvent(document, 'pointerdown', (e) => {
    cancel();
    if (e.pointerType !== 'touch' || !inNeon(e.target)) return;
    start = { x: e.clientX, y: e.clientY, target: e.target };
    timer = window.setTimeout(() => {
      timer = null;
      firedAt = Date.now();
      start.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, view: window }));
    }, LONG_PRESS_MS);
  }, true);
  plugin.registerDomEvent(document, 'pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) plugin.registerDomEvent(document, ev, cancel, true);
  const recent = () => Date.now() - firedAt < 800;
  // the tap that ends a long press must not also open the row
  plugin.registerDomEvent(document, 'click', (e) => {
    if (recent() && inNeon(e.target)) (e.preventDefault(), e.stopPropagation());
  }, true);
  // Android also sends its own contextmenu on a long press: one menu is enough
  plugin.registerDomEvent(document, 'contextmenu', (e) => {
    if (e.isTrusted && recent() && inNeon(e.target)) (e.preventDefault(), e.stopPropagation());
  }, true);
  plugin.register(cancel);
}

/**
 * Open a date field's calendar (fork, Planning editor). Chromium's own calendar icon is hard to see in dark themes,
 * so a button calls this: the browser's picker where it has showPicker (desktop), else the field gets the focus,
 * which on phones and tablets opens the system's date picker. Typing a date still works either way.
 */
function showDatePicker(input) {
  if (!input || input.disabled) return false;
  try {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return true;
    }
  } catch (e) {
    // not allowed here (some mobile webviews): fall back to the focus
  }
  input.focus();
  if (typeof input.click === 'function') input.click();
  return false;
}
/** A date field with a calendar button after it (fork). Returns the input. */
function dateField(parent, { value = '', label = 'date', onChange = null } = {}) {
  const box = parent.createDiv('nd-date-field');
  const input = box.createEl('input', { attr: { type: 'date' } });
  input.value = value || '';
  if (onChange) input.addEventListener('change', () => onChange(input.value || null));
  const btn = box.createEl('button', { cls: 'clickable-icon nd-date-pick', attr: { type: 'button', 'aria-label': `Pick the ${label} from a calendar` } });
  setIcon(btn, 'calendar');
  btn.addEventListener('click', () => showDatePicker(input));
  return input;
}
