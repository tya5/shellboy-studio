# ContextRing

- **Use for:** Place beside Send/Stop to show measured input against the threshold and indicate owner-reported summary activity; open the Thread Analytics tab for measured usage and compaction.
- **Do not use for:** Use Meter for a resource budget elsewhere. Do not use this ring for time or summarization progress.
- **Why:** Measured fill and indeterminate summary activity answer different questions. Only the current owner flag activates the amber arc; missing values never produce a guessed fill.
- **Source:** [Studio #66: Orca and ChatGPT composer context indicators](https://github.com/tya5/shellboy-studio/issues/66); [Studio #79](https://github.com/tya5/shellboy-studio/issues/79); [Studio #80](https://github.com/tya5/shellboy-studio/issues/80)

Use beside the composer's send/stop controls. The fill shows the measured input relative to the configured threshold, not time or summarization progress. The button's accessible name includes the state and opens the Thread Analytics tab (Orca/ChatGPT composer context indicator, Studio #66). Before the first measurement or when the threshold is missing, keep the same disclosure button with only its track and an unknown-state label; zero explicitly means disabled. When Core reports `thread.get.summarizing: true`, the SVG root rotates at the existing motion token (the circular track is symmetric), or becomes a stationary dotted ring under reduced motion. It is indeterminate, not a progress estimate; use no new StatusMark.

Styles: style.css in this directory

Missing or malformed `summarizing` never activates the ring; measured threshold states are unchanged.
