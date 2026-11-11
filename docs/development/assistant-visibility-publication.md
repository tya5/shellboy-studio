# Bounded Legacy Publication Drain

Installed-source baseline e67298f5a96eab0d8dfb45211451f25739b23349.
Confirmed class defect: accepted commit notifies subscriber -> same-owner Work
resource changes -> its source effect calls sync while syncing=true -> request
was discarded -> original publish correctly fails its post-notification source
check -> sync returns false with no qualified replacement until another sync.
Presentation correctly rejects that ref and can therefore render no saved rows.

The correction is producer-owned: nested sync marks one pending bit. The outer
owner runs at most two synchronous passes under the SAME original qualification,
capturing current resource snapshots, not a fresh read token. Existing precommit /
post-notify identity/fingerprint/capability guards remain unchanged. True owner,
scope, cancel, disposal or lifetime loss stops immediately, even when pending.
Continuous mutation stops at two passes and returns actual currentness, never a
false success. Finally clears latch/bit on every return/exception. No timer, task,
read, body cache, stale-ref acceptance or presentation retention authority added.
No Window/model/Conversation code changed.

Evidence distinguishes a controlled synchronous class RED from an actual App
success: original-source App terminal-held/source-subscriber/cancel controls all
passed already (effects may repair after scheduling). They are not renamed red or
claimed to reproduce the USER episode. The class synchronous return did fail and
its identity-only frame trace ends current:false; fixed trace adds a trailing
qualified generation and ends current:true with saved tool/answer rows retained.
Current tests additionally check continuous observer bound, exception cleanup and
existing wrong-scope/owner/cancel/capacity/O-release controls. Initial absent rig
fixture and Node/types fixture failures are author artifacts, not product evidence.

The reported user disappearance may have additional causes; this child fixes the
source-level dropped-publication request only. Latest-answer missing-body presence
and empty-tail layout remain distinct. Browser frames/real user conversations are
not measured: frame numbers denote observer events, not animation frames.
