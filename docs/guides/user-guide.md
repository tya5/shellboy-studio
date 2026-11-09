# Shellboy Studio: user guide

Shellboy Studio is a browser interface for a running Shellboy owner. Start the
owner, then run `shellboy-studio` and open the URL printed by the bridge. The URL
contains a credential in the default authenticated mode: do not share it. By default the bridge listens only on
loopback; a remote bind is plain HTTP unless protected by a TLS tunnel.

## Open on another device

Keep Studio on this computer's loopback address. Use an HTTPS reverse proxy or
a VPN with an HTTPS endpoint reachable from the other device, and allow the
exact hostname with `--allow-host HOSTNAME`. A VPN alone does not provide HTTPS
or user authentication. Preserve the authenticated default unless you explicitly
choose the restricted development opt-out described below. Studio does not
configure or verify your proxy/VPN or its exposure.

### Example: a phone using Tailscale Serve

Tailscale Serve is one example, not a dependency. Install Tailscale on both the Mac or PC running Studio and your phone, and sign
in to the same tailnet on both devices. Tailnet access controls must permit the
phone to reach the computer.

1. Find the computer's full Tailscale hostname. In the Tailscale admin console,
   open the computer's page from [Machines](https://console.tailscale.com/admin/machines):
   its full domain name is shown there. It combines the machine name and the
   tailnet DNS name, in the form `<machine>.<tailnet>.ts.net`. The tailnet DNS
   name is also shown on the [DNS page](https://console.tailscale.com/admin/dns).
   See the official [MagicDNS guide](https://tailscale.com/docs/features/magicdns).
2. Start the owner and Studio on the computer, allowing that exact hostname.
   For example, substituting your own hostname for the fictional one:

   ```sh
   shellboy-studio --allow-host example-computer.example-tailnet.ts.net
   ```

   Keep Studio listening on its default loopback address, `127.0.0.1:8751`.
3. On the computer, expose that local address to your tailnet over HTTPS:

   ```sh
   tailscale serve --bg http://127.0.0.1:8751
   tailscale serve status
   ```

   Serve may prompt you to enable HTTPS certificates for your tailnet. See the
   official [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve)
   and [command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).
   Use Serve, not Funnel: Funnel exposes services to the public internet.
4. On the computer, open Settings, select **Studio**, and use **Open on a
   phone** to create a QR code for the allowed hostname. Scan it with the
   phone. The code can be used once and expires after 120 seconds; reissue it
   if it expires. Anyone who scans it first can log in, so do not show it to
   anyone else.

Use the conversation view to send messages, inspect work and stop a Run. Apps
are small local web applications hosted by Studio. Open Apps to see the app
folder and its README. An agent can create an app there; inspect and test it
before trusting its actions. Actions execute on the Studio host with that
process's environment.

The agent guide is installed at `$SHELLBOY_DATA_DIR/studio/agent-guide.md` when
Studio starts. Studio rewrites it on every startup: edits to that installed copy
are lost. The Apps README is also rewritten. To read the bundled guides without
starting the bridge, run `shellboy-studio guide user` or
`shellboy-studio guide agent`.

## Version and troubleshooting

For released Studio v0.1.0, use the validated matching Core v0.11.0 release
(protocol 5, schema 39). A newer Studio build is not guaranteed to negotiate missing features
with an older owner. If operations fail after a version mismatch, check both
versions and follow the release pairing instructions; do not reset data or
restart an owner that is running work without explicit approval.

If another device cannot connect, confirm the allowed hostname, network access
and HTTPS reverse-proxy/VPN endpoint status; in authenticated mode, reissue an expired pairing
code on the computer. Pairing is disabled in explicit `--no-auth` mode.
Do not expose an unauthenticated Studio publicly (for example via Funnel), or
paste token URLs, QR contents or credentials into reports.
Phone, Safari/Firefox and physical Windows/Linux validation remain unverified
unless the final release notes explicitly record those checks.

## Explicit Development Authentication Opt-Out

`--no-auth` skips token and session checks only when explicitly specified. The
normal default still requires the token and an in-memory session after restart.
For disposable development, use loopback or explicitly trusted private access
through an HTTPS reverse proxy/VPN and an exact `--allow-host HOSTNAME`.
**Never expose this mode to the public internet**, for example via **Tailscale
Funnel**. A VPN is not user authentication. Studio does not configure, detect or
guarantee proxy/VPN access restrictions. Verify those restrictions yourself;
this option is not a safe way to publish Studio.

Anyone who can reach the bridge can operate it, including other processes on the
same PC and users/devices sharing the reachable private network. Host and Origin checks are not user
authentication and do not stop those clients. These checks remain enforced for
HTTP and WebSocket, with no wildcard host or arbitrary-origin bypass. Requests
without Origin retain the existing non-browser policy. Use the normal authenticated
mode when these access assumptions are not acceptable.

An always-visible “Authentication off” / “認証なし” strip appears on desktop and
mobile. The bootstrap `/auth-mode` exposes only the no-auth configuration bit, not
owner data or secrets. In this mode `/auth` acknowledges valid requests without
creating a session cookie; pairing endpoints return 409 and do not issue or
exchange codes. WebSocket and guide-preference routes require allowed Host and
matching Origin (when present), but no token/cookie. App capability URLs retain
their independent sandbox restrictions. `/debug`, when explicitly enabled, also
connects without a cookie and exposes the same bridge operations: do not share it.
Actual reverse-proxy/VPN or Serve/Funnel operation is not established by synthetic tests.

## Protocol 5 compatibility

Studio v0.1.0 follows Core's protocol 5 / schema 39 contract (#276).
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

## Message Sender Identity

For model-originated messages, Studio shows the owner-recorded **From Thread** ID
and, when available, its **Current title**. A title is display text: it can change
or match another Thread's title. The full Thread ID and its link remain the sender
identity even if lookup fails or that Thread has been deleted. Studio uses the
existing Thread lookup; it does not save title snapshots or infer sender identity
from message text, a notification, the selected Thread or a label.

A **Self-asserted label** is the sender's supplied label, not a verified title or
identity. Studio does not automatically fill an absent label. Human and external
CLI provenance do not gain fictional model sender IDs; malformed or missing model
identity displays as unavailable, never as You.

Title lookup is limited to 16 distinct sender IDs and 16 attempts, one at a time,
per owner/view/explicit-page budget. Existing current owner-list titles are reused.
Background updates do not refill that budget or retry failures. Unresolved or
additional IDs still display in full; open the ID link to inspect the Thread.
Leaving the view cancels its lookups and discards view-owned title entries.
