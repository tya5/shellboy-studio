# Shellboy Studio: agent guide

Shellboy Studio is a browser interface and local bridge for Shellboy. Its Apps
feature hosts small web applications that can exchange data and messages with a
Thread. It does not require a separate app server.

To make an app, read the app guide Studio serves on its own address at
`/_shellboy/guide.md` (for example `curl http://127.0.0.1:PORT/_shellboy/guide.md`;
the address is in Studio's settings) for the app layout, sandbox, APIs and
limits. An app is a frontend folder (the artifact) plus, when it needs a
backend, a named Core service owned by the same Thread; the guide shows how pages call it. Services may be shared by several pages, or combined by one page. An app is a folder you write anywhere you like and register with
`shellboy artifact add --uri shellboy-app:./FOLDER`; there is no apps directory.

Test app logic and the backend service locally. Ask the person to open Apps in Studio, open
the app, and report any displayed errors. Do not claim that browser or device
checks were performed unless they were actually performed.

Studio rewrites this guide on each startup. Edits to the installed copy are lost.

Read the bundled user guide with `shellboy-studio guide user` for connection and
phone pairing. Never request or copy Studio tokens, pairing codes, real
conversations or API credentials into app files, logs, screenshots or Git.
The bridge talks to the Shellboy owner; apps must use their documented APIs,
not the owner database or data-directory internals.

## Protocol compatibility

Studio v0.4.3 and v0.4.2 both pair with Core v0.16.0 at
`46212b5391e2d486efec770291359a2ba671fa01`, protocol 26. See the [v0.4.3 pairing notes](../release-v0.4.3.md). There is no protocol downgrade or
ownership alias. Never restart a working owner or change its data to resolve a
version mismatch without explicit approval.

Runs are independent: no Run owns another Run and organizational Thread parents
are not Run owners. Shell ownership remains unchanged. Studio reads bounded directional `message.list` pages and uses
`thread.get.pending_replies` for tab counts. A Reply needed row is captioned
Asked back only when its message ID is in Core's `pending_replies.awaiting_own_ask`
list; Studio never derives that state. The sender is shown from the saved
identity. Answer a duty with `message.reply` and its exact message ID. A count
marked with `+` is a lower bound. A recovery wait does not clear a duty.
