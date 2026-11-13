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

## v0.1.0

Release pairing: published Core v0.11.0, pinned to its official tag
and locked source commit (protocol 5, schema 39). Studio v0.1.0 is published. Older-owner feature negotiation is
not guaranteed; use only the validated matching owner. Existing artifact targets
remain Windows x86_64, macOS arm64 and Linux x86_64, not new physical-device
support claims. See [release notes](docs/release-v0.1.0.md) and the
[release readiness checklist](docs/development/release-v0.1.0-checklist.md).

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
OpenAI, OpenRouter, LiteLLM, local, other) with the matching Core owner (currently v0.13.0).
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
This tree (Studio 0.2.6) pins **Shellboy v0.13.0 (protocol 5, conversation schema 44)**
in `Cargo.toml` and `Cargo.lock`; see the [0.2.6 release notes](docs/release-v0.2.6.md)
for the pairing and the schema 42 to 43 upgrade note. Studio v0.2.4 was paired
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

## Protocol 5 compatibility

Studio v0.1.0 follows Core's protocol 5 / schema 39 contract (#276).
There is no protocol-4 downgrade or ownership alias. Use the exact validated
Core release pair; the published Core tag, lockfile and installed binaries must
be checked separately when installing or replacing binaries. The current manifest/lock establish the
public v0.13.0 pin; earlier preparation checkpoints alone did not.
Never restart a working owner or change its data to resolve a mismatch without
explicit approval.

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
