# Studio 27 Withdrawal: Current Contract

This is the source-integrated documentation candidate. Operational history, freeze corrections, queue state, and validation logs remain in the companion private report.

## Runtime Contract

- Saved rows own persisted bodies. Partial/deferred rows use the ordinary `loadBody(node_id)` action; the body cache becomes the rendered source after a successful read.
- Live records are visible projections with attempt identity. Only a matching accepted assistant provenance retires a live record.
- Missing provenance, different attempt, foreign current handle, revoked accepted state, and rejected publication preserve the live record.
- Natural terminal live state is `ended`; it is not a confirming or retry state. Stop and overflow remain separate.
- Accepted-window publication and scroll effects are capability/generation guarded. Obsolete measurement cannot consume stale scroll intent.

## Removed Mechanisms

- Handoff proof/receipt/display lease/stage/transfer ownership paths: `web/data/src/handoff.ts`.
- Terminal reader ownership module: `web/data/src/terminal-read.ts`.
- Store terminal-read/proof/presentation/transfer/retry ownership APIs: `web/data/src/store.ts`.
- Terminal presence and assistant ownership generators: `web/ui-core/src/terminal-presence.ts`, `web/ui-core/src/assistant-ownership.ts`.
- Console confirming/retry/terminal-presence UI: `web/designs/console/screens/Conversation.tsx`, `web/designs/console/screens/LiveMessage.tsx`.

## Public Mapping

- Live/body/retirement/dual-observer: `web/designs/console/test/pending-own-message.test.tsx`.
- Negative live ownership and rejected publication: `web/ui-core/test/accepted-window-live-retirement.test.ts`.
- Publication/scroll currentness: `web/ui-core/test/controlled-window.ts`, `web/designs/console/test/conversation-items-window.test.tsx`, `web/designs/console/test/projection24-window.test.tsx`, `web/designs/console/test/scroll-resize-delivery.test.tsx`.
- Own-send current capture: `web/ui-core/test/own-send-production-controls.test.ts`, AppModel pending-own-message tests.
- Deleted mechanism tests are replaced by these ordinary saved/live/body/currentness assertions; no compatibility shims are retained.

## Contract Precision

- Scope identity is the actual tuple `[owner.instance_id, entry.id, entry.live.lifetime]`; no presentation-host or proof identity is implied.
- Retirement requires one accepted-window update whose `assistant_response` row has the matching canonical `provenance.attempt_id`. It does not require complete/readable/full-body coverage; a valid 16 KiB excerpt is an ordinary bounded preview. Tail auto-expansion is tracked separately as Studio issue `#28`.
- Removed modules are explicitly deleted: `web/data/src/terminal-read.ts`, `web/ui-core/src/terminal-presence.ts`, and `web/ui-core/src/assistant-ownership.ts`.

## Exact Inventory Boundaries

- Retained `nodeId`/attempt identity: `web/data/src/handoff.ts`, `web/ui-core/src/conversation-items.ts`, `web/ui-core/src/window.ts`.
- Retained ordinary retry semantics: `web/ui-core/src/model.ts` (`resend`/send admission), not the removed handoff retry path.
- Retained manual window/scroll semantics: `web/ui-core/src/window.ts` and `web/designs/console/screens/WindowedScroll.tsx`, including current-generation rejection and scroll-intent preservation.
- Retired proof/lease/readback/confirming paths are removed for their exact source references above; no zero-word rename claim is made.
- Deleted mechanism tests are represented by current registered controls in `web/ui-core/test/accepted-window-live-retirement.test.ts`, `web/ui-core/test/controlled-window.ts`, `web/ui-core/test/own-send-production-controls.test.ts`, and `web/designs/console/test/pending-own-message.test.tsx`.
