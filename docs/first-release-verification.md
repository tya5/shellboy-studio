# First-release verification

This is a record of gaps, not a claim that a release or CI run exists.

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
