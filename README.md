# shellboy-studio

Shellboy Studio is a browser UI for [Shellboy](https://github.com/tya5/shellboy),
the terminal coding agent. Read and send messages, inspect live work and tool
output, and organize Threads. Studio talks to the Shellboy owner over local IPC;
only the owner accesses the conversation database and runs the agent.

**Start here:** [User guide](docs/guides/user-guide.md) · [日本語](docs/guides/user-guide.md#日本語)

## Current release pairing

[Studio v0.4.1](https://github.com/tya5/shellboy-studio/releases/tag/v0.4.1)
uses Core v0.15.0 at the exact revision and protocol 18 recorded in the
[release notes](docs/release-v0.4.1.md). Upgrade them together. Before starting
the new Core, quit both programs and back up the entire Core data directory and
any config outside it. Core applies migrations on startup, through schema 62
when upgrading from v0.3.0's supported Core pairing. There is no automatic downgrade.

## Start

### Install

Download from [Releases](https://github.com/tya5/shellboy-studio/releases).
Verify the chosen archive against the published `SHA256SUMS`. Desktop ZIPs
bundle Core for [Apple silicon](#macos-desktop-zip) and [Windows x64](#windows-desktop-zip).
Separate CLI archives for macOS arm64, Windows x64, and Linux x64 embed the web UI;
install the matching Core separately for the CLI path.

### Start from a terminal

Run `shellboy serve` in one terminal (or use a running Shellboy TUI that owns the
same data directory), then run `shellboy-studio` in another. Open the printed URL
once. Its token is exchanged for a session cookie and removed from the address.
Keep the token private. The ordinary CLI bridge attaches to Core; it does not
start or supervise it. The desktop launchers handle starting Core when needed.

Use the same OS account and data directory for both programs. Studio chooses its
owner's data directory using `--data-dir DIR`, then `SHELLBOY_DATA_DIR`, then the
Core OS default. Studio's own token is stored separately in its config directory
(`--config-dir`): `~/.config/shellboy-studio` on Linux,
`~/Library/Application Support/shellboy-studio` on macOS, and
`%APPDATA%\shellboy-studio` on Windows by default.

### First run

If a model connection is missing, choose **Connect a model service**, or use
**Import settings** if you have a portable TOML file. An API key, when required,
is separate from a Claude or ChatGPT subscription. See the
[setup instructions](docs/guides/user-guide.md#connect-a-model).

## macOS desktop ZIP

On Apple silicon with macOS 14 or later, extract
`shellboy-studio-desktop-vX.Y.Z-aarch64-apple-darwin.zip` and open **Shellboy Studio.app**.
The app is unsigned and not notarized. Review any Gatekeeper warning and use
**Open Anyway** in System Settings > Privacy & Security only if you trust the download.

## Windows desktop ZIP

On Windows x64, extract the full
`shellboy-studio-desktop-vX.Y.Z-x86_64-pc-windows-msvc.zip`, keep
`Shellboy Studio.exe` and `shellboy.exe` together, and open `Shellboy Studio.exe`.
The unsigned launcher opens your default browser without a console. See the
[Windows desktop guide](docs/guides/windows-desktop.txt) for SmartScreen and startup diagnostics.

To use a TUI's existing config and data directory, give the desktop launcher Core's `--config PATH` and `--data-dir PATH` (same meaning and precedence as Core; relative paths start from the launch folder). On Windows, put them in a shortcut's Target, for example:

```text
"C:\Tools\Shellboy Studio\Shellboy Studio.exe" --config "D:\work\shellboy\config.toml" --data-dir "D:\work\shellboy\data"
```

Both desktop launchers attach to an already running owner for the selected data
folder or start the bundled Core. Open the app again to reopen Studio. Closing
the browser is not quitting: use **Quit Studio**. An independent owner is left
running. See [shutdown and restart](docs/guides/user-guide.md#stop-or-restart-the-desktop-app)
for the bundled owner's one automatic crash retry, manual **Restart owner**, and logs.

## Find your way around

- The v2 interface shares headings, buttons, links, and loading and empty
  states across views. Set Studio's display language in **Settings > Appearance > Language**.
- **Pinned** lists pinned Threads even outside the loaded **All** list.
  **Awaiting you** hides **Pinned** and is exclusive with search, tag, and directory filters.
- In **Conversation**, the right panel contains **Activity**, **Reply needed**,
  **Awaiting reply**, **Possessions** (including **Artifacts** and **Attachments**
  when supported), **Analytics**, and per-Thread **Settings**.
- Use **Select Threads**, then **Delete**, to review a permanent bulk deletion.
  Only the confirmed selection is deleted; unselected descendants remain.
- Use global **Settings > Connections > Share settings** for portable TOML
  export/import without credential values. Use global **Analytics > By Thread**
  and **Show models** for model usage in the selected period. **Effective tokens**
  are browser-weighted counts, not prices.

## Security

Studio listens on loopback (`127.0.0.1:8751`) by default and requires a token;
keep it out of screenshots and Git. Host and Origin checks are independent of
user authentication. A non-loopback HTTP bind is not TLS.

For another device, keep Studio on loopback behind a trusted private HTTPS
endpoint, allow its exact hostname with `--allow-host`, and pair using
**Settings > Studio > Open on a phone > Create QR code**. See
[Open on another device](docs/guides/user-guide.md#open-on-another-device).
Never share the printed local token URL or expose Studio through Tailscale Funnel.

Use `--no-auth` only for [explicitly trusted development](docs/guides/user-guide.md#explicit-development-authentication-opt-out).
Anyone who can reach that bridge can operate it. Pairing is disabled and an
explicitly enabled `/debug` page also lacks token/session protection in this mode.

## Studio guides

Run `shellboy-studio guide user` or `shellboy-studio guide agent` without
starting the bridge. Startup rewrites `$SHELLBOY_DATA_DIR/studio/agent-guide.md`
and the managed Apps README. **Apps** can run actions on the Studio host;
review app code and permissions before use.

## Verification and limitations

Release assets are not proof of physical-device testing. See the
[current pairing notes](docs/release-v0.4.1.md) and
[historical first-release verification](docs/first-release-verification.md).
Use the exact owner named in the current pairing; Studio does not provide a
protocol downgrade. For Branches comparison limits, see the
[design documentation](docs/design/branches-threads.md).

## Development

From source, install Node and the pinned Rust toolchain, then run:

```sh
(cd web && npm ci && npm run build)
cargo run --release -- --data-dir DIR
```

The frontend build is embedded in the bridge. Plain Vite is frontend-only.
For local development use an [isolated owner](docs/development/isolated-owner.md),
not your everyday Core data directory.

See [AGENTS.md](AGENTS.md) and [docs/design/architecture.md](docs/design/architecture.md).
Owner-free checks exclude the explicit `real-owner-tests` suite. Exact-pair CI
and the release gate build Core from its verified public-tag source, then run
the suite with that binary and `SHELLBOY_BIN` in temporary test data. This is
separate from local acceptance with the downloaded public Core release binary;
omitting the suite is not owner-integration success.

Checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`,
and in `web/`: `npm run check`.

## License

MIT. See [LICENSE](LICENSE).
