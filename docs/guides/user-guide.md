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

Studio v0.4.1 pairs with Core v0.15.0 (protocol 18); install the exact pair
named in the [release notes](../release-v0.4.1.md), not an older owner. Studio
does not negotiate missing features with an older owner. If operations fail
after a version mismatch, check both versions; do not reset data or restart an
owner that is running work without explicit approval.

If another device cannot connect, confirm the allowed hostname, network access
and HTTPS reverse-proxy/VPN endpoint status; in authenticated mode, reissue an expired pairing
code on the computer. Pairing is disabled in explicit `--no-auth` mode.
Do not expose an unauthenticated Studio publicly (for example via Funnel), or
paste token URLs, QR contents or credentials into reports.
Phone, Safari/Firefox and physical Windows/Linux validation remain unverified
unless the final release notes explicitly record those checks.

## Delete selected Threads

In the sidebar, choose **Select Threads**, check the Threads you want, then
choose **Delete**. Review the exact names and IDs. Live or stopping Runs block
the entire deletion. The review also lists active scheduled executions the
owner will stop. Unselected descendants stay; archive and its descendant option
are separate actions.

Only **Delete selected Threads** sends a deletion request. If the selection or
its targets change, review the new preview and confirm again. The owner deletes
all selected Threads or none; saved list changes arrive from the owner. This
flow supports up to 256 selected Threads on the matching Core build.

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

## Protocol compatibility

Studio v0.4.1 uses Core protocol 18 and pairs only with Core v0.15.0 at the exact
revision in the [release notes](../release-v0.4.1.md). There is no protocol
downgrade or ownership alias. Check the installed versions against that pairing;
do not restart a working owner or change its data to resolve a mismatch without
explicit approval. Studio v0.1.0's protocol-5 pairing is historical.

Runs are independent: no Run owns another Run and organizational Thread parents
are not Run owners. Shell ownership remains unchanged. Studio reads bounded directional `message.list` pages and uses
`thread.get.pending_replies` for tab counts. The sender is shown from the saved
identity. Answer a duty with `message.reply` and its exact message ID. A count
marked with `+` is a lower bound. A recovery wait does not clear a duty.

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

## Open the macOS desktop app

1. Unzip the Apple silicon desktop download and double-click **Shellboy Studio.app**. If Gatekeeper blocks it, review the warning and, only for a trusted download, use **Open Anyway** in System Settings > Privacy & Security.
2. Studio opens in your default browser and signs you in locally. If Core has no connection yet, follow Connection Setup to choose the provider or proxy, paste an API key, and continue to Conversation. A Claude subscription login is not an API key. For supported presets, Studio can offer to reuse the corresponding API-key environment variable when it is available to Core.
3. Double-click the app again to reopen the running Studio in your browser. Studio shares Core's usual configuration and data directory with the TUI. It attaches to an already running owner. If Studio started its own owner, leave the TUI closed while Studio is running.
4. Use **Quit Studio** in the browser to stop Studio and request normal shutdown of the Core child it started; Studio force-terminates that child only if the shutdown request fails or it does not exit within the grace period. This leaves an owner you started separately running. Closing the browser tab does not quit Studio. A bundled owner gets one immediate automatic restart per Studio launch or manual Start after an unexpected crash. Readiness does not reset that allowance. If the restarted owner exits again, before or after ready, Studio stops retrying, shows the last failure and waits for **Restart owner**; choosing it resets the allowance. A clean exit or an initial startup failure is not retried. Diagnostic output remains in `~/Library/Application Support/shellboy-studio/owner.log`.

This desktop path is macOS-only. The CLI bridge and its explicit development `--no-auth` option are unchanged.

If a separately started owner stops, the same **Restart owner** action checks
again for a running owner before it starts one. Studio does not adopt, stop, or restart an owner it did not start.

## Share settings with a colleague

1. In **Settings > Connections > Share settings**, choose **Export file** and share the downloaded `shellboy-settings.toml` with your colleague. It contains portable connection settings (including an API-key environment variable's name, not its value), model filters and defaults. It does not include credentials, custom headers or request bodies, or local paths such as the data directory, shell executable, or guide files. Studio names any connections it left out of the export.
2. On the other installation, open **Import settings** from the first connection screen. In an existing installation, use **Settings > Connections > Share settings > Change** instead. Choose the file or drop it on the file picker.
3. Check the connection names and URLs, the same-name overwrites, and the new defaults in the preview. Choose **Apply settings**. If a same-name connection will use an existing key with new routing settings, review the old and new URL, API format, and key header, then explicitly confirm the change.
4. Enter your own API key for each connection that needs one. Shellboy saves it separately through its credentials operation. If a server intentionally needs no key, say so in the key step. Then choose **Start a conversation** in Setup. If the settings need a restart, use **Restart owner** when Studio started Core. Otherwise stop Shellboy in the terminal where it was started and run the same command again.
