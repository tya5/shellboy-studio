# ConversationHeader

- **Use for:** Show title, owner status and Thread actions; retain only list opener, title, status and overflow on phones.
- **Do not use for:** Use Composer for model, effort and context controls.
- **Why:** The header reuses the row menu for its actions rather than introducing another menu interaction.
- **Source:** [Studio #66](https://github.com/tya5/shellboy-studio/issues/66); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Conversation title, owner status, and desktop actions. Design system v2 header: the status follows the title with the title group's `space-4` gap plus its `space-8` start margin, and every trailing action is a ghost icon button (`size-control`, `size-touch` at phone width) `space-8` apart; the ShellToggle stays in ShellFooter. Navigation such as Branches is not a menu action: it stays in the navigation and the per-message link. In phone layout, only the list button, title, status and overflow remain. Uses the existing row menu (WAI-ARIA APG menu button, Studio row actions) rather than a second menu implementation. Model and context controls belong in Composer, not here.

Styles: style.css in this directory.
