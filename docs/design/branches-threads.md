# Branches and Threads

Status: implemented (2026-11-07), local only. From Shellboy `v0.10.0`: `thread branches`, `thread fork`, `thread rewind`, `thread archive`, `thread unarchive`, `thread list`. Logic is in `web/ui-core/src/branches.ts`, `org.ts` and `branching.ts`; screens in `web/designs/console/screens/Branches.tsx` and `Threads.tsx`.

## Branches: what is real

`thread.branches` returns the family: `depth`, `state`, `running`, `pruned_originals`, `divergence` (`node_id`, `ordinal`, `parent_continues`, `request`), `divergence_unknown`, `tip`, and `size` (`path_nodes`, `nodes_after_divergence`). So node counts on the graph are from the read: run lengths are differences of ordinals, and a lane's last stretch is `path_nodes - 1 - ordinal`.

- Columns follow order, not distance: counts can differ by thousands. Lanes depth first; tips in one last column.
- Current path: the current Thread, and each ancestor up to where the next one leaves.
- A tip opens as a conversation. A point opens the panel.
- `no_shared_prefix` starts apart and is never joined. `parent_continues: false` reads "extends its parent": the owner reports this for a rewind child and for a fork made at the parent's end alike, so the UI doesn't call it a rewind.
- Paging: 200 per page, up to 4 pages (a family is at most 256 Threads). `cursor_expired` means the family changed: start over, at most 3 times, then report it. `family_truncated`, `ancestors_truncated` and `root_parent_unavailable` are shown.
- Reads: on opening the view and when the Thread list changes; one at a time, one trailing. No polling.

**Fork** is non-destructive, so it runs on one press. **Rewind** shows `dry_run` first: nodes and turns that leave, path size, shell commands, children, replies still expected and attachments unselected, that files and shell effects aren't undone, and the undo path. Confirming is a second explicit press on the same point; choosing another point withdraws the preview. A real result links `branch_thread_id`, the child holding the removed part; opening it is the undo. There is no in-place forward. The owner's refusals (a live Run, the node is already the end, an unfinished tool call) show as its message.

**Conversation marks:** one family read per Thread opened, again when the list shows its children changed. `thread.get`'s `children_count` didn't count forks when checked on the real owner (0 with 4 children), so it can't decide this. A point on a node with no row goes on the row before it. A point outside the window read shows nothing. Each message has a quiet `Branch or rewind from here` link to `#/branches/<thread>/<node>`, shown on hover or focus on a wide frame.

## Not shown, and what core would need

| Missing | Need |
|---|---|
| Side-by-side compare of two tips | Reading two Threads from a divergence is possible, but it has no UI yet (user decision: omit for now) |
| Usage per branch since a point | `usage.get` by Thread and period exists, but not "since this node" |
| Whether a child came from a rewind or a fork | A `kind` on the branch item |
| Rewinding to just before a node (`exclude_node`) | Exists in the owner; left out to keep one meaning per link |

## Threads: what is real

`thread.list` in `exclude` or `only` mode, `query` sent to the owner, up to 200 per page. Grouped by directory or state, with the tree from real `parent_id`s; a parent in another group is named. Multi-select archive and unarchive call the real operations, with `descendants` on by default (the owner's bound applies: 200 IDs, 256 in a subtree, refused as `input_limit`). Archive needs a second press, as in Monitor, and states that nothing is deleted. Unarchive is one press. Nothing is optimistic: the list is read again afterwards.

Display modes: tree (the default, real parents across directories), by directory, by state, by tag. Per-directory token totals are omitted: no bounded read gives them, since by-Thread usage is a walk of all history.

**Moving a Thread.** `thread set --parent` is on Shellboy main (`5806aa77`), not in v0.10.0, whose strict decoding would refuse the field, and protocol 2 has no way to ask an owner what it can do. So the capability `thread.reparent` says what this bridge was built to send (`seam::owner_capabilities`), and the UI reads only that:

- A normal build, pinned to v0.10.0, doesn't have it. Threads says moving isn't available and why, draws no control and no drag, and the bridge denies `thread.set`. **The pin wasn't moved.**
- With the Cargo feature `next-shellboy`, in a copy with a `[patch]` of the dependency to Shellboy main, the bridge allows `thread.set` carrying only `parent_id` and nothing else `thread.set` can do. `tests/real_owner.rs` covers it under that feature. When the pin passes that commit, the feature goes and the arm stays.
- A picker (filter, and "No parent") or a drag onto another row leads to the same preview. There is no owner dry run, so the preview states what will change and what won't. Nothing moves until Move. A cycle is left to the owner, whose refusal shows as it wrote it. A result with `parent_change.live_run_id` says the Run keeps its previous owner. Drag is mouse only; phones use the picker.

**Tags** (#222 stage 3) have no wire yet, so the Tag mode says so. `CAPABILITY_TAGS` and `groupThreads` are the seam, and nothing assumes a shape.

## Validation record (2026-11-07)

Chrome headless, temp owner (`shellboy` 0.10.0), temp data dir, loopback mock provider. Console, Light and Terminal at 1440 and 390 px; Japanese. Real family with forks at two points, a nested fork, a plain child. Seen working, on the final build: graph, list, point panel, rewind preview, real rewind with the link to the kept child, fork, marks, archive with second press, unarchive, group by state. `tests/real_owner.rs` covers the same against a real owner. Not tested: real phones, Safari, Firefox, a family over 200 Threads (paging is unit tests only), `pending_replies` above 0, a real model.
