# Awaiting You Refresh Boundaries (ADR-AW1 / ADR-R1)

Scope: the HumanInbox in `web/data/src/human-inbox.ts`, its existing Inbox
UI, and the answer/cancel action boundary. The Core mutation contract is unchanged.

Since #105 the reads run through the shared `PageRun` (`web/data/src/page-run.ts`):
Show more appends a page (at most 128 retained) and a hint re-reads the loaded
page count from the first page. Same owner/session refresh retains the previous validated
rows, loading/stale and any error until successful atomic replacement. A valid
empty page is replacement, not a cancelled/error result. Read failures retain
the entire previous page, not a misleading partly-read page. Canonical owner order
is preserved. The selected message stays selected when still present; same-ID
updates use the same keyed QuestionCard and draft. A disappeared ID falls back
only on a validated replacement and gets a new message_id-keyed detail component.

Owner/connection changes clear rows before they can be answered in the
new scope. Generation is monotonic, including ABA and unknown/disconnect to the
same instance. A direct existing Link subscription observes every closed/owner/
hello transition even if synchronous reactive notifications coalesce. It is
removed on dispose. No additional connection or listener per row is created.

## Read Token

The scope is the owner value (connected, with an instance ID, socket open); a new
value is a new scope. A PageRun session belongs to one scope. Each read installs
its own Cancel after cancelling the previous one and is current only while its
session, Cancel and owner value are unchanged; it checks after every await and
publishes the rebuilt prefix once. A cancelled read restores the state it found
(not an error, not an empty page). Scope reset publishes the empty state before
cancelling, so cancellation callbacks never see old rows. No scheduler is added:
a newer hint supersedes the read in flight.

## Inventory

| File Anchor | Effect | Immutable Fence | Tests |
| --- | --- | --- | --- |
| HumanInbox constructor Link closed/owner/hello callback | Clear cross-session rows/cancel | Owner key + monotonic generation before resets; restart requests a fresh page | reconnect unknownSame, ABA frame tests; R1 matrix |
| constructor owner/list-hint effect | Reset scope on a new owner value, else notify the PageRun session | Scope checked after reset; sidebar loading and staleness do not drive reads | retained-page/error/cancel; owner B/ABA; finite notification reentry |
| resetScope (scope epoch, then PageRun.close) | Clear rows/error/loading; revoke actions | Epoch increment and empty publication before the old Cancel fires | cross-owner answer rejected; R1 transitions; cancel-callback admission zero |
| PageRun read (hint or first page) | Re-read the loaded page count of `to: human` | Session + Cancel + owner value after every await; one publication of the whole prefix | R1 loading/success/error/finally x four; two pages with 0 or 1500 known Threads; zero `thread.get` |
| PageRun read failure / cancel | Keep rows; typed error, or the prior state on cancel | Only `cursor_expired` drops the continuation | page error; expired cursor keeps rows; cancel is not an empty success |
| more -> PageRun append | Next page appended, earlier questions kept, bound 128 | Ignored while a read runs; capped at the bound | mounted Show more, re-read and retention-bound tests (`inbox-pages.test.tsx`) |
| mutate answer or cancel | Dispatch `message.reply` or singleton `message.cancel` | Exact page and owner checks before dispatch; operation receipt belongs to its original attempt | Scoped retries; mounted cancel and refusal |
| mutate completion | Record attempt outcome only; no reread or row removal | Exact cancel result identity; a definitive refusal releases the attempt | Rows change only after a hint and accepted page |
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
capability: the scope's owner value, scope epoch and the retained message IDs (#105; was the page cursor too).
Scope reset revokes it and increments scope epoch BEFORE old Cancel callbacks or
signal notification. Ordinary same-session refresh changes read generation only,
not the page capability; stale rows may still be answered or cancelled under the same scope.

Each mutation captures the scope and checks connected owner/session,
scope epoch, ID membership and the original attempt owner/epoch before attempt
reservation and immediately before dispatch. No old attempt receives a new owner
identity or retry receipt. Completion only records the original attempt's outcome; it never starts a read or changes the page.

Additional inventory: resetScope capability revoke precedes the read's cancel; mutation
entry, attempt reservation and RPC have the same immutable page check.
close revokes capability before Cancel. Tests cover cancelcallback answer under
B/ABA/unknown-same/queryreset (reply RPC zero inside callback), same-session stale
positive control, late answer new-scope refresh zero, preserved unconfirmed retry
identity and reentrant fresh-owner page not erased by the outer reset. No broad
ask restriction or Core mutation protocol change is introduced.

### Receipt Owner Versus Query Session (P2 Follow-Up)

Receipt retry identity is immutable owner instance + action and, for answers, exact text +
original operation ID, not the read-page epoch. A fresh same-instance reconnect
page may authorize an explicit same-message/same-text retry with that ID; no old
invocation resumes and different-owner retries cannot dispatch or mint another ID.
Tests assert new call count, request identity, original operation ID and text,
not merely the last historical call's ID.

A page-two receipt leaves the cursor and rows unchanged. The next owner list
change or resync hint re-reads the loaded pages from the first page (#105). These reads do not depend on sidebar
Thread reads. For a human question, Core normally returns `cancelled` with an
archive draft ID; the shared singleton validator also accepts `reply_cancelled`
for reply duties and rejects mismatched IDs or outcomes.
