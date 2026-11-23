# ContextRing

- **Use for:** Place beside Send/Stop to show measured input against the configured threshold; open Popover for the text breakdown.
- **Do not use for:** Use Meter for a resource budget elsewhere. Do not use this ring for time or summarization progress.
- **Why:** The ring shows normal, threshold or disabled; zero means disabled and missing facts never create a fill or a fourth state.
- **Source:** [Studio #66: Orca and ChatGPT composer context indicators](https://github.com/tya5/shellboy-studio/issues/66)

Use beside the composer's send/stop controls. The fill shows the measured input relative to the configured threshold, not time or summarization progress. The button's accessible name includes the state and opens the existing anchored Popover for a textual breakdown (Orca/ChatGPT composer context indicator, Studio #66). Unknown thresholds have no inferred fill; zero explicitly means disabled. The active summarizing state waits on Core #341.

Styles: style.css in this directory.

Missing facts do not give the ring a fourth state. Show the last compaction time only for a valid owner candidate with explicit complete coverage.
