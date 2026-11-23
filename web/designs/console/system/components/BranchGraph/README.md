# BranchGraph

- **Use for:** Show a Thread family's divergence points and tips as lanes on a wide frame; points are buttons and tips are Thread links.
- **Do not use for:** Use BranchList on phones or for a compact text view.
- **Why:** Columns express structure, not node distance; collapsed stretches carry counts, and unrelated lanes never join by guesswork.
- **Source:** [Studio Branches design](../../../../../../docs/design/branches-threads.md#branches-what-is-real)

A Thread family as horizontal lanes in inline SVG: divergence points and tips, with the runs between them collapsed. Columns follow structure, the order of points along the paths, not distance in nodes, so counts are written on the stretches instead of implied by length. The current path uses `accent`; everything else stays on `line-strong`. A point is a button; a tip is a link that opens that Thread. It scrolls inside its own frame when the family is wide, and is replaced by BranchList at phone width. A lane with no shared prefix starts apart and is never joined by a guess.

Styles are colocated in `system/components/BranchGraph/style.css`.

Styles: style.css in this directory
