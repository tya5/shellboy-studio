# Screen-owned thread list focus

The sidebar's `.side-list` is the row-list
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

ConversationItems renders live rows at the insertion point supplied by the conversation plan. It does not infer an input boundary or a terminal outcome from render order.

## Conversation Analytics and Settings

Only a visible, expanded Analytics tab observes the selected Thread's ungrouped
`usage.get` and at most three recent `compact.list` records. One change/resync
subscription coalesces one follow-up pair; leaving, hiding or collapsing Analytics,
changing Threads, or losing the owner cancels both reads. The same tab works in
the phone sheet. `thread.get` still supplies bounded context facts, not totals.

The sidebar `.side-list` is a zero-inline-padding row boundary. Bands and rows fill that boundary and own their shared-token content insets; do not bleed individual rows or headers beyond the container.

## Resources Memory

The Memory screen treats a typed capacity refusal as an owner-busy result. It reuses the existing header action for a Memory-only Retry; retry is manual and is never automatic. Ordinary Refresh keeps the existing paired Memory and bridge reads.

Thread Settings uses the selected handle’s existing `thread.get` read. A row publishes
no mutation receipt value: it waits for the existing change/resync read, and Undo
restores the observed raw field only while the saved value still matches. The title
row cannot Undo because Core publishes the display title, not its raw override.

## Conversation status announcements (#121)

The visible conversation status keeps its live elapsed-time display, but is not itself a live region. A separate polite, atomic status announces only the current state/activity label; do not include elapsed time, running descriptions, or other ticking values in it. Follow the WAI-ARIA APG [Status Message Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/status/) and use it for meaningful state transitions, not continuously changing measurements.

## Shell output actions (#161)

The inline shell step and Activity detail share one output-actions toolbar for Copy, Wrap lines, and Formatted. Keep the inline output title and Open execution details action at the inline placement only; do not add a second text-button toolbar. Use these controls only alongside retained shell output, not as a generic log toolbar.

## Conversation stop controls (#160)

The Composer's single Stop model action appears only with the existing model-working signal and a current Turn ID; it calls `turn.interrupt` and never stops shells. Stop everything belongs to the Activity Running section, is shown when `thread.get` exposes a Run ID, captures that ID and its opener at press time, and uses the existing WorkSheet alertdialog before calling `run.stop`. Owner refusals appear in the existing status notice; the next owner hint updates the controls. Do not move Run stop back into the Composer or replace shell-row Stop/Background actions.
