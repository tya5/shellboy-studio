# Studio 25 Sender Header Consumer

Contract: sender-header-contract.md SHA256
6dafc1bb4835aa355a27d0b5e3220ab852ba5c70fafe13e97225f956824c4832.
Base: f0f8eef78e2461027e1b638f8bffcc2c5c9b0f6b. No owner/schema/pin change.

## Authority And Bounds

Sender remains the existing senderFact result from the same accepted node. The
sender-display adapter uses the existing SenderTitles last-observed title or a
generic role plus first8 source-ID fallback. Exact full ID remains the route,
link title and accessible identity. Same title does not merge source identities.
Message.who accepts only a string or a structured display value, not a selector,
fetcher or arbitrary protocol object. Preact escapes label/claimed text. Header
and body remain under the same accepted owner/ref qualification, so revoked refs
cannot retain a label or href. Human/current assistant roles remain unchanged.
Existing SenderTitles sixteen-candidate/attempt bound and one-flight ownership
are unchanged. Header rendering creates no read, retry or freshness promise.

Only current title/source-ID duplication moves out of the footer. Claimed label,
qualifier, receipt/branch controls, timestamps and body stay intact. Reply node IDs
are text metadata, never guessed Thread routes.

## Independent Relationship Table

Both history.list and history.window pass optional message through the SAME
field-local admission function. Omission is unavailable, never ordinary. Ordinary
requires false/no reply fields; reply requires false/only valid reply_to; pending,
ignored and cancelled require true/state only; replied requires true/state/valid
reply_node_id. Null/unknown/extra fields/invalid combinations/self-ID fail only the
relationship. IDs are nonempty and <=256 UTF8 bytes; whole JSON.stringify relation
including keys and escaping is <=4096 UTF8 bytes. Sender/body/item keys survive
quarantine. Frame decoding still owns frame limits; typed text budgets/4MiB ledger
are untouched and relation metadata is not charged as text.

Same-projection metadata has an unknown boundary; the display adapter reuses the
same admission function before calling its typed relationship selector, rather
than casting raw retained metadata into selector authority.

## Focused Evidence Map

- data/test/message-provenance.test.ts: six valid table rows and invalid/null/
  oversize/self/conflict rejection, preserving sender/body.
- ui-core/test/sender-display.test.ts: relation CASE mapping, whitespace unresolved,
  same title/distinct full-ID routes and raw text preserved for renderer escaping.
- ui-core/test/sender-titles.test.ts: existing one-flight/sixteen bound, rename,
  candidate removal, owner/page replacement and late response rejection.
- projection24-actual-producer.test.tsx: real App header/full-ID link/claimed text,
  cached rename without body remount, malformed later relation without losing
  sender/body/key; actual Window ref disposal removes label/href/body together.

Final focused snapshot: both TS checks, four files/60 tests pass. Initial author
seam/type/fixture/selector failures remain in separate logs. The existing public
App/decoder tests use local fake transport and are NOT real owner Thread UI
acceptance. No independent real-owner interleaved request/reply exercise, browser
route navigation or installed schema41 source is claimed. Existing owner/replay
and cache controls are not a substitute for that separate permission gate. Exact
SHA CI, integration build and safe trial remain integrator/reviewer gates.
