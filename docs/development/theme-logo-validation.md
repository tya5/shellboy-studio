# Studio #11: Existing Theme Logo Surfaces

Task base: dd9372b338d0be0bae6bb475145d8131b23192da, dedicated
studio-theme-logo-s5 branch. Existing brand and design are unchanged. This work
adds measurement to the existing synthetic production/CSP fixture and corrects
stale documentation, not an App Auto preference or a new logo design.

## Surface Inventory

| Surface | Existing Asset | Selection | Observation |
| --- | --- | --- | --- |
| App sidebar brand, desktop and mobile drawer | inline BrandLogo SVG | console/light/terminal generated accent tokens | DOM/computed colors/rect/identity each RAF |
| SVG favicon | studio-favicon.svg | OS prefers-color-scheme | decoded image clone canvas pixel and direct SVG document |
| ICO fallback | studio-teal.ico | fixed light accent | load/MIME/decoded dimensions, existing baseline |
| Apple touch icon | studio-teal-180.png | fixed light accent | load/MIME/decoded dimensions, existing baseline |
| Install icons | studio-teal-192.png, studio-teal-512.png | fixed light accent | manifest/MIME/dimensions, existing baseline |

The app has three explicit themes. An App Auto setting does NOT exist and is NOT
a passed test case or newly added feature. OS-media auto refers only to the
existing SVG favicon. Static ICO/apple/PWA images are not called adaptive.

## Commands And Observations

Owner-free fixture database/FakeTransport, existing installed Chrome, task-owned
HTTP server on loopback 19642. `brand-serve.mjs` bundles the synthetic fixture into
a task temp directory, serves the existing bridge CSP verbatim, and reads no
owner/data/provider. Installed runtime assets are not changed.

- Server: `FIXTURE_PORT=19642 PRODUCTION_DIR=/tmp/11f-logo-production
  REQUEST_LOG=/tmp/11f-logo-requests.json node web/designs/console/test/browser/brand-serve.mjs`.
- Baseline: `FIXTURE_PORT=19642 DEBUG_PORT=19643 SHOTS_DIR=/tmp/11f-logo-shots
  node web/designs/console/test/browser/brand-check.mjs`.
- Dynamic: `FIXTURE_PORT=19642 DEBUG_PORT=19653
  node web/designs/console/test/browser/logo-frame-check.mjs`.

Baseline checks 1280/390 widths x three app themes x two OS schemes, plus direct
SVG documents, static fallback decoding and manifest parsing. It passed before
any fixture change. Screenshots are local unreviewed artifacts, not committed.

The dynamic runner uses the same production/CSP fixture with a synthetic-only
preference setter. For each width/initial theme it observes four OS changes
(dark/light/dark/light), then app themes light/terminal/console without reloading.
A bounded array holds <=256 RAF samples per run. It measures the actual existing
inline logo, not a replacement invented for the test; a decoded clone of the
favicon URL is drawn to canvas every frame. The sampling begins after mount,
font readiness and image decode, so it is not an initial cold-load paint trace.

Color assertions are against the selected app theme and observed OS media state,
not an arbitrary timeout debounce. Same actual logo DOM and nonzero visible rect
are recorded; on mobile the existing drawer is explicitly opened. Contrast uses
sRGB relative luminance on computed colors: tile/face, bright/face and tile/sidebar
background. The runner requires each measured contrast >=3, preserving the
existing brand contract threshold rather than claiming a new accessibility rule.

An initial new-runner defect escaped a regular expression through a JS template,
causing sample callbacks to throw. That run's exit zero is NOT accepted evidence;
the corrected runner refuses empty samples. No product defect or fix follows
from that fixture error. Final measured counts and repeated runs are reported
with the candidate SHA.

## Interpretation And Remaining Limits

No measured product defect means no speculative production asset/CSS change.
The stale system README claimed no real logo existed; it now links the actual
inline component and distinguishes browser/install assets.

Browser-chrome favicon pixels are not exposed through page DOM. A media-aware
SVG image clone/direct SVG document is evidence for that resource's rendering,
NOT a no-flicker proof of the actual tab/favicon UI. ICO/PWA/apple fallback
selection or installed launcher caching is also not proved by image decode.
Physical phone/touch, native install/launcher, cold cache/first paint, browser UI
pixel capture, cross-OS browsers and arbitrary scheduling outside sampled frames
remain untested. No app Auto UX is delivered; any such feature is a separate
remaining request, not silently included in issue #11.

This is synthetic production-CSP page evidence, not real owner/native bridge
acceptance. No RPC/model/provider/data/auth/notice parsing or Core adoption is
needed. Independent review/privacy and publication/runtime adoption remain
separate gates. Task-owned server and Chrome are stopped after measurement;
existing user owner processes are never stopped or replaced.

Author final checkpoint: six dynamic width/initial-theme combinations capture
288 samples (48 each). Missing/invisible/unloaded, wrong app colors, wrong SVG
image colors and actual logo DOM replacement each total 0. Minimum observed
contrast: tile/face 3.49, bright/face 11.81, tile/sidebar 3.49. All six combinations
contain OS and app transitions. Both TS configurations and 1231 tests / 58 files
pass, web build passes. Baseline command separately passed the original asset
inventory. These are author observations, pending independent review; they do
not establish browser-chrome favicon pixel continuity or an App Auto feature.
