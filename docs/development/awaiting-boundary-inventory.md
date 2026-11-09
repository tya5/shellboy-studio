# Awaiting You Refresh Boundaries (ADR-AW1 / ADR-R1)

Scope: HumanInbox read projection and existing Inbox identity. No reply mutation
contract, B3, fork, Link capacity, timers or polling is changed. Task base is
f53bb16e4f1dbca2c944ff431bc59839c6fbb224, preserved as the parent.

Same owner/session and first-page query refresh retains the previous validated
page, loading/stale and any error until successful atomic replacement. A valid
empty page is replacement, not a cancelled/error result. Detail failures retain
the entire previous page, not a misleading partly-read page. Canonical owner order
is preserved. The selected message stays selected when still present; same-ID
updates use the same keyed QuestionCard and draft. A disappeared ID falls back
only on a validated replacement and gets a new message_id-keyed detail component.

Owner/connection/query-page changes clear rows before they can be answered in the
new scope. Generation is monotonic, including ABA and unknown/disconnect to the
same instance. A direct existing Link subscription observes every closed/owner/
hello transition even if synchronous reactive notifications coalesce. It is
removed on dispose. No additional connection or listener per row is created.

## Read Token

Before loading publication, capture owner key, cursor, generation and exact Cancel.
Increment generation and install the new Cancel before cancelling the old object.
Validity requires current generation/owner/Cancel identity, non-cancelled token,
open connection and connected owner. Check after loading batch, every await,
before every read and before projection. Terminal projection/error batches have
no following work except guarded finally. Finally updates loading only for its
own valid read. Refresher retains its existing one-key running/coalesced followup
bound; this task does not add a scheduler. Cancellation does not impersonate an
empty successful page. Query reset continuation also verifies its reset epoch.

## Inventory

| File Anchor | Effect | Immutable Fence | Tests |
| --- | --- | --- | --- |
| pending.ts constructor Link closed/owner/hello callback | Clear cross-session rows/cancel | Owner key + monotonic generation before resets; no read continuation | reconnect unknownSame, ABA frame tests; R1 matrix |
| constructor owner/list effect | Reset scope or schedule existing bounded refresher | Owner key checked after reset; list stale cancels, retains same-scope rows | retained-page/error/cancel; owner B/ABA; finite notification reentry |
| invalidateRead cancel callback | Cancellation | New generation and Cancel installed before old.cancel | cancelled page late result; synchronous owner transitions |
| resetScope batch exit | Clear items/error/hasMore/loading/stale | Own reset generation checked before batch; callers recheck before continuation | cross-owner answer rejected; paging; R1 transitions |
| read loading/stale batch exit | UI only then read | Captured token valid after batch, before threadList | R1 loading x B/ABA/unknownSame/unchanged |
| read threadList RPC + await | Read only | Original owner/cursor/Cancel; post-await guard | held list/error/cancel/lateowner; no empty-on-error |
| read threadGet loop RPC + await | Read only, at most16 threads x128 projected duties | Same original token before each call/after await | lateowner forbids next detail; detail failure retains old page |
| read fail error/stale batch exit | Terminal error UI | Original token, then guarded finally only | R1 error x four transitions; detail error |
| read success items/error/stale/hasMore batch exit | Atomic validated page UI | Original token after all reads; no further read continuation | R1 success x four; changed/order/valid empty; real adapter DOM |
| read finally loading=false | Own-read UI release | Same original token; cannot clear new loading | R1 finally x four; cancel + lateowner |
| more reset -> next cursor -> requestFresh | Explicit query-scope transition | Reset generation + original owner checked after reset batch | existing canonical page/cursor bound test |
| dispose | Cancel/unsubscribe/terminal rows clear | closed flag before cancel; no subsequent reads | fixture close + late cancellation paths |
| Inbox message selection and QuestionCard key | Existing detail UI only | message_id identity; still-present selection retained across reorder | same-ID DOM/content/draft/reorder; different-ID reset |
| Inbox loading/stale/error labels | UI only | Existing translated labels, no request continuation | synthetic existing-screen checks |

R1 matrix covers loading/success/error/finally x ownerB/ABA/unknownSame/unchanged.
Actual FakeTransport owner frames are used for synchronous ABA, not an impossible
assumption that a coalesced signal must expose an intermediate value. Separate
held-request tests assert no actionable old rows, no message.reply and no late
page projection. The real HumanInbox synthetic DOM test checks textarea identity
and draft throughout invalidation, held reread and successful replacement, not
only final text. Reply receipt/mutation semantics remain unchanged.

Limits: synthetic transport/happy-dom is not an actual owner/browser/phone test.
The original source fails the retained-page and keyed selection tests before this
repair. No debounce, optimistic remove, new timer/cache/poll or real data is used.

## P1 Repair: Display Is Not Action Qualification

The held first repair retained displayed rows but still admitted answer by row
existence during reset cancellation. A dedicated regression first observed one
reply RPC where zero was required. The repaired scope introduces one small page
capability: successful page owner, session/query epoch, cursor and message IDs.
Scope reset revokes it and increments scope epoch BEFORE old Cancel callbacks or
signal notification. Ordinary same-session refresh changes read generation only,
not the page capability; stale rows may still be answered under the same scope.

Answer captures the exact page capability and checks connected owner/session,
query cursor, ID membership and the original attempt owner/epoch before attempt
reservation and immediately before dispatch. No old attempt receives a new owner
identity or retry receipt. Completion keeps its original canonical receipt fact;
it may refresh/cursor-project only when its captured page/scope is still valid.
A newer successful page is never replaced by an old completion's hidden refresh.

Additional inventory: resetScope capability revoke precedes invalidateRead cancel;
read success installs capability before its atomic items publication; answer entry,
attempt reserve and RPC have the same immutable page check; answer await writes
only its original attempt fact, then guards any cursor/refresher continuation.
close revokes capability before Cancel. Tests cover cancelcallback answer under
B/ABA/unknown-same/queryreset (reply RPC zero inside callback), same-session stale
positive control, late answer new-scope refresh zero, preserved unconfirmed retry
identity and reentrant fresh-owner page not erased by the outer reset. No broad
ask restriction or Core mutation protocol change is introduced.
