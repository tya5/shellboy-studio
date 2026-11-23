# Meter

- **Use for:** Show retained bytes against a reported limit such as a cache budget; omit the track and explain when either value is missing.
- **Do not use for:** Use BarList to compare categories and Chart to show a trend.
- **Why:** The fill communicates a real fraction of a limit, and neutral tone avoids implying urgency without evidence.
- **Source:** 出典なし（この Studio で決めた）

Retained bytes against a limit the owner reported, such as a cache budget. Fill is neutral unless `tone` says the limit matters now. When the value or the limit is unknown, the track is left out and `text` says why. Never draw a meter against a guessed limit.

Styles are colocated in `system/components/Meter/style.css`.

Styles: style.css in this directory
