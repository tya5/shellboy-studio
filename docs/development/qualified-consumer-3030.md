# Qualified Consumers For Canonical 303080

Canonical specification SHA-256:
303080884a0005a5a6183737bb0e90a9aa04b95947c022e3eb869b59bfd47962.

## Author Dependencies

- P 99d22: canonical materialized presentation; D 506970 removes remaining old
  consumer imports and ordinal suffix guesses. No old symbol remains in web.
- S aca682: capability-independent LegacyAcceptedPresentation, no invented
  revision/ordinal; original handle qualification and transfer callback authority.
- P fb83/a83: canonical case values/categories and the single raw-input normalizer.
- S 1cfce: observable bounded read-only retry state and awaited coalesced reads.
- D a8d1: strict public MessageAccepted decoder, no new owner API.

## Consumer Changes

Model owns one legacy accepted view only when history.window is absent; dispose
on route, handle, scope or qualification change. UI reads qualified immutable rows,
live and terminal facts and sends them to the same P legacy/live grouping boundary.
No direct LiveMessage remains on the Console conversation route. Raw ledger fields
never grant terminal retirement. Saved ordinary facts and available partial text
remain visible. Handoff facts use normalizeConversationFacts before case lookup.

One scoped local submitted message is explicitly separate from saved history.
It is visible before dispatch acknowledgement and while exact saved node arrival
is pending. MessageAccepted.message_id/thread_id are validated, and only that
canonical node in the current accepted saved view retires the local presentation.
Equal text, time or position never joins identities. Ack-before-save and save-before-
ack are controlled separately. Failed/unconfirmed retry retains operation identity;
navigation/owner/scope invalidation rejects late acknowledgement. Composer clears
only the submitted draft generation, never an intervening new draft.

The read-qualification capture API owns a single token per handle. An early WIP
send capture invalidated the legacy reader; the send guard now uses exact current
handle, route, owner and scope instead of taking another read token.

Work headings consume categoryCounts only, omit zero, retain actual running and
failed tool metadata, and never put unavailable reasons in the heading. Internal
labels consume the case render/category columns. Record/records labels and synthetic
unavailable notification bodies are absent. Child/shell continuation labels require
those explicit case values; generic event text never infers a causal subtype.
Retry controls consume phase/reason/canRetry only: normal idle has no retry,
reading disables the button, actual failed/unavailable reasons provide feedback.
No model/tool resubmission, fake spinner or extra read budget is introduced.

## Evidence Boundary

Both TypeScript checks and 34 focused tests in six files passed at f8f21eb1,
consumer-combined-final.log. Subsequent save-before-ack controls initially failed
because the shared settle helper answered the intentionally held send with an
unrelated generic result. Marking that call held in the existing answered set
corrects the fixture without weakening the accepted-ID assertion. Final current
source validation is execution e7af8665-00da-44ef-acb5-45158222289d, queued on the
shared heavy slot when this document was written; no final green is asserted here.
Other WIP type/helper/fixture failures remain in private validation logs. New
consumer controls are not claimed red-first product repairs.

No all-suite, browser geometry, actual user Thread resolution, or independent S6
final-matrix verdict is claimed. Work remains local-only: no CI, push, workflow,
browser, database query, RPC, installed swap, candidate build or public tag.
