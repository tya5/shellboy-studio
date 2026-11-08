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
- Git author/committer metadata contains one distinct email identity. Identity
  and attribution disclosure require owner approval; values are intentionally
  omitted. No history rewrite or anonymization was attempted.
- URLs, binary assets and arbitrary prose can disclose information outside
  these patterns. Final reviewer must inspect intended public refs, assets,
  attribution and notes. Do not publish internal worktree/log/scratchpad paths.

## Workflow review

Static review only; no dispatch or hosted execution. Existing CI/release use
GitHub-hosted Windows/macOS/Linux runners. Release is tag-triggered and creates
a draft with write permission only in the publish job; build jobs are read-only.
Archives include docs to keep README links usable. A date gate refuses build
work before 2026-11-09 07:00 JST; it does not replace user approval or final gates.
Actions use upstream major-version refs, not commit pins; record as a supply
chain limitation requiring acceptance or a separately reviewed SHA-pin change.
No platform/architecture was added. Packages remain unsigned/unnotarized until
separately implemented and validated. Python syntax/YAML structure checks do
not validate GitHub expressions, action availability or OS shell behavior.
