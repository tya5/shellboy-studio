# First-release verification

This is a record of gaps, not a claim that a release or CI run exists.

## Observed local first-run path

On macOS with headless Chromium, an isolated temporary HOME and data directory, the
Studio bridge (all `next-*` features enabled) was patched against Shellboy
`origin/main` at `89515711525e23fdb0d9de1734c92ba74e6ada81`. A loopback-only mock
provider supplied the model list and chat stream. Opening the token URL, selecting Local,
testing and saving a connection, restarting the owner, creating a Thread, sending a
synthetic message and seeing the mock reply succeeded. No user data or real provider was
used. This is not verification against the pinned v0.10.0 build or a physical phone.

## Not verified for the first release

- A Windows physical machine: build, named-pipe access, configuration paths and usage.
- Linux physical machines and distributions.
- A real phone, including Tailscale, HTTPS, browser installation and touch interaction.
  Browser viewport emulation is not a phone test.
- Safari and Firefox; the development browser checks use Chromium on macOS.
- Real model providers, real API credentials, paid calls, rate limits and provider failures.
- Release artifacts, code signing, packaging, upgrade and GitHub Actions workflows.
- Shellboy v0.11.0 pairing: the tag is not available locally; validate the published tag,
  regenerate the lockfile and repeat the owner and browser tests before enabling it.
- Accessibility with assistive technology and full keyboard workflows on real devices.

## Scope of local checks

The web unit, integration and contract tests use fake data. Existing Rust real-owner tests
use temporary directories and local mock providers when explicitly given a Shellboy binary;
tests that skip without one are not evidence of owner integration. See the individual test
output for the command and result. No production data or paid API is required.
