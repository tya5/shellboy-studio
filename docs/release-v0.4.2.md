# Studio v0.4.2 pairing

Draft: the #130 keyboard fixes below are still pending. Confirm their landing and the final Core pairing before publishing.

- Studio main has moved off Core v0.15.0 to the Core v0.16.0 preparation build (`0.16.0-dev`, commit `62023b082a181e71b77400fa90b5a551acba4a2e`, protocol 22).
- The stable Core v0.16.0 tag is not published yet; desktop ZIPs must wait for a published stable Core tag matching Studio's exact pin.
- Before upgrading, quit Studio and Core and back up the entire Core data directory and any settings files stored outside it; see [v0.4.0](release-v0.4.0.md) for backup and phone-pairing guidance, not the Core version to install for this release.

## Changes on main since v0.4.1

- The sidebar now has an **Archive** section below **All**; **All** leaves archived Threads out, and archived pins stay in **Pinned** (#126).
- Inbox and right-panel lists keep loaded rows in place during refreshes, and empty lists no longer flash a loading state on a quiet refresh.
- Long conversations draw only nearby rows and reuse work they have already done, making scrolling and updates lighter (#125).
- Grouped Work and streaming replies do less work as new content arrives (#125).
- Long formatted tool output takes less work to display without cutting off the text, and Studio avoids retrying the same automatic message-text read repeatedly (#125).
- On phones, the composer follows the space left by the keyboard so Send and Stop stay within reach (#128).
- Sidebar row menus have a larger, separate touch target that does not overlap the Thread link (#128).
- The README and bilingual [user guide](guides/user-guide.md) now match the current setup steps, screen labels, and upgrade and pairing guidance.
- **Settings > Studio > Startup** lets authenticated local desktop users open Studio at sign-in on macOS and Windows; on Windows, use Windows Startup settings or remove the Startup shortcut to turn it off. Linux does not have this setting (#85).
- Monitor can show archived Threads without adding them to **All** in the sidebar (#127).

## Pending landing: Keyboard fixes (#130)

- Global shortcuts stay out of dialogs, editable fields, Japanese text composition, and key events already handled by a control (#130).
- Tab moves from a row menu to the next control after the row (#130).
- Collapsed Work rows keep their keyboard focus outline (#130).
- Tab can reach a right-panel page even when it has no controls of its own (#130).
- When a focused Stop button disappears, focus returns to the message field (#130).

The separate #128 follow-up for phone panel navigation, dialogs, log wrapping, and loading earlier messages is not included in the changes above; verify its landing before adding those items.

## Check on a device

From [#10](https://github.com/tya5/shellboy-studio/issues/10); these are checks to run, not results. Record the device, OS, browser, exact Studio/Core versions, and outcome using disposable test data.

- Pair a phone over authorized private HTTPS and confirm it reconnects to the right conversation after switching away and back.
- In portrait and landscape, tap the row menu and open and dismiss the keyboard; check that the composer, Send, Stop, and dialog controls stay reachable.
- Compose Japanese text, choose or cancel a candidate, and confirm nothing sends or changes views during composition; send once after committing the text.
- While new text arrives, scroll back, select and copy a passage, and return to the latest message without an unwanted jump or send.
- Check keyboard focus and status icons in both themes; if an authorized no-auth test setup already exists, confirm its warning remains visible.
