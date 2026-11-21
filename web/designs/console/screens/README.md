# Screen-owned thread list focus

The sidebar list in `App` and the organization list in `Threads` hold a focus claim only
while focus remains inside the list. Focusin on a row records its stable row-link id
and position; focusout clears the claim when `relatedTarget` is outside the list. If
the claimed link disappears, that list focuses the next link at the same position, or
its heading when no next row exists. It does not recheck document focus. This applies
to delete, archive, filters and other row removals; delete completion never moves
focus.
