# shellboy-web development guide

This file contains instructions for developing shellboy-web, the browser UI and
local bridge for [Shellboy](https://github.com/tya5/shellboy). Linked files are
not expanded automatically.

## Working baseline

- Read the [architecture](docs/design/architecture.md) first. It is the adopted
  baseline once the user approves it; until then it is a proposal. Resolve
  discrepancies between code and design in the design before changing code.
- Shellboy's adopted designs at the pinned tag are the contract for everything
  the owner does (`docs/design/protocol.md`, `docs/design/events-and-external-protocol.md`
  in the Shellboy repository). Do not infer contract from Shellboy internals,
  its database or TUI behaviour.
- Make routine decisions autonomously. Record uncertain ones, with reason,
  impact and when to revisit, in the decisions table of the architecture
  document (move to `docs/development/decisions.md` when it grows).
- English is the default for documentation, matching Shellboy.

## Boundaries

- The bridge is a thin client: no agent logic, no model calls, no direct access
  to Shellboy's database or data-directory files, no copied protocol types. Use
  `shellboy::protocol` and `shellboy::ipc` from the pinned git tag.
- The browser (data layer) talks only to the bridge; the bridge talks only to the owner's
  public RPC. If the Web needs something the RPC lacks, propose a general
  external-client surface in Shellboy instead of a workaround here. No polling
  stand-ins for missing core features.
- No agent-protocol integrations (ACP, A2A, AG-UI, product-specific adapters).
- Every queue, buffer, task and concurrency limit has a documented bound, owner
  and shutdown path. No unbounded per-client buffers.
- Security: loopback bind and token by default; LAN binding only by explicit
  configuration; stricter behaviour is an opt-out setting, not a prompt.
- Reuse Shellboy's state words (meanings) for the same concepts. The Web UI
  uses no text glyph marks; renamed states need the user's approval.
- Keep the layers separate: bridge, data layer (the tested UX boundary),
  swappable presentation, debug page. Presentation must not touch the bridge
  or data layer; layout/visual design waits for the user's brainstorm.
- Few dependencies, exact versions, committed lockfiles. Record the reason,
  bound and validation for each new dependency or toolchain change.
- Do not state wall-clock guarantees or estimated numbers (tokens, sizes,
  latencies); measure and record facts, or mark them unknown.
- Keep credentials, tokens, real conversations, Shellboy data directories and
  private logs out of Git.

## Validation and handoff

- Run checks appropriate to the change (`cargo test`, `cargo clippy`,
  `npm run check`, Playwright suite once they exist).
- Test against a real `shellboy serve` from the pinned tag with a temporary data
  directory and a local mock provider. No paid API calls, no user data.
- Distinguish environment, command, observed result and untested cases.
  Browser device emulation is not a phone test.
- Make local commits at meaningful boundaries. Push only when the user or their
  delegated reviewer approves; tags, releases and binaries need the user's
  explicit approval.
