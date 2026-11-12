# Studio 0.2.5

This candidate is based on the reviewed source at `404c0bc28d43e140608361221b3d8e9c10891e37`. The candidate commit and its exact-SHA CI determine the distributable build; this note does not authorize a tag or publication.

## Included improvements

- Sender identity appears in the message header using the existing current-title cache, full-ID links and short-ID fallback. This was positively observed on the earlier trial, but that older 0.2.5 candidate later reproduced answer disappearance and was rejected. Its bytes are not this candidate and must not be reused.
- Composer clears a reserved draft before acknowledgement, retains the original pending text and operation identity, and does not clear a newer draft.
- Own-send placement re-finds qualified positions after ordinary history revisions without an unqualified tail fallback.
- A same-operation accepted own-message update is committed atomically with pending removal, avoiding publication of the intermediate duplicate ACK state. This is a narrow own-ACK presentation fix, not a general guarantee about all duplicate or disappearing assistant messages.
- Exact-empty assistant text preserves an honest unavailable reason while live; a complete empty wrapper is omitted, and a later non-empty update for that item replaces the unavailable presentation. This prevents one tested unexplained-empty disappearance branch; it does not guarantee recovery of every missing answer.
- Recovery drains a retained change hint after installing the recovery reply, permitting a subsequent read without additional user input.
- Common tool rows prefer descriptions, retain command fallback and consume existing typed status marks and palette.
- Bounded optional tool/relation metadata is admitted with field-local quarantine; missing producer fields remain absent or unknown, and existing sender/body fields remain independent.
- Local send admission reports capacity/eligibility based on the current draft and model, checks again at submit, and retains the original operation for qualified retry. Existing slot and byte budgets are unchanged.
- Receipt-capacity presentation identifies the bounded pending state and does not offer an unqualified retry. Existing live and saved bodies may both remain; this is an explanatory UI change, not duplicate-body suppression.
- Issued Core notification descriptors are normalized to safe meaning labels through the existing App work-row path. Execution ID and changed-field metadata are retained but are not shown as row context. This does not establish CLI producer emission or real-owner delivery.

## Known limits and acceptance boundaries

A previous 0.2.5 candidate reproduced answer disappearance and is rejected. This candidate has different source bytes and still requires its own exact candidate artifacts and same-bytes trial. Prior sender-header feedback, the prior candidate's HTTP response, or a passing CI cannot substitute for user review of this candidate's bytes.

The terminal-empty repair only covers the tested transition: complete typed empty text keeps the client unavailable reason visible, and a later non-empty saved update for the same item replaces it. General USER non-empty disappearance has not been attributed to this cause or universally resolved. The own-ACK change covers same-operation intermediate duplication only; USER own-versus-assistant origin and any assistant exact-node/turn proof remain unknown. Receipt-capacity copy does not remove a second body; whole-preview suppression remains unauthorized because existing linkage does not prove complete coverage.

Studio 0.2.5 does not adopt Core coverage 0.12.0, alter a Core pin, install Core, or claim typed terminal-coverage delivery. Missing metadata remains unknown. The reviewed notification source does not prove N2 admission, CLI producer emission, installed Core 42 behavior, or actual-owner UI acceptance. Context such as execution ID and changed settings fields is retained in metadata but is not visible in the current common work row.

Issue-specific actual-owner acceptance remains separate. Historical non-empty-answer disappearance, all legacy/no-reference/interleaved tool cases, every request/reply relation and state, non-adjacent replay/navigation, complete owner-UI behavior, accessibility/zero/unknown branches, live-to-saved DOM transfer, measured latency, touch tooltip behavior, and explicit Composer cancel/unmount cases are not all independently qualified. No all-symptom or all-policy success is claimed; issues 24 and 25 must not be closed by CI alone.

## Candidate and publication gate

Freeze this version-only/docs commit and validate its exact source SHA. Use the official candidate workflow only after same-SHA dispatched CI and exact owner jobs succeed. Preserve the three official archives, per-archive and binary hashes, source/Core provenance and actual expiry. Safely trial the exact saved archive bytes with rollback/configuration preserved; report the installed manifest and what the user actually reviewed. Publication requires a separate final gate. Never alter or retag `v0.2.4`; never reuse or relabel the rejected earlier candidate bytes. If the candidate expires or bytes differ, qualification and trial must be repeated for the new exact artifact.
