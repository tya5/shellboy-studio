# Store Attempt Identity Authority

The readable Store path at `web/data/src/store.ts` requires one status attempt
whose `id`, `attempt_id`, and `thread_id` all exactly match the live record.
The receipt-only path now uses the same strict resolver, so omitted or duplicate
status identities cannot create a terminal proof or selected-read admission.

The shared resolver is the authoritative boundary for both branches. A stored
receipt may be reused only when its scope and record key match the current
record; a proof from a replaced record cannot authorize the new record. The
text-empty public fixture in `web/ui-core/test/empty-receipt-publication.test.ts`
keeps attempt/scope/key before the transition and asserts exact positive,
missing-attempt-id negative, and duplicate-attempt-id negative outcomes.

Choice: strict shared constructor/resolver rather than two filters. Rationale:
it removes the permissive receipt-only fallback and preserves one source of
truth for current identity. Risk: an owner response omitting `attempt_id` is
now rejected instead of becoming a receipt; this is intentional because a
receipt grants selected-read authority. Existing preview, body coverage, and
normal readback paths remain unchanged.
