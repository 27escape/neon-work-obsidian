/* ---- in-app help (fork) ------------------------------------------------------------------------------------
 * A ? button in the header of every Neon Work tab opens the README section for that part, inside Obsidian (works
 * offline, matches the installed version). NEON_HELP is written into main.js by tools/build.mjs (tools/help.mjs):
 * { key: { title, md, url } }. Pictures are links to GitHub, and each section links to the full README there. */

/** The help topics in this build ({} when there are none, e.g. in unit tests). */
const helpTopics = () => (typeof NEON_HELP === 'object' && NEON_HELP) || {};

class HelpModal extends Modal {
  /** key: the topic to open first (dashboard, tasks, projects, planning, research, time, …). */
  constructor(app, key) {
    super(app);
    this.key = key;
  }
  onOpen() {
    this.modalEl.addClass('nd-help-modal');
    this.titleEl.setText(`${appName()} help`);
    this.comp = new obsidian.Component();
    this.comp.load();
    const topics = helpTopics();
    const keys = Object.keys(topics);
    if (!keys.length) return void this.contentEl.createDiv({ cls: 'nd-empty', text: 'There is no help in this build.' });
    this.navEl = this.contentEl.createDiv('nd-help-nav');
    for (const k of keys) this.navEl.createEl('button', { cls: 'nd-pill-btn', text: topics[k].title, attr: { 'data-key': k } }).addEventListener('click', () => this.show(k));
    this.bodyEl = this.contentEl.createDiv('nd-help-body markdown-rendered');
    this.footEl = this.contentEl.createDiv('nd-help-foot');
    this.show(topics[this.key] ? this.key : keys[0]);
  }
  async show(key) {
    const t = helpTopics()[key];
    if (!t) return;
    this.key = key;
    this.navEl.querySelectorAll('button').forEach((b) => b.toggleClass('is-on', b.getAttribute('data-key') === key));
    this.bodyEl.empty();
    this.bodyEl.createEl('h2', { text: t.title });
    const md = this.bodyEl.createDiv();
    const R = obsidian.MarkdownRenderer;
    try {
      if (R && R.render) await R.render(this.app, t.md, md, '', this.comp);
      else if (R && R.renderMarkdown) await R.renderMarkdown(t.md, md, '', this.comp);
    } catch (e) {
      console.error(`${appName()}: help`, e);
      md.setText(t.md);
    }
    this.bodyEl.scrollTop = 0;
    this.footEl.empty();
    this.footEl.createEl('a', { cls: 'external-link', text: 'Read this on GitHub, with pictures', attr: { href: t.url, target: '_blank', rel: 'noopener' } });
  }
  onClose() {
    if (this.comp) this.comp.unload();
    this.contentEl.empty();
  }
}

/** Add the ? button to a view's header (once), opening the help at this topic. */
function addHelpAction(view, key) {
  if (view.neonHelpEl || !view.addAction) return;
  view.neonHelpEl = view.addAction('help-circle', `${appName()} help`, () => new HelpModal(view.app, key).open());
}
