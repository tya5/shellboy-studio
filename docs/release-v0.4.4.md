# Studio v0.4.4 pairing

Studio v0.4.4 is prepared to pair with Core v0.17.0 at the exact tag commit (pin pending); protocol N. The Core pin and protocol number will be filled in after the Core v0.17.0 tag commit is provided and exact-pair real-owner tests pass. These notes prepare the Studio release; they do not announce publication.

Before upgrading, quit both Studio and Core and back up the entire Core data directory.

## Changes since v0.4.3

The following landed subjects are from `git log 87785a6..main` at prep time:

- **Core protocol adoption (#152):** “Prepare Studio for Core protocol 33 (#152)” and “Adopt Core protocol 34 Branches path revisions”. Studio adopts the newer protocol families for Summary and Branches path revisions, preserving the closed command surface and handling empty page cursors.
- “Keep the new command surface closed and honor empty page cursors”. Empty cursors are preserved while unapproved commands remain closed.
- “Validate saved ask labels and retry Branches reads on the new family”. Saved ask labels are validated and Branches reads retry using the updated family.
- “Witness Summary parts on the exact Core pair”, “Require pinned record facts and preserve advancing cursors”, “Migrate review fixtures and witness malformed and long record pages”, and “Assert the exact empty parts projection for a small manual Summary”. These changes validate Summary parts against the exact Core pair and preserve safe cursor advancement across malformed/long record pages.
- “Replay the full loaded record prefix on owner hints (#152)”. Owner change hints replay the loaded record prefix so updates within the visible prefix appear.
- **Shared shell-output actions (#161):** Copy, Wrap lines, and Formatted controls are shared between output views; inline output retains its title and execution-details action.
- **Stop controls (#160):** If landed, the Composer's Stop model interrupts only the current Turn; Stop everything is a separately confirmed Activity action for the Run.
- **Render leak fix (#144):** If landed, running indicators and conversation animation reduce browser painting work without changing their meaning.

## Upgrade

Quit both Studio and Core before upgrading. Back up the entire Core data directory before starting the new Core; its startup may migrate data and an automatic downgrade is not provided.
