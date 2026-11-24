# Studio v0.4.2 pairing

Studio v0.4.2 pairs with Core v0.16.0 at `46212b5391e2d486efec770291359a2ba671fa01`, protocol 26. This document records the prepared pairing; it does not announce a Studio release. The last published download, Studio v0.4.1, pairs only with Core v0.15.0 / protocol 18. Do not use that binary with the Core v0.16.0 / protocol 26 pairing prepared on main; upgrade Studio and Core together.

- Studio package version: 0.4.2.
- Last published download: Studio v0.4.1 with Core v0.15.0 / protocol 18. New pairing on main: Studio v0.4.2 with Core v0.16.0 / protocol 26. Never combine the v0.4.1 binary with Core protocol 26.
- Exact pin: `Cargo.toml` and `Cargo.lock` use the published Core v0.16.0 tag commit; the exact-owner fixture reports version 0.16.0 and protocol 26. The Setup guide links to the v0.16.0 documentation.
- macOS and Windows desktop package versions are generated from the Cargo package version; there are no independent checked-in product-version literals for those bundles.
- Before upgrading, quit Studio and Core and back up the entire Core data directory and any settings files stored outside it; see [v0.4.0](release-v0.4.0.md) for backup and phone-pairing guidance. This new source pairing supersedes the [previous v0.4.1 pairing](release-v0.4.1.md) for builds from main; the published v0.4.1 binary remains paired with Core v0.15.0 / protocol 18.

## Changes on main since v0.4.1

- In **Analytics > By Thread**, compare **Excl. cached**, **Total**, **Cached input**, or **Summary tokens** over the chosen **Period**. Bars and shares follow the selected metric; open a row for the same-period breakdown. Counts are recorded tokens, not prices, and incomplete scans do not show a ranking (#132).
- Right-panel count badges, such as those on **Reply needed** and **Awaiting reply**, use higher-contrast text (#133).

- The sidebar now has an **Archived** section below **All**; **All** leaves archived Threads out, and archived pins stay in **Pinned** (#126).
- Inbox and right-panel lists keep loaded rows in place during refreshes, and empty lists no longer flash a loading state on a quiet refresh.
- Long conversations draw only nearby rows and reuse work they have already done, making scrolling and updates lighter (#125).
- Grouped Work and streaming replies do less work as new content arrives (#125).
- Long formatted tool output takes less work to display without cutting off the text, and Studio avoids retrying the same automatic message-text read repeatedly (#125).
- On phones, the composer follows the space left by the keyboard so **Send** and **Stop** stay within reach (#128).
- Sidebar row menus have a larger, separate touch target that does not overlap the Thread link (#128).
- The README and bilingual [user guide](guides/user-guide.md) now match the current setup steps, screen labels, and upgrade and pairing guidance.
- **Settings > Studio > Startup** offers **Open Studio at login** to authenticated local desktop users on macOS and Windows; on Windows, use Windows Startup settings or remove the Startup shortcut to turn it off. Linux does not have this setting (#85).
- Use **Archive** and **Unarchive** in the sidebar selection bar to change archive status for the selected Threads (#127; Monitor was removed in #138).
- On desktop, **Settings** keeps the Thread list on the left, just like **Analytics**. On phones, Settings now uses the shared bottom tabs (#148).
- On phones, use the **Thread panel** picker and full-screen details; dialogs scroll in one place. When formatting is available in an expanded shell step, turn **Formatted** off to see raw text. **Wrap lines** controls shell output; **Load earlier messages** appears when earlier history is available (#128 items 3–7).
- Expanded shell steps count saved lines containing standard error. Where the display keeps the original lines, those lines have a `stderr` label and a line along the left edge. Raw text and copied output stay unchanged (#140).
- Global shortcuts stay out of dialogs, editable fields, Japanese text composition, and key events already handled by a control (#130).
- Tab moves from a row menu to the next control after the row (#130).
- Collapsed Work rows keep their keyboard focus outline (#130).
- Tab can reach a right-panel page even when it has no controls of its own (#130).
- When a focused **Stop** button disappears, focus returns to the message field (#130).

- The sidebar exposes its tree structure to assistive technology, and a focused conversation row stays mounted when the window moves. Studio announces **Reply is arriving.** and **Reply saved.**, not each chunk. The page cannot guarantee an independent screen-reader browse cursor (#130 follow-up).

## Check on a device

From [#10](https://github.com/tya5/shellboy-studio/issues/10); these are checks to run, not results. Record the device, OS, browser, exact Studio/Core versions, and outcome using disposable test data.

- Pair a phone over authorized private HTTPS and confirm it reconnects to the right conversation after switching away and back.
- In portrait and landscape, tap the row menu and open and dismiss the keyboard; check that the composer, Send, Stop, and dialog controls stay reachable.
- Compose Japanese text, choose or cancel a candidate, and confirm nothing sends or changes views during composition; send once after committing the text.
- While new text arrives, scroll back, select and copy a passage, and return to the latest message without an unwanted jump or send.
- Check keyboard focus and status icons in both themes; if an authorized no-auth test setup already exists, confirm its warning remains visible.
