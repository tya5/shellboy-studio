# Branches Publish Boundary Inventory (ADR-R1)

Follow-up to held fork 07661c4 atop B12 24a5825. This inventory records
source-confirmed boundaries and synthetic coverage, not independent acceptance. Anchors
are stable method/write names in web/ui-core/src/branching.ts unless specified.
Other-scope ThreadOrg is excluded. No new framework, worker or budget is proposed.

## Boundary Matrix

Anchor | Observable boundary | Continuation/effect | Immutable ownership | Coverage/status
ExcerptBatch.reset | cancel then publish empty per row | remaining old row callbacks | old row identities/epoch, no new admission | R1 excerpt reset grid; old row snapshot is invalidation-only
ExcerptBatch.show | initial publish empty | admit row/drain | capture batch epoch before callback | confirmed/repaired: capture epoch before initial callback; R1 excerpt initial admission grid
ExcerptBatch.show release | cancel/publish empty | delete row | original row identity | confirmed/repaired: cancel/detach old row before callback; R1 release callback replacement
ExcerptBatch.drain | await read; publish facts; cancel | next row | row Cancel + captured excerpt epoch; admitted <=8 | R1 excerpt facts grid + original serial/late tests
ownerChanged | cancel; state invalid; reset callbacks | excerpt reset | family generation established before callbacks | B12 six convergence cases + independent reentry; retained receipt untouched
leave | cancel; excerpt reset; loading false | final loading write | projection/family generation | confirmed/repaired: saved family generation before notification; R1 leave reset callback new read
read start | cancel/reset; state loading; clearActions batch exit | own loop/trailing intent/RPC | family gen + owner gen captured before notifying write | confirmed/repaired: capture before reset/loading, recheck before loop; R1 loading publish grid
read loop | await family; state result/error/cancel publish | next coalesced walk | immutable walk gen/owner gen/id/Cancel | B12 adoption/convergence tests; R1 family result/error grids and original six B12 convergence tests
read finally | running=false | own loop release only | running loop owns one reader until settled | original coalescing tests + R1 loading ensure reentry; no unconditional new read
readWholeFamily | await page | next cursor page/restart | original Thread, Cancel, <=4 pages x4 attempts | original cursor bound tests; pure read helper has no model publish
clearActions | batch exit rewind/fork idle | caller continuation | caller must validate its original token | direct method has no post-publish side effect; callers inventoried separately
select | batch exit target/clearActions | return only | no post-exit RPC | no following effect; changing target invalidates mutation token
previewRewind | previewing; await; ready/refused | RPC/read projection | original owner/session/view/target token + owned Cancel | confirmed/repaired: Invocation and owned Cancel, R1 B12 previewing/preview-await grids
archiveSelected | await; selection; actionError | next UI/read refresh | original attempt + Invocation | confirmed/repaired: R1 B12 archive-selection/archive-error grids + R1 await archive grid
renameBranch | await; actionError | family refresh | original attempt + Invocation | confirmed/repaired: R1 B12 rename-error grid + R1 await rename grid
runRewind | rewinding; await; failed; error; done | mutation RPC/send/read/UI | original attempt + Invocation | confirmed/repaired: R1 B12 rewinding/rewind-failed/rewind-done/rewind-error + await grids
forkAt reservation | no signal; install running promise | runFork | immutable owner/parent/node/text + receipt ID | synchronous transport reentry and same-payload join tests
runFork forking | publish then revalidate | canonical fork/lookup | original Invocation, never recaptured | R1 fork forking grid, initial mismatch no-ID test
runFork canonical await | receipt fact store then guard | child/send admission | original receipt + Invocation | R1 fork fork-await/retained fork grids, original opaque/identity tests
runFork failed | publish then revalidate | actionError | original Invocation | R1 fork failed grid
runFork send await | original send fact then guard/error | done | original Invocation + known child/send ID | R1 fork partial-error/send-clear/send-await grids
runFork done | publish then revalidate | family refresh | original Invocation | R1 fork done grid including unchanged control
runFork finally | running unset; settle original promise | release own slot admission | original attempt object, no new action while running | same-context join and synchronous reentry tests
receipt helper | await result; no model signal | original-slot outcome/pending settlement | original receipt ID/owner; diagnostic never replaces canonical cache | identity/opaque/current-owner recovery tests
refusal/toggleBranch | one signal write | return only | no post-publish RPC | new explicit user action, not a late continuation
screen BranchExcerpt effect | observer show/release/setState callbacks | render/observe | item identity + supported predicate; model batch Cancel | absence-capability test; model-side R1 show/release grids; presentation has item identity guard
screen pagination | reset callbacks then page setState | new displayed batch | explicit user page intent | no mutation target connection; R1 reset/release coverage; explicit page action is a new render, not mutation admission
model owner signal / view effects | ownerChanged/leave/ensure notifications | family intent | AppModel synchronous owner observation + family gen | independent S6 owner signal recovery test; retained source tests

## Regression Grid

Required transitions for each notifying continuation: owner B, owner ABA,
unavailable-to-same owner, leave, different Thread/target and unchanged control.
Unknown/same-owner opaque lookup and ensure/read reentry apply to receipt/family
rows, not to a pure terminal setter. A terminal setter with no following effect
is not permission to skip its caller's guard. Read results/cache must have zero
old-context writes; canonical mutation facts may remain in their original slot.
Already sent RPCs settle once; new explicit actions must be separated by ID.

Table-driven implementation is `web/ui-core/test/branches-boundaries.test.ts`.
The seven transition labels are B, ABA, unavailable-to-A, leave, Thread, target,
and same. Fork covers forking/failed/done/partial-error/success-clear/send-clear,
both receipt awaits, retained retry/cache and initial admission. B12 covers
rename error, archive selection/error, rewinding/failed/done/error, previewing and
preview await; each has all seven transitions. Target-only changes intentionally
do not invalidate a Thread-level rename/archive action (its token has no node).
Family loading/result/error uses six transitions: node-only retarget is irrelevant
to a Thread family read. Existing B12 convergence tests cover owner-invalidating
notification and ensure/read/leave reentry; the new reset callback test covers
leave before a fresh read. No family walk is restarted by a finalizer.

ExcerptBatch is deliberately owner-agnostic: its transition grid maps each
invalidating presentation/context change to the same reset interface, while
combined tests verify actual owner/reset wiring. Its grid tests do not independently
prove every browser effect delivery. ClearActions/select and terminal setters
have no post-exit effect; their caller continues only behind its captured guard.
Finally/receipt settlement only release their original object; existing join and
synchronous reentry tests establish that they do not release another invocation.

Source-confirmed fixes and fixture corrections are distinct: the first loading
Thread test exposed a missing read Thread check; six rename/archive normal controls
initially lacked state.threadId, so refresh was correctly absent. Those fixtures
now set the viewed Thread. The leave/read assertion first used the wrong family
field; it now verifies rootId from the existing decoder. No timeout/skip/type
weakening. New explicit completed-action replacement asserts a different ID and
args; stale callbacks are never relabeled as new user actions.

S6 must independently verify exact source/coverage before adoption. The old 706
result did not satisfy this inventory gate. No runtime/browser/owner/Rust/CI/
cleanup/push evidence is introduced here. Unknown earlier provenance remains
unknown; opaque JSON is neither read nor used for a response contract.

## Cross-Boundary Follow-Up To Held 82db5a6

The old-owner admission exception was too broad: changed key plus stale selected
point could mint an uncertain slot despite zero mutation. The repaired predicate
normalizes the key first and permits only exact retained-key diagnostic lookup.
Every fresh/replacement attempt requires active context before ID/slot changes,
regardless of old owner. Regression `R1 old-owner changed stale payload` checks
no ID consumed and subsequent valid new-owner action gets its own ID and proceeds.
This is distinct from the existing old-exact-key safeopaque grid.

Preview cancellation is itself a notifying boundary. New preview Cancel ownership
is installed before cancelling the captured old Cancel, then identity and the
original invocation are rechecked before previewing, RPC and adoption. Clear and
leave install a sentinel before cancelling; losing to explicit reentrant preview
means no subsequent stale clear/publication. Select delegates to that same clear
boundary. Leave cancels its captured family reader, not a newly installed reader.
Four `R1 preview ... cancel callback` tests exercise restart/clear/leave/select,
requiring initial plus one explicit new preview, zero outer restart and preserved
new ready result. The first 220-grid result did not cover these two classes and
remains held; its 926 successes are not retroactively complete acceptance.

## Ownership Interpretation

Every matrix row uses three distinct owners: attempt facts (immutable receipt /
canonical outcome), invocation qualification (captured owner/session/view/target),
and read admission (owned Cancel/epoch/row identity). Five ordering rules apply:
classify key and qualify before reserve; install replacement handle before old
notification; recheck the same token/handle before the next effect; save canonical
facts independently of projection; settle only the original owned frame.

The counterexample/control for attempt admission is old-owner changed stale key
versus valid new key (no slot/ID change versus a distinct accepted ID). For preview
admission it is outer cancel callback versus explicit nested winner (outer zero
RPC and no clear versus nested ready). For row ownership it is old same-ID release
versus newly admitted row (detach original only). For invocation projection it is
late owner/ABA/leave/retarget versus unchanged control (zero stale UI/read/RPC
versus one qualified continuation). For family ownership it is old cancelled walk
versus explicit new read (no old adoption/loading write versus fresh adoption).
The table's terminal setter/finalizer rows have no subsequent external effect;
their caller still rechecks its own qualification. No extra counter/boolean or
framework is needed to represent these owners. Test totals are not completion
proof; exact independent review of these counterexamples remains the gate.
