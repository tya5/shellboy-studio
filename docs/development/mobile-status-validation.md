# Studio #17: Mobile Activity Readability

Base: public 2dee5539e689f661e495e98c96b328915856c42a, dedicated
studio-mobile-status-s5 branch. #14's unaccepted animation and inline character
are NOT imported. Existing character assets, status meanings, data/RPC layer,
authentication, owner and installed/runtime assets are unchanged.

## Change

Conversation-tail status uses a two-line content group: activity plus the existing
lower-bound running count, then tool label plus elapsed time. Wrapping is allowed
without truncating tool identity. The existing24px character stays in its column.
Elapsed uses tabular digits; no animation, JS measurement or layout write is added.
The composer-adjacent Work details button preserves access to all work/reply/
pending facts but no longer repeats the tail's running count. Pending, reply and
partial notices stay on the button; complete contents remain in the existing
work sheet. Desktop sidebar work details are retained.

English singular count and group use explicit dictionary singular forms when
numeric n===1; zero and plural retain plural forms. Japanese uses its existing
count construction for every count. No JSON/body/state semantics change.

## Evidence And Limits

Red source checkpoint3d14099b8cb7b77cbc624b74fe032bc07d1d4848:
two failures/two controls passed. Its initial synthetic attempt was not a tool;
the final fixture uses an exact existing run's shell work and shell description,
and explicitly enables the normal work reader. Missing-tool fixture failure is
not called a product failure. A wrong role=dialog selector was corrected to the
actual work-sheet dialog. Old smoke expectations for duplicate running count and
`1 tools` are updated explicitly, not silently accepted.

Focused DOM tests cover 0/1/2 in English/Japanese, count/group singular, distinct
activity/tool/elapsed containers, nonduplicated composer summary and work-sheet
information access. Browser command:
`FIXTURE_PORT=19672 DEBUG_PORT=19673 SHOTS_DIR=/tmp/11f-mobile-shots
node web/designs/console/test/browser/mobile-status-check.mjs`.
Existing synthetic production-CSP server uses brand-serve on19672.
Four conditions1280/390 x console/light,36 warm-layout RAF samples each (144 total)
show two distinct content lines, no document horizontal overflow, visible elapsed,
fixed row height within each run and unchanged row DOM. Character animation is
none. No old #14 or S7 status height measurements are imported as new evidence.

These are author synthetic Chrome observations, not independent S7 results,
physical phone/touch/IME tests or universal stable-layout guarantees. The elapsed
text is fixed in this fixture's clock; hour/digit-boundary updates are not proved
by a36-frame warm trace. Content-driven wrapping can legitimately increase height
when values change. Scroll/virtual-reader handoff logic is not altered. No Rust,
new dependency, paid provider, actual owner, tailnet or installed asset operation.
S7 mobile verification, S6 source/privacy and same-exact all-OS CI through6057
remain separate gates before leader landing. Task server/Chrome stop after use.
