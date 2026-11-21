# Screen-owned thread list focus

The sidebar's `.side-list` and the Threads screen's `.org-rows` are the row-list
boundaries; filters, toolbars, and selection actions are outside them. Each list holds
a row focus claim only while focus remains inside its boundary. Focusin on a row records
its stable link id; focusout to outside clears the claim. It also retains each row's
position in current order. If a claimed row disappears, the list focuses the row now at
that position, or the previous row at the end, or the list heading. If the user moved
focus outside, there is no claim to recover.

For dialog dismissal, the list resolves the target id at dismissal time: return to its
link if present, else the row at the retained position (or previous at the end), else
the heading. This covers Cancel when the target row is removed while the dialog is
open. The delete request's later completion never changes dialog or focus.
