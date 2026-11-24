# Studio v0.4.1 pairing

- Studio: v0.4.1; fixes pinned Thread-list reads (#122).
- The "Awaiting you" filter (Japanese: 「あなた待ち」) is exclusive with query, tag and directory filters; enabling it clears those filters, and choosing any of them clears "Awaiting you".
- The pinned band is hidden while "Awaiting you" is active; no client-side filtering is applied.
- The pinned band lists Threads newest first by creation time; a Thread with no creation time comes last.
- A filtered All list (search, tag or directory) arrives in Core's updated order.
- Shellboy Core: v0.15.0, commit `318abee0609eeb3b15a3a21b74b85f816c7d3ea0`, protocol 18.
- This patch release keeps the Core v0.15.0 pairing.
- Upgrade and pairing facts from [v0.4.0](release-v0.4.0.md) remain applicable.
