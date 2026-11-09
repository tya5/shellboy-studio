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

## Classification And Current Status

Classification: effective existing-design repair, not a functional-contract
change. The patch rearranges already displayed activity/tool/time information,
removes a duplicated count while retaining the existing work-details entry and
reply/pending/partial facts, and corrects locale grammar. It does not redefine
status meanings, introduce data requirements, change reply actions, hide tool
identity or alter handoff/body ownership. The existing24px artwork is retained;
there is no new motion or #14 visual adoption. This limited application rationale
does not authorize broader design or functional changes.

Source candidate: `fc3ed01e716703eee02756dcd7e1f5ff9acfba6c` on public
`2dee5539e689f661e495e98c96b328915856c42a`. It is a local review candidate,
NOT a claim about the published release or installed/served assets. S6's initial
source/privacy gate reports no finding; final source disposition and same-exact
all-OS CI / leader landing remain separate gates.

S7 independently served this exact candidate in a fresh dedicated worktree and
executed the same author browser runner: four conditions /144 RAF samples pass.
Each run's height is59.375px, with unchanged DOM, no overflow, separate lines,
visible elapsed, no animation and no duplicate running lower bound on the Work
details button. Execution `c4e74aa7-0e83-4114-ab66-8da4680bcd3c` exited0,
Run `e95f8a77-8a33-41ac-9ac1-123f5c248829`; local synthetic artifacts are in
`/tmp/studio-s7-mobile17-abnFIx/`. This is an independent execution of the same
runner, not an independently designed test or a complete paint audit. Native
phone, AT, long locale, elapsed tick changes, browser singular-tool rendering and
all reply interactions were not tested by that run. Author DOM plural tests are
separate evidence; counts are not added together. No old status height is reused.

This task validation record supplies the candidate-specific status and repair
classification. It does not update release status or close unperformed physical
acceptance. If a separate adopted current-status registry requires an entry, that
entry needs its exact document reference; this task does not infer such a policy
from an abbreviated identifier.
