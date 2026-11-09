# Studio #285: Existing Sender Facts And Current Titles

Task base: public main 175d6d311943d146a19915b2f015c4daad83d473.
Dedicated branch studio-sender-facts-285-s5; no private ancestor merge/cherry-pick.
ADR-A285 supplies the bounded resolver policy. The public Core v0.11.0
protocol.md Message sender inspection (#59) and MessageSender schema were checked
for kind/thread_id/label and omission semantics. No new DTO, saved title, Core
wire, Core version or bridge surface is introduced.

## Implemented

- Existing owner provenance is guarded before classification. Valid opaque model
  IDs stay unchanged; malformed/missing model IDs are unknown-model, not You.
  Human and external CLI do not acquire invented model IDs. No label/text/selected
  Thread/title heuristics. Unknown future kinds do not become human or Shellboy.
- Conversation shows current title (or honest unresolved state), full ID/link and
  separate unchanged self-asserted label. No label is auto-filled. Model titles
  are display only; same titles and renames do not change sender ID/link keys.
  Monitor tiles retain full sender ID and distinguish unknown from bot, but do
  not create another lookup cache or per-tile subscription.
- Resolver: 16 lifetime candidates/entries, 16 attempts, one in flight. Dedup and
  current owner-scoped list cache precede new RPC. Background hint/revision/render
  churn cannot refill candidates or attempts. Explicit owner/route/page scope
  changes can. Later IDs retain identity even if lookup was not admitted.
- Cancel/close/owner/page/membership invalidation drops late replies. Matching
  response ID is mandatory. A fresh cached rename cannot be overwritten by an
  older in-flight response. Old-owner history/list does not seed new lookups.
- Earlier-page completion and explicit jump-to-newest controls notify the resolver
  budget; ordinary scrolling/window movement does not. This does not change
  scroll correction, anchor handling or debounce.

## Evidence

Owner-free synthetic transport, existing fixture database, happy-dom and existing
installed Chrome only. No Core/bridge/real owner/provider/API/private data.

`cd web && npm run check` checks both TypeScript configurations and the full
Vitest suite. Focused tests exercise sender guard, projection, resolver lifetime
and budgets, product AppModel and actual Conversation DOM. Cases include opaque
IDs, missing/invalid/null/array/future provenance; model no-label/explicit label;
human/CLI; same-title IDs and rename; deleted/unsupported/error and returned-ID
mismatch; cache-hit zero RPC and duplicate one RPC; seventeenth-ID fallback;
16-entry/16-attempt budget under repeated membership and hint churn; one flight;
close/owner/page/removal stale result rejection; owner-history quarantine and
reentrant transport close. All text including HTML-shaped labels/titles renders
escaped, not markup. `npm run build` validates bundling separately.

Browser commands: task-owned Vite using existing
`web/designs/console/test/browser/vite.config.mjs`, host 127.0.0.1 port 19582;
`node web/designs/console/test/browser/sender-check.mjs` from repository root.
Eight conditions: 1280/390 widths with console/light themes, legacy and positional history. FakeTransport only.
Observed two same-title sender IDs remain distinct; list rename updates the
current title, full ID/link stays; no-label sender has no fabricated label;
unknown-model fallback is visible; HTML-shaped label is not injected; document
horizontal overflow is false. The fixture uses cached titles, so observed
resolver attemptCount is zero; transport lookup cases are tested separately.
Screenshots are private local artifacts, not committed or human-reviewed evidence.
Device emulation is not a real phone test. Vite/Chrome belong to this task and are
stopped afterward. No external package/browser download is required.

## Limits / Handoff

Core #285 notification truth/order work is separately assigned to W7. Fixture
sharing was requested directly; Studio does not claim the receiver-model notice
implementation or batch-order result merely because its existing provenance
projection works. Label remains sender self-assertion, title current display and
ID the only stable sender identity. Deleted/unavailable/unsupported/unadmitted
lookups retain ID fallback without retry/polling. An explicit page can permit a
new limited attempt budget; automatic history updates cannot.

No installed runtime, auth, release, dependency, paid call, database/schema or
new wire adoption changes are included. Real owner, native bridge end-to-end,
production CSP deployment, physical phone and cross-OS checks are untested.
This does not expand C1 final-body support or implement Core #290/general item
readback. Independent review/privacy audit and publication/runtime approval are
separate gates; an author synthetic green is not either approval.

Author checkpoint validation: both TS configurations and 1181 tests across 56
files pass; production web build passes. Eight browser conditions pass with two
stable sender IDs, current rename observed, unknown-model visible, no fabricated
label, no injected markup or horizontal overflow. These are author observations;
independent review results must be recorded separately, not added to this count.
