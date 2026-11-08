# Measured conversation scrolling

Status: implemented for independent review, 2026-11-08. The acceptance contract is
S7's user request (Thread `4168907e-f803-4950-9d16-028069a736f0`, message
`98278592-dbac-48a6-8527-faebfefff799`). This supersedes the S1 investigation in
`00d9529`; it is not release or push approval. See `long-threads.md` for the wire
and `../development/scroll-verification.md` for reproducible evidence and limits.

## Scroll space and ownership

- The scrollbar describes **one contiguous loaded run**, never the whole path.
  Unloaded edges have the existing loading indicator, not estimated blank space.
  The complete node count is numerical metadata, not a pixel coordinate.
- Every position calculation uses actual measured row heights. Unknown positions
  have no height. Measurements live in a sparse map and are discarded together
  with their history bucket. Neither allocation nor append work scales with the
  full Thread total.
- `ConversationWindow` owns reads, retained positions and model anchor recovery.
  `WindowedScroll` owns every DOM scroll write, including live text. Its row-space
  origin is measured relative to the scroll box; captions, notices, padding and
  edge indicators are not mistaken for conversation row heights. Row-space
  scrollTop can be negative when the first row is below a caption.
- Native scroll anchoring stays disabled. Application corrections use
  `ScrollIntent.program`, which records the browser's clamped result. There is
  no second live-message scroll writer.

## Reading and following

While detached, retain the first visible rendered node (or inner tool execution)
and its viewport offset. `ReadingAnchor` retains identifiers and measured offsets,
not DOM subtrees. It resolves the same execution after a prepend joins two tool
groups; a collapsed group's shared execution identifiers identify its replacement
heading. Model height compensation is the fallback when the DOM anchor no longer
exists. A clicked tool heading takes priority during its own open/close operation.
Following takes priority over heading anchoring, so opening a tool at the tail
keeps the actual end in view.

Group and inner-step expansion choices survive regrouping while their history
remains held. They are pruned when the corresponding run/steps leave retention,
and on a Thread change; they do not become a record of every tool ever visited.

An upward wheel, touch or key event alone does **not** detach. Actual upward
scroll movement does, including a scrollbar move. Programmatic corrections and
layout-driven browser clamping do not detach. Actual downward movement to the
real tail resumes follow. Ready content that fits the viewport is also at the
end. An empty intermediate loading frame during rewind is not ready content and
must not resume follow. Reaching an older loaded run's bottom is not reaching
the Thread's tail.

At the upper/lower edge, a gesture cannot traverse unread history. After an
80 ms pause, a detached view prefetches one adjacent bucket within a viewport of
that edge. A fitting followed run must **not** automatically walk older pages
(e.g. 100 hidden nodes, or one collapsed group). An upward gesture against that
fitting upper edge may request one older bucket without detaching follow. This
keeps reading possible without treating an ineffective gesture as movement.

## Mutation and recovery

- Prepend and eviction restore the measured DOM anchor before paint. A
  below-anchor measurement requests no correction. Above-anchor measurements
  compensate only the measured change.
- A detached append hint offers the return-to-newest control and reads nothing.
  While following, read from the checked last-known node. A large append skips
  the intervening history with a bounded tail read rather than walking pages.
- Return to newest cancels old edge timers/reads. Keep the old run and reading
  position until the target tail window has arrived; then select it, publish a
  redraw, and follow its end. Upward movement during that wait cancels the
  navigation. A failed navigation exposes the existing load-error/retry control.
- A different revision is not proof of rewrite: verify the last-known node with
  `expect_node_id`. A successful check preserves the old prefix. If the checked
  tail has been evicted, the verification item is evidence, not a new rendered
  island. A second revision change during a far-tail read is checked again.
- On `cursor_expired`, cancel and discard old windows/measurements. A detached
  reader tries the anchor node (including a changed ordinal), then its ordinal,
  then the new tail if the ordinal is gone. Preserve the node's old offset when
  it survives; otherwise use the nearest available position and show the
  existing path-changed notice. Re-reading the tail does not itself reattach a
  detached reader. A followed reader recovers at the end.
- Responses are checked against their epoch and request identity. Cancellation,
  navigation and recovery invalidate late replies even when a transport still
  delivers them. There is one shared tail/verification lane; hints coalesce into
  one boolean, not a queue.

## Bounds and disposal

| State/work | Bound and owner | Release |
|---|---|---|
| History | 16 buckets x 100 slots per open `ConversationWindow` | Evict the opposite edge; dispose on leaving/switching Thread |
| Heights | At most one sparse measurement per retained slot (1,600) | Same eviction/reset as history |
| DOM | One loaded run, at most 1,600 positional wrappers; projected group contents are bounded by those items | Preact unmount on eviction/navigation |
| Height/offset work | Scans retained measurements/positions only; no loop or typed array indexed by full total | No persisted index |
| Reads | At most 2 bucket reads plus one tail **or** verification/recovery read; each reply <= 200 nodes | Cancel on departure/reset/disposal; identity check on arrival |
| Requested/failed buckets | Current run plus adjacent edge, at most 17 bucket keys | Prune on view change/eviction/reset |
| Pause | One timer per reader; unchanged layout reports do not postpone an armed timer | Cancel on navigation/disposal |
| Anchors | One model anchor, one reading anchor and one temporary clicked-heading anchor | Replace on view/measurement; component unmount |
| Expansion choices | Groups of the rendered run; inner choices for held executions only | Prune with retention and Thread change; legacy choices pruned with its retained projection |

Existing body/output cache and data-layer queue/page limits are unchanged. No
owner database, real conversation or provider API is needed for the synthetic
scroll suite. Rendering up to 1,600 retained slots is deliberately bounded, not a
claim of a frame-time or memory-byte guarantee on every device.
