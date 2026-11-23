# ChildrenChip

- **Use for:** Summarize loaded descendants beside the parent Thread link, using waiting then running for urgency; disclose only locally revealable children.
- **Do not use for:** Use Chip for Monitor filter counts; never claim unloaded or filtered-out descendants.
- **Why:** An in-flow chip leaves title and actions independent; a static chip avoids offering a disclosure that can't reveal anything.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md)

In-flow control beside a Thread link. It shows the count of loaded descendants,
with the waiting-for-you and running subsets. Waiting for you takes color priority.
Keep it separate from the title link and action menu. Do not use it as a count of
unloaded or filtered-out Threads.

References: Orca sidebar, shadcn/ui Sidebar, WAI-ARIA tree disclosure behavior.

Styles: style.css in this directory

When no child can be revealed inside the current group, the badge is a static summary with no disclosure button or Left/Right action.


Compact chips use the shared sizing tokens: 20px height, 10px status/meaning icons, 11px tabular numbers and symmetric 7px horizontal padding. Use the highest-priority represented state for the surface: waiting-for-you amber first, running blue next, otherwise neutral. References: Orca sidebar child count/urgency treatment; approved Studio sidebar mock v8, section 1a B1.
