# First-release verification

## Published v0.1.0 outcome

Published on 2026-11-09 at 01:57:38 UTC, stable and non-draft, from
`1f26ec97c6e3cf3b8521422c4e430eddcb45ad32`, paired with public Core v0.11.0
(protocol 5, schema 39). Public identities checked after publication:

- [Checks run 42545162766](https://github.com/tya5/shellboy-studio/actions/runs/42545162766):
  the exact release SHA; Ubuntu, macOS, Windows and required exact-pair owner jobs succeeded.
- [Release binaries run 42545961767](https://github.com/tya5/shellboy-studio/actions/runs/42545961767):
  the same SHA; required owner acceptance, all three builds and checksums/draft job succeeded.
- [Published v0.1.0 assets](https://github.com/tya5/shellboy-studio/releases/tag/v0.1.0):
  Windows x86_64 ZIP, macOS arm64 and Linux x86_64 tarballs, plus `SHA256SUMS`.
  These are build targets, not claims of physical-device validation.

The release author reports distributed-artifact Chrome acceptance. A separate
operator independently downloaded the published macOS archive, checked its
checksum and extracted binary, and verified token/cookie-free local and existing
tailnet Serve HTTP, including Host/Origin rejection, after an explicitly approved
`--no-auth` installation. That narrow observation is not a real-phone, live DOM,
WebSocket abuse, touch or browser-install test. This documentation audit verified
public release/run identities and job conclusions; it did not rerun those tests.
Neither hosted jobs nor author-reported Chrome acceptance establish physical-phone
or Safari/Firefox coverage. Archives remain unsigned/unnotarized.

### Historical pre-release checkpoints

The following observations and unverified gates describe the preparation state
when recorded. Published pair/build/archive gates above supersede their pending
status; they do not retroactively change what the earlier tests exercised.

## Observed local first-run path

On macOS with headless Chromium, an isolated temporary HOME and data directory, the
Studio bridge (all `next-*` features enabled) was patched against Shellboy
`origin/main` at `89515711525e23fdb0d9de1734c92ba74e6ada81`. A loopback-only mock
provider supplied the model list and chat stream. Opening the token URL, selecting Local,
testing and saving a connection, restarting the owner, creating a Thread, sending a
synthetic message and seeing the mock reply succeeded. No user data or real provider was
used. This is not verification against the pinned v0.10.0 build or a physical phone.

## Coverage limits and historical pending gates

- A Windows physical machine: build, named-pipe access, configuration paths and usage.
- Linux physical machines and distributions.
- A real phone, including Tailscale, HTTPS, browser installation and touch interaction.
  Browser viewport emulation is not a phone test.
- Safari and Firefox; the development browser checks use Chromium on macOS.
- Real model providers, real API credentials, paid calls, rate limits and provider failures.
- Code signing/notarization and upgrade behavior remain unverified. Hosted workflows
  and published archives now have the evidence above; earlier preparation did not.
- Historical pending gate: public Core v0.11.0 tag/pin/lock and exact-pair tests
  were not established by the old first-run checkpoint. The published outcome
  above supersedes that pending status, not the checkpoint's environment.
- Accessibility with assistive technology and full keyboard workflows on real devices.

## Scope of local checks

The web unit, integration and contract tests use fake data. Existing Rust real-owner tests
use temporary directories and local mock providers when explicitly given a Shellboy binary;
tests that skip without one are not evidence of owner integration. See the individual test
output for the command and result. No production data or paid API is required.
