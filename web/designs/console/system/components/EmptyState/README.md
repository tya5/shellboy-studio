# EmptyState

- **Use for:** A settled empty region: the view variant for a whole view, `compact` inside a panel, card or chart. Both say what belongs here and how it fills up.
- **Do not use for:** Use LoadingRows or LoadingCount while a read is in flight and Notice when a read fails. Never leave a bare blank region or a lone "No items".
- **Why:** An explanation distinguishes an empty result from a missing or broken region. Design system v2: empty states align to the container's content edge instead of floating centred with their own padding.
- **Source:** [shadcn/ui Empty](https://ui.shadcn.com/docs/components/empty), [Apple ContentUnavailableView](https://developer.apple.com/documentation/swiftui/contentunavailableview), [VS Code Views (welcome content)](https://code.visualstudio.com/api/ux-guidelines/views)

Supply the semantic `IconRole` for the empty condition (such as `empty.inbox`), not a glyph name; only `empty.*` roles.

- **View** (default): icon at `size-icon-empty`, `title` in `type-heading`, `body` in `type-body` `muted`, `space-8` apart. It adds no padding and no centring: it starts at the content edge of the view it sits in, so it shares the page perimeter (`space-24` / `space-12`) with everything else. The container supplies that perimeter.
- **Compact** (`compact`): a `size-icon-small` mark, then two lines `space-4` apart: `title` in `type-label` `fg`, `body` in `type-caption` `muted`. It starts at the container's inset (`space-16` in a card or the right panel, `space-12` in a list row).
- Actions inside either variant follow action strength: a ghost Button for an action in place, a text link for navigation, and `primary` only when it is the one main action. Children follow the text and align to its left edge.
- The `character` variant (conversation artwork) stays centred.

Styles: style.css in this directory
