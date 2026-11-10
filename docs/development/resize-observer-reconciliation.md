# Owned Resize Reconciliation

The mounted WindowedScroll owns one persistent ResizeObserver and at most one
requestAnimationFrame callback. This is a local DOM lifecycle, not a shared task
scheduler. The observation set contains only the scroll box and existing rendered
loaded-row/space/live elements; removed nodes are unobserved on render and the set
is cleared on disposal. No history read, polling timer or retained event queue is
introduced. New renders cancel pending resize work before their existing sync.

RO delivery captures a port/reference and invalidates the single frame slot; it
does no DOM measurement, publication, request/heading consumption or scroll write.
The frame checks exact port ownership and acceptedView.isCurrent before sync.
Ref replacement, same-reference revoke and model disposal therefore discard old
work before measurement; unmount also cancels the frame, disconnects the observer
and makes late deliveries inert. No automatic retry follows rejected work.

Layout/render reconciliation reads intent.following, rather than invoking the
movement classifier. Actual scroll events still call ScrollIntent.scroll. This
keeps layout notification from consuming program-target/upward gesture state;
programmatic correction still uses existing bounded ScrollIntent.program. Model
loaded-tail qualification remains separate from user movement intent.

Fake-RO controls first failed on the old direct-delivery implementation (six red
cases, /tmp/g-ro-delivery-red.log). The final nine RO cases cover no delivery-time
effects, coalesce-one, unchanged reference/notifications/scroll assignments, same-
ref revoke, replacement, model disposal, unmount, persistent observation, late
callbacks, measurement reentry and upward gesture across changed geometry. With
related existing tests, seven files / 52 tests and both TypeScript configurations
pass (/tmp/g-ro-delivery-final-controls.log and -type.log).

These controlled tests do not reproduce the browser's resize depth/delivery
algorithm, establish removal of the four previous warnings, prove arbitrary
anchor/tail compensation, or identify the historical #6 cause. Geometry reliability
remains on HOLD. Browser revalidation is a separate explicitly authorized finite
step after independent review of this exact source. No owner/runtime operation is
part of this change. Prior P1 text observations and all failures remain separate.
