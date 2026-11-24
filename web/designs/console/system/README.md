An engineer's console: dark navy surfaces, one accent, and monospace wherever the content comes from a machine. It looks like a workbench, not a chat product.

## Content fundamentals

- Write English by default; Japanese is a supported translation. Sentence case: "Awaiting you", "Open conversation".
- Name things by what the person sees: "Awaiting you", "Retry". Address the person as "you"; Shellboy's own messages use "I".
- Show facts, not encouragement: `2.4s`, `exit 0`, `412k`. Never show an estimated number as if measured.
- Never use text glyphs as marks, and never emoji. Use the `StatusMark` shapes and line icons.

## Visual foundations

- Set surfaces with `bg`, `panel`, `raised` and `inset`. Separate regions with `line`; the anchored row menu alone uses `shadow-popover` for light elevation.
- Use `accent` for the running state, links, the current view and the focus ring only. A screen stays mostly neutral.
- Chart marks use `chart-1` (uncached input), `chart-2` (cached input) and `chart-3` (output), or `muted` for one series with no such identity. These are fills and lines, never text. Each theme's three hues pass the colour-blind and contrast checks together on `panel`.
- Text is `fg` or `muted`. On filled colours use `on-accent` and `on-wait`.
- Thread marks use five attention categories, defined in StatusMark. Shell results, raw owner activity, and active conversation footer wording keep their distinct facts. The footer shares the textless idle Thread mark. A theme does not change these meanings.
- Put commands, paths, numbers, model names and logs in `font-mono` (`code`, `log`). Everything else is `font-sans` (`title`, `heading`, `body`, `label`, `caption`).
- Corners: `radius-s` for controls and menu items, `radius-m` for the menu panel, `radius` for cards. Terminal squares all three.
- Spacing comes from `space-4` to `space-24`. Touch targets on phone width are at least 44px.
- Focus is a solid 2px `accent` ring with a 2px offset on every interactive element.
- Motion: LoadingRows pulses, the running character dots hop, and the active summary arc and shared Thread/shell running arc spin. Reduced motion stops all of these; the summary ring uses stationary dots and the running mark keeps its gap.
  Animate `transform` or `opacity` on a whole HTML element or SVG root, never on a shape inside an SVG.

## Layout

- Desktop: 260px sidebar, breadcrumb top bar, main column, optional 340px four-tab conversation inspector with a compact icon rail, status bar at the bottom. Settings and Analytics add a 230px section list beside one pane (SubView).
- Under 1180px the right panel does not fit beside the conversation. It is hidden, and the right-panel toggle in a footer under the conversation opens the same panel as a sheet (see Shell panels). One container query, `max-width:1179px`, owns both sides.
- Phone width (container under 900px): sidebar and status bar disappear and a bottom tab bar of three tabs takes over: Awaiting you, Conversation and More, which holds the rest. Use container queries, so the same components work in any frame.
- The conversation opens first. Thread destinations are Conversation and Awaiting you. Analytics, Settings and Branches are whole-owner views.

## Layout contract

- `space-4`: tightly related text, labels and control internals; `space-8`: row-to-row and compact control insets; `space-12`: component insets and related groups; `space-16`: card insets and distinct sections; `space-24`: desktop page horizontal perimeter. At phone width use `space-12` for the page perimeter. Use zero when regions touch by design; a one-pixel grid divider is a border, not spacing.
- No raw pixel values outside the token files. Sizes, spacing and type come from tokens. The only raw values allowed are `0`, `1px` hairlines (borders, dividers, the one-pixel grid gap), the `2px` focus ring (`outline` and `outline-offset`), and the container-query breakpoints `899px` / `900px` and `1179px` / `1180px`, which container queries cannot read from a custom property. `check-raw-px.mjs` enforces this in `npm run check`; `raw-px-allowlist.txt` lists the offenders found on 2026-11-23, which the v2 application bundles remove.
- Use `size-control` for ordinary control height and at least `size-touch` for phone targets. Let text rows grow for wrapping; never clip content to a fixed line height.
- `type-title` names a desktop page (`type-heading` at phone width); `type-heading` names a section; `type-body` is prose; `type-label` is control and row text; `type-caption` is metadata; `type-code` and `type-log` are machine text. Use the token's line height.
- Align page headings, sections and cards to the same content left edge; nested content aligns to its component inset. Keep the same perimeter above and beside each screen, including empty states. Tool groups in Conversation follow these rules; do not change their ownership or interaction.
- Use a card (`panel`, `line`, `radius`) for a distinct subject or independent action. Use a `line` separator, not another card, between repeated rows of one subject. Avoid nested cards solely for spacing.
- Hover uses `hover`; selection uses `accent-bg` with `fg` and existing current/pressed semantics; focus uses the 2px `accent` outline; disabled controls use reduced opacity and `not-allowed`. List row hover/selection fills span the list width, including behind nested rows.
- A long group that collapses uses the `ThreadGroup` band: a full-width, sticky, opaque `inset` band between two `line`s, `size-control` high, with the group-label text, a count and a small trailing chevron. The whole band is the accessible disclosure button and has no hover surface; do not add a text link. Align its trailing chevron to the list's `size-row-action` (24px) action column. A static group label is `.group-label` (ListDivider in panels). See "Structure levels" below.
- Use marks only when they distinguish meaning, and only on content rows: page titles, section headings, group labels and bands carry no icon. StatusMarks have equal outer diameters and distinguish state by shape as well as color (arc, question, alert, center dot, empty ring for Threads; a check remains a shell completion fact); never rely on color alone. See StatusMark and Icon READMEs.
- Compact count chips use `size-chip-height`, `size-chip-icon`, `size-chip-text`, and `space-chip-inline`: 20px high, 10px icon, 11px tabular numerals, equal 7px horizontal padding. Urgency color follows the highest priority represented: awaiting is amber, running is blue, otherwise neutral.

## Design system v2 rules

Approved by the user on 2026-11-23 with the v2 sheet (shellboy-studio #97). These rules apply to every screen; the parts that carry them are named in each rule.

### Common rules

| Spacing | Role |
|---|---|
| `space-2` | Hairline separation: panel tabs, the segmented control's inset and segment gap, the compact empty-state icon nudge |
| `space-4` | Tightly related text, a label and its control, control internals |
| `space-8` | Row to row, compact control insets, between controls |
| `space-12` | Component insets and related groups |
| `space-16` | Card insets and distinct sections; between two groups of choices |
| `space-24` | Desktop page perimeter left and right (`space-12` at phone width) |

| Type | Role |
|---|---|
| `type-title` | Desktop page name (`type-heading` at phone width), one per page |
| `type-heading` | Section name |
| `type-body` | Prose |
| `type-label` | Controls, row text, field names, subheadings at 600 |
| `type-caption` | Metadata, group labels and bands, helper text |
| `type-code`, `type-log` | Machine text (mono) |

| Size | Role |
|---|---|
| `size-icon` 18px, `size-icon-small` 15px, `size-icon-menu` 16px | Line icons, stroke 1.7, `currentColor` |
| `size-control` 32px | Ordinary controls and content rows |
| `size-touch` 44px | Minimum hit target at phone width |
| `size-header` 48px | Header bar, including its bottom line |
| `size-chip-height` 20px | Compact count chips and tag badges |
| `size-row-action` 24px | Row action column (`size-row-action-touch` at phone width) |

Never write raw pixel values: see the Layout contract above for the only exceptions.

### Action strength (操作の強さ)

A bordered or filled box means "press me", so use as few as possible. Six strengths only:

| Strength | Part | Use |
|---|---|---|
| Primary (filled) | Button `primary` | One per region: its main action (Send, Save). `accent` / `on-accent`. |
| Ghost (no border) | Button `ghost` | Most actions, and every icon-only button in headers, toolbars, rows and cards. A `hover` surface appears only on hover, keyboard focus and while its menu is open. |
| Outline (border) | Button (default `outline`) | Only a secondary action beside a primary one that must look pressable. Never on its own. |
| Text link | `a`; `.nav-link` when standalone | Navigation. Underlined in prose; standalone links are `accent` without underline, underlined on hover and focus, `size-touch` high at phone width. An action that does not navigate is never a link. |
| Segmented | ButtonGroup | One choice out of a few (language, effort, view, state filter with counts, period). One `raised` container, only the chosen segment filled (`accent-bg` with an `accent` edge). Two groups in a row sit `space-16` apart in `.choice-row`; an independent action goes outside as ghost. Real tabs that switch panels stay PanelTabs or AppTabs. |
| Bordered chip | `.tag-badge`, Chip (removable) | Tags and removable tokens (attachments, FilterChips) only; never actions or menu triggers. |

In one region, only the primary and the outline beside it have a border or fill. Several options that can be on together are Check boxes in a `fieldset` whose `legend` is the setting name, never a ButtonGroup. A list of values the person adds and removes (instruction files) is one list inside its Section with `line` separators, a ghost Remove in each row's action column and, below it, a Field with a visible label and a ghost Add; never nested cards or full-width buttons. Sources: [VS Code Settings editor](https://code.visualstudio.com/docs/getstarted/settings), [Apple HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables).

### Structure levels (構造の見せ方)

Four levels, each with its own look in every dimension, so the level reads at a glance. No level borrows another level's look.

| Level | Type and colour | Space above and below | Icon | Surface | Interaction |
|---|---|---|---|---|---|
| Page title (PageHeader) | `type-title` 700 `fg` (`type-heading` at phone width) | Page perimeter `space-16` above; `space-4` to the description, `space-12` to the toolbar | None | None (page ground) | None; one per page |
| Section heading (Section) | `type-heading` 600 `fg`, sentence case | `space-16` between sections, `space-12` below | None | The card has it (`panel`, `line`, `radius`); the heading has none | None; section actions at the end of the heading row |
| Group label or band (`.group-label`, ListDivider, ThreadGroup) | `type-caption` 500 `muted`; uppercase with `letter-caps` in an English UI | Label: `space-16` above, `space-4` below. Band: `space-8` above, `space-4` below | None | Label: none. Band: full-width `inset` between two `line`s, `size-control` high | No row hover; a band that collapses shows only a small trailing chevron (`size-icon-small`) |
| Content row (NavItem, ThreadItem, ListRow, Menu item) | `type-label` 400 `fg`; detail `type-caption` `muted`; machine values `type-code` | 0 to `space-4` between rows; `size-control` high (`size-touch` at phone width) | Yes: `size-icon` or a StatusMark, then `space-8` | None at rest; `hover` on hover, `accent-bg` when selected, across the list width | The whole row is pressable; row actions in the trailing `size-row-action` column |

Inside a Section card, a sub-subject is an `h4` in `type-label` at 600, `space-12` above and `space-4` below; anything larger is its own Section. Heading levels follow the outline: `h1` page, `h2`/`h3` Section, `h4` sub-subject.

### Group labels

A group label is clearly a label, not an item: `type-caption`, `muted`, weight 500, no icon, no hover or selection surface, not clickable, and uppercase with `letter-caps` (0.06em) in an English UI (Japanese has no case: smaller, `muted` and 500 only). Its left edge is the items' icon edge. Use the shared `.group-label`, ListDivider in panels, and SectionNav's grouped mode. A long group that collapses is a ThreadGroup band instead: the same text on a full-width `inset` surface between two `line`s; the whole band is the disclosure button. Owner data used as a band name (tags, directories) is never uppercased.

### Composer controls in one row

The composer's control row is always one line, in every state and width:

- Start: the model control as a ghost button showing the connection and model in `type-code` and the effort in `type-label` `muted`, then the hint in `type-caption` `muted`.
- End, in this order: ContextRing (ghost), Stop (only while running), Send (`primary`, always last).
- When space runs out: first the hint truncates, then the model name truncates; at phone width the hint is hidden. Nothing wraps.
- A long running status goes in a status line above the composer (`type-caption` `muted`, truncated), not in the row.
- Attachments are removable tokens (bordered, `type-code`, a `size-row-action` remove button with the `composer.removeAttachment` icon) in a row above the text area.
- Row padding `space-4` × `space-8`, gaps `space-8`; controls `size-control` (`size-touch` at phone width).

Sources: observed products ChatGPT, Claude.ai and Cursor (no official layout specification found); all keep controls in one row below the text and attachments above it.

### Icons and labels

An icon and its label sit in one inline-flex row with `align-items: center`. The icon box equals its size token and never sits on the text baseline. The gap follows the icon size, not the component:

| Icon | Gap | Where |
|---|---|---|
| `size-icon` 18px | `space-8` | Navigation, bars, whole-view empty states |
| `size-icon-menu` 16px, `size-icon-small` 15px | `space-8` | Menus, row StatusMarks, tabs, composer chips, bands |
| `size-chip-icon` 10px | `space-4` | Compact count chips |

The icon centre and the text line's centre differ by at most 1px. Sources: [Material 3 Lists specs](https://m3.material.io/components/lists/specs), [Apple HIG SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols).

## Layout parts

- `LayoutSeparator` is the shared Window Splitter for the expanded desktop sidebar and conversation panel, never the drawer or a collapsed rail. `layoutWidthStyle` binds the independent saved widths to their layout variables; unspecified widths keep the design tokens.

## Themes

Console is the default. Light and Terminal replace colour tokens only, and Terminal also sets `font-sans` to the mono stack and squares the radii in `components/bundle.css`. Components name a role, never a colour. To add a theme, add a value per colour token; don't add component styles.

## Iconography

Line icons at 18px, stroke 1.7, round joins, `currentColor`. The sidebar uses the approved inline `BrandLogo` silhouette and generated theme tokens. OS-adaptive SVG favicon and fixed ICO/apple/PWA fallbacks are separate browser/install assets; see `components/BrandLogo/README.md`.

## Keeping several designs

A design system is one folder under `web/designs/<name>/`. Data and screen logic stay below it and are shared. See `docs/design/design-system.md` in the shellboy-studio repository.

## In this repository

This folder is the system; `../screens` builds on it. A screen uses only these tokens and components. If a screen needs something missing, add it here first, with a usage note in `components/<Name>/README.md`.

- `tokens.json` is the one source of token values. `npm run tokens` writes `tokens/console.css`, `tokens/light.css` and `tokens/terminal.css`; a test fails if they drift. Elevation contains only `shadow-popover` for the anchored menu; other regions are lifted by surface tokens and separated by `line`.
- `components.css` is the single ordered stylesheet entry. Each component owns `components/<Name>/style.css`; shared semantic roles live in `shared/*.css`. `layout.css` owns the application frame. No stylesheet contains literal colours.
- `components/<Name>/` holds each component and its usage note.
- The root attribute is `data-ds`, as `docs/design/design-system.md` specifies; the reference previews use `data-theme`.
- Fonts: no web font is loaded at runtime. The stacks name Inter, Noto Sans JP and JetBrains Mono first, so a machine that has them uses them, and otherwise fall back to the system faces. The reference's Google Fonts import is for its previews only.

Differences from the reference, each for a reason in the usage note or `docs/design/design-system.md`: five Thread categories in StatusMark, with separate shell exit facts; added tokens `scrim`, `motion-spin`, `letter-caps`, `size-icon-empty` and the `size-*` layout tokens; spacing inside components snaps to the `space-*` scale, where the reference has some 10px and 14px values; the Notice, Field, Chip, LogBlock, KeyValue, EmptyState, Message, Composer, ThreadItem, QuestionItem and Icon components; for Analytics and Settings, the Section, Stat, Chart, DataTable, Meter, BarList, RangeBar, SectionNav, SubView, MoreMenu, FactList and ButtonGroup components; for first-run setup, the ChoiceList component; for Branches and Threads, the BranchLanes, BranchMark, ThreadGroup, SelectRow and SelectionBar components; for Apps, the AppTabs, AppFrame and AppCard components; and LoadingRows and the `chart-1` to `chart-3` tokens; and for the conversation inspector, `PanelTabs`, `ListRow` and `ListDivider`; and for design system v2, `PageHeader` and the shared `.group-label`, `.choice-row`, `.nav-link` and `.tag-badge`.

The desktop navigation can collapse to an icon rail with the navigation button or Alt+0. The per-browser preference does not affect the phone drawer.

Thread row menus use the approved vertical three-dot mark (`Icon` `more`) and keep the row as the menu state owner.

The approved Thread row menu mark is the vertical three-dot `more` icon; row-owned `useRowMenu` keeps its trigger available while the menu is open.

## Row actions

The shared row-action pattern and its references are recorded in `patterns/row-actions.md`.

### Brand surfaces and theme ownership

- The sidebar header (expanded or collapsed) and the phone thread drawer show the same inline `BrandLogo`. Its tile and details use the resolved palette; no separate mobile artwork, filters, or image swaps.
- The browser tab uses the existing OS-adaptive `studio-favicon.svg`, with a fixed ICO fallback. Browser chrome owns that scheme independently of the app setting.
- Apple touch and manifest install icons are OS-owned static assets; they retain their built-in contrast. The master SVG and remaining export sizes are source/export variants, not additional in-app placements. No artwork or size changes.

### Conversation status artwork

The permanent one-line footer in Conversation uses the existing status artwork. Only its description may ellipsize; activity, the lower-bound count when two or more, elapsed time from the actual start, and actions retain their own fields. It is the one place for a recovery reason and Retry (Retry only when `canRetry`); no Notice above the composer repeats them. The status line stays one line and only the reason ellipsizes. When Retry is offered, the warning that a retry may be charged again is supporting text on its own `muted` row under the status line (Material 3 supporting text, https://m3.material.io/components/text-fields/guidelines), in the same gutter, wrapping in full and never ellipsized or hover-only; Retry points to it with `aria-describedby`. Its facts are the open Thread's own: `thread.get` and that Thread's row in the row cache, whether or not a list page holds it.

The `ConversationCharacter` component owns running-only dot motion inside the existing artwork.

## Shell panels

On desktop, sidebar and right-panel visibility controls live in `ShellFooter` rows of height `size-shell-footer` (36px), separated from the middle content. Under 1180px, where the right panel is hidden, the right-panel toggle sits in a footer under the conversation and opens the same panel in a WorkSheet; that footer is `size-shell-footer` high from 900px to 1179px and `size-touch` (44px) at phone width. Headers and footers do not scroll; only each panel's middle does. `ShellToggle` uses a VS Code-style window glyph whose leading strip is filled when shown and outline-only when hidden; do not change color for state. The shared 50px `size-shell-column` fixes icon centers 25px from the left/right shell edge in both expanded and rail states; `size-shell-rail` adds only the divider width. Keep current navigation IconRoles unchanged. The right rail repeats the existing tab counts as badges on their icons. The phone drawer remains on the header menu button. References: VS Code layout sidebar actions, Orca SidebarToggleIcon, GitHub sidebar footer disclosure.

When the right panel collapses, all tab panels are hidden and unfocusable; the flex middle remains to anchor the footer. Do not use this rule to remove tab state or unmount panel content.
Settings navigation and save behavior are specified in `patterns/settings.md`.

- BranchLanes has screen-specific `size-lane-column`, `size-lane-node`, and `size-lane-line` geometry tokens; keep those dimensions out of spacing roles.
