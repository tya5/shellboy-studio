# shellboy-studio

A browser UI for [Shellboy](https://github.com/tya5/shellboy), the terminal
coding agent. It aims to be a better place than the TUI to read and drive a
conversation (rendered Markdown and code, collapsible tool output, live
progress, Thread list) and to make Shellboy usable from a phone.

## Status

**First version, local only.** The Rust bridge, the `--debug` page, the TypeScript data layer
(`web/data`, [docs/design/data-layer.md](docs/design/data-layer.md)), shared screen logic
(`web/ui-core`) and the first design (`web/designs/console`,
[docs/design/design-system.md](docs/design/design-system.md)) exist. To run it: `npm ci && npm run build`
in `web/`, then `cargo run -- --data-dir DIR` with an owner on that directory
([docs/design/bridge.md](docs/design/bridge.md)). The design is in
[docs/design/architecture.md](docs/design/architecture.md). The first milestone
depends on Shellboy features that are designed but not implemented yet
(change notification `events.wait`, Shellboy #243; external RPC contract with
capabilities and JSON Schema export, Shellboy #244).

## How it relates to Shellboy

- Shellboy's owner process remains the only place with agent logic and saved
  conversations. shellboy-studio does not access Shellboy's database.
- shellboy-studio is a small Rust bridge on the same machine as the owner. It
  talks to the owner over Shellboy's existing local IPC RPC, like
  `shellboy chat`, and serves the TypeScript frontend over HTTP and WebSocket. The frontend is
  layered: a tested data layer, a swappable presentation, and an opt-in debug
  page. A desktop app (Tauri) is a possible later step.
- It listens on localhost and requires a token by default. For phone or remote
  access, put it behind Tailscale (`tailscale serve`) or an SSH tunnel; LAN
  binding is available only when explicitly configured.
- It has its own release cadence. Each release states which Shellboy release
  (protocol version) it works with.

## License

MIT. See [LICENSE](LICENSE).

## Planned usage (not usable yet)

During development (M1) the owner and the bridge are started separately, as below.
The release target is one `shellboy-studio` binary and one command: it connects to a
running owner if there is one, otherwise starts the owner in-process (Shellboy's
headless `serve` as a library), doubles as the `shellboy` CLI when called with
arguments (multicall, so model shells find `shellboy`), and opens the browser.
Using the TUI at the same time needs the TUI to attach to an existing owner, which
Shellboy does not support yet (tracked as a Shellboy issue).

```sh
shellboy serve &      # an owner must already run (a TUI owner also works)
shellboy-studio          # prints http://127.0.0.1:8751/#token=…; open it once
shellboy-studio --debug  # also enables the separate /debug page (off by default)
```

- The bridge connects to a running owner only; if none runs it says to start `shellboy serve`.
- It listens on localhost by default. For a phone, expose it privately with
  `tailscale serve` (HTTPS, needed for the PWA) or an SSH tunnel; LAN binding needs
  an explicit setting and warns.
- Config and the token live in the OS config directory, separate from Shellboy's data directory.
- A future desktop app bundles owner, bridge, UI and CLI into one binary, so none of
  the above is needed there (see `docs/design/architecture.md` §11).
