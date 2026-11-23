# FilterMenu

- **Use for:** Open optional list filters from a count-bearing Menu beside search; show applied choices in FilterChips.
- **Do not use for:** Use Menu for row actions and NavItem for route changes.
- **Why:** The trigger stays compact; catalog paging stays in the menu, and catalog reads and subscriptions end when it closes.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

A count-bearing Menu button for optional list filters. Place it beside the search
control; use FilterChips to show and remove the active filters. Do not use it for
row mutations or for navigation.

References: Orca sidebar filters, shadcn/ui DropdownMenu, WAI-ARIA Menu Button.

Catalog paging actions keep the menu open; choices are owner catalog facts, not the filtered rows.

Catalog reads and their hint subscriptions live only while this menu is open. Closing or leaving the route cancels them.
