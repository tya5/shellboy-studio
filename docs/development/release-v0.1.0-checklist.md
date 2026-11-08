# Studio v0.1.0 release readiness

Audit baseline: main `dc37c77` (2026-11-08). This document supersedes the
initial eight-item inventory at `26e4027`. It is not publication approval.
First push and publication are authorized **no earlier than 2026-11-09 07:00
JST (2026-11-08 22:00 UTC)**; readiness gates still apply. No push, workflow
run, tag, release, main merge, restart or real owner was performed in this audit.

## Minimum proposed scope

- Browser UI and thin local bridge, paired with the published Core v0.11.0.
- Keep the existing artifact targets only: Windows x86_64, macOS arm64, Linux
  x86_64. These are build targets, not claims of physical-device validation.
- Scroll S7 `6312f700` is reviewed and adopted in local main; retain it and
  validate the final selected tip, not a pre-scroll baseline.
- #279/S5 is **not an unconditional release gate**. At Core #262 landing,
  include #279 only if independent review and both exact-SHA CI runs are green.
  Otherwise do not wait: defer it to the next version and publish Studio's
  existing live behavior as an explicit known limitation. The attempted partial
  fix stays excluded. Final acceptance must describe the selected behavior and
  must not claim the deferred fix or intermediate-attempt linkage is solved.
- Attachment picker/icons are excluded. Character-only is reviewed and adopted
  in local main `fb1dc5c8` (including scroll `6312f700`); final selected-tip
  validation remains required. No attachment changes enter this release.
- No Core #276/#280 wire work, no dependency on #278, new UI design, platform
  expansion, signing claim, installer, crate publication or paid-provider claim.

## The eight readiness items

| # | Item and evidence | Required gate or known limitation | Remaining action / owner |
|---|---|---|---|
| 1 | Pin is v0.10.0 in manifest/lock, while four next features default on. `src/seam.rs` advertises build flags, not negotiated owner support. | **Blocker**: no verified release pairing or old-owner fallback. | Leader: wait for public Core v0.11.0, inspect its adopted public types, update tag/lock, build/test exact pair. Do not substitute origin/main. |
| 2 | Package/lock now say 0.1.0; MIT present; `publish = false` intentionally retained for binary-only distribution. Notes and guides prepared. | Metadata fixed locally; final release scope/tip approval **required**. | Leader/reviewer: integrate reviewed changes, confirm scope and version on final tip. |
| 3 | CI YAML has Ubuntu/macOS/Windows jobs and required Linux exact-pair owner job. Local frontend: 600 tests pass and production build passes at audit baseline. | **Blocker**: hosted CI not run; local tests do not prove target builds. | After first-push authorization: inspect all jobs and run synthetic owner acceptance with published Core; record run IDs, not invented CI numbers. |
| 4 | Release YAML builds existing three targets, embeds web, archives binary/LICENSE/README/docs, checks staged guides/version and emits SHA256SUMS; draft release only. Time guard added. | **Blocker**: artifact workflow/execution/download contents untested. | After approved tag: inspect actual archives/checksums/embedded UI/CLI guides on each target. Signing/notarization and extra architectures are **known limitations**, not added commitments. |
| 5 | Prior evidence is macOS headless Chromium and synthetic data, not phone/Windows/Linux/Safari/Firefox/AT. | **Known unverified limitations**, unless required by product acceptance; do not claim those checks passed. | Reviewer/user: accept explicit limitations or require physical testing before publishing. A successful CI runner is not a physical-device test. |
| 6 | Reachable baseline history: 173 commits, 1,173 blobs scanned for common credential/private-path/key-file/tailnet patterns; no private-path/key-file matches. Credential-looking hit is a synthetic setup-test value. Tailnet hits are example/test contexts (locations in safety report). | **Final privacy review required** for fixture-host provenance; normal Git attribution approved; pattern scan is not proof of no secrets. | Review locations and fixture provenance without printing values; normal Git attribution is approved by the leader and retained without rewriting. Approve final intended public history and assets. Never rewrite history without authorization. Rescan final tip. |
| 7 | README/User Guide/Agent Guide and release notes now distinguish proposed pairing, build targets and unverified devices; release archive includes docs. | Local documentation complete for proposed scope; final artifact truthfulness **required**. | Final tip reviewer: update pending pairing language only after published-tag validation and inspect packaged links. |
| 8 | Existing first-run report uses origin/main and mock provider, not release pair; scroll is adopted; #279 is subject to the #262 review/both-CI cutoff, not always required. | **Blocker**: clean synthetic first-run and correctness acceptance on final candidate. | Leader: after pin and reviewed selected-tip integration, use temporary data/local mock only; validate startup/setup/session recovery/scroll/failure paths and the selected existing live behavior. If #279 misses cutoff, document its limitation and defer; do not wait for S5. No real data, owner or paid API in this audit. |

## Feature and old-owner policy

Propose retaining the current four default owner API flags only after the published tag
passes typed compilation and allowlist tests: `next-shellboy` (history/config/
settings/live text), `next-connection-setup`, `next-tags`, `next-cwds`.
`real-owner-tests` is a separate non-default test-selection feature, not an owner capability.
`next-reply` stays off: it is not needed for this scope; the gated `MessageAsk`
arm is denied and `MessageReply` is already independently allowed. Do not infer
feature needs from names or enable all flags blindly.

A no-default-features v0.10.0 build is a separate legacy build, not the proposed
v0.1.0 artifact. The v0.11.0 Studio build must not be advertised as automatically
compatible with older owners: capability strings currently describe the bridge
build (`src/seam.rs`), and owner info reports the compiled protocol version
(`src/hub.rs`). Missing features can fail rather than disappear safely. Support
only the selected matching owner; test and document the observed old-owner
failure and a clear upgrade instruction. If graceful fallback is required,
that is a separate correctness blocker, not a documentation promise.

## Morning sequence (leader-controlled)

1. Verify the clock is at/after the authorized boundary; verify Core release
   authorization and public v0.11.0 tag. Never treat the time alone as a green gate.
2. Inspect that tag's public protocol/design and generated schema for every
   enabled next surface. Update `Cargo.toml` tag, regenerate `Cargo.lock` through
   `rust-slot cargo update -p shellboy`, inspect exact source revision and diff.
3. Retain adopted scroll and character; review/integrate this branch
   (attachments excluded). At #262 landing apply the
   #279 cutoff: if review and both exact-SHA CI are not green, defer #279 and
   its partial Studio fix without waiting; document existing live limitations.
   No merges are performed by this preparation task.
4. Through rust-slot run locked Rust tests/clippy and a no-default-feature
   compatibility build as appropriate; run `npm ci`, `npm run check`,
   `npm run build`. Run final-pair synthetic acceptance only in approved
   temporary data/local mock environment. Record skipped cases explicitly.
5. Review final history/privacy findings, release notes, artifact contents and
   scope approval. Resolve blockers before first push/tag; do not push all
   private branches or tags. No automatic history rewrite.
6. Only after approval and time gate, first push selected public refs and run
   CI; inspect all target results. Then approved v0.1.0 tag triggers draft
   artifacts. Verify checksums/downloads/extracted docs/UI and approve draft
   publication separately if any gate or scope changed. Never restart/replace
   a running owner or binary as part of release automation.

## Local checks for this preparation

`rust-slot cargo metadata --offline --locked --no-deps --format-version 1`
passes with package 0.1.0; this does not compile the mismatched pin/features.
`npm ci`, `npm run check` (600 tests) and `npm run build` pass on the isolated
baseline worktree. YAML parses and embedded Python syntax checks are recorded
in the safety report. No hosted workflow, actual release archive, real owner,
physical phone or additional OS was tested.

Follow-up: this branch now includes main `6312f700` by rebase. Final local
frontend checks pass 623 tests and production build. See the safety report for
the follow-up history scan and synthetic packaging-script check. Exact Core
pairing, hosted CI, genuine artifacts and selected-tip acceptance remain open;
#279/S5 is conditional under the #262 cutoff, not an unconditional blocker.


## Independent review corrections

Ordinary all-target jobs run owner-free tests: `real_owner` has Cargo
`required-features = ["real-owner-tests"]` and is not in defaults. CI calls the
required reusable exact-owner job; release artifact builds depend on that same
job, so its failure prevents artifacts/draft creation. This job explicitly
requires the public v0.11.0 pin, matches its official peeled tag commit to the
locked dependency commit, verifies source package version, builds that checkout
under runner temporary storage, asserts the binary version,
and runs the selected suite with `SHELLBOY_BIN`. Selecting the suite without the
binary is an error, never a successful skip. The still-v0.10.0 pin intentionally
cannot pass this gate until the separate approved tag/pin/lock work is done.
No owner was started to test this preparation.

`python3 tools/check-release.py` verifies target classification, gate wiring,
Python syntax and all parsed local file/heading links in README/AGENTS/docs,
both in source and in all three synthetic archive layouts. Archive contents
now include AGENTS and all docs, including architecture, rather than selected
files with dangling README links. This is local packaging evidence, not target
binary or hosted-workflow success. Run the check from CI and release jobs.

The baseline also failed `cargo fmt --check`; rustfmt-only changes in
`src/events.rs`, `src/guide_preference.rs`, `src/server.rs`, `src/main.rs` remove
that known failure without changing logic or integration scope. Typed tests and
clippy remain dependent on the public Core pin and are not claimed passed.

Scope update: attachment changes are excluded from v0.1.0; character-only
is reviewed/adopted in main `fb1dc5c8`, along with scroll `6312f700`. This branch changes
neither feature. The missing bridge pairing fixture `config_dir` is filled
with a synthetic path, not a user configuration directory.


## Exact identity gate (synthetic evidence, not public-tag verification)

The existing exact-owner job fetches only the fixed official repository's
v0.11.0 tag into runner temporary storage. `tools/exact-owner.py` rejects a
missing or ambiguous lock package, wrong source/tag/version, missing commit,
peeled-tag/lock commit mismatch, wrong/dirty checkout, wrong source package,
and missing/wrong binary version. The job builds the verified checkout, not a
separately resolved version/tag install, then rechecks the identity and binary
version before the explicit integration suite. Version text alone never proves
commit identity. Logs contain public repository/tag/commit/package/binary fields,
not user paths or config. Source verification logs explicitly say the binary
has not yet been checked; only the second phase verifies that field.

`python3 tools/test-exact-owner.py` exercises annotated and lightweight tags,
including a same-version/different-commit rejection, using isolated temporary
Git repositories and fake version text only. These tests do not fetch, install,
start or validate the official owner. Public v0.11.0 pin/lock matching, actual
binary provenance/build and exact-pair integration remain publication gates.
