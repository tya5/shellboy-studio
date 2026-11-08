# Shellboy Studio v0.1.0 (candidate)

First public browser UI and local bridge for Shellboy, intended to pair with
Core v0.11.0 after its public tag and exact-pair validation. This is preparation,
not an announcement that artifacts or compatibility validation already exist.

The candidate covers conversations, monitoring, branches, analytics, settings
and local Apps. Scroll usability and live-to-saved answer correctness are
release gates under review. Character and attachment-icon changes may be
omitted independently. Core #276/#280 wire changes and #278 are not prerequisites.

Planned archive targets remain Windows x86_64, macOS arm64 and Linux x86_64.
Unsigned/unnotarized archives and missing physical-device/browser coverage are
known limitations, not promises of universal compatibility. Source build
instructions, phone security, bundled guides and startup details are in README
and `docs/guides/`. No installers or crates.io package are proposed.

Do not use an older owner expecting automatic feature negotiation. Use only
the release's validated matching owner; pairing and upgrade instructions must
be finalized after the Core tag is public. No existing owner is restarted by
these notes. Preserve user data and keep token URLs/QR codes private.

See `docs/development/release-v0.1.0-checklist.md` for required gates and
`docs/first-release-verification.md` for the limited prior test environment.
Publication is not authorized before 2026-11-09 07:00 JST.

Scope update: attachment changes are excluded from v0.1.0; character
`6fbb954` remains optional pending independent review. This branch changes
neither feature. The missing bridge pairing fixture `config_dir` is filled
with a synthetic path, not a user configuration directory.
