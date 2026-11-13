/* ---- wrap up ------------------------------------------------------------ */
class WrapUpModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    const p = this.plugin;
    const key = moment().format('YYYY-MM-DD');
    const sum = p.summary(key, true);
    const day = p.day(key);
    this.modalEl.addClass('nd-modal', 'tm-wrap');
    this.titleEl.setText(`Wrap up · ${moment().format('dddd D MMM')}`);
    const c = this.contentEl;
    const top = c.createDiv('tm-wrap-top');
    p.donut(top, sum, 96, true);
    const bars = top.createDiv('tm-legend');
    p.legend(bars, sum);
    const facts = c.createDiv('tm-wrap-facts');
    const fact = (v, l, cls = '') => {
      const f = facts.createDiv(`tm-fact ${cls}`);
      f.createDiv({ cls: 'tm-fact-v', text: String(v) });
      f.createDiv({ cls: 'tm-fact-l', text: l });
    };
    fact(fmtMin(sum.total), sum.target ? `of ${fmtMin(sum.target)}` : 'weekend');
    fact(sum.over ? `+${fmtMin(sum.over)}` : '—', 'overtime', sum.over ? 'is-over' : '');
    fact(day.done.filter((d) => d.kind === 'task').length, 'tasks done');
    fact(new Set(day.done.filter((d) => d.kind === 'ticket').map((d) => d.ref)).size, 'projects moved');
    c.createDiv({ cls: 'tm-label', text: 'A line about tomorrow' });
    const ta = c.createEl('textarea', { cls: 'nd-input', attr: { rows: '2', placeholder: 'Start with…' } });
    ta.value = day.tomorrow || '';
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    button(row, {
      text: 'Save to log',
      cls: 'mod-cta',
      onClick: async () => {
        day.tomorrow = ta.value.trim();
        day.wrapped = true;
        this.close();
        p.closeSession();
        p.workEnd(key);
        p.changed(key);
        await p.writeDay(key, true);
        new Notice('✦ Day wrapped up. Nice work.');
      },
    });
    window.setTimeout(() => ta.focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

