# Client Server-Frame Ingress Resource Policy

Leader adoption f9fdd803, S6 conditional design c9cf9d52. All incoming server text
frames are admitted only up to8,388,660 UTF8 bytes inclusive, BEFORE JSON.parse.
This is a client resource/rejection policy, not a guarantee that all Core methods
or other server frame kinds fit8MiB. Core full Response8,388,608 plus canonical
compact result/max-u64 wrapper52 is the byte oracle, not JS request-ID safety.
Other kinds and noncanonical whitespace/extensions exceeding the cap are rejected.
Server24MiB client-ingress policy is the opposite direction and is not reused.

Bounded scan uses fixed auxiliary memory, stops on first overlimit, surrogate
pair4bytes/isolated3. It does not protect memory already used for the raw string.
ArrayBuffer/Blob stay unsupported. Ordinary underlimit invalid JSON retains its
existing invalid-frame behavior. Oversize is typed, reports invalid, quarantines
that socket generation before observers, and closes only the still-current socket
in finalization. Existing close settles calls/reconnects once; no guessed IDs,
per-call cancellation from unparsed data, body truncation or false mutation retry.
Observers can throw, reenter, stop or replace connection; replacement is not closed.

Close may revoke accepted references: no claim of preserved proof or authority.
Prior text preservation/unavailability belongs to existing S/D store/UI policy;
transport fixture keeps a local prior-body sentinel but is NOT an actual store
preservation or USER-owner acceptance control. Shared-store changes require its
owner. N1 admission, issued metadata, UI and coverage remain separate scopes.

Source controls are added in existing protocol/transport files. Local compilation,
Node tests and builds are intentionally NOT executed under the memory hold.
Source-only review precedes cloud exact-SHA CI. No installed or owner operation.
