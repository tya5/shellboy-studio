# Studio v0.4.1 pairing

- Studio: v0.4.1; fixes pinned Thread-list reads (#122).
- Needs-you is exclusive with query, tag and directory filters; enabling it clears those filters, and choosing any of them clears Needs-you.
- The pinned band is hidden while Needs-you is active; no client-side filtering is applied.
- Shellboy Core: v0.15.0, commit `318abee0609eeb3b15a3a21b74b85f816c7d3ea0`, protocol 18.
- This patch release keeps the Core v0.15.0 pairing.
