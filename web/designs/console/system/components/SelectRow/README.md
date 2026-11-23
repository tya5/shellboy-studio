# SelectRow

- **Use for:** Represent one Thread in a selectable management list with a separate checkbox, link and in-flow actions.
- **Do not use for:** Use ThreadItem in the sidebar and ThreadGroup for a section band.
- **Why:** A separate selection target doesn't interfere with opening a Thread; depth and move availability come from real relationships and capabilities.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

A Thread in a list that supports choosing several. The checkbox chooses and the title opens. Depth reflects a real parent link; `note` names a parent outside the group. `drag` is present only when moving a Thread is available. `moveAction` stays in place beside the title.

`ListRow` supplies the row shell and in-flow menu trigger; the separate checkbox, title link, tags, drag handlers and trailing age retain their existing positions. It follows the shadcn/ui `SidebarMenuAction` (`showOnHover`) states: hover, `:focus-within`, selection, and open on hover-capable devices; always visible on touch. Its width stays reserved so the title truncates in place. Menu keyboard behavior follows the WAI-ARIA APG Menu Button pattern and shadcn/ui `DropdownMenu` / Radix.


The caller's `linkId` is the stable id of the title link. A containing list uses it for
a focus claim while focus remains inside the list; if the claimed row disappears, the
list advances to the next row link or its heading.

Styles are colocated in `system/components/SelectRow/style.css`.

Styles: style.css in this directory


The management list container has no inline padding. Rows fill the section-band width and own their shared-token insets, with the trailing action aligned to the band chevron; title/depth content keeps its inset. A top-level row's checkbox fills the same leading column as the ThreadGroup band checkbox, so the two share one left edge; depth indents in `space-16` steps from there. At phone width the title link is at least `size-touch` high. References: shadcn/ui SidebarMenuAction (`showOnHover`) and Orca sidebar rows.
