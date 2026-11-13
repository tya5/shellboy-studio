# Studio 0.2.6

Fixes for tool rows and live activity rows, paired with Core v0.13.0. This note does not authorize a tag or publication.

## Core pairing

Studio 0.2.6 is paired with published Core [v0.13.0](https://github.com/tya5/shellboy/releases/tag/v0.13.0), tag commit `c212ecb8e3f56e2f7e8cee0ee49f9e7bd942c3bd` (protocol 5, conversation schema 44). `Cargo.toml` pins the official tag and `Cargo.lock` records that exact commit; the exact-pair owner acceptance builds Core from that verified tag. Use 0.2.6 only with Core v0.13.0; Studio 0.2.5 stays paired with Core v0.12.0.

Installing Core 0.13.0 over real data migrates the conversation database from schema 43 to schema 44 (adds the nullable `thread.max_tokens`) on its first write-capable start, and older Core binaries cannot open the upgraded store. Back up the data directory first.

## Fixes

- Tool rows no longer all show a red failed "exited": history links carry no exit code, so the exit code from the saved shell list is now overlaid, and an exited command whose exit code is unknown is shown as exited without a failure mark.
- A step with no saved shell fact (older than the page or a failed read) is no longer counted as failed in groups and in the details panel.
- A live run or turn is shown as "Run" / "Turn" activity instead of "Unsupported item / Item details are not supported". Genuinely unknown kinds keep the old wording.

## Not in this release

Studio does not yet expose Core 0.13.0's per-Thread output limit (`thread set --max-tokens`); use the CLI or TUI. The model dialog still shows the `segment`/`rounds` fields, which Core 0.12.0 and later reject.
