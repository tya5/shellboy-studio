# Studio 0.2.5 Release Candidate

Source baseline: c66d11f3b85f58f3bcb78334b46488c1c7def9fc. The version commit and its exact-SHA validation determine the candidate source; this document does not authorize a tag or publication.

## Improvements

- Sender identity moves into the message header using the existing current-title cache, full-ID links and short-ID fallback. The user confirmed this visible improvement in the preceding trial.
- Composer clears a reserved draft before acknowledgement while retaining the original pending text and operation identity, without clearing a newer draft.
- Own-send placement re-finds qualified current positions after normal history revisions, preserving order without an unqualified ordinary-tail fallback.
- Exact-empty assistant text uses writing presence while live, omits explicitly complete empty wrappers, and retains honest unavailable states for incomplete data.
- Recovery drains a retained change hint after installing the recovery reply, allowing a subsequent read without additional user input.
- Common tool rows prefer descriptions, retain command fallback, and consume existing typed status marks and palette.
- Optional structured tool and relation metadata is admitted with bounds and field-local quarantine. Missing producer fields remain absent or unknown; existing sender and body data remain independent.

## Known Limits And Acceptance Boundaries

The sender-header trial has positive user feedback, not blanket acceptance of all relation states, nonadjacent request/reply replay, actual navigation or every existing owner Thread. Historical nonempty-answer disappearance is not established as universally resolved. Legacy/no-reference/interleaved tool cases and actual-owner historical rendering still require the issue-specific acceptance evidence.

Mock transport through the actual App and the Rust response-to-frame type seam are separate evidence; neither proves a live IPC connection or an installed metadata producer. This release does not install Core, change its pin, activate a schema, or fabricate absent metadata. Metadata admission assumes bounded plain values supplied by the existing decoder, not arbitrary cyclic JavaScript objects.

Live-to-saved namespace DOM transfer, measured latency, touch tooltip behavior, explicit cancel/unmount Composer cases and some unknown/zero/accessibility branches do not have complete independent acceptance evidence. Issue 24 and issue 25 remain subject to their own closure gates, including actual-owner observations and the required postmortem/release-gate evidence. No all-policy or all-symptom success is claimed.

## Publication Gate

Freeze the version commit; independently review and validate that exact SHA. Preserve candidate archives, checksums, source/Core-pair provenance and actual artifact expiry. Trial the exact release archive bytes with rollback and configuration preserved. Report the installed manifest, user-confirmed scope, limits, CI and archive allowlist together before separately approving tag/publication. Never retag 0.2.4 or substitute rebuilt bytes for tested candidate bytes. Expired or unavailable candidates require a fresh trial.
