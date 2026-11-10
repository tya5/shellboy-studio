# Footer Parent Repair (Isolated Proposal)

Parent: fee24109607cee138271cc03ab081290ea669186. Main c073 remains unchanged.
No visual acceptance is implied; this child is for the authorized anonymous retry.

## Source Diagnosis

The old OrderedHistory rendered ConversationStatus through WindowedScroll.statusLine
in positional mode, and within the legacy scroll box otherwise. AppModel.syncWindow
changes the reader when handle/owner scope changes. Equal footer keys in different
parents do not preserve the element. The actual browser disconnect failure and the
corrected real-App test reproduce this lifecycle defect.

The child removes both conditional instances. Conversation now always has one
ConversationStatus as a keyed direct child of its stable .convo parent, outside
reader, handle and loading branches, before the existing dock. No ConversationStatus
content, copy, CSS height, theme, icon or action changes. Leaving the Conversation
route still unmounts the view; route navigation is not a promise to retain the row.

## Fixture Contract For T

- Render actual Console App with a real AppModel/DesignContext and FakeOwnerDb.
- Footer state is selectedRow from thread.list: update db.threads and db.details
  state/activity, then send changed with list:true and the thread ID; settle both.
  db.work status alone cannot change selectedRow. Assert the requested model state
  and actual footer text before recording a browser measurement.
- Received/user body must be a history node with selection.ordinal and strict
  typed text items (item_identity, kind:text, text, text_complete:true), not a
  work.pending_message record. Preserve actual provenance if comparing its sender.
- Internal record and unavailable cases must use an actually accepted typed kind;
  legacy aggregate prose is not a typed record body and must not be unhidden.
- Compressed badge requires a selected spill node with spill_tools containing known
  status, truncated:false and public call/execution IDs. Use strict Operations
  decoding. Open details[data-work-group] to inspect [data-tool-compressed].
- Permanent footer selector is .convo > .conversation-status. Drive disconnect via
  FakeTransport.drop(); reconnect via open() and a normal owner hello. Loading
  and unknown states must be observed, not inferred from a loop label.

## Evidence

Earlier local runs failed due to incorrect App context, settle arguments, and an
incorrect FakeTransport.close name. Those are retained setup failures, NOT product
reds. The valid old-parent run (footer-parent-valid-red.log) fails same-element
identity after actual transport drop. Final footer-permanent-final.log:
both TypeScript configurations and 43 tests in four files pass, execution
6382238f-b24e-4e9c-b2af-8e9b16fe1c1c. The actual App test uses changed thread-list
facts for not_started/running/completed/not_started and actual transport drop/open;
MutationObserver rejects removal of the footer or its containing subtree.

This is HappyDOM identity evidence, not constant rendered height or Chrome pixels.
The reconnect intermediate is sampled before settle but does not independently
certify every possible loading UI. No new Chrome, build or live RPC was run here.
Original browser 390px measurements and failed comparison artifacts remain intact.
T alone owns the separately authorized single retry after fixture reachability.
