# LayoutSeparator

- **Use for:** Resize an expanded desktop sidebar or conversation panel with a named, bounded pointer and keyboard splitter.
- **Do not use for:** Use ShellToggle to collapse a pane; omit the splitter on collapsed rails, the phone drawer and WorkSheet.
- **Why:** The component owns pointer capture and keys, while the caller retains independent width preferences.
- **Source:** [WAI-ARIA APG Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)

Link the controlled pane. Left/Right resize (Left widens the right pane), Shift steps farther,
Home/End select the min/max; the right boundary has a coarse-pointer hit target.

Styles: style.css in this directory
