# Fork Receipt Repair (ADR-F1)

## Source And Policy

Product parent is approved B12 `24a582517823513374f5a161b15a8a1ee7db4ac7`.
Original 24a and test-only diagnostic b5d1019 are unchanged. A temporary working
branch used the diagnostic as a parent; the submitted product branch instead
starts directly at 24a, with safe repair assertions in a separate test file.
Diagnostic six-case success established the old gaps, not fork safety. No B3
implementation is included in this candidate.

Existing Operations.threadFork/messageSend canonical responses, injected receipt
IDs, Link's unconfirmed outcome semantics and adopted operation observability
are the contract. ADR-F1 adds one model-lifetime fork-chain slot with at most two
receipts. Total policy is now four independent slots and six receipts; the
three B2 slots still have their original four-receipt bound. No wire, permission,
schema, dependency, screen or toolchain change is introduced.

The slot captures immutable original owner, parent, node and normalized text
before awaiting. Same-payload calls join in flight or retry the same ID/args;
an unresolved slot rejects changed payloads. Only the canonical fork response
establishes the child. A known child is retained and follow-up recovery retries
only its send receipt. A repeated successful action reuses known facts, not a
new fork. Read, clear and leave never evict the slot. Lifetime does not include
hard-reload persistence. Owner mismatch permits diagnostic opaque lookup only;
that lookup cannot establish a child, free a slot or initiate a send.

The existing immutable invocation captures original owner/generation/view/target/
navigation epoch. Follow-up, result/error projection and family refresh require
all current bindings to agree. Owner ABA, unavailable, leave and retarget invalidate
late continuations. An explicit join of an already running action does not
replace its original token. A later explicit action by the original owner may
recover its known child or retry its exact receipt. Synchronous forking-signal
notifications are checked again before dispatch. Lost send replies say not
confirmed/may have applied, rather than not sent. B12 family/excerpt budgets,
coalescing, convergence and cancellation logic are unchanged.

## Permitted Validation

Only owner-free synthetic transport and frontend type/check/build are used.
The real Link/Operations/Branches tests invert the six diagnostic gap scenarios
and add opaque lookup, unavailable/ABA across both stages, explicit rejoin,
synchronous transport/signal reentry, invalid/expired responses, unknown owner,
retarget and independent six-receipt capacity. Existing two fork tests retain
their assertions but now select the node route before invoking fork, matching
the production UI. Initial failures exposed that missing fixture precondition;
no target guard, timeout or assertion was weakened.

The tests establish client command IDs/targets and projection behavior, not
actual owner application counts, exactly-once creation, parent-path preservation
or native/browser acceptance. Manual synthetic child state in the old diagnostic
is not real duplicate-child evidence. No runtime, Core/Studio binary startup,
real browser, owner/data operation, Rust, CI, cleanup or push was performed.
No earlier unauthorized observation or opaque receipt JSON informs this decoder,
fixtures or acceptance. Previous B2/B12 failures and UNKNOWN/provenance limits
remain as recorded; they are not retroactively successful.

Independent S6 meaning/privacy review and integration's exact-source conflict
forecast remain required. Fork is reviewed before B3; comparison selection must
not become mutation target. No deployment or publication authorization follows
from this document.

## Done-Notification Reentry Follow-Up

S6 independently held initial product 52c24ef: after publishing done, a
synchronous subscriber could change owner or leave before the unguarded family
refresh. Its 700 passing tests did not cover that boundary. The follow-up checks
the original immutable invocation again after done publication and before read.
Four new synthetic tests invalidate owner, owner ABA, leave or target during
the done notification and require zero refresh RPCs. No receipt, policy, family
budget or public contract changes. The rejected initial result remains history;
these tests do not constitute runtime or real-owner acceptance.

A further synchronous failed notification guard preserves the new owner's error
instead of writing the old error after reentry. Two additional tests cover failed
notification owner switch and partial-send error notification preventing stale
done. All guards reuse the same invocation, never a freshly sampled replacement.

## ADR-R1 Inventory And Admission Follow-Up

07661c4 remained held: its 706 tests did not cover all publish boundaries, and
same-owner initial target mismatch could skip the visible branch and dispatch.
The next source captures initial fork invocation before reservation and refuses
stale selected target without minting an ID. Old-owner explicit lookup remains
separate, diagnostic-only and cannot dispatch. Pending/cached retarget and a
valid different explicit action are tested with actual IDs/args.

`branches-publish-inventory.md` lists fork and current B12 publication, reset,
cancellation, batch exit, await, admission and finally boundaries. The table
maps each continuation to its immutable context and regression family. The
220 table-driven/new boundary cases cover seven context transitions, owner-free
normal controls and specialized reentry/row identity tests. Together with
existing tests, typecheck and 47 files / 926 tests and frontend build pass.
Full-suite green is evidence alongside, not a replacement for, inventory review.

Confirmed B12 gaps repaired in the same architect-approved scope include row
initial-callback admission/reset, callback replacement detach order, read loading
notification context capture, leave/reset fresh-read ownership, rename/archive
refresh after callback, rewind initial/failed/done continuations and preview
owner/session/target/cancel ownership. A compatible optional read-options argument
passes preview cancellation through the existing read path; no RPC change.
Family one-loop/one-trailing ownership, four slots/six receipts and all budgets
stay unchanged. No ThreadOrg, B3 or presentation redesign is included.

Matrix fixture corrections (viewed Thread missing from normal-control refresh,
wrong family field and a required FamilyState field) and a real loading-thread
guard failure are separately recorded in the inventory. No assertion was skipped,
no timeout lengthened and no unsafe behavior treated as successful acceptance.
Previous rejected SHA history and earlier UNKNOWN/observation exclusions remain.

The independent 82db5a6 review held the candidate on old-owner changed-key slot
poisoning and reentrant preview cancellation. Exact-key-only diagnostic admission
and preinstalled Cancel/sentinel ownership repair those classes. Five additional
cross-boundary regressions include valid next action without consumed receipt ID
and restart/clear/leave/select cancellation callbacks. These are separate from
prior 220-grid evidence. No policy, runtime evidence or public contract changes.

The next independent finding held fd88 on owner invalidation's current-pointer
cancellation. Capturing both old family/preview handles and preinstalling the
sentinel, with batched family invalidation and guarded post-callback reset, fixes
that ownership class. Three counterexample/control and reverse-resource regressions
bring owner-free acceptance to 47 files / 934 tests plus typecheck/build. This
remains candidate evidence pending independent S6 exact review, not runtime proof.
