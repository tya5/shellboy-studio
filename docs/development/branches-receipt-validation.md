# Branches Mutation Receipt Repair

## Authority And Scope

Public source base `1f26ec97c6e3cf3b8521422c4e430eddcb45ad32`, its existing
Operations/Link canonical mutation responses and ID injector, the adopted Core
operation-observability design and architect ADR-B2 are the authority. A saved
opaque operation.get outcome is not a newly specified public response schema.
Diagnostic baseline commit `3b332b76db454f1f0d2d20f0ce8f1de4352dc478`
characterizes unsafe old behavior; repair tests replace those expectations,
not promote the old behavior to a permanent contract. This branch is separate
from Branches #1 and the integration candidate. No #3 or fork repair is included.

## Model Ownership And Bounds

One AppModel-owned Branches instance has three fixed attempt slots: rename,
archive and rewind chain. The chain has at most one rewind receipt and one send
receipt: four receipt IDs maximum. These are policy bounds, not measurements.
Slots reserve immutable normalized wire payload and the initiating owner before
awaiting; in-flight duplicates join, changed payloads are refused. Uncertain
slots cannot be evicted by unrelated actions, navigation, read, clear or leave.
Known completed attempts can be replaced by a new explicit action. Repeating
an already successful identical action returns its stored canonical outcome.
No persistent hard-reload guarantee, new queue, poller or worker is introduced.

Current-owner retries send the same mutation ID and args through the existing
mutation decoder. Unconfirmed, owner errors, expired results and invalid payloads
retain identity. An explicit old-owner retry performs one diagnostic lookup only:
ID, known state and replay policy are checked, but even a well-shaped opaque
outcome cannot mark success, free a slot or start a new stage. No prefix remapping.
An old owner's unstarted follow-up remains unstarted. Recovery from opaque
old-owner receipts is deliberately unresolved, not claimed complete.

A known successful rewind is irreversible saved fact. Follow-up retries reuse
only the send receipt; they never rewind again. Changed follow-up text is refused.
Definite local pre-send not_connected/busy is distinct from sent reply loss,
which says not confirmed/may have applied and retains the original ID. Late
results update their original slot but not another view's projection. An
unstarted send is not automatically launched after navigation or owner change.
The existing confirm/result area provides explicit partial-chain retry; there
is no new screen or permission surface.

## Authorized Acceptance

Only synthetic FakeTransport with the real Link, Operations and Branches model,
and owner-free frontend typecheck/check/build establish this repair's acceptance.
Tests cover same-ID/same-args retry, changed text/targets, duplicate in-flight
calls, independent occupied slots, four-ID capacity, unknown/expired/invalid
results, diagnostic-only opaque lookups, old-owner zero mutation, current-owner
saved-outcome replay, read/clear/leave, late result projection, rewind success
plus send refusal/loss, pre-send versus post-send errors and unrelated parent
retention. Synthetic owner application is manually modeled; it is not proof of
real owner mutation counts. Existing partial-archive assertions remain intact. Final owner-free frontend
typecheck, 44 files / 660 tests and production frontend build pass; these
include 15 repair tests, replacing six baseline diagnostic expectations.
A synchronous transport reentry test confirms pending guards precede send.
No Rust, native owner, browser, hosted CI or runtime replacement validates this
repair. The previous #1 browser happy paths do not establish #2 receipt safety.

## Excluded Observation And Provenance

Before the stop instruction, the author exceeded the approved transport-only
scope by starting disposable binaries around 2026-11-09 04:04 UTC to inspect a
receipt. The first harness failed; a second returned an opaque receipt. Its JSON
is private and excluded from this code, fixtures, decoder contract and acceptance.
The speculative saved-outcome decoder was removed; no code reads opaque outcome
contents. This disclosure does not authorize that observation retroactively.

Process isolation/shutdown and absence of user-owner interaction were worker
claims, not independent proof. Child PIDs, Chrome descendants, exact STOP adoption
instant and real-owner non-contact remain UNKNOWN. No additional runtime,
cleanup or measurement fills those gaps. Limited resumption authorizes only the
product edit and synthetic/owner-free web work described here. Separate S6
meaning/privacy/provenance review and integration approval remain required;
no push, CI, release, composition or runtime operation is authorized by this file.

## Owner Generation Follow-Up

Independent S6 review rejected initial repair `6c3cb105`: ownerless projection
checks allowed a late rename/archive success to affect another owner, and the
success cache shortcut preceded owner validation. Its 660 passing tests did not
cover those races; that candidate is not accepted on that evidence.

The follow-up separates immutable original-owner receipts from per-invocation
projection. AppModel synchronously notifies a monotonic owner generation,
including transitions through unavailable and A-to-B-to-A. Each invocation
captures generation, owner, view, target and navigation epoch before await.
Only a current nonempty matching owner and matching captured bindings permit
projection, read side effects or an unstarted next stage. Joining/rebinding does
not alter older invocation tokens. Owner validation precedes successful-cache
reuse. Diagnostic lookup never overwrites a retained canonical success. Explicit
return to the original owner may reuse the same ID or display its known outcome;
no cached successful mutation stage is re-executed.

Nine additional synthetic owner-race tests cover rename/archive late success,
A-to-B and A-to-B-to-A, unavailable roundtrip, cross-owner canonical cache reuse,
explicit original-owner join without resurrecting the old continuation, and
owner roundtrips in both rewind/send stages. One older test initially timed out
because the corrected old-owner confirm now performs a diagnostic lookup; the
fixture now explicitly answers that read. No timeout increase or skip was used.
