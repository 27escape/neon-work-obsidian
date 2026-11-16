/* ---- Inbox tab (fork) ----------------------------------------------------------------
 * The Inbox card full size in the main pane, listed in the sidebar with Dashboard, Tasks, Projects… */
class InboxView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_INBOX;
  }
  getDisplayText() {
    return 'Inbox';
  }
  getIcon() {
    return 'inbox';
  }
  async onOpen() {
    const p = this.plugin;
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-inbox-view');
    const inner = root.createDiv('nd-inbox-view-inner');
    const card = widget(inner, 'nd-inbox-page', 'Inbox', 'inbox', p.inboxFolder());
    p.mountInbox(card, this);
  }
  async onClose() {
    this.contentEl.empty();
  }
}
