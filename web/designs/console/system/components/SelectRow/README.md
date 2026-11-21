A Thread in a list that supports choosing several. The checkbox chooses; the title opens. Depth indents only for a real parent link, and `note` names a parent outside the group. `drag` is given only when moving a Thread is really available: dropping asks first, and never moves anything itself. Without it the row isn't draggable, so nothing suggests an operation that doesn't exist. `action` is a small control beside the age. `tags` are the Thread's tags as small labelled items under the title; pass them only when the owner reports tags, so an owner without them shows none.


The optional `action` stays in the row flow after the title link, so it takes its own space rather than overlaying the title. Leave it out when the operation is unavailable; the row itself remains the checkbox-and-title interaction.

The optional action slot carries the shared Thread menu; row context menus and ArrowDown open that same menu.

The title is truncated in-flow so the checkbox, parent action, age, and row menu retain their own space.

The row menu trigger is in-flow but hidden until row hover, focus-within, or selection.

The in-flow menu trigger appears on hover, focus, selection, or while the menu is open. The block title truncates only while the trigger is visible.
