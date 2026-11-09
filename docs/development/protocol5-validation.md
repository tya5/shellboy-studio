# Protocol 5 / independent Runs candidate

Base: `6cb224524d7493e4dbf05b68ad949dd489497f38` (public candidate).
Contract read directly from Core branch `issue-276/reply-only-w7`, checkpoint
`dd88933623cb6b50fde0c07b139b604f613d65a7`: `docs/design/protocol.md`,
`events-and-external-protocol.md`, `reply-expected-messages.md` and public Rust
DTOs. This is protocol 5 and schema 39, not the superseded branch-only proposal
of protocol 4. Later exact-tag pin/lock/install validation belongs to the release
pairing task and is not established by this branch.

## Migration inventory

| Wire change | Studio action |
|---|---|
| `ThreadDetails.children_count` removed | Remove type/fixture/details row and localized label; retain `thread.branches` family reads |
| `RunDetails.owner_run_id` / `owned_run_ids` removed | No corresponding product input/row exists in this public baseline; typed tests verify these fields are not re-exposed; strict request tests prohibit aliases; shell `owned_execution_ids` remains |
| `ParentChange.live_run_owner_run_id` removed | No product parser for that field exists; remove the old running-Run previous-owner claim and its derived UI flag |
| Three old Thread-get reply lists removed | Existing reader already uses `awaiting_replies`; make the type explicit, retain human/thread discrimination and bounded 128 decoder, test that legacy extras are not merged |
| Protocol 5 exact pairing / `self_wait` | Core's typed IPC handshake enforces the version; no downgrade added. Typed tests check exact version, removed output fields/errors and retained operations |
| Human count exactness | Type optional exactness flag with absent=true semantics; typed test covers 16 exact / 17 lower-bound, no new count UI invented |
| Schema 39 Run settlement | Core owns storage/lifecycle; Studio does not read/migrate the database or recreate that state machine |

The public ThreadSummary may still contain scalar counters with names resembling
the removed detail **lists**. Do not mistake a summary counter for a detail inbox
or delete unrelated scalar facts. Unknown additive metadata remains opaque.

## Boundaries

No private investigation/harness commits are imported. No runtime authentication
switch is enabled; adopted no-auth code remains an explicit user choice. No Serve,
owner data, live handoff, agent/provider or UX redesign is involved. The browser
has no new queue, polling or retention. Protocol capability inference and exact
release pairing are separate: a successful local dependency override is not a
released owner or installed pin. Cargo manifest and committed lock stay unchanged.

## Verification

Owner-free web checks, synthetic human/thread UI acceptance, typed Rust checks,
release-preparation checks, delta privacy review and independent review outcomes
are reported with the final commit. Physical devices, real-owner data, paid APIs,
public-tag pinning and hosted CI are not exercised here. Existing synthetic
happy-dom iframe warnings are not physical browser acceptance.

### Observed owner-free checks

Environment: macOS arm64, Node 25.9.0, locked npm dependencies, Rust 1.99.1.
`npm run check` passes both TypeScript configurations and 638 tests in 42 files;
`npm run build` succeeds. Focused protocol-5 UI and parent-organization tests
pass 42 tests. `python3 tools/check-release.py` passes 21 preparation tests and
checks three synthetic OS archives; this is not a real release or CI run.

The existing synthetic production fixture now accepts `state=awaiting` and the
existing browser runner accepts `PROTOCOL5_ONLY=1`. Four cases (1280/390 widths,
console/light) pass: human question, Thread-directed duty/link, human answer
control, loaded character assets, no horizontal overflow or old owner claim.
Human reply command identity and hint refresh are asserted in the happy-dom
acceptance test. Browser checks do not claim a real owner, physical device or
complete runtime/CSP-console audit. The fixture favicon request may return 404;
no character asset failure occurred.

Artifacts remain private under literal `$TMPDIR/studio-p5-browser-iG55r3/`:
four `production-*-awaiting.png` files, `production-results.json`, request log
and served synthetic bundle. Logs use literal `$TMPDIR/s7-p5-final-check.log`,
`$TMPDIR/s7-p5-final-build.log`, `$TMPDIR/s7-p5-focused.log` and
`$TMPDIR/s7-p5-release.log`. No host-specific path or evidence contents are
embedded in the public source.

A local delta scan of added lines and new commit messages found no host-home,
private temporary root, tailnet hostname, credential assignment, internal UUID
or email matches. This is a scoped delta check, not a guarantee about inherited
history. Commit identity remains the repository's established public noreply
identity. Independent review remains distinct from this author check.

### Typed candidate compile (not a release pin)

A separate temporary Studio snapshot and Core archive at the checkpoint above
were used with a **CLI-only** Cargo patch to the local archive. Only that
snapshot's lockfile resolved the candidate dependencies; neither this checkout's
manifest/lock nor an installed binary was changed. All local Rust commands ran
through `rust-slot`. `cargo check --tests` succeeded; `cargo test --test protocol5`
passed all four tests: unified details/removal, human count exactness, retained
shell ownership and strict removed inputs, protocol-4 rejection. Result DTOs
remain tolerant of unknown additions; the tests check that removed output fields
are not re-exposed, not that unknown result fields are rejected.

During preparation, incorrect author-written test fixtures (an `op` key instead
of the public Command `command` key and an unknown-result rejection assumption)
failed and were corrected. The first attempt to use Default on EventsWaitArgs
also failed compilation; the final code explicitly keeps
`include_reasoning_activity=false`, without enabling a new reasoning UI. These
were superseded by the successful check and four tests, not reported as Core
bugs. Logs: literal `$TMPDIR/s7-p5-rust3.log` (check success, superseded fixture
failures) and `$TMPDIR/s7-p5-rust4.log` (four tests pass).

Final UI wording includes the parent-move preview in both languages, not just
the completion notice. Rechecked 638 web tests and production build pass in
literal `$TMPDIR/s7-p5-final2-check.log` and `$TMPDIR/s7-p5-final2-build.log`.
Public-tag exact pairing, lock regeneration, installation, all-OS Rust checks,
real-owner acceptance, runtime activation and hosted CI remain release gates,
not outcomes claimed by this candidate work.


## Formal public-pin follow-up and event fixture diagnosis

The public v0.11.0 tag resolves to
`4dc8f66a6c586db57a7a63a3a8be84e25999c95f` (protocol 5, schema 39).
The manifest and lock now select that source rather than the earlier CLI patch.
The macOS arm64 public release archive matches its published SHA256SUMS; the
identity tool verifies tag/peeled commit/locked commit/source package and
binary version. Studio remains an unpublished source candidate.

Initial default `cargo test --locked` failed two bridge tests with frame waits:
`hints_reach_only_the_tabs_that_watch_and_resync_reaches_all` and
`new_tabs_start_from_the_current_owner_state_and_hear_about_changes`. Eleven
other bridge tests passed. This failure is retained, not treated as pair success.

Cause: the full bridge starts `run_with_guide`, unlike direct event-loop tests.
After consuming the baseline, registration reads ConfigGet before announcing
Connected or polling the next cursor. The hint fixture's handler omitted that
command; common MockOwner intentionally waits forever for unknown commands.
The 10-second guide bound consequently competed with the existing 10-second
WebSocket frame deadline. This is an incomplete startup fixture, not evidence
of lost hints, an invalid protocol5 cursor, or a process/IPC failure. No owner
wire, migration, product event order, deadlines or assertion strength changes.

Minimal fix: explicitly answer ConfigGet with the existing no-file result for
these hint-only tests. Use unique synthetic data/config paths instead of shared
fixed roots; hello still asserts exact equality with its configured path.
Separate semaphore-controlled guide tests prove slow config holds Connected
and the next poll until release, errors still permit Connected/hints, and a
persisted opt-out avoids ConfigGet. Each proves the baseline cursor survives.
The test-created opt-out file is removed. Unknown-command pending behavior is
retained for cancellation/backpressure tests.

Focused original tests now pass individually without increasing timeouts.
Three guide startup causal tests pass. During authoring, diagnostic compile
errors (wrong helper signature/field names) and a stale fixed-path hello
assertion were corrected; none is counted as successful execution. Full
locked default results and real public-binary synthetic pair results are
recorded only after their commands finish. No running user owner/data/Serve
configuration or runtime binary is touched by these checks.

Default locked rerun passed after the fixture correction, including protocol5
4/4 and guide-startup 3/3. The independent six-test public-binary suite did not
pass: 3/6 failed (stale title-denied expectation, branch settle, live frame).
A focused branch diagnostic identifies recovery caused by guide registration
pointing to a missing agent-pointer file: library-start test fixtures do not
run the CLI's guide installer. This is separate from hint subscription/cursor
semantics. The stale title test is updated to assert permitted naming and
retain denial of unrelated cwd changes. Clippy's items-after-test-module is
corrected by moving the unchanged guide test module after implementation.
Full-pair and limited real-CLI acceptance remain independent pending gates;
no runtime switch or publication is authorized by this record.

### Public-binary pair follow-up

Library-start fixtures now create their synthetic guide pointer before serving,
matching the CLI install prerequisite; the serving task removes its owned
UUID directory on shutdown. They never register an unowned user path. With
that correction, the independent public Core binary suite passes all six
real_owner tests, including branch settle and live-to-saved text. The prior
recovery was caused by a nonexistent registered extra-instruction file, not
by a removed Run lifecycle notification. Default locked rerun passes 76 tests
with one pre-existing asset HTTP test ignored; protocol5 is 4/4. Clippy all
ordinary targets, format and synthetic release checks pass.

Limited real-CLI/browser acceptance is **3/4, not passed**: a disposable public
Core binary, this unpublished local Studio binary and a loopback provider pass
protocol5 connection, synthetic send and saved assistant text rendered in
headless Chrome. A real tool issues a synthetic human question and the bridge
returns a human `awaiting_replies` entry, but the actual Awaiting you inbox is
empty because production still selects `noPending` in `web/ui-core/src/pending.ts`.
This separate product adapter gap needs an explicit implementation/scope decision;
neither longer timeouts nor successful full-pair tests satisfy that UI gate.
Early harness mistakes (owner-frame shape and operation instance prefix) were
corrected before the three successful observations; no discarded run is counted
as four-point success. No existing owner/Serve/runtime was changed. No Studio
release or first push has occurred as part of these checks. Hosted OS CI,
actual distribution inspection, final privacy review and release authorization
remain separate gates.

### Human Inbox Adapter Acceptance

The production `noPending` gap is a separate product defect, not a fixture
failure. The data-layer HumanInbox now uses only `thread.list(awaiting:human)`
with one displayed keyset page of 16 Threads and sequential detail reads only
for that page. Existing list hints, signal lifecycle and Refresher drive rereads;
there is no new worker, queue, timer or full-Thread scan. Existing UI cards and
reply form are retained. Only human duties enter the reply adapter; existing
Thread-directed duties stay open-only. Count exactness and unknown oldest time
are preserved. A reply uses its message ID and one operation identity; duplicate
clicks coalesce, uncertain retries keep identity/text, and the public owner
performs the atomic terminal-state CAS. Protocol.md Explicit Replies and
reply-expected-messages.md are the authority, not old lifecycle assumptions.

With the published Core macOS arm64 binary and an unpublished default-feature
Studio executable, a disposable HOME/config/data directory, loopback mock
Responses provider and real headless Chrome successfully exercise protocol5
connection, synthetic send, saved answer DOM display, real shell-tool ask,
Awaiting you inbox display, existing form reply and removal. No user data,
external model, runtime replacement or Serve configuration is involved.
The public API admits 16 pending duties and returns typed `reply_limit` for
additional asks; actual shell.read JSON verifies that error and its limit 16.
The same real-browser run verifies UI count 16 and retention of an unrelated
Thread's pending human question.

Legacy 17+ is tested separately by synthetic transport/DOM fixtures: count17,
exact=false, oldest unknown, rendered 17+. New public API asks cannot create
legacy over-limit state; no database seed, migration bypass or owner-wire
change was used. **Real legacy migration/17+ state is not tested.** An earlier
17+ real-owner attempt failed because it incorrectly assumed admission beyond
16; that harness error is not a product failure or successful legacy test.

Data regression tests assert exact human-list/keyset and detail-call counts,
human-only reply, duplicate submission, uncertain same-ID retry and changed-text
refusal, cursor-expired error, oversized-page refusal, shutdown cancellation and
unrelated list preservation. Console smoke tests assert the 17+ presentation.
No next-reply or additional live feature is enabled. Release readiness still
requires independent exact-delta review, final push-ref privacy audit, hosted OS
CI and distribution checks; this local-browser acceptance is not physical testing.
