# Shellboy Studio: user guide

Shellboy Studio is a browser interface for a running Shellboy owner. Start the
owner, then run `shellboy-studio` and open the URL printed by the bridge. The URL
contains a credential: do not share it. By default the bridge listens only on
loopback; a remote bind is plain HTTP unless protected by a TLS tunnel.

## Open on a phone

Install Tailscale on both the Mac or PC running Studio and your phone, and sign
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

For the v0.1.0 candidate, use the validated matching Core release (planned:
v0.11.0). A newer Studio build is not guaranteed to negotiate missing features
with an older owner. If operations fail after a version mismatch, check both
versions and follow the release pairing instructions; do not reset data or
restart an owner that is running work without explicit approval.

If a phone cannot connect, confirm the computer's allowed hostname, tailnet
access and HTTPS Serve status; reissue an expired pairing code on the computer.
Do not use Funnel or paste token URLs, QR contents or credentials into reports.
Phone, Safari/Firefox and physical Windows/Linux validation remain unverified
unless the final release notes explicitly record those checks.
