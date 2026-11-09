# Published Studio Scope And Follow-Up

This reconciles the [eight-item readiness checklist](release-v0.1.0-checklist.md)
against [publication evidence](../first-release-verification.md#published-v010-outcome).
The old checklist is historical preparation, not today's blocker list.

## Published Artifact Boundary

Studio [v0.1.0](https://github.com/tya5/shellboy-studio/releases/tag/v0.1.0)
is immutable source `1f26ec97c6e3cf3b8521422c4e430eddcb45ad32`, paired with
Core v0.11.0 `4dc8f66a6c586db57a7a63a3a8be84e25999c95f`
(protocol 5, schema 39). Later main changes do not update those archives or
embedded docs, nor prove that a running installation has new assets.

| Readiness Item | Recorded Outcome | Remaining Limit |
|---|---|---|
| 1. Pair/pin | Published Core v0.11.0 lock and exact-pair owner CI | Older-owner fallback unsupported; four defaults on, next-reply off |
| 2. Metadata/scope | Package 0.1.0, MIT, binary-only distribution | No attachments, installers, crate publication or extra targets |
| 3. Hosted CI | Exact release-SHA [Checks 42545162766](https://github.com/tya5/shellboy-studio/actions/runs/42545162766), three OS jobs and required owner job | Not physical-device or paid-provider acceptance |
| 4. Artifacts | Exact-SHA [Release 42545961767](https://github.com/tya5/shellboy-studio/actions/runs/42545961767), three archives and SHA256SUMS | Unsigned/unnotarized; download/extraction inspection is release-author evidence, not repeated by this reconciliation |
| 5. Devices/browser/accessibility | Explicitly unverified | Physical phone, Safari/Firefox, assistive technology and physical Windows/Linux testing remain open |
| 6. Privacy/provenance | [Safety review and fixture corrections](release-v0.1.0-safety.md) recorded | Pattern scans are not complete secret-absence proof; later scans do not retroactively scan every released asset |
| 7. Docs/truthfulness | Current source distinguishes historical preparation from publication | Packaged docs remain tag content; this page does not replace immutable archives |
| 8. First-run/correctness | Recorded exact-owner and disposable mock/headless checks only | General body handoff, scroll and tool presentation are not universally complete |

Public assets are listed on the release page, including
[SHA256SUMS](https://github.com/tya5/shellboy-studio/releases/download/v0.1.0/SHA256SUMS).
This reconciliation reads existing refs, API receipts and documents; it performs
no new binary, browser, phone, owner or provider tests.

## Follow-Up Issues

| Issue | Scope And Status Boundary |
|---|---|
| [#4](https://github.com/tya5/shellboy-studio/issues/4) | No-auth follow-up. Explicit opt-out exists; that alone does not close all follow-up validation. |
| [#5](https://github.com/tya5/shellboy-studio/issues/5) | Body handoff. Limited explicit final-answer subset plus history-only failure gate landed; general item-body and mixed/unsupported cases remain open. |
| [#6](https://github.com/tya5/shellboy-studio/issues/6) | Remaining scroll measurement and anchor behavior; not a claim that all scroll behavior is fixed. |
| [#7](https://github.com/tya5/shellboy-studio/issues/7) | Awaiting flicker repair landed and issue closed; do not reimplement as outstanding work. |
| [#8](https://github.com/tya5/shellboy-studio/issues/8) | Transient tool-JSON presentation; existing fixtures do not establish universal coverage. |
| [#9](https://github.com/tya5/shellboy-studio/issues/9) | This eight-item evidence reconciliation; source documentation, not new runtime validation. |
| [#10](https://github.com/tya5/shellboy-studio/issues/10) | Physical-phone/device/browser/accessibility validation remains unverified. |
| [#11](https://github.com/tya5/shellboy-studio/issues/11) | Theme/logo follow-up; no redesign implied by this documentation change. |

## Later Main Evidence Is Separate

The following successful runs concern later main, not published v0.1.0 archives:

- Fork/B3 `f53bb16e4f1dbca2c944ff431bc59839c6fbb224`:
  [candidate 42614802841](https://github.com/tya5/shellboy-studio/actions/runs/42614802841)
  and [natural main 42616195131](https://github.com/tya5/shellboy-studio/actions/runs/42616195131).
- Awaiting `ba265c4771c824bb2b65c5f76dca912320cf4f10`:
  [42619389086](https://github.com/tya5/shellboy-studio/actions/runs/42619389086).
- Combined C1/Awaiting `175d6d311943d146a19915b2f015c4daad83d473`:
  [42621978377](https://github.com/tya5/shellboy-studio/actions/runs/42621978377),
  three OS checks plus required owner acceptance successful.

Integrator 1147 tests, independent parent 1115/1101 tests with separate additional
regressions, and author eight-condition RAF observations are distinct evidence.
Do not add those counts together or present author browser observations as an
independent native/phone test. The Awaiting pre-push audit initially failed and
publication erroneously continued; subsequent independent privacy clearance and
landing gates do not turn that original failed gate into a success.

C1's [validation scope](conversation-handoff-validation.md) remains limited.
General body readback design does not become an implemented API, release
requirement or dependency merely because a proposal exists. Unsupported initial
tool/non-live/mixed cases, same-thread history-delay trade-offs, and coverage
UNKNOWNs remain explicit. See also [release notes](../release-v0.1.0.md).
