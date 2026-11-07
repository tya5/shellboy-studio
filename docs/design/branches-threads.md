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

Display modes: tree (the default, real parents across directories), by directory, by state, by tag (the last two headings-first when the owner has the capability, below). Per-directory token totals are omitted: no bounded read gives them, since by-Thread usage is a walk of all history.

**Moving a Thread.** `thread set --parent` is on Shellboy main (`5806aa77`), not in v0.10.0, whose strict decoding would refuse the field, and protocol 2 has no way to ask an owner what it can do. So the capability `thread.reparent` says what this bridge was built to send (`seam::owner_capabilities`), and the UI reads only that:

- A normal build, pinned to v0.10.0, doesn't have it (nor `live.text`, which follows the same pattern: `bridge.md`, `data-layer.md`). Threads says moving isn't available and why, draws no control and no drag, and the bridge denies `thread.set`. **The pin wasn't moved.**
- With the Cargo feature `next-shellboy`, in a copy with a `[patch]` of the dependency to Shellboy main, the bridge allows `thread.set` carrying only `parent_id` and nothing else `thread.set` can do. `tests/real_owner.rs` covers it under that feature. When the pin passes that commit, the feature goes and the arm stays.
- A picker (filter, and "No parent") or a drag onto another row leads to the same preview. There is no owner dry run, so the preview states what will change and what won't. Nothing moves until Move. A cycle is left to the owner, whose refusal shows as it wrote it. A result with `parent_change.live_run_id` says the Run keeps its previous owner. Drag is mouse only; phones use the picker.

**Tags and directories** (#222 stage 3) are behind the capability `thread.tags` (and `thread.cwds` for directories), which `seam::owner_capabilities` advertises only in a build with the Cargo feature `next-tags` (and `next-cwds`). Both are on Shellboy branches (`issue-222/tags-4`), not in v0.10.0, so a normal build shows what it showed before: Tag says "Tags aren't available ... needs a newer version", Directory groups the Threads read so far and says so, and no tag control exists. `next-tags` was compiled and its allowlist test run against a copy of `issue-222/tags-4`; `next-cwds` names `Command::ThreadCwds`, which no Shellboy has yet, and has never been compiled.

Wire used (docs/design/protocol.md on `issue-222/tags-4`): `thread.tag {thread_ids, add, remove}` returns `{changed, unchanged, not_found, add, remove}`; `thread.tags {limit, cursor}` returns distinct names as strings; `thread.list` takes `tags` (AND) and `cwd`; `ThreadSummary` and `ThreadDetails` carry `tags`, omitted when empty. Browser and Watch rows carry no tags, so the view reads through `thread.list`.

**Assumed, and kept in one place:** `thread.cwds {limit, cursor}` mirrors `thread.tags` (a page of strings). `Operations.threadCwds` is the only code that says so. If the real shape differs, that function and its decoder change and nothing else.

- **Headings, then members.** Tag and Directory show headings from `thread.tags` / `thread.cwds` (200 per page, at most 5 pages held, 1000 names) and nothing else until a heading is opened. Opening reads `thread.list` with `tags: [name]` or `cwd: name`, in the shown Active/Archived mode and filter, 100 per page, at most 5 pages (500 rows) per heading. At most 6 headings stay open; opening a seventh closes the one opened first. Memory and calls are therefore bounded by those numbers, not by how many Threads exist. Headings and members re-read to the same depth when the list changes; an expired cursor starts the walk over up to 3 times, then shows the error.
- **No counts, no ordering by size.** The owner reports none, so a heading shows a count only after it is opened (what was read) and headings stay in the owner's byte order. A tag filter that names the narrowest tag first is not offered: nothing says which is narrowest.
- **Tag mode** lists a Thread under each of its tags. Threads without a tag are not reachable by a filter, so they are only in the other views (the view says so). A heading can be empty in the shown mode (names are not archive-aware).
- **Editing.** Choose Threads (rows of open headings, or any flat view), press Tags, write tags to add (the owner's rule is checked first: trimmed, one line, 1 to 128 characters, no control characters) and press tags already on the chosen Threads to remove them, then Apply: one `thread.tag` with an operation ID. At most 200 Threads per call (checked before sending); a tag cannot be in both lists. The result is shown as the owner gave it: changed, unchanged, and `not_found` for Threads gone since the read. Exceeding 64 tags on a Thread is `input_limit`, reported as such ("nothing was changed"), and the draft stays. Nothing is optimistic: names and open headings are read again after a success. Suggestions are the first 12 known names; removal offers only tags of chosen rows that have been read.
- **Selection** in a heading mode keeps to rows still shown: closing a heading drops its rows from the selection, so the selection is bounded by what is loaded.
- Tags are shown on rows as small labelled items (`SelectRow tags`), only when the owner has the capability.

## Validation record (2026-11-07)

Chrome headless, temp owner (`shellboy` 0.10.0), temp data dir, loopback mock provider. Console, Light and Terminal at 1440 and 390 px; Japanese. Real family with forks at two points, a nested fork, a plain child. Seen working, on the final build: graph, list, point panel, rewind preview, real rewind with the link to the kept child, fork, marks, archive with second press, unarchive, group by state. `tests/real_owner.rs` covers the same against a real owner. Not tested: real phones, Safari, Firefox, a family over 200 Threads (paging is unit tests only), `pending_replies` above 0, a real model.
