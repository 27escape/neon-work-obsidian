/* ---- slash menu ------------------------------------------------------- */
const SLASH_ITEMS = [
  { id: 'table', icon: 'table', label: 'Table', hint: 'pick rows × columns', keys: ['table', 'grid'], run: (ed, p) => p.openTablePicker(ed) },
  { id: 'h1', icon: 'heading-1', label: 'Heading 1', hint: '#', keys: ['h1', 'heading', 'title'], run: (ed) => setLinePrefix(ed, '# ') },
  { id: 'h2', icon: 'heading-2', label: 'Heading 2', hint: '##', keys: ['h2', 'heading'], run: (ed) => setLinePrefix(ed, '## ') },
  { id: 'h3', icon: 'heading-3', label: 'Heading 3', hint: '###', keys: ['h3', 'heading'], run: (ed) => setLinePrefix(ed, '### ') },
  { id: 'sub', icon: 'heading-4', label: 'Sub-title', hint: '####', keys: ['sub', 'subtitle', 'h4'], run: (ed) => toggleSubtitle(ed) },
  { id: 'todo', icon: 'check-square', label: 'Checklist', hint: '- [ ]', keys: ['todo', 'task', 'check'], run: (ed) => setLinePrefix(ed, '- [ ] ') },
  { id: 'bullet', icon: 'list', label: 'Bullet list', hint: '-', keys: ['bullet', 'list', 'ul'], run: (ed) => setLinePrefix(ed, '- ') },
  { id: 'number', icon: 'list-ordered', label: 'Numbered list', hint: '1.', keys: ['number', 'ol', 'list'], run: (ed) => setLinePrefix(ed, '1. ') },
  { id: 'quote', icon: 'quote', label: 'Quote', hint: '>', keys: ['quote'], run: (ed) => setLinePrefix(ed, '> ') },
  { id: 'callout', icon: 'message-square-quote', label: 'Callout', hint: '> [!note]', keys: ['callout', 'note', 'info'], run: (ed) => makeCallout(ed) },
  {
    id: 'code',
    icon: 'code-2',
    label: 'Code block',
    hint: '```',
    keys: ['code', 'snippet'],
    run: (ed) => {
      const l = ed.getCursor().line;
      ed.setLine(l, '```\n\n```');
      ed.setCursor({ line: l + 1, ch: 0 });
    },
  },
  {
    id: 'divider',
    icon: 'minus',
    label: 'Divider',
    hint: '---',
    keys: ['divider', 'line', 'hr'],
    run: (ed) => insertDivider(ed),
  },
  { id: 'pagebreak', icon: 'file-minus', label: 'Page break', hint: 'PDF: new page', keys: ['pagebreak', 'umbruch', 'page', 'break'], run: (ed) => insertPageBreak(ed) },
  { id: 'link', icon: 'link', label: 'Link to note', hint: '[[', keys: ['link', 'note', 'wiki'], run: (ed) => ed.replaceSelection('[[') },
  { id: 'date', icon: 'calendar', label: 'Today’s date', hint: moment().format('YYYY-MM-DD'), keys: ['date', 'today'], run: (ed) => ed.replaceSelection(moment().format('YYYY-MM-DD')) },
];
class SlashSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.limit = 20;
  }
  onTrigger(cursor, editor) {
    if (!this.plugin.settings.slashMenu) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    // a / at the start of a line or after a space, so paths and URLs don't open the menu
    const m = before.match(/(?:^|\s)\/([\w-]{0,20})$/);
    if (!m || inCodeBlock(editor, cursor.line)) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] };
  }
  getSuggestions(ctx) {
    const q = ctx.query.toLowerCase();
    const items = SLASH_ITEMS;
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.keys.some((k) => k.startsWith(q)));
  }
  renderSuggestion(item, el) {
    el.addClass('nw-slash-item');
    icon(el, item.icon, 'nw-slash-ico');
    el.createSpan({ cls: 'nw-slash-label', text: item.label });
    el.createSpan({ cls: 'nw-slash-hint', text: item.hint });
  }
  selectSuggestion(item) {
    const ctx = this.context;
    if (!ctx) return;
    const ed = ctx.editor;
    ed.replaceRange('', ctx.start, ctx.end);
    ed.setCursor(ctx.start);
    this.close();
    item.run(ed, this.plugin);
  }
}

