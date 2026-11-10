# Current Socket Callback Ownership

Transport callbacks may publish only while their captured socket is the current
socket and the transport is not stopped. This is a local object-identity fence,
not a wire epoch, Core attempt order, read qualification or end/status barrier.

| Event | Current and running | Superseded or stopped |
| --- | --- | --- |
| open | Reset backoff; publish open | No state change or publication |
| message, valid JSON | Parse and publish decoded frame | Do not parse or publish |
| message, invalid/binary | Publish invalid-frame category | No publication |
| close | Existing current-socket guard; close and reconnect when running | Existing identity guard ignores old socket |

Stopping clears socket identity and handlers. Starting again establishes a new
socket: captured callbacks from an earlier start cannot reach new handlers.
The guard precedes backoff changes, decoding and callback publication. Legitimate
current behavior and wire shapes are unchanged. No queue or retained tombstones
are introduced; ownership ends with the current socket/transport stop.

Focused tests retain old callbacks across reconnect/stop/start, assert old open,
valid/malformed/binary messages are inert, and assert current open/frame delivery.
An old open must not reset the replacement connection's retry backoff. These are
synthetic transport controls, not actual browser, producer or replay-barrier proof.
Cross-channel live/status freshness and ledger read-cohort reclamation remain
separate unresolved contracts.
