# shellboy-studio

A browser UI for [Shellboy](https://github.com/tya5/shellboy), the terminal coding agent.
It is a small local program that sits next to a running Shellboy and lets you read and
drive your conversations in a browser: rendered Markdown and code, collapsible tool
output, live progress, Thread organization and responsive layouts. Monitor supports list and tile
views; Apps provide a local library, named tabs and prompt templates. Analytics, settings,
branches, search and inbox views are also available, subject to owner capabilities.

Shellboy's owner process stays the only place with agent logic and saved conversations.
Studio never reads Shellboy's database; it talks to the owner over Shellboy's local IPC
RPC, the same way `shellboy chat` does.

**Status: first version, not yet released.** No binary has been published and nothing
here has run on GitHub CI yet. See [Verification and limitations](#verification-and-limitations).

<!-- Screenshots: files do not exist yet. Add them under docs/screenshots/ and replace this list with images.
     - docs/screenshots/conversation.png   Conversation view with a tool row expanded
     - docs/screenshots/threads.png        Thread list
     - docs/screenshots/setup.png          First-run connection setup
     - docs/screenshots/phone.png          A real phone over Tailscale (do not use browser emulation)
-->
Screenshots are not bundled yet.

## Start

You need a running Shellboy owner first, then Studio:

```sh
shellboy serve &        # the owner (a Shellboy TUI that owns the data directory also works)
shellboy-studio         # prints:  open http://127.0.0.1:8751/#token=...
```

Open the printed address once. The token in the address is exchanged for a session
cookie and removed from the page. Add `--debug` to also enable the separate `/debug` page
(off by default).

This is two commands, not one. The intended one-command form (Studio starts the owner
itself, acts as the `shellboy` CLI, and opens the browser) is a later step, designed in
[docs/design/architecture.md](docs/design/architecture.md) section 10.1 and **not
implemented**. While Studio or `shellboy serve` owns a data directory, the Shellboy TUI
cannot run on that directory, because the TUI is itself an owner today.

### Install

- Release binaries (one `shellboy-studio` per OS/CPU, frontend embedded, with
  `SHA256SUMS`) are what the release workflow will produce. **None are published yet.**
  Verify a download with `sha256sum --check SHA256SUMS` (`shasum -a 256 -c` on macOS).
- From source, which needs Node (build time) and the pinned Rust toolchain:

  ```sh
  git clone https://github.com/tya5/shellboy-studio && cd shellboy-studio
  (cd web && npm ci && npm run build)   # the frontend is embedded by build.rs
  cargo run --release -- --data-dir DIR
  ```

  Without `npm run build` the binary still builds, but `GET /` only says how to build the frontend.

## Connecting to an owner

Studio finds the owner from the Shellboy **data directory**: `--data-dir DIR`, else
`SHELLBOY_DATA_DIR`, else Shellboy's OS default. Use the same directory the owner uses.
Studio keeps its own token in its own config directory (`--config-dir`; by default
`~/.config/shellboy-studio` on Linux, `~/Library/Application Support/shellboy-studio` on
macOS, `%APPDATA%\shellboy-studio` on Windows), never in the data directory.

If the owner is missing, Studio starts anyway, says so on the terminal, and keeps
retrying; the page shows "Shellboy isn't reachable" until an owner appears.
Run Studio and the owner as the same OS user.

If no model connection exists yet, Studio can set one up from the browser (Anthropic,
OpenAI, OpenRouter, LiteLLM, local, other). That needs a Shellboy newer than v0.10.0;
on v0.10.0 the screen lists the manual steps instead. A Claude or ChatGPT subscription
is not an API key; an API key is required.

## Security

- Studio listens on **loopback only** (`127.0.0.1:8751`) by default and requires a
  **token**: 256 random bits in a file in the config directory (mode 0600 on Unix).
  Anyone who has the token has your Shellboy session; keep it out of screenshots and Git.
- Requests with an unexpected `Host` or `Origin` are refused (DNS rebinding and
  cross-site WebSocket protection).
- For a phone or another machine, use [Tailscale](https://tailscale.com):

  ```sh
  shellboy-studio --allow-host YOUR-MACHINE.TAILNET.ts.net
  tailscale serve --bg 8751
  ```

  `tailscale serve` shares only within your tailnet and gives you HTTPS (needed for the
  PWA). **Do not use `tailscale funnel`**: it publishes the port on the public internet.
  An SSH tunnel (`ssh -L 8751:127.0.0.1:8751 host`) also works.
- Binding to a non-loopback address with `--listen` is possible but is plain HTTP; Studio
  warns, and the token is still required.
- Studio is a thin client: no model calls, no direct access to Shellboy's data files.
  It forwards only an allowlist of owner operations.

## Version pairing with Shellboy

Studio releases are built against one Shellboy release and speak its protocol.
This tree is built against **Shellboy v0.10.0 (protocol 2)**, pinned in `Cargo.toml`.
Until Shellboy's protocol 3, pair releases exactly. If the owner speaks another protocol,
Studio says so on start and asks you to install the paired Shellboy. Screens that need
operations newer than v0.10.0 (editing `config.toml`, connection setup) say so and
stay read-only. A release's notes will name the exact Shellboy tag.

## Verification and limitations

See [First-release verification](docs/first-release-verification.md) for the tested
environments and known gaps, including the distinction between browser emulation and a
physical phone. No CI run or release binaries are claimed by this tree.

## Development

See [AGENTS.md](AGENTS.md) and [docs/design/architecture.md](docs/design/architecture.md).
Checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`,
and in `web/`: `npm run check`.

## License

MIT. See [LICENSE](LICENSE).

## Studio guides

Read `shellboy-studio guide user` or `shellboy-studio guide agent` without
starting the bridge. At startup Studio installs the agent guide in
`$SHELLBOY_DATA_DIR/studio/agent-guide.md`; it is overwritten on each start.
The Apps library offers prompt drafts for creating apps and an AGENTS.md guidance line.
Apps reside in the owner data directory by default; the gateway writes their README.
Apps can run actions on the Studio host, so review their code and permissions.
