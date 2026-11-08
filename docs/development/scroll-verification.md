# Scroll verification (S7)

Environment: macOS arm64, Node 25.9.0, locked `web/package-lock.json`, headless
Google Chrome with a fresh temporary profile. Browser viewport cases are
1440 x 1000 desktop and 390 x 844 mobile/touch **emulation**, not physical devices.
Only generated history, a fake transport and synthetic owner replies are used.
No real owner, user data, credentials, provider or billing API participates.

## Commands

From the dedicated `studio-scroll-successor` worktree:

```sh
cd web
npm ci
npm run check
npm run build
cd ..
node web/designs/console/test/browser/verify-scroll.mjs
```

The browser runner starts/stops its own loopback Vite server and temporary Chrome
profile, chooses free ports, and writes PNGs plus JSON geometry to a new temp
directory printed on stdout. It does not restart an installed/shared server.
`CHROME_BIN` can override the macOS Chrome executable. An optional first argument
is a **new**, nonexisting artifact directory; existing directories are refused.
The fixture is a development HTML entry, not part of the production App bundle.
No new dependency or lockfile change is needed.

## Results and acceptance mapping

- `npm run check`: both TypeScript configurations and all 623 tests in 39 files
  pass. This includes all data/core/Console tests, not just the changed files.
- `npm run build`: production bundle succeeds (156 transformed modules).
- Browser runner: succeeds, recording 36 scenario checkpoints plus assertions
  for desktop and mobile emulation. The final evidence path is recorded in the
  handoff; generated images/JSON are not committed.
- No estimated heights / no total-sized storage: sparse measurements only;
  trillion-node metadata test opens one tail read without allocating by total.
- Loaded edges: blocked-reply browser case holds the existing range at scrollTop
  zero, then restores the same old node at its measured viewport offset on
  prepend (within one CSS pixel). No guessed placeholder exists.
- Follow intent: real desktop PageUp, CDP touch movement and wheel movement
  detach only after movement. Unit cases cover ineffective gestures, content
  shrink, viewport growth, scrollbar motion and fitting content. Short-content
  browser cases stay following after an ineffective upward wheel.
- Opening/closing: actual native outer and inner tool headings retain their
  viewport positions. Above/below-anchor synthetic ResizeObserver changes and
  detached/followed live growth preserve the appropriate anchor/end. Dense
  adjacent tool groups merge on prepend without losing an opened inner output
  or moving its saved heading; this uses production Conversation components.
- Append / return / rewind: detached append hints read nothing; followed large
  append jumps with bounded reads. Sustained reading evicts the old tail, then
  the production return-to-newest button selects the new disjoint tail. Rewind
  recovers while detached without interpreting its temporary loading frame as
  fitting content. Unit tests also cover surviving moved nodes, removed nodes,
  nearest ordinals, tail fallback, revision verification and retry.
- Late responses / disposal: unit tests exercise cancelled edge and tail replies,
  obsolete epoch responses and no reads after disposal. Hints and navigation
  are coalesced/cancelled rather than queued without bound.
- Bounded sustained work: deterministic 100,000-node test records one open read,
  100 older-edge reads, <=16 buckets/1,600 measurements, no reads during 301
  uninterrupted drag reports, and one cancel at disposal. Browser cases retain
  <=16 buckets/1,600 measurements/1,600 positional wrappers through eviction.
  A fitting collapsed dense group stays at one open call while idle instead of
  automatically walking the entire history.
- Existing functions: Stop/recovery/branch marks/selected steps retain explicit
  coverage after sequential loaded-edge traversal. All existing appearances,
  wording and symbols are retained.

## Inherited failures and review findings

The imported S1 WIP initially produced 596 passes / 12 failures in this worktree
(the handoff reported an earlier 594 / 14 run).
The preserved parked-window patch correctly replaced an estimate-based setup
with measured loaded rows and was adopted. The remaining far-scroll tests were
rewritten to visit adjacent loaded edges, retaining their substantive assertions
(cancellation, disposal, marks, Stop/recovery, selection, append and rewind).
Tests were not simply skipped or relabelled as obsolete: the new setup exposed
real extra bugs (evicted candidates being re-read, stale edge timers after
navigation, moved recovery anchors, caption coordinates, and intermediate loading
frames restoring follow), which were fixed and given focused coverage.

W8 P2 #1 is addressed by removing both full-total Float64Arrays and their growth
copy/scan. Measurements and all coordinate work are bounded by held buckets.
W8 P2 #2 is addressed by removing the ineffective same-range comparison: pixels
cannot select an unloaded island. Explicit navigation selects its target after
arrival and publishes a version change. Unit and browser tests return to a
noncontiguous tail after eviction, including an old armed edge timer.

## Limits

No physical phone, Safari, Firefox, Windows/macOS graphical user session,
real-owner integration or owner latency measurements were run. This task's
boundary explicitly requires fake bridge/synthetic owner rather than real-owner
tests. No Rust changes or Rust checks are involved. The store/live saved-body
issue waiting for #279 is unchanged; the live cases here check geometry only.
Browser automation and screenshots do not replace W8's independent visual/code
review or release approval. No push, main merge, installed binary change or
shared server restart is performed.
