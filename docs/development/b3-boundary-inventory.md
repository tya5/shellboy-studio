# Limited B3 Boundary Inventory (ADR-R1)

Scope: read-only `branch-compare.ts`, its existing-screen handlers, and AppModel
hooks added for B3. Existing B12/fork mutation machinery is unchanged. The held
initial implementation `67968b2` is not acceptance evidence for the repaired
continuation fences. This inventory accompanies the repair, not a new framework.

## Immutable Invocation And Admission

An explicit refresh intentionally invalidates old reads. Immediately after that
invalidation, before publishing its sides, it captures one immutable token:
epoch, owner/view context key, immutable selected Thread IDs and the exact Cancel
object. Epoch changes on pair/page/owner/view invalidation, including ABA and
unknown-to-same transitions. Original selected BranchItem copies are frozen.
Continuation never recaptures a newer token for an old pair. All RPC arguments
come from those captured facts or the same token's pair. The Cancel object is
both identity-checked and checked for cancellation.

`run` owns one admission in a shared Map keyed by side; the value is the immutable
token, which is also the budget owner. Cancel does not release it. Only settlement
of that admission may remove it, by identity. No stale finally clears fresh busy
state. Task entry, publication-return and each RPC/await continuation validate
the same token. Terminal publications have no further read continuation except
the guarded admission finalizer. Invalidation's cancel callback and body/state
reset publications also recheck their own invalidation epoch to avoid overwriting
a reentrant newer state.

No mutation effect belongs to B3. Invalid read effects are UI/cache/RPC zero;
original receipt-fact-only mutation exceptions are NOT used here.

## Inventory

Anchors name exact methods/call sites rather than unstable line numbers. Every
signal setter, cancellation callback, await and RPC in the B3 read module is
listed, including setters reached through `update`. There is no B3 batch exit;
existing mutation batches are outside this unchanged scope.

| File Anchor | Effect Class | Fixed Owner / Fence | Synthetic Coverage |
| --- | --- | --- | --- |
| branch-compare.ts invalidate: old.cancel | Cancellation callback; no RPC | Increment epoch and install next Cancel before callback; check epoch after callback | terminal/reset cancelCallback x six transitions; cancelled-admission tests |
| invalidate: body.value reset | Clear UI/cache | Invalidation epoch checked after synchronous setter | terminal/reset resetBody x six transitions |
| invalidate: state.value reset | Clear UI/cache/selection | Caller verifies expected invalidation epoch before any later publication | terminal/reset resetState x six transitions; initial reentry |
| choose: final state.value selected | Selection only, never mutation target | Expected invalidation epoch; terminal setter, no RPC | initial x pair; existing smoke selection separation |
| hint: state.value stale | Mark older facts only | No read continuation and no refill; explicit refresh required | 100-hint and stale-block tests |
| refresh: unavailable pair publication | Terminal unsupported UI | Captured refresh epoch; no RPC follows | unsupported pair/no API test |
| refresh: initial sides publication | Publish selected snapshots, then dispatch | Original refresh token checked after setter and passed unchanged to both run calls | inventory initial x six transitions; notification refresh reentry |
| run: update busy=true | Admission UI before task entry | Token check before admission AND after synchronous busy setter | inventory busy x six transitions |
| run: await task | Await/catch/finally | Task uses original token; thrown error projects only if valid | read-failure paths and late-error/context tests |
| run: update readFailed | Terminal failure UI | Original token, no next RPC; guarded finalizer | terminal/reset error; late errors; thrown read uses same error class |
| run: finally active.delete and update busy=false | Release self admission; UI | Map identity match; token valid before busy setter; no work follows | terminal/reset finally x six; old-settlement/new-busy test |
| refresh: await Promise.all and point RPC | Read only | Original pair item plus fixed token.cancel; run entry guard | initial/busy matrices; four-initial-calls/different ordinals |
| refresh: point await/error update | Read fact/error projection | Same token checked immediately after await; errors terminal | late anchors; terminal/reset error x six |
| refresh: point metadata update | Anchor ordinal/revision UI then next window | window entry validates original token after metadata publication | inventory point x six transitions; initial ABA tests |
| window: historyWindow RPC/await | Read only | Token pair ID, guarded ordinal/node/revision; same token before/after RPC | path revision/unsafe ordinal tests; late response tests |
| window: error update | Terminal path error | Same token after await; no next RPC | changed revision test; terminal error/finally class |
| window: pages/next update | Bounded cache UI | Same token; terminal result; next read only explicit action | inventory window x six; cache4/more test |
| more: await run/window | Explicit continuation read | Capture current token before run; no hidden retry | continuation bound and mixed limiter tests |
| usage: update call count/seen | Consume attempt before dispatch | Fixed token checked after setter before usageGet | inventory usage x six transitions; duplicate cursor/budget tests |
| usage: usageGet RPC/await | Read only | Token pair ID, captured anchor/until, token.cancel; same token after await | same-until/thread/UTC test; late usage/cancel test |
| usage: refusal/invalid period/row error update | Terminal unknown UI | Original token; no clipped/fallback request | terminal/reset usageFailure x six; 31day/malformed period tests |
| usage: final usage/coverage/cursor update | Terminal bounded aggregate UI | Original token, safe integer sums; no implicit next page | terminal/reset usageResult x six; four responses/cursor/unknown tests |
| openBody: body.value busy/attempt increment | Consume bounded body attempt | Original token checked after body setter before historyGet | inventory body x six transitions; two failures count |
| openBody: historyGet RPC/await | Read only | Captured node from admitted side cache, original Cancel; post-await token | target/UTF8 bound; late body tests |
| openBody: body.value unavailable | Terminal unknown UI | Original token after await; no automatic retry | terminal/reset bodyFailure x six; body failures budget |
| openBody: body.value result | Terminal bounded text UI | Original token, same node and UTF8 bytes checked | terminal/reset bodyResult x six; old-body late tests |
| model.ts BranchCompare context effect | Owner/connection/capability/view invalidation | Existing reactive owner and Link facts; synchronous context invalidation | smoke route leave; module owner B/ABA/unknown-same matrices |
| model.ts threadList effect | Hint only | No compare read; stale presentation | 100-hint/no-refill tests |
| model.ts dispose | Leave/cancel | No background timer/task beyond settling admissions | module leave/late response; existing fixture dispose |
| Branches.tsx setExcerptPage | Page UI plus compare cancel | pageChanged invalidates before Preact page setter; no compare RPC | page late-response test; inventory initial x page |
| Branches.tsx compare Check | Explicit pair selection only | choose; never bulk archive selection/receipt | actual-component synthetic smoke, initial x pair |
| BranchCompare.tsx buttons | Explicit refresh/more/body/usage | Model methods own fixed invocation before publication; no async UI continuation | module dispatch matrices + existing-screen synthetic smoke |

The table-driven tests are named `inventory ... x ...`. Six transitions are
owner B, owner ABA, leave, another pair, unknown-to-original owner, and unchanged.
They assert immediate transient UI removal where invalidated, final projection,
RPC counts and unchanged-path behavior. Separate refresh-notification reentry
uses one Cancel identity across all four admitted fresh calls, distinguishing
the explicit new action from the old continuation (which sends zero).

Await/late tests additionally hold promises, change context and settle old work;
aggregate capacity includes cancelled-but-unsettled work. Same-owner normal-path
and explicit-after-settlement cases retain finite call/cache/attempt bounds.
No owner, actual browser, runtime, Rust, CI or push is exercised by these tests.
Passing counts do not substitute for inspecting this inventory's scope coverage.
