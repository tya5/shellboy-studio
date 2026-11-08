# Public-history and workflow safety review

Baseline: `dc37c77`; local review only. No secrets were printed, uploaded or
rewritten. Scope: objects reachable from baseline HEAD, not other branches,
reflogs, ignored data, the owner repository or user directories. The scanner
read Git objects, not Shellboy data. 173 commit objects and 1,173 blob objects
were inspected. Common API/private-key signatures, personal absolute paths,
credential filenames and tailnet-like host patterns were checked. This is a
bounded pattern audit, not a comprehensive secret detector.

## Findings requiring publication review

- `web/ui-core/test/setup.test.ts`: credential-signature candidate appears in
  a synthetic test. No evidence of a real credential was found in this audit;
  reviewer must confirm fixture provenance before history publication.
- `README.md`, `docs/guides/user-guide.md`, `src/auth.rs`, `tests/bridge.rs`,
  `web/data/test/pairing.test.ts`: tailnet-shaped candidates appear in example
  or test contexts. Confirm fictional provenance; do not reproduce values in
  external reports. No private absolute-path or credential-file matches were
  found by these patterns in reachable history.
- Git author/committer metadata contains one distinct email identity. The leader approves
  retaining this as normal Git attribution for this publication. Values remain
  omitted. No history rewrite or anonymization was attempted.
- URLs, binary assets and arbitrary prose can disclose information outside
  these patterns. Final reviewer must inspect intended public refs, assets,
  attribution and notes. Do not publish internal worktree/log/scratchpad paths.

## Workflow review

Static review only; no dispatch or hosted execution. Existing CI/release use
GitHub-hosted Windows/macOS/Linux runners. Release is tag-triggered and creates
a draft with write permission only in the publish job; build jobs are read-only.
Archives include AGENTS.md and the complete docs tree to keep all checked local
README/guide/architecture links usable. A date gate refuses build
work before 2026-11-09 07:00 JST; it does not replace user approval or final gates.
Actions use upstream major-version refs, not commit pins; record as a supply
chain limitation requiring acceptance or a separately reviewed SHA-pin change.
No platform/architecture was added. Packages remain unsigned/unnotarized until
separately implemented and validated. Python syntax/YAML structure checks do
not validate GitHub expressions, action availability or OS shell behavior.

## Follow-up after local main advanced

This branch was rebased onto reviewed scroll main `6312f700` without merging
or changing main. `npm run check` passes 623 tests and `npm run build` passes
on that base plus release-preparation changes. A local packaging-script dry run
with a fake, non-executable Linux-target fixture confirms guide files enter the
archive; it is not a real binary, workflow dispatch or Linux test. All embedded
Python heredocs parse. Reachable-object rescan after the first preparation
commit: 176 commits and 1,208 blobs, same candidate locations/categories, no
additional private-path or key-file hits. Subsequent audit-record-only commits
are covered by diff review, not those object counts.


## Fixture provenance correction and review evidence

Both `web/ui-core/test/setup.test.ts` and
`web/designs/console/test/smoke.test.tsx` (Setup fixture, baseline line 1063)
contain literal credential-like test constants introduced in reachable commit
`168d818`. Each is used with `fixtureModel` and mocked `db.answer` responses;
no credential retrieval or real provider is used for these cases. They are
synthetic setup/UI assertion inputs, not discovered live credentials. The
smoke literal is shorter than the original signature pattern, which explains
its omission from that scan; provenance review explicitly covers it now.
Neither literal nor any private value is reproduced here. A pattern scan alone
must not be described as a complete credential audit.

Review correction validation uses fake archive executables and temporary
folders only: `tools/check-release.py` checks local paths/heading fragments in
README, AGENTS and every Markdown document under docs in source and extracted
ZIP/tar layouts. It executes packaging Python, never workflow steps or binaries.
YAML is parsed separately. Real-owner tests are an explicit required gate rather
than skipped passing tests; local checks do not stand in for hosted CI or the
not-yet-selected public Core pair. Existing action major-version refs remain a
known supply-chain limitation.


Local correction checks (macOS, synthetic only): rust-slot `cargo fmt --check`
passes; `cargo metadata --offline --locked --no-deps` proves real_owner requires
its explicit non-default feature. `cargo test --offline --locked
--no-default-features` passes the ordinary suites (including all 11 bridge
fixture tests) with no real_owner executable selected. Default-feature typed
compilation/exact-pair remains blocked on the separately approved public pin,
not claimed green here. Frontend check: 623 pass; frontend production build
passes. Workflow YAML parses; synthetic ZIP and both tar target layouts each
pass all 11 parsed local file/heading link checks. These are not native target
executions. The final reachable ref is rescanned after committing corrections;
no other private branches/reflogs are included.
