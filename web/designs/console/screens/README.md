# Screen-owned thread list focus

The sidebar's `.side-list` and the Threads screen's `.org-rows` are the row-list
boundaries; filters, toolbars, and selection actions are outside them. Each list has one
total focusin handler: focus on a row records its stable link id; focus on any other
control inside the list clears the claim. Focusout to outside also clears it. It also retains each row's
position in current order. If a claimed row disappears, the list focuses the row now at
that position, or the previous row at the end, or the list heading. If the user moved
focus outside, there is no claim to recover.

For dialog dismissal, the list resolves the target id at dismissal time: return to its
link if present, else the row at the retained position (or previous at the end), else
the heading. This covers Cancel when the target row is removed while the dialog is
open. The delete request's later completion never changes dialog or focus.
