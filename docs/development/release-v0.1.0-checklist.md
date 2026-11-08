# Studio v0.1.0 release checklist

Audit baseline: Studio main `26e4027`. This is a pre-publication checklist,
not a release approval. No workflow was run and no artifacts were published.
Each unchecked item below is one remaining item.

- [ ] **Owner pin and feature set.** `Cargo.toml` pins Shellboy v0.10.0 but
  defaults to `next-shellboy`, `next-connection-setup`, `next-tags`, and
  `next-cwds`, which require newer owner types. Verify the published v0.11.0
  tag and its adopted public protocol, switch the git tag, regenerate
  `Cargo.lock` (`cargo update -p shellboy`), then validate locked builds and
  capability behavior with the four default features on. `next-reply` remains
  off unless explicitly approved and its security boundary reviewed. Repeat
  real-owner tests with temporary data and a local mock provider, including
  older-owner behavior. Decide the actual pairing and update README and guides.
- [ ] **Version and release scope.** Cargo currently says `0.0.1` and
  `publish = false`; the release workflow rejects a v0.1.0 tag unless the
  package version matches. Decide version and distribution policy, update
  metadata and lockfile, and obtain explicit approval before any tag, binary,
  or release. Do not push before publication approval.
- [ ] **CI execution.** The checked-in workflow has Linux, macOS and Windows
  checks but has never run on GitHub. After publication is authorized, run and
  inspect it on all three platforms; decide whether the manual Linux real-owner
  job must pass for release. Do not infer CI results from local tests.
- [ ] **Release artifacts.** The untested release workflow builds Windows
  x86_64, macOS arm64, and Linux x86_64 archives, embeds the frontend, generates
  `SHA256SUMS`, and creates a draft. Decide whether Intel macOS, ARM Linux,
  code signing/notarization, and platform compatibility need additional work;
  inspect and test all artifacts before explicit publication approval.
- [ ] **Physical-device and browser validation.** Test a real phone over
  Tailscale HTTPS, QR pairing, touch and installation; also validate Windows,
  Linux, Safari, Firefox and assistive technology as appropriate. Browser
  emulation is not a phone test. Record actual environments and results.
- [ ] **Security review.** This audit scanned tracked current-tree text for
  common credential signatures, private paths and tailnet names; this is not a
  comprehensive secret scan or history audit. Test hostnames and `/home/me`
  paths appear as fixtures; verify they are fictional and review Git history,
  artifacts, logs, dependencies and release notes before making them public.
  Do not paste suspected secrets into the checklist or logs.
- [ ] **Guide and release-content review.** User and agent guides cover startup,
  phone pairing and Apps boundaries, but must be checked against the final
  pairing and release artifacts. Add verified screenshots and troubleshooting
  as needed; confirm bundled guides and README links in packaged archives.
- [ ] **Owner compatibility and first-run acceptance.** Existing first-run
  evidence uses an origin/main owner and mock provider, not the pinned tag.
  Repeat against the selected published owner and clean temporary data, check
  startup, connection setup, session recovery and real-owner errors; decide
  whether provider-specific testing is required without using user credentials.

## Inspected baseline

`LICENSE` contains the MIT license. README documents source installation,
startup, owner directory, loopback security and phone connection, but binaries
are not published. CI and release workflows exist; release is draft-only and
uses upload/download artifacts and checksums. Their YAML and execution were not
validated by this audit. No GitHub workflow was invoked.
