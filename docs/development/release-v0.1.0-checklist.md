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
- Include scroll correction S7 `6312f700` after independent review/integration;
  it is a user-prioritized inclusion, not silently optional. Leader subsequently
  reports it reviewed and fast-forwarded to local main; final-tip checks remain
  outside this baseline audit.
- Resolve S5 live/persisted answer handoff and tool JSON correctness before
  publication, using existing public IDs. Final integrated-tip validation is
  required; this audit does not validate S5 or S7 changes.
- Character and attachment-icon changes are independent optional additions
  after S3 integration/review; defer either rather than expand the release.
- No Core #276/#280 wire work, no dependency on #278, new UI design, platform
  expansion, signing claim, installer, crate publication or paid-provider claim.

## The eight readiness items

| # | Item and evidence | Required gate or known limitation | Remaining action / owner |
|---|---|---|---|
| 1 | Pin is v0.10.0 in manifest/lock, while four next features default on. `src/seam.rs` advertises build flags, not negotiated owner support. | **Blocker**: no verified release pairing or old-owner fallback. | Leader: wait for public Core v0.11.0, inspect its adopted public types, update tag/lock, build/test exact pair. Do not substitute origin/main. |
| 2 | Package/lock now say 0.1.0; MIT present; `publish = false` intentionally retained for binary-only distribution. Notes and guides prepared. | Metadata fixed locally; final release scope/tip approval **required**. | Leader/reviewer: integrate reviewed changes, confirm scope and version on final tip. |
| 3 | CI YAML has Ubuntu/macOS/Windows jobs and optional Linux real-owner job. Local frontend: 600 tests pass and production build passes at audit baseline. | **Blocker**: hosted CI not run; local tests do not prove target builds. | After first-push authorization: inspect all jobs and run synthetic owner acceptance with published Core; record run IDs, not invented CI numbers. |
| 4 | Release YAML builds existing three targets, embeds web, archives binary/LICENSE/README/docs, checks staged guides/version and emits SHA256SUMS; draft release only. Time guard added. | **Blocker**: artifact workflow/execution/download contents untested. | After approved tag: inspect actual archives/checksums/embedded UI/CLI guides on each target. Signing/notarization and extra architectures are **known limitations**, not added commitments. |
| 5 | Prior evidence is macOS headless Chromium and synthetic data, not phone/Windows/Linux/Safari/Firefox/AT. | **Known unverified limitations**, unless required by product acceptance; do not claim those checks passed. | Reviewer/user: accept explicit limitations or require physical testing before publishing. A successful CI runner is not a physical-device test. |
| 6 | Reachable baseline history: 173 commits, 1,173 blobs scanned for common credential/private-path/key-file/tailnet patterns; no private-path/key-file matches. Credential-looking hit is a synthetic setup-test value. Tailnet hits are example/test contexts (locations in safety report). | **Privacy decision required** for author identity and fixture-host approval; pattern scan is not proof of no secrets. | Review locations and author/committer identity without printing values; approve intended public history and assets. Never rewrite history without authorization. Rescan final tip. |
| 7 | README/User Guide/Agent Guide and release notes now distinguish proposed pairing, build targets and unverified devices; release archive includes docs. | Local documentation complete for proposed scope; final artifact truthfulness **required**. | Final tip reviewer: update pending pairing language only after published-tag validation and inspect packaged links. |
| 8 | Existing first-run report uses origin/main and mock provider, not release pair; S5/S7 pending integration are outside this worktree. | **Blocker**: clean synthetic first-run and correctness acceptance on final candidate. | Leader: after pin and reviewed S5/S7 integration, use temporary data/local mock only; validate startup/setup/session recovery/live-to-saved answers/scroll and failure paths. No real data, owner or paid API in this audit. |

## Feature and old-owner policy

Propose retaining the current four default flags only after the published tag
passes typed compilation and allowlist tests: `next-shellboy` (history/config/
settings/live text), `next-connection-setup`, `next-tags`, `next-cwds`.
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
3. Independently review/integrate S5, S7 and this branch; decide optional S3
   additions. No merges are performed by this preparation task.
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
pairing, hosted CI, genuine artifacts and S5 integrated acceptance remain open.
