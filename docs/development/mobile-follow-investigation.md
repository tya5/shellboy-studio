# Mobile return-to-newest investigation (S7)

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

Product baseline: `c2a63261d6cc49be7ad084e3d2fdf28337c9bddb`.
Investigation request: private follow-up on the mobile return-to-newest observation.
This follows the unresolved observation in `main-scroll-integration-acceptance.md`.
Only the browser harness and evidence change here; product code remains identical
to the adopted baseline. The earlier theme correction belongs to `30245df`,
not this investigation. No main/push/restart/real owner/user data/provider is used.

## Conclusion and its scope

The reproduced failure is a **harness input-model problem**: it starts a real
Chrome touch fling, then uses JavaScript `button.click()` to simulate the return
button. That untrusted click does not stop the old touch fling. The old fling
continues moving the actual scroll offset upward after the programmatic return.
The product detects that real upward movement and detaches, as its existing
scroll contract requires. The live growth arrives after that detachment; it is
not the transition that caused it.

A CDP touch tap on the return button supplies the missing real input. It cancels
the old fling before the button's trusted click. This preserves the approved
experience and needs no product change, no ignored-scroll grace period and no
larger movement tolerance. Increasing sleeps or ignoring post-navigation
movement would hide the condition and was not done.

This identifies the reproduced Chrome-emulation failure mechanism, not every
possible mobile bug. The original `D58hbC` report lacks an intent trace, so its
individual event ordering cannot be proved retrospectively. It has the same
path and symptom as the failures reproduced here. Physical-device behavior,
other browsers, keyboard/accessibility activation during an active touch fling,
and intentionally scripted navigation during a fling remain unverified. The
latter can still detach: its old physical motion has not been cancelled. These
results do not establish that all programmatic-navigation uses are safe.

## Bounded experiment (56 focused trials)

Same synthetic fixture, production Vite bundle, baseline product source, Chrome
headless mobile emulation (390x844), and fixed original timing in every group:
five 30px touch moves, 30ms between moves; touch end; 350ms; return action;
350ms; live growth; 250ms; check. The load-ready pause is unchanged. No sleep was
increased or repeated until success. Each trial navigates a fresh page in the same temporary Chrome profile, loads
generated 100,000-node metadata, and writes its own trace.

| Group | Trial count | Failures | Evidence suffix |
|---|---:|---:|---|
| Original JS `button.click()` | 16 | 4 | `x79URs` |
| Real touch tap on return button | 16 | 0 | `opPXdJ` |
| New touchstart/cancel, then the **same JS click** | 8 | 0 | `ZonFXU` |
| Final tap regression with trusted-event/stage trace | 8 | 0 | `AaOuUR` |
| Final retained JS-click negative control | 8 | 5 | `bjRQMr` |

Thus JS click fails 9/24, touch tap 0/24, and the input-cancellation causal
control 0/8. These counts describe these bounded runs, not a population failure
rate or a statistical guarantee. All nine reproduced failures were already
detached in the pre-live snapshot. Failed trials are retained and negative-control
commands exit nonzero; none are omitted from the summary.

The causal control changes only input cancellation, not the navigation handler
or live renderer. Its success supports the explanation beyond two coincidental
successful full-suite runs. It also distinguishes residual browser motion from
an invented extra product state transition.

## Exact transition evidence

First baseline failure, `x79URs/trial-0.json`:

- Original touch: at 841.6ms, top 13764 -> 13749, upward=true, following true ->
  false. This is the expected initial user detachment.
- Return: at 1371.7ms, program sets top to the actual end, 13764; following=true.
- At 1374.1ms, `scroll()` called from `onScroll` reads top=13762, height=14365,
  clientHeight=601. `programTop=13764`, previous top=13764, upward=false. Since
  the offset actually decreased and dimensions did not change, the mismatch is
  real upward motion, not a resize clamp. It sets following=false.
- Pre-live already has following=false. Live later increases height to 15481
  while the detached anchor is preserved; that is expected detached behavior.

Final negative control, `bjRQMr/trial-0.json`:

- 1795.2ms: before-navigation marker.
- 1796.0ms: `click`, trusted=false, target `Jump to the newest`; there is no new
  touchstart before this activation.
- 1803.7ms: top 13764 -> 13762, unchanged height=14365, upward=false,
  programTop=13764, following true -> false.
- 2170.1ms: before-live marker, already detached.

Final tap regression, `AaOuUR/trial-0.json`:

- 4434.0ms: before-navigation marker.
- 4442.5/4457.1ms: trusted touchstart/touchend on the return button.
- 4467.3ms: trusted click on that button. No second following true -> false
  transition occurs after return.
- Before live: top=13764, height=14365, viewport=601, following=true.
- After live: top=14880, height=15481, viewport=601, following=true (actual end).

Browser-internal compositor implementation is not directly inspected; residual
fling attribution is based on continued real motion with no fresh upward input,
its timing after an active fling, the untrusted activation, and the isolated
new-touch cancellation control. It is not a claim about undocumented owner state.

## Harness correction and regression coverage

- Mobile full-suite return actions now use CDP touchstart/touchend on the actual
  return button, not `HTMLElement.click()`. Desktop handling is unchanged.
- The normal suite now **asserts** pre-live following; it was previously a
  snapshot-only checkpoint. Focused trials check detached, pre-live, post-live
  and actual-end conditions and retain every outcome.
- `SCROLL_FOCUS=1` runs only this path (default 16 trials, hard bound 1..32).
  `SCROLL_NAV=js-click` retains the original negative control;
  `SCROLL_NAV=touch-cancel-js` isolates cancellation of old input.
- `?trace=1` opt-in wraps actual `ScrollIntent` methods in the test fixture;
  original methods run unchanged. It records before/after state, geometry,
  requested program offset, trusted touch/click events and phase markers.
  Only the latest 256 entries per page are retained. A failure stores a PNG
  and trace; failed runs still report their summary as failed.
- No product exported diagnostics, new production state, threshold, scheduling
  change, dependency or protocol change is introduced.

Reproduce from the investigation worktree:

```sh
# Positive regression: CDP trusted touch input, original timings.
SCROLL_PRODUCTION=1 SCROLL_FOCUS=1 SCROLL_TRIALS=8 \
  node web/designs/console/test/browser/verify-scroll.mjs
# Retained negative control: nonzero exit is expected when a trial reproduces.
SCROLL_PRODUCTION=1 SCROLL_FOCUS=1 SCROLL_TRIALS=8 SCROLL_NAV=js-click \
  node web/designs/console/test/browser/verify-scroll.mjs
# Causal control, no extra sleep.
SCROLL_PRODUCTION=1 SCROLL_FOCUS=1 SCROLL_TRIALS=8 SCROLL_NAV=touch-cancel-js \
  node web/designs/console/test/browser/verify-scroll.mjs
```

## Validation and artifacts

- `cd web && npm run check`: both TypeScript configurations, 40 files / 625
  tests pass. `npm run build`: succeeds; product output unchanged.
- `SCROLL_PRODUCTION=1 node .../verify-scroll.mjs`: one full post-correction run
  succeeds, 42 recorded scenario checkpoints (not 42 independent assertions).
  The real pre-live assertion is now present. No repeated full-suite hunting.
- `node --check` and `git diff --check`: pass.
- Logs: `$TMPDIR/s7-follow-baseline.log`, `$TMPDIR/s7-follow-touch-tap.log`,
  `$TMPDIR/s7-follow-cancel-control.log`, `$TMPDIR/s7-follow-final-focused.log`,
  `$TMPDIR/s7-follow-final-negative.log`, `$TMPDIR/s7-follow-check.log`,
  `$TMPDIR/s7-follow-build.log`, `$TMPDIR/s7-follow-suite.log`.

Artifact root for every suffix in the table is
`$TMPDIR/s7-scroll-evidence-` followed
by that suffix. Each has `trial-N.json` and `focused-summary.json`; failed trials
also have `focused-failure-N.png`. Full-suite images/results are in
`$TMPDIR/s7-scroll-evidence-2sEreC/`.

These are geometry/state-machine assertions in synthetic Chrome, not proof of
all CSP compliance (the runner still does not automatically fail every runtime
or CSP console event), nor new cancelled-frame/response-ID correspondence
coverage. The earlier character theme correction and its 12-case evidence are
unchanged in `30245df`; do not attribute that work to this investigation.
