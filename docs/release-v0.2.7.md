# Studio 0.2.7

Fixes for tool rows and live activity rows. This candidate note does not authorize a tag or publication.

## Core pairing

Studio 0.2.7 requires an exact reviewed Core v0.13.1 release ref; no Core tag or SHA is bound by this candidate yet. The release workflow must bind that immutable ref before exact-pair acceptance; do not use moving main or the older v0.13.0 pairing.

Studio #27 handoff retirement additionally requires a saved node `provenance.attempt_id`, introduced by Core `576c76f180` and present in its `1dfc414b` descendant; this prerequisite is absent from Core `v0.13.0`/`10cfe2`.

Core installation, data migration, and pairing instructions are intentionally deferred until the exact reviewed v0.13.1 ref is bound. No installed-data operation is authorized by this candidate.

## Fixes

- Tool rows no longer all show a red failed "exited": history links carry no exit code, so the exit code from the saved shell list is now overlaid, and an exited command whose exit code is unknown is shown as exited without a failure mark.
- A step with no saved shell fact (older than the page or a failed read) is no longer counted as failed in groups and in the details panel.
- A live run or turn is shown as "Run" / "Turn" activity instead of "Unsupported item / Item details are not supported". Genuinely unknown kinds keep the old wording.

## Not in this release

Studio does not yet expose the paired Core's per-Thread output limit (`thread set --max-tokens`); use the CLI or TUI. The model dialog still shows the `segment`/`rounds` fields, which Core 0.12.0 and later reject.
