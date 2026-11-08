# Shellboy Studio: agent guide

Shellboy Studio is a browser interface and local bridge for Shellboy. Its Apps
feature hosts small web applications that can exchange data and messages with a
Thread. It does not require a separate app server.

To make an app, read `$SHELLBOY_DATA_DIR/apps/README.md` for the app layout,
sandbox, APIs and limits. If Studio was started with a custom `--apps-dir`, use
the folder shown in the Apps screen instead. Keep app files in that folder.

Test app logic and actions locally. Ask the person to open Apps in Studio, open
the app, and report any displayed errors. Do not claim that browser or device
checks were performed unless they were actually performed.

Studio rewrites this guide on each startup. Edits to the installed copy are lost.

Read the bundled user guide with `shellboy-studio guide user` for connection and
phone pairing. Never request or copy Studio tokens, pairing codes, real
conversations or API credentials into app files, logs, screenshots or Git.
The bridge talks to the Shellboy owner; apps must use their documented APIs,
not the owner database or data-directory internals.

## Protocol 5 compatibility

The v0.1.0 candidate follows Core's protocol 5 / schema 39 contract (#276).
There is no protocol-4 downgrade or ownership alias. Use the exact validated
Core release pair; the published Core tag, lockfile and installed binaries must
be checked separately before release. This source change does not establish that
pin. Never restart a working owner or change its data to resolve a mismatch
without explicit approval.

Runs are independent: no Run owns another Run and organizational Thread parents
are not Run owners. Shell ownership remains unchanged. Pending reply duties come
from one bounded `thread.get.awaiting_replies` list (at most 128), discriminated
by `recipient_kind` and `recipient_thread_id`. Human answers use `message.reply`;
a Thread-directed duty is not a human question. For delegation, retain the
accepted request's exact message ID and use an explicit reply to that message;
progress is ordinary messaging, not automatic child-Run forwarding. A recovery
wait is not evidence the reply duty disappeared. Unknown fields are not inferred
from old lists. Human count 17 with `awaiting_human_count_exact=false` means
17 or more, not an exact count.
