An engineer's console: dark navy surfaces, one accent, and monospace wherever the content comes from a machine. It looks like a workbench, not a chat product.

## Content fundamentals

- Write English by default; Japanese is a supported translation. Sentence case: "Awaiting you", "Open conversation".
- Name things by what the person sees: "Recovery wait", "Retry". Address the person as "you"; Shellboy's own messages use "I".
- Show facts, not encouragement: `2.4s`, `exit 0`, `412k`. Never show an estimated number as if measured.
- Never use text glyphs as marks, and never emoji. Use the `StatusMark` shapes and line icons.

## Visual foundations

- Set surfaces with `bg`, `panel`, `raised` and `inset`. Separate regions with `line`; don't use shadows.
- Use `accent` for the running state, links, the current view and the focus ring only. A screen stays mostly neutral.
- Chart marks use `chart-1` (uncached input), `chart-2` (cached input) and `chart-3` (output), or `muted` for one series with no such identity. These are fills and lines, never text. Each theme's three hues pass the colour-blind and contrast checks together on `panel`.
- Text is `fg` or `muted`. On filled colours use `on-accent` and `on-wait`.
- State meaning is fixed and carried by shape as well as colour: running is an open ring in `accent`; awaiting a person is a solid disc in `wait`; recovery wait is a diamond in `bad`; completed is a check in `ok`. A theme may restyle a state, never merge or rename one.
- Put commands, paths, numbers, model names and logs in `font-mono` (`code`, `log`). Everything else is `font-sans` (`title`, `heading`, `body`, `label`, `caption`).
- Corners: `radius-s` for controls, `radius` for cards. Terminal squares both.
- Spacing comes from `space-4` to `space-24`. Touch targets on phone width are at least 44px.
- Focus is a solid 2px `accent` ring with a 2px offset on every interactive element.
- Motion: only the running ring spins. It stops under `prefers-reduced-motion`.

## Layout

- Desktop: 260px sidebar, breadcrumb top bar, main column, optional 340px execution details, status bar at the bottom. Settings and Analytics add a 230px section list beside one pane (SubView).
- Phone width (container under 900px): sidebar, status bar and details disappear and a bottom tab bar of four tabs takes over: Awaiting you, Conversation, Monitor and More, which holds the rest. Use container queries, so the same components work in any frame.
- The conversation opens first. Thread views are Conversation, Monitor and Awaiting you. Analytics, Settings, Branches and Threads are whole-owner views.

## Themes

Console is the default. Light and Terminal replace colour tokens only, and Terminal also sets `font-sans` to the mono stack and squares the radii in `components/bundle.css`. Components name a role, never a colour. To add a theme, add a value per colour token; don't add component styles.

## Iconography

Line icons at 18px, stroke 1.7, round joins, `currentColor`. No logo file exists yet, so the source mock draws a simple robot mark inline: treat it as a placeholder until the project has a real mark.

## Keeping several designs

A design system is one folder under `web/designs/<name>/`. Data and screen logic stay below it and are shared. See `docs/design/design-system.md` in the shellboy-web repository.

## In this repository

This folder is the system; `../screens` builds on it. A screen uses only these tokens and components. If a screen needs something missing, add it here first, with a usage note in `components/<Name>/README.md`.

- `tokens.json` is the one source of token values. `npm run tokens` writes `tokens/console.css`, `tokens/light.css` and `tokens/terminal.css`; a test fails if they drift. Elevation is a deliberate empty list: regions are lifted by surface tokens and separated by `line`, without shadows.
- `components.css` holds the component styles, `layout.css` the application frame. Neither contains a literal colour.
- `components/<Name>/` holds each component and its usage note.
- The root attribute is `data-ds`, as `docs/design/design-system.md` specifies; the reference previews use `data-theme`.
- Fonts: no web font is loaded at runtime. The stacks name Inter, Noto Sans JP and JetBrains Mono first, so a machine that has them uses them, and otherwise fall back to the system faces. The reference's Google Fonts import is for its previews only.

Differences from the reference, each for a reason in the usage note or `docs/design/design-system.md`: added states `hold`, `fail`, `halt` and `idle` on StatusMark; added tokens `scrim`, `motion-spin` and the `size-*` layout tokens; spacing inside components snaps to the `space-*` scale, where the reference has some 10px and 14px values; the Notice, Field, Chip, LogBlock, KeyValue, EmptyState, Message, Composer, ThreadItem, QuestionItem and Icon components; for Analytics and Settings, the Section, Stat, Chart, DataTable, Meter, BarList, RangeBar, SectionNav, SubView, MoreMenu, FactList and ButtonGroup components; for Branches and Threads, the BranchGraph, BranchList, BranchMark, ThreadGroup, SelectRow and SelectionBar components; for Apps, the AppTabs, AppFrame and AppCard components and the `chart-1` to `chart-3` tokens.
