# Design system

Status: adopted and implemented for the first design, `web/designs/console/` (2026-11-07), local only. Direction from the user: engineer-oriented, dark console feel per the reference images; all of conversation, monitor, inbox and phone views are wanted; design systems should be defined and switchable.

## Principle

A design system is data the presentation layer reads. Switching one never touches the data layer (`web/data`) or changes behaviour. A component names a role, never a colour, size or font.

## Three levels

| Level | Example | Who may use it |
|---|---|---|
| Primitive | `navy-900`, `cyan-400` | Only the design system's own token file |
| Semantic | `--bg`, `--panel`, `--fg`, `--muted`, `--accent`, `--ok`, `--wait`, `--bad`, `--mono`, `--radius` | Components |
| Component | status mark, card, step row, question card, region | Screens |

## What a design system defines

- Colour roles, including surfaces per state (`--need-bg`, `--err-bg`) and text on filled colours (`--on-accent`, `--on-wait`)
- Type: sans, mono, type scale
- Shape and density: radius, spacing scale, row height
- Motion, honouring `prefers-reduced-motion`
- Status vocabulary: one mark per state, differing in shape as well as colour; no text glyphs

State meaning is fixed across systems: running, waiting for a person, recovery wait, completed. A system may restyle a state, not merge or rename one.

## Switching

- A root attribute selects the system: `data-ds="console"`. No rebuild or reload.
- A system ships as one token file, so a site can add its own, for example a company palette, without changing components.
- The choice is a per-browser preference in local storage. It isn't stored in the owner.
- Every system must pass the same checks: text contrast of 4.5:1, states distinct without colour, phone width. A contract test lists required tokens and fails if one is missing.
- Light and dark are separate systems, or modes within one: to be decided when a second real system is adopted.

## Keeping several designs side by side

User requirement (2026-11-07): after building one design, it must be possible to start another without removing the first, and reuse what can be shared.

| Layer | Path (proposed) | Contents | Shared by designs |
|---|---|---|---|
| Data | `web/data` | View-model, operations, reconnect, previews | Always |
| Screen logic | `web/ui-core` | No DOM or style: grouping Threads by state, status meaning, labels and translations, time and token formatting, keyboard commands, reply and cancel flows | Always |
| Parts | `web/ui-parts` | Optional unstyled parts with behaviour only: log viewer, virtual list, composer, Markdown rendering | Opt in per part |
| Design | `web/designs/<name>/` | Tokens, styled components, screens, layout | Never shared; each design owns its folder |

Rules:

- Dependencies point one way: `designs/*` may import from `ui-parts`, `ui-core` and `data`. Nothing imports from a design, and designs don't import each other. A part wanted by a second design moves down to `ui-parts` first.
- A new look comes in two sizes. Same structure with new colours or type: add a token file. New structure: add a `designs/<name>/` folder and reuse `ui-core` and any `ui-parts`.
- Starting from an existing design is a folder copy; it diverges freely, and the old one keeps working.
- Each design has a small manifest (`name`, `title`, entry) in one registry. The bridge serves all designs and the browser selects one by preference, so an old design stays one click away. Removing a design is deleting its folder and registry line.
- Tests live at the lowest layer that owns the behaviour, so a new design inherits them. Each design only needs a smoke test on the shared fixture view-model plus the token contract test. A design that has rotted can't break others.
- Bundle size: load only the selected design, by dynamic import.

Limit: this costs some discipline, and a shared `ui-core` change can affect all designs. Keep `ui-core` free of visual assumptions, such as row counts or colours.

## Layers it sits in

`web/data` → `web/ui-core` → optional `web/ui-parts` → `web/designs/<name>/`. Layout variants (A conversation, B monitor, C inbox, phone) are screens within a design and aren't design systems.

## Decided (user, 2026-11-07)

- Keep Console (default), Light and Terminal as the first systems. Light must keep text at readable contrast.
- Default UI language is English; Japanese stays available as in the TUI.
- The app opens on Conversation.

- Build the design system first and every screen on it, so new pages inherit the same taste. Screens use only the system's tokens and components; a screen that needs something new adds it to the system first, with a usage note. A test enforces this.

## The Console design

`web/designs/console/system/` is the system, taken from the design system reference built from the approved mock; its `README.md` lists the contents and where it differs. `web/designs/registry.ts` is the one registry; `web/app/main.ts` is the entry point, which holds the token exchange, preferences and the fragment route.

| Decision | Reason | Revisit when |
|---|---|---|
| Preact 10.29.8, `@preact/signals` 2.11.3, Vite 8.3.5 (exact, older than two weeks on 2026-11-07), as in `architecture.md` §7.2. Preact 10, not the newer 11 | small, familiar, signals update only what reads them; the data layer already uses the same signal core. Preact 11 is a month-old major | Preact 11 has settled |
| `markdown-it` 15.0.3 with `html: false`, in a chunk of its own loaded when a message first renders, inside the design. Text shows unformatted until then | model text can't inject markup; the chunk is the largest and isn't needed for the first paint. It stays in the design until a second design wants it (then `web/ui-parts`) | a second design |
| No `highlight.js` yet, though `architecture.md` lists it. Code blocks have a copy button and no colouring | not in the approved mock, and it would add size for something nobody has asked to see | syntax colour is wanted |
| `happy-dom` 21.0.4 (dev only) for the smoke tests, no `@types/node`; the two node-based test files are excluded from `tsc` | real components and events without a browser; one less dependency | those tests need types |
| No web font at runtime. System stacks that name Inter, Noto Sans JP and JetBrains Mono first | the bridge must work with no external host, and bundling the faces costs more than the rest of the app together. Text differs slightly by machine from the mock | a bundled face is measured and wanted |
| Light and dark are separate systems, not modes of one | Console and Light differ in more than a mode flag would express cleanly, and one attribute selects either | a system needs both |
| Icons drawn inline as line icons from the mock. No icon package | a package is a dependency for about twenty paths | many more icons are needed |
| Status marks: four from the reference (`run`, `wait`, `bad`, `ok`) plus `hold`, `fail`, `halt`, `idle` (uncertain; the reference says not to add states) | the owner reports waiting, failed, stopped and idle as distinct states. Merging them would change their meaning, and showing them with no mark would be worse. `awaiting` comes only from the pending adapter, never from the owner's `waiting` | the user reviews these marks |
| Execution details hide below a 1180px frame, earlier than the reference's 900px | a 340px panel leaves too little for the conversation with the 260px sidebar | a real layout need |
| On phone width the thread list is a drawer from a menu button in the top bar, which the mock doesn't show | a phone needs a way to change Thread and create one | the user wants another path |
| Archive needs a second press | the UI has no unarchive yet (`thread.unarchive` is denied) | unarchive exists |

## Console layout rules

The Console system's `web/designs/console/system/README.md` is the component-level contract. Use `space-4` for tightly coupled content, `space-8` for rows and compact insets, `space-12` for component interiors and related groups, `space-16` for card interiors and section separation, and `space-24` for the desktop page perimeter (phone: `space-12`). Use the existing control and touch heights, and the title, heading, body, label, caption, code and log type roles. Align headings, sections and cards at a shared left edge. Cards contain distinct subjects; lines separate repeated rows. Hover uses `raised`, selection `accent-bg`, focus the accent outline, and disabled controls reduced opacity. Preserve semantic status marks and words. Conversation tool group layout follows the same rules; changes to that group belong to its worker.

## Validation record (2026-11-07)

Environment: macOS (Darwin 25.3, arm64), Node 25.9, Google Chrome headless driven over its DevTools protocol by a throwaway script (no browser tooling installed), bridge debug build embedding the production bundle, `shellboy serve` from Shellboy `fa7bec02c0` with temporary HOME and data directory and a local mock provider. No real API call.

`npm run check` (typecheck plus Vitest) and `cargo clippy --all-targets -- -D warnings`, `cargo test` pass. In the browser, against the real bridge at `/`: token exchange and fragment removal; Thread list, Conversation with Markdown, command steps with exit code and output, details panel, usage and input size from `thread.get`; sending from the composer (recorded as a person), Stop on a running Run, Retry from Monitor, Archive with two presses, New; a 100-message Thread opening at its end with Show earlier messages; a message from the CLI arriving by hint without reload; theme and language switching without reload and kept after a reload; owner down and back; a restarted bridge asking for the token, refusing a wrong one, accepting the right one; no request leaving the bridge's origin. Widths of 1440, 1000 and 390 px checked by computed style and screenshots.

Browser device emulation is not a phone test. Not tested: real phones, Safari, Firefox, Windows, Linux, a real provider, real compaction, live text (not on Shellboy main), real `message ask`.

## Not decided

Whether users can load a custom token file from settings.
