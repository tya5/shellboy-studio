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

## Layers it sits in

`web/data` (view-model and operations, no DOM) → components → screens → design system tokens. Layout variants (A conversation, B monitor, C inbox, phone) are screens over the same view-model and aren't design systems.

## Not decided

Component technology for the production UI, icon set, whether users can load a custom token file from settings, Japanese and English font pairing.
