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
| `RunDetails.owner_run_id` / `owned_run_ids` removed | No corresponding product input/row exists in this public baseline; typed negative tests prohibit aliases; shell `owned_execution_ids` remains |
| `ParentChange.live_run_owner_run_id` removed | No product parser for that field exists; remove the old running-Run previous-owner claim and its derived UI flag |
| Three old Thread-get reply lists removed | Existing reader already uses `awaiting_replies`; make the type explicit, retain human/thread discrimination and bounded 128 decoder, test that legacy extras are not merged |
| Protocol 5 exact pairing / `self_wait` | Core's typed IPC handshake enforces the version; no downgrade added. Typed tests check exact version, removed fields/errors and retained operations |
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
