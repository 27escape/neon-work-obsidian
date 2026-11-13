Object.assign(NeonTime.prototype, {
  /** fork: the time log folder, inside the base folder unless set */
  logFolder() {
    return locPath(this.settings.logFolder, 'Time Log');
  },
  /* ---- log notes --------------------------------------------------------- */
  dayNotePath(key) {
    return normalizePath(`${this.logFolder()}/${key}.md`);
  },
  async openDayNote(key) {
    await this.writeDay(key, true);
    const f = this.app.vault.getAbstractFileByPath(this.dayNotePath(key));
    if (f instanceof TFile) openFile(this.app, f);
    else new Notice('Nothing logged on this day yet.');
  },
  dayNote(key, synced) {
    const d = this.days[key] || { entries: [], done: [] };
    const s = this.summary(key, false);
    const m = moment(key, 'YYYY-MM-DD');
    const lines = ['---', `date: ${key}`, `total_min: ${s.total}`, `untracked_min: ${s.untracked}`, `break_min: ${s.breaks}`];
    for (const k of timeCats()) lines.push(`${k.replace(/[^a-z0-9]+/g, '_')}_min: ${s.by[k]}`); // fork: customer names → safe keys
    lines.push(`target_min: ${s.target}`, `overtime_min: ${s.over}`, `synced: ${synced ? 'true' : 'false'}`, '---', '');
    lines.push(`# Time log · ${m.format('ddd D MMM YYYY')}`, '');
    const split = timeCats().filter((k) => s.by[k]).map((k) => `${CAT_LABEL[k]} ${fmtMin(s.by[k])}`);
    lines.push(`**${fmtMin(s.total)}**${s.target ? ` of ${fmtMin(s.target)}` : ' (weekend)'}${s.over ? ` · +${fmtMin(s.over)} overtime` : ''}${split.length ? ' · ' + split.join(' · ') : ''}`, '');
    lines.push('## Done today');
    const notes = new Map();
    for (const e of d.entries) if (e.path && e.source === 'auto') notes.set(e.path, (notes.get(e.path) || 0) + e.ms);
    const done = [];
    for (const [path, ms] of notes) done.push(`- Worked on [[${path.replace(/\.md$/, '')}|${cell(path.split('/').pop().replace(/\.md$/, ''))}]] (${fmtMin(ms / 60000)})`);
    for (const x of d.done.filter((x) => x.kind === 'task')) done.push(`- [x] ${x.text}`);
    const tickets = new Map();
    for (const x of d.done.filter((x) => x.kind === 'ticket')) {
      const t = tickets.get(x.ref) || { text: x.text, changes: [] };
      if (x.change && !t.changes.includes(x.change)) t.changes.push(x.change);
      const path = x.path || (/\.md$/.test(x.ref) ? x.ref : '');
      if (path) t.path = path; // latest location wins
      tickets.set(x.ref, t);
    }
    for (const [ref, t] of tickets) {
      const name = t.path ? `[[${t.path.replace(/\.md$/, '')}|${cell(t.text || ref)}]]` : t.text || ref;
      done.push(`- 🎫 ${name}: ${t.changes.join('; ')}`);
    }
    lines.push(...(done.length ? done : ['- (nothing yet)']), '');
    if (d.tomorrow) lines.push('## Tomorrow', d.tomorrow, '');
    const w = this.workOf(key);
    if (w) {
      const hm = (t) => moment(t).format('HH:mm');
      lines.push('## Workday', `Started ${hm(w.start)}${w.end ? ` · ended ${hm(w.end)}` : ''} · worked ${fmtMin(this.workMin(key))}`);
      for (const [a, b] of w.breaks) lines.push(`- Break ${hm(a)}–${b == null ? 'now' : hm(b)}${b == null ? '' : ` (${fmtMin(Math.round((b - a) / 60000))})`}`);
      lines.push('');
    }
    lines.push('## Entries', '| Start | Min | Category | Note | Jira | Source |', '| --- | --- | --- | --- | --- | --- |');
    for (const e of [...d.entries].sort((a, b) => a.start - b.start)) {
      const note = e.note || (e.path ? `[[${e.path.split('/').pop().replace(/\.md$/, '')}]]` : '');
      lines.push(`| ${moment(e.start).format('HH:mm')} | ${entryMin(e)} | ${e.cat} | ${cell(note)} | ${cell(e.jira)} | ${e.source} |`);
    }
    return lines.join('\n') + '\n';
  },
  /** Write (or update) a day's log note. Keeps `synced: true` unless the entries changed. */
  async writeDay(key, force) {
    if (!this.settings.writeNotes && !force) return;
    const d = this.days[key];
    const path = this.dayNotePath(key);
    const f = this.app.vault.getAbstractFileByPath(path);
    const empty = !d || (!d.entries.length && !d.done.length && !d.tomorrow && !this.workOf(key));
    // nothing to write for a new day; an existing note is still rewritten so deleted time disappears from it
    if (empty && !(f instanceof TFile)) return;
    const table = (t) => (t.split(/\n## Entries\n/)[1] || '').trim();
    try {
      if (f instanceof TFile) {
        await writeNote(this.app, f, (old) => {
          const wasSynced = /^synced:\s*true\s*$/m.test(old.split(/\n---/)[0] || '');
          const fresh = this.dayNote(key, false);
          const next = wasSynced && table(old) === table(fresh) ? this.dayNote(key, true) : fresh;
          return next === old ? old : next;
        });
      } else {
        await ensureFolder(this.app, this.settings.logFolder);
        await this.app.vault.create(path, this.dayNote(key, false));
      }
    } catch (e) {
      console.error('Neon Time: could not write log note', e);
    }
  },
  readmeSoon() {
    if (!this._readme) this._readme = debounce(() => this.ensureReadme(), 2000, true);
    this._readme();
  },
  async ensureReadme() {
    if (!this.settings.writeNotes) return;
    const path = normalizePath(`${this.settings.logFolder}/README.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const target = Math.round(this.settings.dayHours * 60);
    const idle = this.settings.idleMin;
    const text = [
      '# Time Log — format',
      '',
      'Neon Time writes one note per day here, named `YYYY-MM-DD.md`. It never connects to Jira or the network; an AI agent reads these notes and sends them on.',
      '',
      '## Properties',
      '- `date` — the day.',
      '- `total_min` — minutes worked: the category minutes added up, or the workday timer (Start day to End day minus breaks) when that is longer.',
      '- `untracked_min` — workday minutes not covered by a category; `break_min` — breaks in the workday (not counted as worked).',
      '- `projects_min`, `school_min`, `admin_min`, `operations_min`, `other_min` — active minutes per category (`other` = notes without a category).',
      `- \`target_min\` — ${target} on weekdays (${fmtMin(target)}), 0 on weekends. \`overtime_min\` — time past the target.`,
      '- `synced` — set to `true` once the day has been sent to Jira. Neon Time keeps it, unless entries change afterwards, then it goes back to `false`.',
      '',
      '## Body',
      '- **Done today** — notes worked on, tasks ticked and project changes.',
      '- **Tomorrow** — the line written in Wrap up, if any.',
      '- **Workday** — when the work timer started and ended, time worked, and each break.',
      '- **Entries** — one row per block of work:',
      '',
      '| Start | Min | Category | Note | Jira | Source |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 09:12 | 47 | projects | [[API migration]] | PROJ-142 | auto |',
      '| 10:05 | 30 | operations | Customer call |  | manual |',
      '',
      '`Source` is `auto` (counted while you worked in the note), or `manual` (added by hand).',
      'The Jira key comes from the note’s `jira` property, or was typed in by hand.',
      '',
      `Auto time counts while a note is the focused tab and you type, scroll or click, also while you are briefly in another app; after ${idle} minute${idle === 1 ? '' : 's'} without input in Obsidian it ends at your last activity and the idle time is dropped. Short bits of work on the same note add up and become an entry once they reach a minute; bits still under a minute are saved when tracking is paused or Obsidian closes. Back-to-back sessions on the same note are merged, and a session past midnight is split between the two days. Notes with \`untracked: true\` are never logged.`,
      '',
      'These notes are rewritten by Neon Time; edits to them are overwritten (except `synced`). Change entries in the Time tab instead. This README is rewritten too when the Neon Time settings change.',
      '',
    ].join('\n');
    try {
      if (existing instanceof TFile) {
        // keep it in step with the settings, as long as it's still the generated README
        await writeNote(this.app, existing, (old) => (old.startsWith('# Time Log — format') ? text : old));
      } else if (!existing) {
        await ensureFolder(this.app, this.settings.logFolder);
        await this.app.vault.create(path, text);
      }
    } catch (e) {
      console.error('Neon Time: README', e);
    }
  },

});
