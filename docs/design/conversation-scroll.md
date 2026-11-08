# Conversation scroll investigation (in progress)

Baseline: Studio main 26e4027. This is an inventory, not yet an adopted design.
The two reported symptoms have not yet been reproduced in a browser; root causes
and the effect of individual events remain unverified.

## Current write paths

- `ScrollIntent.program` assigns the element's `scrollTop` and remembers the
  resulting value. `WindowedScroll` calls it in a layout effect and in a
  ResizeObserver callback: while following it requests the bottom; otherwise it
  applies `ConversationWindow.takeScroll()` when present.
- `Conversation` calls `program` when its follow callback runs, provided the
  active reader is following. `jumpToEnd` in the window requests a clamped
  bottom and the layout effect applies it.
- `ConversationWindow` changes its internal `viewTop` and queues a request in
  `applyHeights`; it does not itself write the DOM element. `applyHeights`
  compares `offsetOf` at the located ordinal before and after measurement.
  Unknown row heights use the current mean, so an offset difference can include
  changes to estimated heights as well as a measured row.
- Browser native anchoring is disabled on `.scroll-frame > .scroll`; browser
  clamping and user gestures can still change the scroll position.

## Height-changing events to measure

New history, live text and status changes; loading and evicting history windows;
placeholder replacement and row measurement; image or attachment loading;
tool-group and nested tool expansion; asynchronous Markdown rendering and font
loading can change geometry. Windowed rows are observed with ResizeObserver;
the group is measured as one ordinal row, not by the nested tool heading. The
current code does not explicitly select the operated heading as an anchor.
The precise effect of each event on viewport position requires browser
measurements, including desktop and emulated mobile touch gestures.

## Target invariants

Keep the first visible row id and its viewport offset stable while detached;
compensate measured height changes above it, not changes below it. Opening or
closing a tool anchors its operated heading. Following remains at the end and
is detached only by user input. Centralize DOM scroll writes and avoid combining
browser anchoring with application compensation. Never use estimated heights in any position calculation: unmeasured rows
contribute no height. The detailed mapping across evicted rows and anchor removal
requires explicit testing before implementation.

## Proposed bounded scroll range

Only the contiguous loaded range participates in the scrollable height. Each
unloaded edge shows a fixed-height loading indicator, not an estimated height
for the rest of the path. Approach to an edge requests the adjacent window;
prepending restores the visible anchor using the measured geometry after
render. Explicit far navigation reads the target window before displaying it.
The scrollbar describes the loaded range; the full node total is shown as a
number. Hold at most `WINDOWS_HELD` windows and evict only at the edge opposite
the active direction. Cancel outstanding requests on disposal. Native browser
anchoring remains disabled when application compensation is active.

This proposal has not yet been implemented or verified. In particular, edge
eviction while a gesture is in progress and restoration when the anchor itself
is removed require browser tests before declaring the policy safe.

## Initial browser measurement

Chrome headless on macOS, using the existing `WindowOwner` double with 100,000
nodes and the real `ConversationWindow` (not the rendered Conversation screen):
with the anchor at ordinal 99,500 and `viewTop` 9,552,000 CSS px, reporting a
300 px measurement for ordinal 99,950 (below the anchor) requested a new
`scrollTop` of 1,865,625 px. This demonstrates that the model's estimate-based
correction can move an anchor even for a measurement below it. It does not by
itself reproduce the user's rendered-screen symptom or establish its frequency.
The tool expansion and physical-touch cases remain unmeasured.

The deterministic model regression `does not request a scroll when a row below
the detached viewport changes` also fails before the redesign: with a viewport
set to 48,000 px and a 500 px measurement at ordinal 900, the model requests
16,666.67 px even though that ordinal is below the anchor. This is a model
fixture measurement, not a rendered-screen or touch reproduction. The old
anchor test only checks internal consistency after the requested correction;
it does not assert that a below-anchor measurement leaves scrollTop unchanged.
