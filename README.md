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

**Status: v0.1.0 released.** Published binaries and hosted checks are available.
See the [exact release evidence](docs/first-release-verification.md#published-v010-outcome)
and [Verification and limitations](#verification-and-limitations).

<!-- Screenshots: files do not exist yet. Add them under docs/screenshots/ and replace this list with images.
     - docs/screenshots/conversation.png   Conversation view with a tool row expanded
     - docs/screenshots/threads.png        Thread list
     - docs/screenshots/setup.png          First-run connection setup
     - docs/screenshots/phone.png          A real phone over Tailscale (do not use browser emulation)
-->
Screenshots are not bundled yet.

## Current release pairing

Studio v0.4.1 pairs with Core v0.15.0 at the exact commit and protocol 18 recorded
in the [release notes](docs/release-v0.4.1.md). Install the matching Studio and
Core together; do not pair this build with an older Core. Back up the owner data
directory before the first Core start, which applies migration 62.

The original Studio v0.1.0 release used Core v0.11.0 (protocol 5, schema 39).
See its [historical release notes](docs/release-v0.1.0.md) and
[readiness checklist](docs/development/release-v0.1.0-checklist.md).

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
  `SHA256SUMS`) are published in the [v0.1.0 release](https://github.com/tya5/shellboy-studio/releases/tag/v0.1.0).
  Verify a download with `sha256sum --check SHA256SUMS` (`shasum -a 256 -c` on macOS).
- From source, which needs Node (build time) and the pinned Rust toolchain:

  ```sh
  git clone https://github.com/tya5/shellboy-studio && cd shellboy-studio
  (cd web && npm ci && npm run build)   # the frontend is embedded by build.rs
  cargo run --release -- --data-dir DIR
  ```

  Without `npm run build` the binary still builds, but `GET /` only says how to build the frontend.

For development and visual checks, do not point Studio at your everyday owner.
Use the [isolated owner procedure](docs/development/isolated-owner.md). Plain Vite
(`npm run dev`) is frontend-only and does not proxy to a Core/Studio pair.

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
OpenAI, OpenRouter, LiteLLM, local, other) with the matching Core owner (currently v0.15.0).
Older owners are not a supported pairing; no protocol downgrade is provided.
A Claude or ChatGPT subscription is not an API key; an API key is required.

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

  For a phone, use Settings > Studio > Open on a phone to issue a one-use pairing QR code; see the [user guide](docs/guides/user-guide.md). Never share the printed local token URL.

  `tailscale serve` shares only within your tailnet and gives you HTTPS (needed for the
  PWA). **Do not use `tailscale funnel`**: it publishes the port on the public internet.
  An SSH tunnel (`ssh -L 8751:127.0.0.1:8751 host`) also works.
- Binding to a non-loopback address with `--listen` is possible but is plain HTTP; Studio
  warns, and authentication remains required unless explicitly disabled with `--no-auth`.
- Optional `--no-auth` is included in v0.1.0 for explicitly trusted local or tailnet-only
  Serve access. Default authentication is unchanged. Host/Origin checks remain, but
  anyone who can reach the bridge (including local processes and shared-tailnet users)
  can operate it. Never use Funnel; Studio does not detect or guarantee Serve/Funnel
  configuration. See the [opt-out restrictions](docs/guides/user-guide.md#explicit-development-authentication-opt-out).
- Studio is a thin client: no model calls, no direct access to Shellboy's data files.
  It forwards only an allowlist of owner operations.

## Version pairing with Shellboy

Studio releases are built against one Shellboy release and speak its protocol.
This build (Studio 0.4.1) binds Core v0.15.0 (protocol 18) at the exact commit in
Cargo.toml and Cargo.lock. See the [0.4.1 release notes](docs/release-v0.4.1.md)
for the pairing and validation plan. Studio v0.2.4 was paired
with Core v0.11.2 and Studio v0.1.0 with Core v0.11.0. For v0.1.0, hosted
exact-pair checks and distribution builds passed for the published release; see
the [release evidence](docs/first-release-verification.md#published-v010-outcome). See the [validation record](docs/development/protocol5-validation.md)
for the tested environment and limits, and the [release checklist](docs/development/release-v0.1.0-checklist.md)
for historical preparation checkpoints and the published outcome.
Pair the final release exactly with the owner named in its release notes.
Capabilities currently describe the bridge build, not negotiated owner support.
Automatic protocol-mismatch guidance or read-only fallback on older owners is
not guaranteed. Older-owner behavior is unverified until measured; do not use
it as a supported pairing or infer data safety from missing UI controls.

## Verification and limitations

See [First-release verification](docs/first-release-verification.md) for the tested
environments and known gaps, including the distinction between browser emulation and a
physical phone. Published CI and archive evidence is recorded separately from
historical preparation and unverified device/browser coverage.

## Development

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

## Studio guides

Read `shellboy-studio guide user` or `shellboy-studio guide agent` without
starting the bridge. At startup Studio installs the agent guide in
`$SHELLBOY_DATA_DIR/studio/agent-guide.md`; it is overwritten on each start.
The Apps library offers prompt drafts for creating apps and an AGENTS.md guidance line.
Apps reside in the owner data directory by default; the gateway writes their README.
Apps can run actions on the Studio host, so review their code and permissions.

## Protocol compatibility

Studio v0.4.1 uses Core protocol 18 and is supported only with its exact Core
v0.15.0 pairing. There is no protocol downgrade or ownership alias. Check both
installed versions against the [release notes](docs/release-v0.4.1.md) before
replacing binaries. Older Studio v0.1.0 followed protocol 5; that is historical,
not the current pairing.
Never restart a working owner or change its data to resolve a mismatch without
explicit approval.

Runs are independent: no Run owns another Run and organizational Thread parents
are not Run owners. Shell ownership remains unchanged. Pending reply duties come from bounded `message.list` pages (`owed_by`,
`asked_by`, or `to: "human"`). `thread.get.pending_replies` reports only direction
counts. Studio displays the saved sender and answers eligible duties with
`message.reply` using the original message ID. A recovery wait is not evidence
that a duty disappeared.

### Limited branch comparison (source candidate)

The Branches view adds recorded creation kind (`fork`, `rewind`, otherwise
`unknown`) and a separate selection of at most two tips. Only direct parent/child
or same-parent/same-divergence candidates are offered; the same anchor must be
verified on both paths, with each side's own ordinal and revision. This does not
prove an exact LCA, equality of all preceding context, or a complete diff.
Unsupported or truncated families stay unavailable; normal tip navigation remains.

Usage is explicitly scoped to each Thread from the anchor's saved timestamp
inclusive to one displayed shared `until` exclusive. It is recorded usage, not
ordinal-exclusive tail cost, money, refunds or causal savings. Shared-prefix
parent/child totals are not summed or subtracted. Missing/unsafe/overflow counters
and summary coverage remain unknown/partial. Grouped intervals over 31 days are
unavailable; explicit shorter-period selection is not implemented. There is no
silent clipping, timestamp epsilon or all-time fallback.

Reads use the existing owner-free-testable data boundary: aggregate concurrency
two across history/body/usage, one in flight per side; four initial window calls,
50-row pages and four cached pages per side, one expanded node with at most two
16 KiB body responses, and at most four usage responses per side per explicit
refresh. Hints only mark stale and never refill budgets; route/owner/pair/page
changes cancel reads and reject late results. Compare selection does not mutate
archive/rewind/fork selection or receipt slots. Arbitrary-pair exact divergence,
full-history comparison and arbitrary-age exclusive monetary cost remain unsupported.
This source addition does not replace already-published v0.1.0 archives.

## macOS desktop ZIP

On Apple silicon with macOS 14 or later, unzip `shellboy-studio-desktop-vX.Y.Z-aarch64-apple-darwin.zip` and open **Shellboy Studio.app**. The app is unsigned and not notarized. If Gatekeeper blocks it, review the warning and use **Open Anyway** in System Settings > Privacy & Security only if you trust the download. See the [user guide](docs/guides/user-guide.md) for setup and shutdown.

The existing CLI archives remain available. A desktop candidate ZIP names both exact commits; it is for testing and is not a release. The release desktop ZIP requires an already published Core release matching Studio's pin. CI only builds and checks the desktop ZIP; the user handles release publication.

## Windows desktop ZIP

On Windows x64, extract the entire `shellboy-studio-desktop-vX.Y.Z-x86_64-pc-windows-msvc.zip`, keep `Shellboy Studio.exe` and `shellboy.exe` together, and double-click `Shellboy Studio.exe` to open the default browser without a console. The launcher is unsigned. The bundled [Windows guide](docs/guides/windows-desktop.txt) covers SmartScreen, reopening, Exit, and startup diagnostics.

The separate console CLI remains available. A desktop candidate ZIP names both exact commits; it is for testing and is not a release. The release desktop ZIP requires an already published Core release matching Studio's pin. See the release notes for which desktop packages were checked on real devices and what those checks covered.

To use a TUI's existing config and data directory, give the desktop launcher Core's `--config PATH` and `--data-dir PATH` (same meaning and precedence as Core; relative paths start from the launch folder). On Windows, put them in a shortcut's Target, for example:

```text
"C:\Tools\Shellboy Studio\Shellboy Studio.exe" --config "D:\work\shellboy\config.toml" --data-dir "D:\work\shellboy\data"
```

Studio attaches to a TUI owner already running on that data directory, or starts the bundled Core with both paths. Only one Studio runs per user: if it is already running with a different data directory, the launcher shows both paths and exits; use Exit in the running Studio first.
