/* ---- Project plans (fork): the task editor's link controls --------------------------------------------------
 * On each Depends on chip: after (⛔), starts with ([starts-with:: ]) or ends with ([ends-with:: ]), and a lag in
 * working days for the last two. Split from plan-editor.js. */
Object.assign(PlanTaskModal.prototype, {
  /** On a dependency chip: how it is linked (after / starts with / ends with) and, for the last two, a lag. */
  linkControls(chip, d) {
    const sel = chip.createEl('select', { cls: 'dropdown np-ed-linktype' });
    for (const [k, label] of [['fs', 'after'], ['ss', 'starts with'], ['ff', 'ends with']]) sel.createEl('option', { text: label, attr: { value: k } });
    sel.value = d.type || 'fs';
    tip(sel, 'After: starts when that one finishes (⛔). Starts with: starts no earlier than it starts. Ends with: finishes no earlier than it finishes.');
    sel.addEventListener('change', () => {
      d.type = sel.value;
      if (d.type === 'fs') d.lag = 0;
      this.update();
    });
    if (d.type === 'fs') return;
    const lag = chip.createEl('input', { cls: 'np-ed-lag', attr: { type: 'number', min: '0', step: '1', value: String(d.lag || 0), 'aria-label': 'Lag in working days' } });
    tip(lag, 'Lag: working days after (0: at the same time)');
    lag.addEventListener('change', () => {
      d.lag = Math.max(0, Math.round(Number(lag.value) || 0));
      this.update();
    });
    chip.createSpan({ cls: 'np-ed-lag-unit', text: 'd' });
  },
});
