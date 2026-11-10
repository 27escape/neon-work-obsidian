/* ---- ticket note body -------------------------------------------------- */
function findSection(lines, key) {
  const start = lines.findIndex((l) => SEC[key].re.test(l.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}
/** Append `line` to section `key` (created in canonical order when missing); log lines go on top. */
function addToSection(text, key, line) {
  const lines = text.split('\n');
  let sec = findSection(lines, key);
  if (!sec) {
    // insert before the first later section, else at the end
    let at = lines.length;
    for (const k of SEC_ORDER.slice(SEC_ORDER.indexOf(key) + 1)) {
      const s = findSection(lines, k);
      if (s) {
        at = s[0];
        break;
      }
    }
    const block = [SEC[key].head, line, ''];
    while (at > 0 && lines[at - 1] === '' && at === lines.length) at--;
    if (at > 0 && lines[at - 1] !== '') block.unshift('');
    lines.splice(at, 0, ...block);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  if (key === 'log') {
    // newest log line on top, so the note reads like every view
    let at = sec[0] + 1;
    while (at < sec[1] && lines[at].trim() === '') at++;
    lines.splice(at === sec[1] ? sec[0] + 1 : at, 0, line);
    return lines.join('\n');
  }
  let end = sec[1];
  while (end - 1 > sec[0] && lines[end - 1].trim() === '') end--;
  // an empty "- [ ]" placeholder from old templates is replaced instead of kept
  if (key === 'steps' && end - 1 > sec[0] && /^\s*[-*]\s+\[[ xX]\]\s*(✅[^\n]*)?$/.test(lines[end - 1]) && !lines[end - 1].replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').replace(/✅.*/, '').trim()) {
    lines[end - 1] = line;
  } else lines.splice(end, 0, line);
  return lines.join('\n');
}
function parseTicketBody(text) {
  const lines = text.split('\n');
  const out = { description: [], steps: [], log: [], time: [], shots: [] };
  const sec = (k) => findSection(lines, k);
  const d = sec('description');
  if (d) for (let i = d[0] + 1; i < d[1]; i++) if (lines[i].trim()) out.description.push(lines[i].replace(/^\s*[-*]\s+/, ''));
  const s = sec('steps');
  if (s) {
    for (let i = s[0] + 1; i < s[1]; i++) {
      const m = lines[i].match(/^\s*[-*+]\s+\[(.)\]\s*(.*)$/);
      if (!m) continue;
      let txt = m[2];
      const stamp = txt.match(/\s*✅\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*$/u);
      if (stamp) txt = txt.slice(0, stamp.index);
      if (!txt.trim()) continue;
      out.steps.push({ line: i, done: m[1] !== ' ', text: txt.trim(), at: stamp ? stamp[2] || moment(stamp[1]).format('D MMM') : '' });
    }
  }
  const lg = sec('log');
  if (lg) {
    for (let i = lg[0] + 1; i < lg[1]; i++) {
      const m = lines[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\s*[—–-]+\s*(.*)$/);
      if (m) out.log.push({ when: moment(`${m[1]} ${m[2] || '00:00'}`, 'YYYY-MM-DD HH:mm'), hasTime: !!m[2], text: m[3] });
      else if (/^\s*[-*]\s+\S/.test(lines[i])) out.log.push({ when: null, text: lines[i].replace(/^\s*[-*]\s+/, '') });
    }
  }
  const sh = sec('shots');
  if (sh) {
    for (let i = sh[0] + 1; i < sh[1]; i++) {
      // ![[path]] or ![alt](path)
      const m = lines[i].match(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/) || lines[i].match(/!\[[^\]]*\]\(([^)]+)\)/);
      if (m) out.shots.push({ line: i, link: m[1].trim() });
    }
  }
  const tm = sec('time');
  if (tm) {
    for (let i = tm[0] + 1; i < tm[1]; i++) {
      const m = lines[i].match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\s*·\s*(\d+)\s*m(?:in)?\s*(?:·\s*(.*))?$/);
      if (m) out.time.push({ date: m[1], start: m[2] || '', min: Number(m[3]), note: (m[4] || '').trim() });
    }
  }
  return out;
}


/** Note text for a ticket template. */
function templateMarkdown(tpl) {
  return [
    '---',
    'type: ticket-template',
    'untracked: true',
    `template: ${JSON.stringify(String(tpl.id))}`,
    `priority: ${tpl.priority || 'normal'}`,
    ...(tpl.dueDays != null ? [`due_days: ${tpl.dueDays}`] : []),
    '---',
    '',
    '## Description',
    ...(tpl.description ? [tpl.description] : []),
    '',
    '## Next steps',
    ...tpl.steps.map((s) => `- [ ] ${s}`),
    '',
  ].join('\n');
}
/** A template note back into { id, name, steps, description, priority, dueDays }; null when it isn't one. */
function parseTemplateNote(name, text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm || !/^type:\s*["']?ticket-template["']?\s*$/m.test(fm[1])) return null;
  const val = (k) => {
    const m = fm[1].match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
  };
  const lines = text.slice(fm[0].length).split('\n');
  const d = findSection(lines, 'description');
  const due = parseInt(val('due_days'), 10);
  const prio = val('priority');
  return {
    id: val('template'),
    name,
    steps: parseTicketBody(lines.join('\n')).steps.map((s) => s.text),
    description: d ? lines.slice(d[0] + 1, d[1]).join('\n').trim() : '',
    priority: TICKET_PRIOS.includes(prio) ? prio : 'normal',
    dueDays: Number.isFinite(due) && due >= 0 ? due : null,
  };
}
