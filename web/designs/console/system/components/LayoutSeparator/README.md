# LayoutSeparator

- **Use for:** Resize an expanded desktop sidebar or conversation panel with a named, bounded pointer and keyboard splitter.
- **Do not use for:** Use ShellToggle to collapse a pane; omit the splitter on collapsed rails, the phone drawer and WorkSheet.
- **Why:** The component owns pointer capture and keys, while the caller retains independent width preferences.
- **Source:** [WAI-ARIA APG Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)

Use the [WAI-ARIA APG Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) for the expanded desktop sidebar or conversation panel. Name the separator and link its controlled pane. The component owns pointer capture and keyboard interaction; its caller supplies the current width and bounds and writes the existing per-browser preference. The separator is absent while its pane is collapsed. Do not use it for the phone drawer or Work sheet.

Drag or press Left/Right to move the boundary (left widens the right panel). Shift uses a larger step; Home/End select minimum/maximum width. The right boundary has a touch-sized target on a coarse pointer device without relying on hover.

Styles: style.css in this directory
