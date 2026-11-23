# Studio v0.4.0 release notes gate

Before creating the Studio v0.4.0 tag, finalize both languages of
[`docs/release-v0.4.0.md`](../release-v0.4.0.md) against the frozen release tip:

- [x] Verify the Studio manifest and lock against published Core `v0.15.0` (`318abee0609eeb3b15a3a21b74b85f816c7d3ea0`).
- [x] Verify #103/#107 on Studio main `dd041811be677bb203a2b956ece5bbc0d9ddd187` and document the shipped behavior in both languages.
- [x] Set the comparison from Studio `v0.3.0` to the verified main tip used for the notes (`dd04181`). Use the release tag as the stable endpoint when publishing.
- [ ] Record qualifying CI and candidate evidence for the frozen release revision. Distinguish real-device checks performed from those not performed, including the Mac swap. Do not transfer evidence from an earlier tip.

Track sign-off in [Studio #111](https://github.com/tya5/shellboy-studio/issues/111).
