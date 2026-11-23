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

Thread marks use five shared categories: running, awaiting a person, error, waiting, and no action needed. Shell exit facts and active conversation footer wording remain separate from this visual grouping. The idle Thread category uses only an empty ring, named No activity for accessibility and tooltips. A theme does not change these meanings.

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
| Thread marks (#83): running arc, awaiting question, error exclamation, waiting ring with center dot, and empty ring for no action needed | Thread recovery and failure share a mark; completed, stopped and idle share an empty ring, with existing unread emphasis for new results. Awaiting comes from the pending adapter, not owner waiting. Shells share the running arc, but preserve the distinct completed and failed exit facts. The footer shares the textless idle mark; active wording and owner facts stay unmerged | when the approved vocabulary changes |
| Execution details hide below a 1180px frame, earlier than the reference's 900px | a 340px panel leaves too little for the conversation with the 260px sidebar | a real layout need |
| On phone width the thread list is a drawer from a menu button in the top bar, which the mock doesn't show | a phone needs a way to change Thread and create one | the user wants another path |
| Archive needs a second press | the UI has no unarchive yet (`thread.unarchive` is denied) | unarchive exists |

## 部品の選び方

1. 新しい形を考える前に、誰が、どの画面で、何をしようとしているかを言葉にする。たとえば、設定を変えるための画面と、ふだんは既定のままで値を読む画面とでは、必要な操作の見せ方が違う。
2. 既存の部品で足りるかを先に確かめる。足りなければ、似たツールの同じ場面と、設計の決まり（デザインシステムやアクセシビリティのパターンなど）を調べ、どの判断を何に基づいて選んだかを出典へのリンクとともに残す。記録で確認できない出典は推測しない。
3. 同じ役目の部品で、場面によって適した形が違うなら、別部品を増やさず一つの部品の型（variant）にする。各型をどの場面で選ぶかを部品の README に書く。見た目が変わる新しい形には、これまでどおり見本と利用者の承認が必要。

各部品の README の先頭に、`Use for:` / `Do not use for:`（代わりに使う部品）/ `Why:` / `Source:`（リンク）の順で短く書く。既存の振る舞い、レイアウト、出典の詳細はその下に残す。出典が確認できなければ「出典なし（この Studio で決めた）」とする。

## Design system v2 (#97, user approval 2026-11-23)

The user approved the v2 sheet (version 2) after an audit of the running app found 71 rule violations and 17 missing patterns. The rules below are the decisions; the Console contract that carries them, with tokens per rule, is `web/designs/console/system/README.md` § "Design system v2 rules", and each component README names its use in the `Use for` / `Do not use for` / `Why` / `Source` form.

- **Common rules.** Spacing roles `space-4` (tight), `space-8` (rows, between controls), `space-12` (component insets, related groups), `space-16` (cards, distinct sections, between two groups of choices), `space-24` (desktop perimeter; `space-12` at phone width). Type roles title, heading, body, label (controls, rows, field names), caption (metadata, group labels), code and log. Heights `size-control`, `size-touch`, `size-header`, `size-chip-height`, `size-row-action`. No raw pixel values outside the token files except `0`, `1px` hairlines, the `2px` focus ring and the container-query breakpoints; `npm run check` enforces this with an allowlist of the current offenders that only shrinks.
- **Action strength (操作の強さ).** Six strengths: primary (filled, one per region), ghost (no border; most actions and every icon-only button), outline (border; only a secondary action beside a primary), text link (navigation only), segmented (one choice out of a few; ButtonGroup), bordered chip (tags and removable tokens only). In one region only the primary and the outline beside it have a box.
- **Structure levels (構造の見せ方).** Page title → section heading → group label or band → content row. Each level differs in type, colour, spacing, icon, surface and interaction, and never borrows another level's look: only content rows carry icons and hover; a band is a group label on an `inset` surface between two lines; one page title per page.
- **Group labels.** `type-caption` 500 `muted`, no icon, no surface, not clickable, uppercase with the new `letter-caps` token in an English UI. A collapsing group is a ThreadGroup band; the earlier sidebar band look (raised, label 600, a pin mark for Pinned, mock v8) is replaced.
- **Composer controls in one row.** Model (ghost) and hint at the start; ContextRing, Stop and Send at the end, Send always last. Hint, then model name truncate; nothing wraps. Long running status goes above the composer, attachments above the text.
- **Icons and labels.** One inline-flex row centred vertically; the gap follows the icon size (`space-8` for 15–18px, `space-4` for the 10px chip icon); centres within 1px.

New tokens: `size-icon-empty` (28px, the whole-view EmptyState icon, which was a raw value) and `letter-caps` (0.06em). Field names move from the caption role to the label role. New IconRoles: `menu.checked`, `composer.removeAttachment`; `action.editTags` already existed.

| Decision | Reason | Revisit when |
|---|---|---|
| Foundations land first (tokens, rules, shared parts, the raw-px check); each area owner applies them to its screens in a bundle stacked on top | one owner per shared part avoids two looks for one role; screens change only through their owners | all bundles have landed |
| `quiet` is renamed `ghost` and the default Button variant is named `outline`, with no alias | the rule's names are the API names; an alias would be debt | never |
| The `link` Button variant is removed (coordinator decision on the #97 review); every non-navigating caller (Undo, Dismiss, Reset, Close, pressed choices) is `ghost`, and navigation is a real `a` link | a link-looking action contradicts "an action that does not navigate is never a link" | never |
| ButtonGroup is redrawn as the segmented control instead of adding a second component | one role, one part; the sheet decides the redraw | a choice needs more than a few options |
| Group labels and the band are uppercase only for `:lang(en)`, and never for owner data (`ThreadGroup` `verbatim`, `mono`) | tags and paths must show exactly as stored | another Latin-script UI language is added |
| The raw-px check allows the `899px`/`900px` and `1179px`/`1180px` container breakpoints | container queries cannot read custom properties | browsers support custom properties in container queries |

## Console layout rules

The Console system's `web/designs/console/system/README.md` is the component-level contract. Use `space-4` for tightly coupled content, `space-8` for rows and compact insets, `space-12` for component interiors and related groups, `space-16` for card interiors and section separation, and `space-24` for the desktop page perimeter (phone: `space-12`). Use the existing control and touch heights, and the title, heading, body, label, caption, code and log type roles. Align headings, sections and cards at a shared left edge. Cards contain distinct subjects; lines separate repeated rows. Hover uses `hover`, selection `accent-bg`, focus the accent outline, and disabled controls reduced opacity. Preserve semantic status marks and words. Conversation tool group layout follows the same rules; changes to that group belong to its worker.

## Sidebar spacing audit (#91, 2026-11-23)

- Heading: `space-12` top and horizontal component inset aligns its left edge with the controls; `space-8` below keeps the title close to its controls row.
- Search/filter/new controls: `space-12` horizontal component inset; `space-4` between related controls; `space-12` below separates the controls group from Thread bands.
- Thread list: zero horizontal inset keeps the band full-width; `space-8` separates repeated bands/rows; `space-12` below is the list component inset. Band content uses ThreadGroup's own inset.

The left-edge choice is resolved by the Layout contract's shared content edge: the heading aligns with the controls inset at `space-12`. No additional placement needs a new token or user decision.

## Validation record (2026-11-07)

Environment: macOS (Darwin 25.3, arm64), Node 25.9, Google Chrome headless driven over its DevTools protocol by a throwaway script (no browser tooling installed), bridge debug build embedding the production bundle, `shellboy serve` from Shellboy `fa7bec02c0` with temporary HOME and data directory and a local mock provider. No real API call.

`npm run check` (typecheck plus Vitest) and `cargo clippy --all-targets -- -D warnings`, `cargo test` pass. In the browser, against the real bridge at `/`: token exchange and fragment removal; Thread list, Conversation with Markdown, command steps with exit code and output, details panel, usage and input size from `thread.get`; sending from the composer (recorded as a person), Stop on a running Run, Retry from Monitor, Archive with two presses, New; a 100-message Thread opening at its end with Show earlier messages; a message from the CLI arriving by hint without reload; theme and language switching without reload and kept after a reload; owner down and back; a restarted bridge asking for the token, refusing a wrong one, accepting the right one; no request leaving the bridge's origin. Widths of 1440, 1000 and 390 px checked by computed style and screenshots.

Browser device emulation is not a phone test. Not tested: real phones, Safari, Firefox, Windows, Linux, a real provider, real compaction, live text (not on Shellboy main), real `message ask`.

## Not decided

Whether users can load a custom token file from settings.
