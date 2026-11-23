# SelectRow

- **Use for:** Represent one Thread in a selectable management list with a separate checkbox, link and in-flow actions.
- **Do not use for:** Use ThreadItem in the sidebar and ThreadGroup for a section band.
- **Why:** A separate selection target doesn't interfere with opening a Thread; depth and move availability come from real relationships and capabilities.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Keep move action beside the title. Use a stable link ID for the containing list’s focus claim;
if the row disappears while focus is still in the list, advance to the next link or heading.
List containers have no inline padding; align the action with the section band.

Styles: style.css in this directory
