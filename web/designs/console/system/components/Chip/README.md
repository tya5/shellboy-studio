# Chip

- **Use for:** A removable filter token inside a filter list (FilterChips), with its removal labelled; the count variant only where it is already in place for existing sidebar status filters.
- **Do not use for:** Use ButtonGroup to filter by a state count or to switch a view, ChildrenChip for descendants, a tag badge (`.tag-badge`) for an owner tag on a row, and Button for actions or menu triggers.
- **Why:** Design system v2 action strength keeps bordered chips for tags and removable tokens only, so a border means "this is a value you can remove".
- **Source:** [Material 3 Chips (input chips)](https://m3.material.io/components/chips/overview), [shadcn/ui Badge](https://ui.shadcn.com/docs/components/badge), [Studio sidebar filters](../../../../../../docs/design/branches-threads.md)

The removable variant shows the value and a remove icon; its accessible label describes the removal. The count variant shows a state and its count; pressing it again clears the filter. Height is `size-control` (`size-touch` at phone width).

Styles: style.css in this directory
