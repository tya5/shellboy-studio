# Studio 0.2.7

Fixes for tool rows and live activity rows. This candidate note does not authorize a tag or publication.

## Core pairing

Studio 0.2.7 requires an exact reviewed Core v0.13.1 release ref; no Core tag or SHA is bound by this candidate yet. The release workflow must bind that immutable ref before exact-pair acceptance; do not use moving main or the older v0.13.0 pairing.

Studio #27 handoff retirement additionally requires a saved node `provenance.attempt_id`, introduced by Core `576c76f180` and present in its `1dfc414b` descendant; this prerequisite is absent from Core `v0.13.0`/`10cfe2`.

Core installation, data migration, and pairing instructions are intentionally deferred until the exact reviewed v0.13.1 ref is bound. No installed-data operation is authorized by this candidate.

## Candidate scope

This version-only candidate carries metadata and documentation updates only; no
new runtime behavior is asserted here. Validation must use the existing release
workflow after an immutable Core v0.13.1 ref is supplied.
