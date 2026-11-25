# Studio v0.4.4 pairing

Pairing: Core v0.17.0 (`5a164b37deac681520362a8b93b6ca08a47eb3a9`, protocol 36). Cargo.toml and Cargo.lock pin that exact tag commit. The exact-pair real-owner suite was run against this Core and this Studio worktree. It exercised Thread Ask acceptance and a subsequent standalone Reply with temporary owner data and a loopback mock provider; the paired protocol test checked that Ask uses the Send `MessageAccepted` schema and that routed and standalone Reply values follow `MessageReplied` (including omitted, not null, standalone delivery). The real-owner run did not exercise named Ask acceptance or a routed Reply. A Core v0.17.0 pairing is verified for this candidate; Studio v0.4.4 is still unpublished.

Before upgrading, quit both Studio and Core and back up the entire Core data directory.

## Changes since v0.4.3

The following landed commit subjects are quoted from `git log 87785a6..main` on the current main used for this draft:

- **Core protocol adoption (#152):** “Prepare Studio for Core protocol 33 (#152)”, “Adopt Core protocol 34 Branches path revisions”, and “Keep the new command surface closed and honor empty page cursors”. Studio adopts the newer protocol families for Summary and Branches path revisions, keeps unapproved commands closed, and preserves empty cursors.
- **Branches and saved asks:** “Validate saved ask labels and retry Branches reads on the new family”. Saved ask labels are validated and Branches reads retry using the updated family.
- **Summary parts and record pages:** “Witness Summary parts on the exact Core pair”, “Require pinned record facts and preserve advancing cursors”, “Migrate review fixtures and witness malformed and long record pages”, and “Assert the exact empty parts projection for a small manual Summary”. Against the exact tagged Core pair, the small manual Summary returned an explicit empty parts report; retained nonempty parts were not exercised. Malformed and long record pages preserve safe cursor advancement.
- **Owner hints (#152):** “Replay the full loaded record prefix on owner hints (#152)”. Changes within the loaded record prefix are replayed when the owner reports a change.
- **Stop model (#160):** “Separate model and Run stop controls”, “Capture stop targets and report owner refusals”, and “Keep Activity sections and gate Run stop by detail”. Stop model now interrupts only the Turn. Stopping the Run and its shells requires the separately confirmed Stop everything action in Activity.
- **Shared shell-output actions (#161):** “Unify shell output actions in Activity detail”. Copy, Wrap lines, and Formatted controls are shared between output views; inline output retains its title and execution-details action.
- **Long-open tabs (#144):** “Document Console component render lifetimes (#144)”. A long-open tab's memory stays flat rather than accumulating DOM, listeners, and render closures.
- **Source archives:** “Keep screenshot tooling note archive-safe”. Development guidance no longer links to a browser README omitted from source archives.

## Upgrade

Quit both Studio and Core before upgrading. Back up the entire Core data directory before starting the new Core; its startup may migrate data and an automatic downgrade is not provided.
