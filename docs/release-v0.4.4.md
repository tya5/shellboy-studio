# Studio v0.4.4 pairing

Pairing: pending the Core v0.17.0 tag commit, exact Core pin, protocol number, and successful exact-pair real-owner tests. These notes prepare the Studio release; they do not announce publication.

Before upgrading, quit both Studio and Core and back up the entire Core data directory.

## Changes since v0.4.3

The following landed commit subjects are quoted from `git log 87785a6..main` on the current main used for this draft:

- **Core protocol adoption (#152):** “Prepare Studio for Core protocol 33 (#152)”, “Adopt Core protocol 34 Branches path revisions”, and “Keep the new command surface closed and honor empty page cursors”. Studio adopts the newer protocol families for Summary and Branches path revisions, keeps unapproved commands closed, and preserves empty cursors.
- **Branches and saved asks:** “Validate saved ask labels and retry Branches reads on the new family”. Saved ask labels are validated and Branches reads retry using the updated family.
- **Summary parts and record pages:** “Witness Summary parts on the exact Core pair”, “Require pinned record facts and preserve advancing cursors”, “Migrate review fixtures and witness malformed and long record pages”, and “Assert the exact empty parts projection for a small manual Summary”. The Summary projection is checked against the exact Core pair; malformed and long record pages preserve safe cursor advancement.
- **Owner hints (#152):** “Replay the full loaded record prefix on owner hints (#152)”. Changes within the loaded record prefix are replayed when the owner reports a change.
- **Shared shell-output actions (#161):** “Unify shell output actions in Activity detail”. Copy, Wrap lines, and Formatted controls are shared between output views; inline output retains its title and execution-details action.
- **Source archives:** “Keep screenshot tooling note archive-safe”. Development guidance no longer links to a browser README omitted from source archives.

## Upgrade

Quit both Studio and Core before upgrading. Back up the entire Core data directory before starting the new Core; its startup may migrate data and an automatic downgrade is not provided.
