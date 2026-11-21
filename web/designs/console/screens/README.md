# Screen-owned thread list focus

The sidebar list in `App` and the organization list in `Threads` remember the last row
link that received focus. If that row disappears while focus has fallen to the body,
the rendering list focuses the next row link at the same position, or its heading when
there is no next row. If the user has moved focus elsewhere, no focus is moved. This
policy applies to all row removals, including delete, archive, and filtering; a delete
request's later completion never changes focus.
