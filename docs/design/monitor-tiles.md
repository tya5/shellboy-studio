# Monitor tiles

The optional tile view uses the Monitor's stable order and current state filter. A per-browser pinned-only filter selects stored pins; pins and the card/tile choice use the existing preferences store. At most 20 matching tiles are rendered. Each visible tile is a conversation link, with a separate pin control. The Console system owns the compact, non-scrolling component. Text is plain, and the last three messages are single lines.

A tile owns its intersection observation. On entering the viewport it acquires a lightweight hint subscription; on leaving it closes that subscription and cancels its read. The view owns the reader, which holds at most 20 previews, queues at most 20 IDs and runs at most four reads concurrently. A hint cancels any older read for that Thread; removal and view shutdown cancel reads and discard previews. There is no timer or polling. Reconnection and resync are hints to refresh. Each read requests a tail `history.window` with `before=19`, `after=0`, `excerpt_chars=160`, then one `shell.list` page with limit 20. Tool counts describe only the returned window; incomplete shell facts are indicated, not inferred. On owners without the capability no history or shell preview is read and the tile asks for a newer owner.

## Validation record

Fake transport/owner, `web/ui-core/test/tiles.test.ts`: 20 visible tiles result in 20 `history.window` and 20 `shell.list` calls on initial display; one Thread hint adds one of each; an offscreen Thread hint adds none. Four calls are initially in flight. The test exercises cancellation and the old-owner fallback. This is a call count, not a timing measurement; it excludes the ordinary Monitor thread list.

Screenshots: Chrome headless, macOS, simulated 1440 x 900 and 390 x 844 viewports, fake fixture owner and no provider. Device emulation is not a physical phone test. The `history.window` feature is behind `next-shellboy` and is unavailable on the pinned v0.10.0 owner. No real owner or user data was used for this change.
