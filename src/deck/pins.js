/* ---- pin board note: one pin per line ---------------------------------- */
// `- [[path]]` or `- ![[path]]` is a file pin, any other line a text pin; frontmatter and # headings are skipped
function parsePins(text) {
  return stripFrontmatter(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l))
    .map((raw) => {
      const body = raw.replace(/^[-*+]\s+/, '');
      const m = body.match(/^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
      return m ? { raw, link: m[1].trim() } : { raw, text: body };
    });
}
/** The note with `line` added at the end (unchanged when that pin is already there). */
function addPinLine(text, line) {
  text = text || '';
  if (parsePins(text).some((p) => p.raw === line)) return text;
  return (text && !text.endsWith('\n') ? text + '\n' : text) + line + '\n';
}
/** The note without the first line that is `raw` (trimmed). */
function removePinLine(text, raw) {
  const lines = (text || '').split('\n');
  const i = lines.findIndex((l) => l.trim() === raw);
  if (i < 0) return text;
  lines.splice(i, 1);
  return lines.join('\n');
}
/** One pin line for a piece of text: a single line, never read back as a link or heading. */
function textPinLine(text) {
  return `- ${String(text).replace(/\s*\n\s*/g, ' ').trim()}`;
}
