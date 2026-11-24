# Shellboy Studio

Keep working with [Shellboy](https://github.com/tya5/shellboy), the terminal coding agent, from a browser. Send messages, see what the agent is doing, inspect tool output, and pick up a conversation from a paired phone. Shellboy Core still runs the agent and owns its data; Studio is the interface.

**Published pairing:** [Studio v0.4.1](https://github.com/tya5/shellboy-studio/releases/tag/v0.4.1) + [Core v0.15.0](https://github.com/tya5/shellboy/releases/tag/v0.15.0), protocol 18 ([exact revision](docs/release-v0.4.1.md)).

[Start](#start) · [What you can do](#what-you-can-do) · [User guide](docs/guides/user-guide.md) · [日本語](docs/guides/user-guide.md#日本語)

![Studio Conversation with a Thread sidebar, running shell commands in Activity, and a message composer](docs/images/studio-conversation.png)

*Development build with synthetic data. See the [phone view](docs/images/studio-phone.png).*

## Start

Download the matching archive from [Releases](https://github.com/tya5/shellboy-studio/releases) and verify it against `SHA256SUMS`. If upgrading, [back up before starting the new Core](#upgrading-and-limits).

### Terminal (macOS arm64, Windows x64, Linux x64)

1. Install the Studio CLI and the matching Core separately.
2. Run `shellboy serve`, or use a running Shellboy TUI that already owns the same data directory.
3. Run `shellboy-studio` in another terminal and open the printed URL. Keep its token private.

### macOS desktop ZIP

1. On Apple silicon with macOS 14 or later, download and extract the `aarch64-apple-darwin` desktop ZIP. It includes Core.
2. Open **Shellboy Studio.app**. The app is unsigned and not notarized; use **Open Anyway** in **System Settings > Privacy & Security** only if you trust the verified download.
3. Continue in the browser that opens. The launcher attaches to Core or starts the bundled copy.

### Windows desktop ZIP

1. On Windows x64, download and extract the full `x86_64-pc-windows-msvc` desktop ZIP. Keep `Shellboy Studio.exe` and `shellboy.exe` together.
2. Open `Shellboy Studio.exe`. On a company PC, ask IT if either executable is blocked; do not bypass SmartScreen, Defender, or application-control policy.
3. Continue in your default browser. If it does not open, see the [Windows desktop guide](docs/guides/windows-desktop.txt) for startup logs and company-PC checks.

On first run, choose **Connect a model service**, or **Import settings** if you have a portable TOML file. An API key, when required, is separate from a Claude or ChatGPT subscription. See [Connect a model](docs/guides/user-guide.md#connect-a-model).

## What you can do

- **Follow work and reply.** Open a Thread in **Conversation**, expand tool output, or use **Awaiting you** to find requests directed to you. The sidebar has **Pinned** and **All**. On current `main`, **Archived** sits below **All**, and Thread management is in the sidebar instead of separate **Monitor** and **Threads** screens.
- **Use a phone.** Pair over private HTTPS using **Settings > Studio > Open on a phone > Create QR code**. See [Open on another device](docs/guides/user-guide.md#open-on-another-device).
- **Understand usage.** In **Analytics > By Thread**, compare recorded token usage over a selected period. Effective tokens are weighted counts, not prices or a provider bill. Incomplete data is not zero.
- **Manage Core on current `main`.** **Settings > Core** shows its state and **Running now**; the desktop launcher can start, stop, or restart the Core it manages. Studio does not restart an independently started Core.
- **Schedules and services are in development.** [Activity controls for existing definitions](https://github.com/tya5/shellboy-studio/issues/131) are not part of the published v0.4.1 pairing. Creating or editing definitions is outside that work.

## Upgrading and limits

- Quit both programs and back up the entire Core data directory and any config outside it before starting a newer Core. Core applies migrations on startup; Studio does not downgrade the protocol or undo migrations. Use the exact release pairing. Development builds may use a different Core pin; the [next release notes](docs/release-v0.4.2.md) are a draft, not install instructions.
- Use the same OS account and Core data directory. With a custom directory, pass `--data-dir DIR` to Studio or set `SHELLBOY_DATA_DIR`. The CLI attaches to Core and does not supervise it. For desktop launch arguments, see the [user guide](docs/guides/user-guide.md#install-and-open-studio) and [Windows shortcut examples](docs/guides/windows-desktop.txt).
- Closing the browser does not stop the desktop launcher. Use **Quit Studio**; an independently started owner is left running. See [Stop or restart the desktop app](docs/guides/user-guide.md#stop-or-restart-the-desktop-app).
- A downloadable archive is not proof of physical-device or company sign-in testing. See the [release notes](docs/release-v0.4.1.md) and [historical verification](docs/first-release-verification.md).

## Security and guides

Studio binds to loopback (`127.0.0.1:8751`) by default and requires authentication. Keep the printed token URL and pairing QR code private. For phone access, keep the bridge on loopback behind a trusted private HTTPS endpoint, allow its exact hostname with `--allow-host HOSTNAME`, and never use Tailscale Funnel. A non-loopback HTTP bind is not TLS. Use `--no-auth` only in [explicitly trusted development](docs/guides/user-guide.md#explicit-development-authentication-opt-out); anyone who reaches that bridge can operate it.

- [User guide](docs/guides/user-guide.md) and [日本語](docs/guides/user-guide.md#日本語): setup, keyboard use, phone pairing, and troubleshooting.
- [Windows desktop guide](docs/guides/windows-desktop.txt): unsigned ZIPs, company-PC policy, and startup diagnostics.
- `shellboy-studio guide user` and `shellboy-studio guide agent` print the guides without starting the bridge. Startup rewrites `$SHELLBOY_DATA_DIR/studio/agent-guide.md` and the managed Apps README. **Apps** can run actions on the Studio host; review their code and permissions first.

## Development

Install Node and the pinned Rust toolchain. Build the frontend before running Studio with an [isolated owner](docs/development/isolated-owner.md), not your everyday data directory:

```sh
(cd web && npm ci && npm run build)
cargo run --release -- --data-dir DIR
```

The bridge embeds the built frontend; plain Vite runs only the frontend. See [AGENTS.md](AGENTS.md) and the [architecture](docs/design/architecture.md). Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` from the root, and `npm run check` from `web/`. The explicit `real-owner-tests` suite uses the exact paired Core and temporary data in CI; owner-free checks are not integration evidence.

MIT. See [LICENSE](LICENSE).
