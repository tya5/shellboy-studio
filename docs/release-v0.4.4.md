# Studio v0.4.4 pairing

Pairing: Core v0.17.0 (`5a164b37deac681520362a8b93b6ca08a47eb3a9`, protocol 36). Cargo.toml and Cargo.lock pin that exact tag commit. The exact-pair real-owner suite runs against that Core with temporary owner data and loopback mock providers, and its Ask/Reply pairing coverage is exactly two witnesses. Standalone: a person's CLI `message ask --thread` into a mock Thread whose model runs `shellboy message reply` for that exact Ask ID; the Reply's root result has `reply_to` equal to that ID and omits `delivery`. Routed: a mock Thread's model runs `shellboy message ask --to human`, and the person answers that exact Ask ID with the CLI `message reply`; the Reply's root result has a nonempty answer `message_id` and a `delivery` whose `message_id` is that answer and whose `thread_id` is the asking Thread. Thread-to-Thread Replies and held or later delivery states are not exercised by these witnesses. The protocol-pair test separately checks Ask's `MessageAccepted` registry/schema mapping and both routed and standalone `MessageReplied` shapes, including omitted (not null) delivery for standalone replies. Studio v0.4.4 is still unpublished.

Before upgrading, quit both Studio and Core and back up the entire Core data directory.

## Changes since v0.4.3

The following landed commit subjects are quoted from `git log 87785a6..main` on the current main used for this draft:

- **Core protocol adoption (#152):** “Prepare Studio for Core protocol 33 (#152)”, “Adopt Core protocol 34 Branches path revisions”, and “Keep the new command surface closed and honor empty page cursors”. Studio adopts the newer protocol families for Summary and Branches path revisions, keeps unapproved commands closed, and preserves empty cursors.
- **Branches and saved asks:** “Validate saved ask labels and retry Branches reads on the new family”. Saved ask labels are validated and Branches reads retry using the updated family.
- **Summary parts and record pages:** “Witness Summary parts on the exact Core pair”, “Require pinned record facts and preserve advancing cursors”, “Migrate review fixtures and witness malformed and long record pages”, and “Assert the exact empty parts projection for a small manual Summary”. Against the exact tagged Core pair, the small manual Summary returned an explicit empty parts report; retained nonempty parts were not exercised. Malformed and long record pages preserve safe cursor advancement.
- **Owner hints (#152):** “Replay the full loaded record prefix on owner hints (#152)”. Changes within the loaded record prefix are replayed when the owner reports a change.
- **Stop model (#160):** “Separate model and Run stop controls”, “Capture stop targets and report owner refusals”, and “Keep Activity sections and gate Run stop by detail”. Stop model now interrupts only the Turn. Stopping the Run and its shells requires the separately confirmed Stop everything action in Activity.
- **Shared shell-output actions (#161):** “Unify shell output actions in Activity detail”. Copy, Wrap lines, and Formatted controls are shared between output views; inline output retains its title and execution-details action.
- **Long-open tabs (#144):** “Document Console component render lifetimes (#144)”. A long-open tab no longer keeps old conversation renders, settings handlers and DOM nodes after you switch Threads (#144).
- **Panel tabs fit (#164):** “Measure stable available width for panel tabs”. Dock and phone-sheet tab labels now collapse based on the stable available panel width, preserving the six touch targets while showing only the labels that fit.
- **README and screenshot fixture (#162):** “Lead the Studio README with reply duties”, “Preserve README screenshot bytes on checkout”, and “Document the Studio screenshot fixture and published pairing”. The README now leads with reply duties, and its screenshot is documented as synthetic fixture data with reproducible generation guidance.
- **Source archives:** “Keep screenshot tooling note archive-safe”. Development guidance no longer links to a browser README omitted from source archives.

## Upgrade

Quit both Studio and Core before upgrading. Back up the entire Core data directory before starting the new Core; its startup may migrate data and an automatic downgrade is not provided.
