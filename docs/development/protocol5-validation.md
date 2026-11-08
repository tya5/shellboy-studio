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
