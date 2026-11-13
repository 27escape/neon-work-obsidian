
/* =========================================================================
 * NEON WRITE — nicer note writing: a rows × columns table picker, styled tables,
 * dividers, locked callouts and a barely-there pattern behind the note.
 * ========================================================================= */
const { MarkdownView, EditorSuggest } = obsidian;
// fork: the slash menu, the selection toolbar and image moving are removed
const NW_DEFAULTS = {
  liftedWindow: true,
  themeFonts: true,
  styledTables: true,
  notePattern: true,
  limeDividers: true, // --- dividers as a lime dotted line (item 27)
  patternOpacity: 35, // percent of the dashboard pattern's strength (already faint by design)
};
const GRID_COLS = 10;
const GRID_ROWS = 8;

