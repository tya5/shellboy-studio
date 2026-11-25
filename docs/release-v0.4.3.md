# Studio v0.4.3 pairing

Studio v0.4.3 uses the same Core as v0.4.2: Core v0.16.0 at `46212b5391e2d486efec770291359a2ba671fa01`, protocol 26. The exact pin in `Cargo.toml` and `Cargo.lock` is unchanged. These notes prepare the Studio release; they do not announce publication.

The macOS and Windows desktop bundle versions come from the Studio package version. Before upgrading, quit Studio and Core and back up the entire Core data directory and any configuration files stored outside it. See [v0.4.0](release-v0.4.0.md) for backup and phone-pairing guidance.

## Changes since v0.4.2

- **Analytics > Overview** now shows the last **24 hours** as hourly request bars. Use the previous and next controls to select an hour, or open the exact-values table. Comparison with the preceding 24 hours starts off and Studio remembers your choice. Differences are shown only when both periods are complete and both values are available; percentage change also requires a previous value above zero. Select an hour to see Threads ranked by requests. Open a conversation without jumping to that hour, or choose one Thread to see its requests by model. See [Inspect usage and cost](guides/user-guide.md#inspect-usage-and-cost) (#147).
- Running indicators and the conversation animation do less browser painting work without changing what they signal (#144).
- On a Mac, **Option + number** now works with the physical number row even when Option changes the character typed. The [keyboard shortcuts section](guides/user-guide.md#keyboard-shortcuts) lists the supported keys and where they work.
- If you send a message and scroll back, returning to the latest messages now replaces the pending row with the saved message, even if you scroll away again while the update is loading (#154).
- In **Possessions > Artifacts** on Windows, **Show in Explorer** no longer reports failure just because Explorer exits with code 1. Success and error messages appear below the artifact row instead of covering the title (#156).
- On phones, the sidebar child-count chip is easier to tap to expand nested Threads. The size of the visible chip and the Thread row are unchanged (#157).
- **Branches** keeps expanded messages open during ordinary appends and checks that the selected message still belongs to the path before updating the view. If a row cannot load, it shows the failure instead of repeatedly reloading the family (#142).
- In desktop mode with authentication off, checking for pairing hosts no longer returns a conflict. Pairing remains disabled (#149).

## Known gaps

- For now, Studio does not offer sending input to a shell or choosing **Deliver now**; messages go to the model with the default next-safe-boundary delivery. The model can still write to shells. Use the right panel to move a shell to background or stop it.
- **Branches** may briefly miss a change inside a path whose tip and length stay the same; it refreshes on the next owner change notification ([Core #418](https://github.com/tya5/shellboy/issues/418)).
