# Design system

Status: proposal from the 2026-11-07 discussion. Direction from the user: engineer-oriented, dark console feel per the reference images; all of conversation, monitor, inbox and phone views are wanted; design systems should be defined and switchable.

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

## Not decided

Component technology for the production UI, icon set, whether users can load a custom token file from settings, Japanese and English font pairing.
