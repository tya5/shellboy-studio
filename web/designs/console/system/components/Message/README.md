# Message

- **Use for:** Render a saved conversation message with sender, time, Markdown and copyable code blocks.
- **Do not use for:** Use LogBlock for machine output and QuestionCard for a pending question with an answer action.
- **Why:** The message can preserve readable formatting without rendering raw HTML or allowing arbitrary link schemes.
- **Source:** [Studio Console decisions](../../../../../../docs/design/design-system.md#the-console-design)

One saved message: who, when, and the text rendered from Markdown. Raw HTML in the text is not rendered and links only open http, https and mailto addresses. Code blocks have a copy button. Saved messages, artifacts, and completed answers always use the normal whole-message renderer. Only explicitly live streaming text may retain stable Markdown blocks and reparse its open tail; boundaries are withheld when continuation, reference, or list structure could change interpretation.

Styles are colocated in `system/components/Message/style.css`.

Styles: style.css in this directory
