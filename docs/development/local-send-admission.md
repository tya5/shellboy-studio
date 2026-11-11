# Local Send Admission Display

Source: S capacity-retirement/source-api.md Disposition and S6 Count Correction;
leader/S6 4889 limited implementation. This is not a new admission controller.

| Existing Guard | Pure Display Result | Mutation |
| --- | --- | --- |
| no matching current selected handle | unavailable | none |
| pending operation exists | pendingphase (show its existing phase) | none |
| accepted count >= 8 | slotsfull | none |
| retained original UTF8 + current edited draft > 4MiB | bytesfull | none |
| otherwise disconnected owner | unavailable | none |
| local guards clear, connected owner | ready | none; not a mutation capability |

Slots precede bytes only when both fail. deliver reuses that exact pure capacity
function at its original guard position; route/pending/owner order is unchanged.
Composer computes draftStatus from its current text and current model signals on
each render and again at submission: no cached draft error, delayed callback or
scope-transfer state is introduced. Existing draft generation/scope guards still
own early-clear behavior. Empty-text, IME, submitting and busy guards remain.
The old capacity boolean is retained for compatibility but no longer drives UI.

Retry eligibility checks current pending object, phase, selected handle/thread,
connected owner and existing retryCurrent closure without mutation. Per-row click
also passes the original object into resend, which rechecks it before dispatch.
Ineligible visible rows keep original text and show only current-route/owner
unavailability. No cross-scope copy/restore or new retry/fetch is added. Existing
scope invalidation may remove its scoped local rows; this change does not retain
unauthorized content or alter that policy.

Bounds remain accepted<=8 and active pending<=1, including the known transient
ACK publication of eight accepted plus one pending reference for the SAME original
operation. No combined rows<=8 assumption, truncation, duplicated-byte allowance,
terminal GC, queue, forced retirement or capacity increase is introduced.

Focused: local-send-admission.test exact UTF8 limit/-1/+1 with multibyte and
pending/slots precedence; pending-own-message.test edited Composer hint and draft
preservation, denied callback0/no dispatch, readonly original-op retry, route and
owner ABA deny; existing model reservation throw/reentrant-route and Composer
scope-generation/IME/held-ACK controls remain in the same program. Fake transport
and DOM tests do not establish USER acceptance or latency. Exact union CI/build/
trial is separate. No runtime/Core/DB/provider/browser operation in this child.
