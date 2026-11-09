# Branches #1 Local Acceptance

## Scope

Public release base `1f26ec97c6e3cf3b8521422c4e430eddcb45ad32`, dedicated
public-derived branch. Historical #1/#2 commits were already public ancestors;
no private candidate history was merged. #3 is not implemented here.

#1 shows requests and saved assistant responses observed in inspected windows,
not first requests or final conclusions across a full history. Protocol5
intermediate responses are not promoted to final answers. Missing/failed or
inconsistent windows remain unknown. Child answers must be after divergence.
The existing list uses eight-row batches and existing button components.
The architecture records per-epoch excerpt16/family16/combined32 RPC limits,
sequential excerpt admission, cancellation and no retry/full-scan fallback.

## Regression Evidence

Frontend typecheck and 43 files / 652 tests pass, including seven added tests:
eight-row admissions/serialization, late epoch cancellation, long-tool windows,
revision mismatch, split-read error without retry, precancel zero reads,
exact sixteen RPCs for eight child rows, pre-split answer exclusion, offscreen
invalidation/no same-epoch retry and absent capability zero reads. Several
assertions share tests. Existing #2 operation tests are retained unchanged.
Frontend build, Rust locked binary build, format and diff checks pass. This
change does not establish fresh Rust test/Clippy or hosted-platform success.
Some full frontend runs emit happy-dom teardown/network warnings even though
the runner's tests pass; those warnings are not described as clean stderr.

## Real Binary / Browser

Environment: published Core v0.11.0 binary (protocol5/schema39), locally built
unpublished Studio candidate, disposable HOME/config/data and loopback synthetic
Responses provider, real headless Chrome with a desktop viewport. No existing
owner/runtime/config or user conversations are used. Disposable processes are
stopped after every run. Device emulation is not physical-device acceptance.

The fixture creates a parent conversation, forks an exact saved user node,
sends a child request, names that fork and opens Branches. Actual DOM contains
the split/request/saved-answer excerpts and scoped labels. A tall desktop
viewport makes both rows visible: the earlier default short viewport left the
child offscreen and correctly unknown, so that failed harness expectation is
not counted as successful child display. Separate diagnostic public RPC reads
showed both windows at the same revision with the expected nodes. The harness's
first rename selector incorrectly required an explicit type=text attribute;
the existing Field omits that attribute. Corrected selector, no product fix.

The same disposable fixture exercises existing #2 UI naming, archive selected
without archiving its unrelated parent, exact-point UI fork with input while
preserving the parent's selected node IDs, and preview/rewind with new input.
These are existing-operation acceptance, not #2 product changes or complete
unknown-outcome/partial-failure acceptance. No retry identity safety is inferred
from happy-path browser success. #2 uncertainty/partial-success gaps require a
separate evidence-backed proposal before any product fix.

## Limits / Handoff

The overall budget is per bounded read/batch epoch, not a lifetime bound under
repeated user navigation or notifications. Revisited rows in an exhausted epoch
remain unknown until a new batch/read epoch. Large family, cursor expiration,
long-tool, revision, failure and cancellation evidence is synthetic regression,
not full-scale real-owner load measurement. No finality/latency guarantee.
Independent exact-delta/privacy review is required before push. No GitHub issue
closure, push, hosted CI, tag, release or runtime replacement is performed.
