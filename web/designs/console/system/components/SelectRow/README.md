A Thread in a list that supports choosing several. The checkbox chooses and the title opens. Depth reflects a real parent link; `note` names a parent outside the group. `drag` is present only when moving a Thread is available. `moveAction` stays in place beside the title.

The optional menu trigger is in-flow. It follows the shadcn/ui `SidebarMenuAction` (`showOnHover`) states: hover, `:focus-within`, selection, and open on hover-capable devices; always visible on touch. Its width stays reserved so the title truncates in place. Menu keyboard behavior follows the WAI-ARIA APG Menu Button pattern and shadcn/ui `DropdownMenu` / Radix.


The caller's `linkId` is the stable id of the title link. A containing list uses it to
remember which row held focus and to recover only if that row disappears while focus
is on the body; focus elsewhere is left alone.
