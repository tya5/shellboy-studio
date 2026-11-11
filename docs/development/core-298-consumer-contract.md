# Core 298 Consumer Contract Checkpoint

Studio base42d9ce51. Core producer a429259882 is reviewed/landed, not installed.
Current bridge tag v0.11.2 and installed owner may omit all new metadata. No Core
activation, dependency pin or Rust bridge type change is part of this task.
Canonical display spec read at hash fc1cf815a0156f663a3db0a63f241bbf57124416f01c9ca64d5046faaf65fd7f.

## Source Mismatch And Bounded Compatibility

HistorySavedItem currently has only execution_ids; decodeHistoryWindow allows only
those tool fields and rejects the approved Core descriptor. Canonical normalizer
then drops name/call-ID/availability and snapshot copy retains only tool identity.
Existing associated-tool display uses qualified shells; without them it says
execution content was not provided. Zero execution is not zero canonical tool.

| Input case | Required decode / same-projection outcome |
| --- | --- |
| Old owner lacks both new fields | accept; descriptor/detail remain absent/unknown, no synthesized availability/name or success |
| New call exact descriptor | validate closed states, optional-field consistency, bounded structural strings; retain bytes/identity |
| New result | name absent/name_state not_applicable; exact call ID only, no request-name join |
| Malformed/extra state or partial extension pair | reject, not silently discard invalid public metadata |
| Available field | exact nonempty <=256 UTF-8 bytes; name ASCII/nonwhitespace/control; both byte lengths added to existing shared4MiB ledger |
| Unavailable field | value absent; invalid/missing/field_budget/not_applicable preserved, no truncated ID |
| execution_linked detail | requires existing actual execution IDs; routing only, not output completeness |
| Zero-exec tool | retain canonical row, honest descriptor name and detail unavailable; no fake execution or global call-ID merge |
| Legacy unknown descriptor | keep missing as unknown; not a fabricated missing-field wire state |

P owns protocol.ts / operations.ts / data tests only. S must formally retain the
validated descriptor and detail availability as inseparable same-projection metadata
through normalize + snapshot copy; exact item identity stays canonical. Existing
CASE policy dispatch and identity/conflict guards must not be bypassed by name.
D/DS consume existing formal display bundle, no raw rejoin or kind classification.

Display hook request: associated-tool can use the actual validated call name as
content when no qualified shell exists, expose availability as unavailable rather
than output expansion, and keep exact call ID in structured context. It must not
infer text/state/result name from arguments/output/excerpts or claim actual owner
UI acceptance. Retry/reader/shell execution APIs remain unchanged. No Core #290
scope, readable reasoning #299 or sender #297 is added here.

Planned validation: actual strict operation decoder old/new positives; wrong
availability/value/extra/UTF-8 byte and shared-ledger negatives; same-projection
normalizer+display controls owned by S/D after exact API agreement. No private DB,
RPC, paid provider, browser, installed/Core schema40 operation is needed. This is
a type/contract checkpoint, not implemented decoding or UI success.
