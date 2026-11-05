
/* =========================================================================
 * NEON WRITE — nicer note writing: a rows × columns table picker, a / menu,
 * a toolbar on selected text and a barely-there pattern behind the note.
 * ========================================================================= */
const { MarkdownView, EditorSuggest } = obsidian;
const NW_DEFAULTS = {
  slashMenu: true,
  toolbar: true,
  liftedWindow: true,
  themeFonts: true,
  styledTables: true,
  moveImages: true,
  notePattern: true,
  limeDividers: true, // --- dividers as a lime dotted line (item 27)
  patternOpacity: 35, // percent of the dashboard pattern's strength (already faint by design)
};
const GRID_COLS = 10;
const GRID_ROWS = 8;

