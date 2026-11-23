# Studio 0.4.0

Metadata-only Studio 0.4.0 candidate; no since-release runtime fixes are attributed here. This note does not authorize a tag or publication.

## Core pairing

Studio 0.4.0 is bound to the exact Core v0.15.0 main commit `318abee0609eeb3b15a3a21b74b85f816c7d3ea0` (protocol 18); the release workflow verifies that immutable ref before exact-pair acceptance; do not use moving main.

Studio #27 handoff retirement additionally requires a saved node `provenance.attempt_id`, introduced by Core `576c76f180` and present in its `1dfc414b` descendant; this prerequisite is included in the reviewed v0.15.0 pairing.

Core installation and data migration instructions remain outside this source candidate; no installed-data operation is authorized here.

## Candidate scope

This version-only candidate carries metadata and documentation updates only; no
new runtime behavior is asserted here. Validation must use the existing release
workflow against the bound exact Core v0.15.0 commit.
