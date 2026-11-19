# Studio 0.2.7

Fixes for tool rows and live activity rows. This candidate note does not authorize a tag or publication.

## Core pairing

Studio 0.2.7 requires an exact reviewed Core v0.13.1 release ref; binds the exact peeled tag commit `0496e563dc106768c8a875be31f0645f3a72e145`; the release workflow verifies that immutable ref before exact-pair acceptance; do not use moving main.

Studio #27 handoff retirement additionally requires a saved node `provenance.attempt_id`, introduced by Core `576c76f180` and present in its `1dfc414b` descendant; this prerequisite is included in the reviewed v0.13.1 pairing.

Core installation, data migration, and pairing instructions are intentionally deferred until the exact reviewed v0.13.1 ref is bound. No installed-data operation is authorized by this candidate.

## Candidate scope

This version-only candidate carries metadata and documentation updates only; no
new runtime behavior is asserted here. Validation must use the existing release
workflow after an immutable Core v0.13.1 ref is supplied.
