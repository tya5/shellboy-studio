# Studio 27 Withdrawal: Current Contract

Status: source-unfrozen documentation artifact. The Console guarded run is still queued/running; no final SHA is claimed.

## Current Runtime Contract

- Saved rows are the persisted body owner. Partial/deferred rows expose the ordinary `loadBody(node_id)` action; the loaded body is rendered from the body cache.
- Live records are visible text projections and retain their own attempt identity until an accepted saved assistant row with the matching `provenance.attempt_id` commits.
- A matching accepted publication retires only the matching live record. Missing provenance, different attempts, foreign current handle, revoked accepted view, and rejected publication preserve the live record.
- Natural live termination is represented as `ended`; it is not a confirming or retry state. Stop and overflow remain separate controls.
- Accepted window and scroll effects use the current capability/generation and reject obsolete measurements without consuming stale scroll intent.

## Removed Runtime Mechanisms

- Handoff proof/receipt/display lease/stage/transfer/confirming ownership paths: `web/data/src/handoff.ts`.
- Terminal reader ownership module: `web/data/src/terminal-read.ts` (deleted).
- Store terminal-read, proof, presentation, transfer, and retry ownership APIs: `web/data/src/store.ts`.
- Terminal presence and assistant ownership generators: `web/ui-core/src/terminal-presence.ts` and `web/ui-core/src/assistant-ownership.ts` (deleted).
- Console confirming/retry/terminal-presence rendering: `web/designs/console/screens/Conversation.tsx` and `web/designs/console/screens/LiveMessage.tsx`.

## Public Assertion Mapping

- Live visibility, matching retirement, 16 KiB excerpt/full-body click/read, and dual accepted/live observer atomicity: `web/designs/console/test/pending-own-message.test.tsx`.
- Missing attempt provenance, different attempt, foreign current handle, revoke-before-reply, and rejected publication: `web/ui-core/test/accepted-window-live-retirement.test.ts`.
- Accepted publication generation and obsolete scroll effects: `web/ui-core/test/controlled-window.ts`, `web/designs/console/test/conversation-items-window.test.tsx`, `web/designs/console/test/projection24-window.test.tsx`, and `web/designs/console/test/scroll-resize-delivery.test.tsx`.
- Own-send cohort/current capture: `web/ui-core/test/own-send-production-controls.test.ts` and the AppModel pending-own-message suite.
- Ordinary saved body ordering/multiplicity and body projection: `web/ui-core/src/conversation-items.ts`, `web/ui-core/src/conversation-input.ts`, and `web/designs/console/screens/Conversation.tsx`.

## Deleted-Test Meaning

- Retired mechanism-only tests are deleted rather than renamed. Their retained public meanings are represented by the ordinary saved/live, owner/current, publication, body-load, and scroll assertions above.
- No compatibility alias, fallback reader, proof shim, retry shim, or empty/no-op fixture is retained.

## Freeze Qualification Correction

- The checkout documentation edit was made at 2026-11-16T05:57:18Z while the validation group was active. It is not part of a frozen-qualified run.
- The checkout copy was removed at 2026-11-16T05:57:29Z without changing the source unit; this mapping remains patch-only outside the checkout.
- Checkout bytes remain frozen from validation-group start through terminal cleanup. Apply this documentation/mapping only after the terminal event and only when creating the complete SHA qualification.

## Validation Terminal Evidence

- Console guarded execution `b7bcf1da-aac0-45c2-932d-ea1171e871e6` terminated at 2026-11-16T05:58:47Z with native exit 1, owned max RSS 444.8125 MiB and footprint 380.335266 MiB; no resource abort.
- Footer: 2 files, 85 tests; 83 passed, 2 failed. Browser setup reported `ECONNREFUSED` for port 3000.
- First source/test REDs were a stale `f` identifier in the migrated smoke assertion and an overflow assertion expecting a removed record identity. Those corrective edits were made after validation terminal and require a new guarded qualification run.

## Post-terminal Requalification Evidence

- Console requalification : 2 files / 85 tests passed / 0 skipped / native exit 0. Happy-dom emitted an AbortError during teardown, but Vitest footer was green.
- Both  and  exit 0 after the post-terminal repairs.
- Current unstaged patch checksum (not an immutable completion SHA): .
- Current completion remains unqualified until the full source/docs/mapping unit is frozen and the required normal qualification reruns on that frozen SHA.

## Requalification Report Erratum

- Correct Console execution ID: 7e336f95-e24d-400a-9608-c2fa09a6aa29.
- Correct typechecks: tsc --noEmit and tsc --noEmit -p tsconfig.ui.json both exit 0.
- Current unstaged patch checksum (not completion SHA): e774391a941cf9d494d7db309558048c3cd7486660a6014901bb409bdf030e3b.
