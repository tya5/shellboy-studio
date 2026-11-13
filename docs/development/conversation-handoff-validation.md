# Conversation Handoff Candidate: Evidence And Boundaries

Current policy amendment: see presentation-ownership.md, Current Exact-Identity
Ownership Amendment (2026-11-13). Historical S2 reservation greens below cover
older narrow producer/proof states; they are not a universal no-duplicate claim
for released026 or permission to restore whole-node pending masks. New ownership
uses complete current scoped FINAL ordinary item identities and one atomic choice.


Task base is exact f53bb16e4f1dbca2c944ff431bc59839c6fbb224. Dedicated
studio-f53-live-handoff-s5 branch/worktree; no no-auth or ef140dac merge/cherry-pick.
S7 private diagnostic 74f0e08 (parent ef140dac) supplied scenario provenance only:
next-attempt window loss, mixed-node ambiguity, metadata-less tool first arrival.
The new tests are recreated synthetic fixtures, not copied private ancestry or a
claim that S7's old diagnostic greens were acceptance. No real conversations,
credentials, logs or screenshots are committed.

## Supported Repair

- live_end followed by delayed persistence, unrelated history changes and later
  attempts retain earlier visible text and logical identity.
- The limited exact final_answer projection can replace that text only after
  bounded successful readback and selected-path revision verification. A tool or
  commentary sharing its node is not sufficient reason to project aggregate text.
- Failed reads retain the preview and show an explicit retry; no timeout guess.
- Owner/cancel/leave/last-close results are rejected, including owner ABA. Closing
  one of two handles does not kill the other's valid lifetime.
- A held canonical window receives one body lease; automatic eviction/reset
  returns it, close ends it, stale callbacks cannot remove a successor attachment.
- Eight attachments/one MiB UTF-8, unpublished admission, exact byte edge, Unicode,
  eight-read generations and transfer accounting are synthetic regressions.

## Retained / Unsupported

Commentary-only, null phase, competing finals, truncated/malformed/absent refs,
empty final projection, incomplete body pages and mismatched identities retain
confirming text. Empty success alone cannot prove an actual empty saved message.
A node aggregate is never used to infer item spans. Missing status rows after the
single bounded 200-row read are unknown, not no-save. Read limits may require
explicit retry. Overflow retains old text but cannot promise a fully gap-free
conversation for unadmitted later text.

The old metadata-less/non-live first tool arrival problem is not fixed by claiming
all assistant excerpts are safe. Without a held live record the normal history
projection is unchanged here. #279 may classify a published tool ref, but it does
not expose arbitrary safe item bodies or execution details. This remains an
explicit known limitation rather than a fabricated tool success/command.

Failures coalesce history hints until explicit retry/recovery instead of displaying
an arriving aggregate row in parallel with the retained failed response. This can
delay history updates, including unrelated new history, while that read failure
persists. It is a review-visible tradeoff; existing known bodies are not hidden by
mere identity discovery. Mixed unsupported refs do not establish safe replacement.

## Core #290

General `(attempt_id, ordinal)` typed body readback is still unadopted/unimplemented.
Same-node commentary and final bodies cannot both be obtained separately through
current public history text/excerpt. No new RPC, Core code, schema adoption or
provider parser is added. Do not call the supported final subset a general item
readback fix or a guarantee that every case reaches ready. No release dependency
is introduced.

## Commands And Observations

Owner-free macOS environment; fake transport/database and existing synthetic
window owner only. No Core/bridge/owner/paid API/data or runtime connection.

- Before edits: two store regressions failed on task base (delayed persistence
  and unrelated-node inference), and the next-generation DOM regression failed.
- Same FakeTransport/RAF harness against temporarily restored base production
  source observed eight missing frames per tested width/theme, body height zero
  during disappearance, and DOM replacements. Production sources were restored
  afterward; no branch history was changed.
- Adding the windowed harness found a further candidate defect: two duplicate
  frames and seven DOM changes. Same-parent list ownership and failure hint
  ordering corrected it. The failing measurement was not relabelled a pass.
- npm run check validates both TS configurations and all synthetic tests; the
  exact current count is reported with the candidate SHA. npm run build also runs.
- Browser: `cd web && npx vite --config designs/console/test/browser/vite.config.mjs
  --host 127.0.0.1 --port 19572 --strictPort`, then from repository root
  `node web/designs/console/test/browser/c1-check.mjs`. Existing installed headless
  Chrome only, no downloads/install. Desktop 1280/mobile-width 390, both existing
  themes, legacy and history.window routes: eight combinations. Every sampled
  frame after initial renderer/font readiness checks count, actual Message DOM,
  logical key, body rect and outer rect through delay/error/retry/next generation.
- Body-height observations are distinct from status chrome. Desktop body 102.75px
  stayed constant in the observed trace. Mobile window body 146.125px stayed
  constant; legacy mobile body ranged 124.4375..146.125px. Outer heights changed as
  checking/retry labels appeared/disappeared. These are measured facts, not a
  claim of invariant height or a reason to mask change with debounce/scroll fixes.

The renderer fixture caps captured samples at 256; the test runner owns Chrome
and shuts it down. The task-owned Vite server must also be stopped at handoff.
Screenshots are private artifacts, not human-inspected acceptance. Viewport
emulation is not phone testing. Real owner/provider/native runtime, actual
commentary-to-final body completeness and production CSP deployment are not
established by this owner-free Vite test. Existing scroll/anchor acceptance is
not replaced; residual position work belongs to a later minimal change after
this body handoff is reviewed.

## Failed-History Gate Follow-Up

Only the changed Thread's history refresh is coalesced. Thread detail, active
work/status, list hints and lightweight hint consumers continue immediately;
usage/shell listeners remain independent. History state is marked stale while
held and the failed response explicitly warns that saved history may be out of
date until retry. Existing rows stay visible. Pause/navigation and owner/session
reset clear the old pending hint gate; recovery/retry refreshes history without
turning an unsupported mixed body into ready. The added synthetic regression
checks hint callbacks, thread.get and status still advance during a failed body
lookup. Exact follow-up web check: 1101 tests / 52 files, both TS configurations;
web build succeeds. The same eight RAF combinations are rerun as author evidence,
not independent review or a whole-time rendering guarantee.

## S2 exact identity reservation (2026-11-10 local validation)

Baseline: public `83dabe0ba858324ac8dd150d3fdcf97a7e23f1a8`, with S7's
independent visible RAF fixture imported unchanged. No real owner, runtime owner
configuration, installed asset or user data was used.

- Red: `DEBUG_PORT=19683 node web/designs/console/test/browser/visible-red-check.mjs`
  exited 1. Of twelve Chrome/RAF cases (legacy/windowed, 1280/390, normal/partial/
  wrong-node), four windowed partial/wrong-node cases each observed two duplicate
  frames while the body was still confirming. Missing frames and message identity
  changes were zero.
- Repair: after exact attempt/reference plus assistant anchor validation, retain
  the anchored node as display reservation; do not mark ready. Suppress only the
  ordinary message projection for that node. Partial, wrong, absent or unsupported
  body formats retain known text; safe body proof and transfer remain unchanged.
- Green: the same runner at `DEBUG_PORT=19684` exited 0, all twelve cases had zero
  missing, duplicate or message identity-change frames and eventually ready after
  valid retry. Text and confirming status remained for unverified bodies.
- `npm --prefix web run check`: 58 files, 1232 tests passed, including unsupported
  public-body format, cancellation-before-identity and owner ABA coverage.
  `npm --prefix web run build` passed.
- Scope limitation: ResizeObserver loop notifications still appear in the Vite
  browser diagnostic output (not silently filtered). The retained message body
  measured 102.75 px in desktop cases and 146.125 px in windowed mobile cases;
  legacy mobile varied from 124.4375 to 146.125 px. Status/retry chrome changes
  message height separately. Scroll/height work belongs to #6, not this body fix.
- Unknown/mixed refs without exact identity cannot be deduplicated by guessing
  text or body spans; they remain unknown and do not remove a retained body.
  No resource limits, read budgets, hint refills or protocol surface changed.
- Independent S6 review and same-SHA all-OS CI are handoff gates, not established
  by these local results. Device widths are emulation, not phone testing.

### Synchronous identity subscriber invalidation

Source review identified an additional boundary not exercised by the earlier
cancel-before-anchor test: identity publication synchronously invokes subscribers.
A subscriber can cancel reads, close the last handle, or restart owner A twice
(ABA) before the next body read starts. Three controlled tests fail on `040c920`
with one stale `history.get` start each (`/tmp/s2-sync-identify-red2.log`). Rechecking
the existing epoch/cancel/closed/owner predicate immediately after `identify`,
before taking budget or starting a read, makes all three pass. No new timing,
resource ownership, read budget or protocol changes are needed. Full Web check
now passes 58 files / 1235 tests and build passes. The updated candidate needs a
fresh independent source and exact-SHA Chrome acceptance before leader CI.
