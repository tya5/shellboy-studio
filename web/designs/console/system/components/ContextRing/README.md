# ContextRing

- **Use for:** Place beside Send/Stop to show measured input against the threshold and indicate owner-reported summary activity; open Popover for the breakdown.
- **Do not use for:** Use Meter for a resource budget elsewhere. Do not use this ring for time or summarization progress.
- **Why:** Measured fill and indeterminate summary activity answer different questions. Only the current owner flag activates the amber arc; missing values never produce a guessed fill.
- **Source:** [Studio #66: Orca and ChatGPT composer context indicators](https://github.com/tya5/shellboy-studio/issues/66); [Studio #79](https://github.com/tya5/shellboy-studio/issues/79)

Use beside the composer's send/stop controls. The fill shows the measured input relative to the configured threshold, not time or summarization progress. The button's accessible name includes the state and opens the existing anchored Popover for a textual breakdown (Orca/ChatGPT composer context indicator, Studio #66). Unknown thresholds have no inferred fill; zero explicitly means disabled. When Core reports `thread.get.summarizing: true`, the approved amber arc rotates at the existing motion token, or becomes a stationary dotted ring under reduced motion. It is indeterminate, not a progress estimate; use no new StatusMark.

Styles: style.css in this directory

Missing or malformed `summarizing` never activates the ring; measured threshold states are unchanged. Show the last compaction time only for a valid owner candidate with explicit complete coverage.
