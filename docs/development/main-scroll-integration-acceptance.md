# Adopted-main synthetic integration acceptance (S7)

## Public-record provenance

This document preserves a synthetic validation report from a private validation
branch, not a validation rerun on this public candidate. Its final source record
is commit `051fdb08f3da96f1a1f4d28b3475e6a3e5f555f2`; the earlier acceptance
harness and theme correction were recorded in `30245df`. Those commits are
provenance references, not ancestors added to this public candidate.

The public candidate starts at
`c2a63261d6cc49be7ad084e3d2fdf28337c9bddb` and adds records only. Its product
**and test code** are identical to that baseline. It does not contain the private
runner additions described below: production-scroll mode, focused trials,
trusted mobile taps, expanded diagnostics, pre-live assertion, or the fixture
theme correction. Commands using those additions describe the private validation
checkout; they do not reproduce that coverage from this public tree alone.
Historical present-tense references to the harness refer to that private checkout.

Artifact and log locations below use literal, unexpanded `$TMPDIR` placeholders;
they are portable descriptions of privately retained evidence, not bundled or
publicly downloadable files. Host-specific temporary roots and an internal
request identifier are anonymized. Results, failures, trace values, causal
qualifications and unverified cases are preserved. No new tests were run for
this records-only copy. Full public-ref history/privacy audit remains a separate
review; this copy is not a claim that the inherited history is free of private
information.

Target: `c2a63261d6cc49be7ad084e3d2fdf28337c9bddb` (2026-11-08).
All product sources remain identical to that target. Changes on
`studio-s7-main-acceptance` are test harnesses and this evidence record only.
This is neither publication approval nor physical-device/real-owner evidence.

## Environment and commands

macOS arm64, Node 25.9.0, Chrome headless with temporary profiles. Desktop
1440x1000 and mobile 390x844 are browser emulation, not actual devices.
Only the existing generated `WindowOwner`, `FakeTransport`, scroll fixture and
character integration fixture are used. No bridge/owner binary or API is run.
Every temporary HTTP/Vite server is started for this test and stopped afterward.
No shared-server restart, push, tag, release or main modification is performed.

```sh
cd web
npm ci
npm run check
npm run build
cd ..
node web/designs/console/test/browser/verify-scroll.mjs
SCROLL_PRODUCTION=1 node web/designs/console/test/browser/verify-scroll.mjs
```

The new optional `SCROLL_PRODUCTION=1` mode builds the existing scroll HTML
entry with the adopted Vite configuration, serves only `/` and hashed `/assets/`
from a temporary directory, and sends the exact CSP read from `src/assets.rs`.
It reuses the existing scenarios and adds asset/status checks and a deliberately
late cancelled-edge response. Test output paths are printed; no artifacts enter
Git. The normal product bundle is built independently by `npm run build`.

Character production checks use the existing server and runner:

```sh
# OUT is a fresh temporary directory. Start/stop only this process's server.
FIXTURE_PORT=19630 PRODUCTION_DIR="$OUT/bundle" REQUEST_LOG="$OUT/requests.json" \
  node web/designs/console/test/browser/production-serve.mjs
SHOTS_DIR="$OUT" FIXTURE_PORT=19630 DEBUG_PORT=19631 \
  node web/designs/console/test/browser/production-check.mjs
```

The character fixture previously accepted `theme=light` but did not apply it to
`document.documentElement.dataset.ds`; results therefore labelled both themes
`console`. Only the fixture is corrected, with a runner assertion that the
requested theme is actually applied. Production theme handling is unchanged.

## Observed results

- On the pristine target: both TypeScript configurations and 625 tests in 40
  files pass; production App build succeeds (164 modules, seven hashed SVGs).
- The unmodified scroll runner passes all 36 scenario checkpoints on the target.
  It covers loaded edges, fitting content, measured anchors, native outer/inner
  details, live geometry, prepend, eviction, disjoint tail return and rewind.
- Production scroll passes the complete suite with asset/status and late-response
  checks. The deliberately cancelled old edge reply leaves the loaded range,
  first visible node and offset unchanged on desktop and mobile. Successful
  production run `MuPShh` records 40 checkpoints and 36 successful HTTP requests,
  with no missing asset.
- Corrected character production fixture: 12 cases (1280/390 widths x
  console/light x history/empty/running), all pass. Thirty-two image instances
  load from hashed SVG asset URLs. No page horizontal overflow; status remains
  outside the composer dock. Running status retains `Running tools`,
  `Verify query ranking`, `Running at least 2` and `1m 0s`.
- Its request log includes a browser `/favicon.ico` 404 because that fixture
  has no favicon route. No character/JS/CSS request fails. The scroll fixture
  has a data favicon and no missing requests.

## Intermittent observation, not silently discarded

Follow-up: `mobile-follow-investigation.md` reproduces the transition and compares
real touch activation with the old JS-click harness. The observation below is
retained as the original report, not silently rewritten into an initial pass.

One production-scroll run (`D58hbC`) failed after the mobile touch movement,
return-to-newest, and initial synthetic live growth. Snapshot: following=false,
scrollTop=13485, scrollHeight=15481, clientHeight=601, loaded run 99900..99999,
total=100000, no read in flight. The same test and product source then passed
completely in run `MuPShh`. A further run `fxKvxV` with bounded diagnostic
tracing and a pre-live snapshot also passed all 42 checkpoints (two consecutive
full production passes after the single live-follow failure). This is not a proven deterministic regression or a
proven harness-only issue. Touch inertia versus navigation/layout ordering is a
hypothesis, not a conclusion. Do not describe these results as an unconditional
all-green production acceptance. The runner now records bounded scroll-event
traces and a failure screenshot for subsequent reproduction, and records the
state after return-to-newest before growing live text.

Reproduction command is the production-scroll command above; the fixture needs
no owner or data. Sequence: mobile emulation; five upward-scroll touch moves;
350 ms pause; click the production return-to-newest button; 350 ms pause; append
`Synthetic live text. ` 100 times; 250 ms pause; assert follow and actual end.
The failure JSON is retained alongside passing evidence rather than deleted.

## Evidence locations

- Pristine-main scroll: `$TMPDIR/s7-scroll-evidence-8AAvJY/`
- Passing production scroll: `$TMPDIR/s7-scroll-evidence-MuPShh/`
- Latest production scroll with diagnostics (42 checkpoints): `$TMPDIR/s7-scroll-evidence-fxKvxV/`
- Intermittent failure: `$TMPDIR/s7-scroll-evidence-D58hbC/failure.json`
- Corrected character production cases: `$TMPDIR/s7-main-production-verified-loTJ1E/`
- Logs: `$TMPDIR/s7-main-check.log`, `$TMPDIR/s7-main-check2.log`,
  `$TMPDIR/s7-main-build.log`, `$TMPDIR/s7-main-scroll-browser.log`,
  `$TMPDIR/s7-main-production-scroll2.log`, `$TMPDIR/s7-main-production-scroll3.log`,
  `$TMPDIR/s7-main-production-scroll4.log`.

Each complete scroll run contains 14 PNGs and geometry JSON. The character run
contains 12 PNGs, production results, the served bundle and a request log.

## Not verified

No physical phone, Safari, Firefox, Windows/Linux GUI, real owner, bridge binary
embedding, actual release archive/download, CI, provider or billing API was
verified. Production here means the existing synthetic entry bundled by Vite
and served with the adopted CSP, not a real embedded bridge binary. The known
store/live saved-body issue waiting for #279 is unchanged; these tests check live
geometry, not correctness of that deferred feature.
