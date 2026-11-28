# Studio release notes draft

This draft describes changes already on Studio main. It is not a release candidate and does not specify a release pairing.

## Changes since v0.4.4

- **Apps belong to Threads (#169).** Ask a Thread to build an app, then register its folder as a `shellboy-app:` artifact. Open it from the Thread's **Possessions** or find it in **Apps** with that Thread open. Use **Show more apps** to see additional results. A standalone HTML artifact opens as a single page in Possessions, without the app API or access to neighboring files.
- **Apps can update without a page reload (#169).** A page can redraw when the Thread or its backend changes files in the app's `data/` folder. A page that needs a backend can call its own loopback service with `shellboy.call`; the page does not start the service. To share an app, copy its folder and register it in the receiving Thread. See [Apps, guides, and troubleshooting](guides/user-guide.md#apps-guides-and-troubleshooting).
- **Long-running Studio sessions use fewer resources (#171).** Idle app watchers are released, the sidebar keeps only the last focused position, and ticking elapsed time no longer redraws the whole panel. Desktop `owner.log` and `studio.log` are capped at 8 MiB each, with one older copy per log. Opening Studio again does not start a second desktop session.
- **Idle tabs do less work and retain less history (#181).** Only visible time labels update with the clock. Studio releases fetched history bodies as their rows age out of the conversation window, and releases the window when you leave the conversation or switch Threads.
- **Archived Threads appear only in Archive (#174).** This also applies to pinned Threads and archived children of pinned Threads. They no longer appear under **Pinned** or **All** while archived.
- **Activity sections stay in place, even when empty (#178).** Running, Pending, Services, and Schedules always appear in that order. Running and Pending show **None** only after a complete read confirms there are no rows; loading, partial, and stale results are shown separately. Attachments remain in Possessions.
- **Activity shows which running shells are in the foreground (#167).** **Foreground** and **Background** follow Core's reported state. Use the foreground row's **Move to background** button to let the Turn continue while the shell keeps running. If a focused row action disappears as its state changes, focus returns to the row.
- **Reply and sender details are clearer (#168, #163).** **Asked back** identifies an open reply duty where the Thread is waiting for an answer to its follow-up question. Named Asks from a Thread show the sender recorded by Core instead of **Unknown sender** when that sender is available.
- **An unconfirmed stop explains what to check (Core #431, Studio #170).** The conversation identifies the affected Run and distinguishes a save failure from an inconsistent state. The notice does not retry the stop for you.

## Upgrade

Quit both Studio and Core before upgrading. Back up the entire Core data directory and any configuration files stored outside it before starting the new Core. Startup may migrate data; an automatic downgrade is not provided.
