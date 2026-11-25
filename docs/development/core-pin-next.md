# Core main preparation (Studio #152)

Core `3ab5ada40910e727553d85d271c1d84ec5db2c41`, protocol 34. The manifest and lock resolve the same commit. This is a preparation branch on landing hold, not a published pairing.

| Core change | Studio adoption |
| --- | --- |
| #416 Unit 1, protocol 30 | Carry effective `limit` and typed `filters` on consumed record pages, including artifact version history. Keep omission flags distinct from selectors; preserve cursor continuation for empty pages. Branch family limits and shell scan metadata remain separate. Compaction is a capped report with `more`, not cursor pagination. Status uses top-level limit without reflecting cursor or memory; memory remains independent. Do not use the new fingerprint as a cursor or a live observation. |
| #416 Unit 1, count and snippet coverage | Use `awaiting_replies_count_exact`, keep directional lower bounds, and preserve `excerpt_omitted`, `excerpt_truncated`, and `execution_count_exact` independently. No inferred count or coverage. |
| #420, protocol 31 | The CLI's `message ask --sender-label` uses existing Core wire sender metadata. Studio already displays saved sender labels. The bridge still disallows `message.ask`; no browser sender authority or new write route. |
| #416 Unit 2, protocol 32 | Use `parent_thread_id` for Thread create/set and returned Thread facts, including watch summaries and Branches rows. Preserve empty-string detach. Map reply-list requests to `owed_by_thread_id` and `asked_by_thread_id`; do not rename `pending_replies` fields or item `asked_by`. Studio does not issue filtered `history.list` reads by shell state; Core's pinned typed command and app/bridge passthrough carry the `shell_state` contract. |
| #416 Unit 3, protocol 33 | Use `history.read` and `HistoryReadArgs` without changing request shape. Studio only holds opaque page cursors in the current walk; do not reuse old `history.get` scopes across the pin. |
| Other additions in this Core pin | Explicitly deny Core draft commands, `history.recall`, and `history.received` in the exhaustive bridge allowlist. No new Studio surface. |
| #418 | Compare every admitted lane window to the family row's `selection_revision`, retaining the tip/size and window agreement checks. Reject and reread an inconsistent family when a divergence's `parent_selection_revision` disagrees with the parent row. |

The Studio public app bridge returns the pinned Core record envelopes. Core's public `attachment.list` inspection path still sends a bare page despite the schema; Studio accepts that page and validates typed scope and limit if Core supplies them. No client-synthesized metadata. Grouped usage, fixed service/schedule lists, and status memory do not use record pagination.
