# Composer Clear At Owned Send Reservation

Source 57bcc (v0.2.4 base); no measured latency claim. Existing clear waits for
message.send ACK, with no intervening history fetch/extra await to remove.

| Actual owned state | Input field | Protected original | Action |
| --- | --- | --- | --- |
| editing / reservation denied | unchanged | Composer draft | no dispatch/no clear |
| model reservation committed | clear ONLY same captured draft generation | pendingOwnMessage text + original operation ID | one reservation notification |
| dispatch / awaiting ACK | new draft allowed, no second send | same pending model row | submitting/busy guard |
| accepted | never clear a newer draft | acceptedOwnMessages text/message/op ID | original pending retires |
| unconfirmed | no restoration over new draft | model unconfirmed row text/op | existing original-op resend ONLY |
| failed | no restoration over new draft | model failed row text/op | existing explicit retry path |

Formal seam: Composer onSend(text,onReserved?:()=>void):Promise<boolean>.
D model.send(text,onReserved?) -> private deliver(...,onReserved?) invokes callback
only AFTER pendingOwnMessage and sending state hold original text/op, before its
single messageSend dispatch. Admission failure invokes nothing. Callback is NOT an
ACK/delivery claim or an extra RPC. D owns model/Conversation wiring. S edits only
Composer + existing Enter DOM tests. No token/owner/read authority is changed.

Composer closure captures exact submitted generation/text; a single local once
latch ignores repeated reservation notices. It clears textarea DOM and controlled
state together only if that generation remains unchanged. A newer draft (including
edit away and back to identical text) is not erased. Success-ACK fallback remains
for unchanged legacy callers, but cannot erase a reserved/newer draft. Failure or
uncertainty never discards model escrow, resets original op, or duplicates send.

IME / shift-enter / enter repeat / submitting guards unchanged. Need check synchronous
notification reentry between model escrow and dispatch: D must retain original route,
owner, operation identity before dispatch, or cancel safely without erasing escrow.
A callback exception must not strand sending or trigger a second operation; callback
is presentation-only and cannot become authority. No auto-submit/retry on clear.

Controls: hold ACK and assert empty field immediately after owned reservation;
no reservation -> unchanged; newer draft before notice/ACK survives; denied/failed/
uncertain retain protected original; repeat notice/Enter no duplicate; existing IME.
Actual model escrow/resend controls remain D-owned and combined gate separately.
No service, Core, browser, real DB/RPC, paid provider or user send in these tests.

S6 conditions fixed: callback is accepted only synchronously inside this onSend
call, once; later/replayed notification does nothing. Draft scope changes increment
a local scope generation, so A -> B -> A cannot revive old ACK clear authority.
Scope identity is provided by D from the original route/owner/handle lifetime,
not a text/thread-only match. Optional scope preserves old standalone component
callers, but the actual App wiring MUST pass the qualified original scope.

D must isolate notification exceptions, then recheck original mutation/route/op
qualification before dispatch; invalidation publishes a protected failed/cancel
state with original text/op and no dispatch. Callback failure is not ACK, never
retries automatically and cannot orphan the reserved draft. Explicit original-op
retry does not call onReserved again. Model pending/failed/unconfirmed text is the
visible recovery owner; S must not restore it over a newer local draft.

S owns Composer and pending-own-message.test.tsx; D owns model/Conversation and
uses another existing actual App test for protected pending/retry/throw/cancel.
S-only green is component-contract evidence, NOT final actual App early-clear
success until D's formal model hook/wiring is integrated and tested.
