# Expanded shell step in Conversation: design study (#140)

The user called the open shell row "ダサい". This study covers only what shows under an open shell (tool) row in Conversation. The collapsed row (`WorkElementRow`), the Work group band, the right-panel detail and the output read path stay as they are.

## Today

`StepView` (`web/designs/console/screens/Conversation.tsx:427`) renders `WorkElementRow`. Under it, the optional command caption (only when the row shows a description) is followed by `Output` (`Conversation.tsx:367`): a row of text buttons (`Copy`, `Wrap lines`, `Raw text`/`Formatted`), then `LogBlock` or the windowed `OutputLines`. Captures at 1440 px and 390 px are in the mock's Before frames (`web/designs/console/mocks/shell-step-desktop.png`, `shell-step-phone.png`).

What is wrong:

- **Hierarchy and alignment.** The detail has no inset. The command caption, the buttons and the log start at the card's left edge, left of the row's own icon, while the row above has a `space-12` inset. Nothing says which row the detail belongs to.
- **Spacing.** There is no gap between the caption, the button row and the log. The buttons touch the caption above and the log below, and on phone they touch the card edge.
- **Typography.** The command caption is `type-caption` in `muted`, which is smaller and fainter than the row label, although the command is the most important fact. When the row has no description, the full command is not shown anywhere, only the ellipsized row label.
- **Status, exit code and duration.** The row shows the raw machine word (`exited`, `running`) beside the mark. The exit code, the duration and the directory appear only in the right-panel detail, so in the conversation a failed `exit 101` and a clean exit look alike apart from the mark's colour and shape.
- **stdout and stderr.** They are not distinguished at all. Studio's `shell.read` returns one merged text (Core `ShellReadArgs` has no stream selection, `src/protocol.rs:463`), although Core stores the two streams separately and the TUI already marks stderr (`src/ui/presentation.rs:276`).
- **Long output.** Desktop scrolls sideways inside a 420 px log, which is fine. Phone wraps by default (#128), which is also fine. But there is no line count, so the reader cannot tell how much is hidden below the fold, and the cut-off note is a bare caption under the log.
- **Actions.** `Copy` and `Wrap lines` are outline text buttons on their own. The v2 action-strength rule says an outline button is "never on its own". They sit above the output, away from the command. Copy gives no feedback, either visual or announced. There is no Copy for the command, and the right-panel detail opens only as a side effect of expanding the row.
- **Reclaimed output.** When storage cleanup has removed the raw output, the only sign is the error caption "Couldn't read the output: …", which reads as a fault rather than a known retention fact.

## Research

- **VS Code terminal shell integration.** Each command gets a gutter decoration that marks success or failure by colour and shape (a circle, or a circle with a cross). Clicking it opens Copy Output, Copy Output as HTML and Rerun Command. Transfer: one mark that carries the exit fact, and copy actions attached to the command run rather than to the whole terminal. [Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- **VS Code chat (Copilot) terminal tool.** The tool invocation shows the command, with "Show Output" to reveal its output in chat and "Show Terminal" to open the full terminal. Transfer: a compact in-chat block with an explicit way out to the full view, here the existing right-panel detail. [Agent tools](https://code.visualstudio.com/docs/copilot/agents/agent-tools)
- **Claude Code.** A Bash call collapses multi-line output behind "Ran <command>" with a "+N lines (ctrl+o to expand)" hint. Transfer: state the line count so the reader knows what is folded. Do not copy the keyboard-only expansion. [Interactive mode](https://code.claude.com/docs/en/interactive-mode), [issue: auto-collapsing Bash output](https://claudeissues.com/issue/59458-feature-add-setting-to-disable-auto-collapsing-of-multi-line-bash-tool-output)
- **Cursor agent terminal.** The official docs say only that commands run in the terminal under a Run Mode. The in-chat block's buttons (Skip, Move to background) are known only from forum reports. Not used as a layout source. [Terminal](https://cursor.com/docs/agent/tools/terminal)
- **GitHub Actions step logs.** Each step is a collapsible header with its runtime. Failed steps open automatically, the log has its own search, and the full log can be downloaded. Transfer: duration in the step's facts, failure as a fact beside the command, and "full log" as a separate place. [Using workflow run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)
- **Warp blocks.** A block groups one command with its output. Long blocks keep the command pinned in a sticky header, and a non-zero exit gives the block a red background and sidebar. Actions (copy command, copy output, or both) are in a kebab menu and the right-click menu. Transfer: command and output as one unit, and an edge rule for the error part. Do not copy the hover-revealed kebab: Studio needs touch. [Block basics](https://docs.warp.dev/terminal/blocks/block-basics), [Block actions](https://docs.warp.dev/terminal/blocks/block-actions)
- **shadcn-style code blocks.** A code block is a header bar (title on the left, actions on the right, copy shows a check) over the code. shadcn/ui itself has no official code-block component; the pattern comes from registries built on it. [AI Elements Code Block](https://elements.ai-sdk.dev/components/code-block), [shadcnblocks code block header](https://www.shadcnblocks.com/component/code-block/code-block-composition-1)
- **Icon-only buttons.**
  - [Primer's copy pattern](https://primer.style/product/scenario-patterns/copy): an invisible-variant icon button placed next to the content, with a label that names what is copied ("Copy branch name"). After the write resolves, the icon swaps to a success-coloured check and the tooltip to "Copied!" for about two seconds. A visually hidden live region announces it, and the button is always visible, never on hover only. [Primer ClipboardCopy](https://primer.style/components/clipboard-copy) builds in that polite live region.
  - [shadcn/ui](https://ui.shadcn.com/docs/components/tooltip) and [Radix](https://www.radix-ui.com/primitives/docs/components/tooltip) tooltips open on hover and on keyboard focus.
  - Material 3's Compose `IconButton` pairs every icon button with a tooltip and a content description, with a 48 dp minimum touch target. [IconButton](https://developer.android.com/reference/kotlin/androidx/compose/material3/IconButton.composable), [Material 3 icon buttons](https://m3.material.io/components/icon-buttons/guidelines)
  - Apple HIG asks for a 44 × 44 pt minimum hit region and an accessibility label for icon-only buttons. A help tag (tooltip) exists only where there is a pointer. [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- **Colour alone.** WCAG 1.4.1: "Color is not used as the only visual means of conveying information." [Understanding SC 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

## Chosen pattern: command block (Warp block structure, code-block header)

Under the open row, one block starts at the row's text edge (after the icon column; at the icon edge at phone width):

1. **Command.** The full command in `type-code` and `fg`, wrapping, never ellipsized. Copy command is an icon button at the end of its first line.
2. **Facts.** One caption line:
   - the StatusMark with the exit code (`exit 0`, `exit 101`), or the mark with "Running" while it runs;
   - the duration (elapsed "so far" while it runs);
   - the directory in mono.
   Facts are separated by space, not glyphs, so a wrapped line never starts with a separator.
3. **Output.** One bordered code block, made of a header bar and the existing bounded log.
   - The header bar shows "Output · N lines", with "so far" while it runs and a stderr line count when there is one. Its icon actions sit at the end: Wrap lines (toggle, `aria-pressed`), Copy output, and Open execution details (the existing right-panel detail).
   - The log keeps `size-log-max-height`, its own scroll and the windowed `OutputLines` (#125). It wraps by default at phone width (#128).
4. **stderr.** Each stderr run gets a small "stderr" caption tag above it and a `bad` hairline along its start edge. The words carry the meaning, and the colour only adds to it. Copy output copies the original text without the tags.
5. **Cut off and reclaimed.**
   - A cut-off read keeps today's sentence, with the info mark, directly under the log.
   - Reclaimed output replaces the output block with a dashed note. The note says the output is no longer kept and that the command, exit code and duration remain. Copy output and Wrap are not shown, because there is nothing to copy.
6. **Icon actions.**
   - Each is a ghost icon-only Button with an `aria-label` that names what it acts on ("Copy command", "Copy output").
   - A tooltip with the same text shows on hover and on keyboard focus. It is never the only label.
   - Buttons are 32 px on desktop and 44 px at phone width (the existing `.btn-icon` container rule).
   - Copy shows success only after `clipboard.writeText` resolves: the icon swaps to a check in `ok`, the tooltip says "Copied" for 1.5 s, and a polite `role="status"` region announces "Copied". A failed write announces "Couldn't copy".

**Why.** Every reference treats one command run as one unit: the command first, its outcome facts beside it, then its output. Warp, the VS Code decorations and GitHub Actions all put the exit result next to the command rather than inside the output. The code-block header is the established place for actions that act on a block of text, and it keeps Copy next to what it copies, as Primer asks. Moving the exit code, duration and directory inline answers the most common question ("did it work, where, and how long") without opening the panel. The panel stays the place for the larger view.

**When not.**

- Do not use the block for non-shell Work members (reasoning, notifications, problems). They keep `WorkElementRow`'s plain detail.
- Do not use it where a row has no shell output (`detailPolicy` `none` or `unavailable`).
- Do not wrap output where columns carry the meaning (tables, aligned diffs). The Wrap toggle stays available.
- Do not show the stderr tags until Core can say which stream a segment came from. Until then the build shows one stream and no stderr count. It must not guess the stream from content.

## Not built (作らない仕組み)

- No Stop, Rerun or Search for a shell in the conversation. Studio has no shell stop path today, and these are separate features.
- No line numbers or per-line permalinks (GitHub Actions has them; this view stays dense).
- No new reader, no new output paging, no change to the windowing and no new subscription. The existing `Output`, `OutputLines` and `watchOutput` lifetimes stay.
- No change to the collapsed row, the Work group band or the right-panel detail content.

## What the build needs

- **Core.** Make `shell.read` return the stream of each segment, or accept a stream selection, so Studio can tag stderr. Core keeps the streams apart internally (`StreamSelection`, `src/control/output.rs:19`), but the public read is "Both". Without this, the build ships everything else and leaves stderr untagged.
- **System Icon roles.** `output.copy` (Lucide copy), `output.copied` (check), `output.wrap` (wrap-text) and `output.openDetails` (panel-right-open), added to `ICON_ROLES` with README rows.
- **System Tooltip.** A small system Tooltip, opened on hover and focus and placed in the popover layer, so it is not clipped by the Work group's `overflow:hidden`. Today Studio uses native `title` only, which does not show on keyboard focus.
- **A shared CopyButton.** It holds the check swap, the 1.5 s reset and the live announcement, reused by every Copy listed in #140.
- **i18n.** "Copy command", "Copy output", "Open execution details", "Output · {n} lines", "so far" and the reclaimed sentence. The reclaimed sentence is shown only for Core's `output_expired` error. Other read errors keep "Couldn't read the output".

## Open the mock

From `wip/studio-shell-step-mock`: `cd web && npm ci && npm run dev`, then open `http://127.0.0.1:5173/shell-step-mock.html` (use the port Vite prints).

The page shows the Console (dark) and Light themes. Each has Before and After at desktop width and at a 390 px phone width. The Before frames are today's StepView markup built from the real components and styles. The After frames show six states: running, succeeded (with Copy just pressed), failed with stderr, long output, cut off, and reclaimed.

Captures: `web/designs/console/mocks/shell-step-desktop.png` (1440 px) and `shell-step-phone.png` (390 px, laid out at a true 390 px viewport through the DevTools protocol).
