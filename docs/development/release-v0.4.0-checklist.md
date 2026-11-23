# Studio v0.4.0 release notes gate

Before creating the Studio v0.4.0 tag, finalize both languages of
[`docs/release-v0.4.0.md`](../release-v0.4.0.md) against the frozen release tip:

- [ ] Replace the preparation status with the final Studio/Core pairing and verify the manifest and lock against the published Core tag.
- [ ] Verify #103/#107 on the release tip before replacing the pending bullet with the shipped behavior. Do not tag with this gate unresolved.
- [ ] Set the comparison from the Studio `v0.3.0` tag to the exact v0.4.0 release (use the release tag name as the stable endpoint).
- [ ] Rewrite both verification sections against the exact tagged pair. Link the qualifying CI and candidate runs and distinguish device checks performed from those not performed. Do not transfer evidence from an earlier tip.

Track sign-off in [Studio #111](https://github.com/tya5/shellboy-studio/issues/111).
