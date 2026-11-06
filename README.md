# shellboy-web

A browser UI for [Shellboy](https://github.com/tya5/shellboy), the terminal
coding agent. It aims to be a better place than the TUI to read and drive a
conversation (rendered Markdown and code, collapsible tool output, live
progress, Thread list) and to make Shellboy usable from a phone.

## Status

**Design stage. Not usable yet.** There is no code. The proposed design is in
[docs/design/architecture.md](docs/design/architecture.md). The first milestone
depends on Shellboy features that are designed but not implemented yet
(change notification `events.wait`, Shellboy #243; external RPC contract with
capabilities and JSON Schema export, Shellboy #244).

## How it relates to Shellboy

- Shellboy's owner process remains the only place with agent logic and saved
  conversations. shellboy-web does not access Shellboy's database.
- shellboy-web is a small Rust bridge on the same machine as the owner. It
  talks to the owner over Shellboy's existing local IPC RPC, like
  `shellboy chat`, and serves the TypeScript frontend over HTTP and WebSocket.
- It listens on localhost and requires a token by default. For phone or remote
  access, put it behind Tailscale (`tailscale serve`) or an SSH tunnel; LAN
  binding is available only when explicitly configured.
- It has its own release cadence. Each release states which Shellboy release
  (protocol version) it works with.

## License

MIT. See [LICENSE](LICENSE).
