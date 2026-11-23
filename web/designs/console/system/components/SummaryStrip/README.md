# SummaryStrip

- **Use for:** Mark the position of a conversation summary and expand it to show the summary and any measured before/after facts.
- **Do not use for:** Use Message for normal conversation and RangeBar for a standalone cell comparison. Do not estimate sizes.
- **Why:** An inline marker preserves where compaction happened without drawing bars for unknown facts.
- **Source:** 出典なし（この Studio で決めた）

Marks where a summary replaced earlier conversation, and opens to show what happened.

Provide the input size before and after, the summary's own usage and its parts. Draw both bars on the same scale with real measured values only. Place it inline in the conversation.

Today the owner's history gives the summary text of a node but no before and after sizes in a read this view has, so the strip shows the text only and draws no bars. Add the bars when those facts are read.

Styles are colocated in `system/components/SummaryStrip/style.css`.

Styles: style.css in this directory
