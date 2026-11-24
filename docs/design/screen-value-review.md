# Monitor / Threads / Branches: do these screens earn a place?

Snapshot: Studio `origin/main` at `78a3c22e` (after #133). This is a product-surface decision, not a proposal to add screens. Existing areas named in the comparison are the sidebar bands/search, Awaiting you, right panel (Activity, Reply needed, Awaiting reply, attachments, Info), Conversation, Analytics, and CLI.

## Recommendation

- **Monitor — Remove.** Its job is an at-a-glance status wall; the individual status, recent activity, awaiting state, and pin actions already exist in the sidebar and Awaiting you. The one useful out-of-list case is archived pinned Threads: #127 made Monitor read these itself, but the sidebar Archive band is now the direct home. No new destination is needed. Its tile preview is a costly duplicate of recent Conversation/Activity content.
- **Threads — Remove.** It is a second organizer alongside the sidebar's All/Pinned/Archive bands, search, tags, row menus, and group controls. Its bulk archive/unarchive and tag operations duplicate row-menu/band selection affordances, while moving/reparenting has no ordinary single-user use case unless reorganizing a family tree; expose that existing operation from the relevant sidebar row's existing Move action rather than retaining a second full-page organizer. It should not become a new screen.
- **Branches — Keep, redesigned.** This is the only screen with a distinct job: decide between divergent conversation histories. Sidebar bands and search find Threads but cannot show a shared ancestor, divergence point, branch topology, or compare excerpts. Conversation reads one selected Thread but cannot place two histories side-by-side. CLI can fork/rewind, but is not a visual comparison/preview. Make it a focused decision workspace, not a sprawling second conversation or branch administration console. Mock below.

## Function inventory and existing coverage

Line references below are on `web/designs/console/screens/{Monitor,Threads,Branches}.tsx` at the snapshot revision.

### Monitor (`Monitor.tsx`)

- Status wall: cards/tiles, live status, recent message/tool summaries, running command and elapsed duration (`Card` lines 20–45; `Tile` 47–80; view switch 134–138). **Covered:** sidebar rows show status/activity; Conversation and right-panel Activity show details; Analytics shows aggregate usage. A wall is only useful during a deliberate multi-Thread watch session; one user otherwise visits a row.
- Scope All / Pinned / Attention and counts (`Monitor` 139–143). **Covered:** sidebar All/Pinned bands; Awaiting you for attention/reply duties.
- Search, status chips, archive include/exclude/only, sort, refresh, clear filters (`Monitor` 145–165). **Covered:** sidebar search and Archive band; Awaiting you narrows to assigned response. Refresh is not needed as a separate control in the pushed-event UI.
- Tile previews read visible history via `TilePreviews`, including last messages/tool step summaries (`Tile` 50–77; reader lifecycle 104–108). **Covered:** Conversation history and right-panel Activity; this is duplicate display, not a separate action.
- Pin/unpin a row (`Tile` 66; card counterpart 35–43). **Covered:** sidebar pin row menu.
- Show archived Thread even when not in loaded shared rows; Monitor-owned archive reads and merged-cache resolution (#127; `Monitor.tsx` 108–127,175). **Covered:** sidebar Archive band and its own paged read. Rare operational reconciliation only; if a pin points at a missing/deleted Thread the row menu should state that, not retain a second archive browser.
- Page tiled layout and load more (`Monitor` 104,120–122,166–185). **Covered:** sidebar paging; card view has no pagination value beyond screen real estate.

**Removal delta:** remove route/import/render branch `App.tsx:13,349`; `Monitor.tsx` and its styles; Monitor i18n and preferences; `TilePreviews` reader/cache and its reader tests; monitor-owned archived row subscriptions/dedupe and stale-pin reconciliation tests (#127); Monitor-only page and archived-history tests; Monitor link/description in guides and design docs. Keep common row statuses, sidebar Archive/Pinned/Search, and Activity/Analytics. This is meaningful reduction: a second read/cache/filter/pin state owner disappears, not just a navigation link.

### Threads (`Threads.tsx`)

- Full Thread inventory; group by directory/state/tag and active vs archived mode (`Threads.tsx` 137–145,181–185,239–264). **Covered:** sidebar All/Pinned/Archive and search; sidebar group bands, status, tags. Directory/state/tag grouping is occasional organization, not a distinct daily destination.
- Search/filter and fold groups (`Threads.tsx` 174,263,299–318). **Covered:** sidebar search, group bands and existing folds.
- Select individual, entire group, and descendants (`Threads.tsx` 199–216,264–271,299–318). **Covered:** existing sidebar row selection and selection bar; not an exclusive function.
- Archive/unarchive selected Threads with confirmation, result and not-found counts (`Threads.tsx` 190–197,264–278). **Covered:** sidebar row menu and Archive band; bulk operations are occasional. Keep the action in the existing selection bar, not a screen.
- Apply/remove tags in bulk (`Threads.tsx` 178–180,258–262,269). **Covered:** sidebar tags and row menu. Infrequent maintenance can use existing selected-row action.
- Move/reparent by picker or drag/drop, with preview (`Threads.tsx` 178–180,217–232,257–258). **Not covered exactly:** CLI can set parent, but ordinary users rarely reorganize Thread ancestry (only when correcting a mistaken parent). Merge its existing Move picker into the sidebar row's existing Move action; do not preserve a second organizer. This is one occasional action, not a reason for a screen.
- Delete selected set with preview, blockers and confirmation (`Threads.tsx` 147,238,264–271 and `ThreadDeleteDialog`). **Covered:** the existing row menu and selection confirmation model; deletion is rare and already belongs next to the row.
- Accessible row focus restoration, group collapse, paging/partial directory member loading (`Threads.tsx` 148–171,285–362). **Covered:** conversation selection/sidebar navigation; these are duplicate implementation support, not a user function.

**Removal delta:** remove route/import/render branch `App.tsx:17,349`; `Threads.tsx`, full-page organization styles, grouping and screen-only query/grouping/archive state in the organization model; move-panel page host (retain the actual sidebar Move operation), organization-specific list readers/member paging; Thread page focus/grouping/archive tests. Retain shared multi-select/delete confirmation/tag/archive action logic by moving it to existing sidebar controls; retain any unique move picker within the current sidebar action. Remove Threads navigation/guide/docs. Do not delete shared sidebar tree, row actions, archive readers, or deletion protocol.

### Branches (`Branches.tsx`)

- Read the selected Thread's family and render graph or list (`Branches.tsx` 126–177,183–219). **Not covered:** other areas locate individual Threads, not the family topology or common fork history. Needed occasionally when comparing alternative approaches, but this is the core job users explicitly associate with branching; **Keep**.
- Select graph point and inspect message/position/fan-out (`Branches.tsx` 137–164,188–199,223–228; `PointPanel` 67–84). **Not covered:** Conversation can read one Thread, but cannot identify corresponding divergence points across branches; **Keep** as the comparison workspace.
- Compare branch Threads and excerpts (`Branches.tsx` 201–216; `BranchCompare`; excerpt reader 9–37). **Not covered:** right panel Info/Activity is for one Thread. This is the job's primary value; **Keep**.
- Fork from a selected point with a new request (`PointPanel` 86–93). **CLI covers the underlying operation**, but not the visual selection/confirmation context. Users do this when an approach is uncertain; **Keep** adjacent to comparison.
- Preview and confirm rewind, showing removed nodes/turns, children, pending replies, shells, attachments and irreversible warning (`PointPanel` 39–64,95–120). **CLI covers execution but not this structured impact preview.** Rare and high consequence; users need the graph context before choosing; **Keep**.
- Rename/select a branch, navigate to its conversation and page excerpts (`Branches.tsx` 202–219). **Covered:** Conversation and CLI for navigation/rename; selection/paging are comparison-specific; **Keep only selection in comparison, remove redundant renaming controls from the redesigned view** (rename remains available in CLI).

**Why a redesign, not one small fix:** current page combines graph, list, per-row controls, excerpt pagination, compare controls, fork, destructive rewind and a point inspector in one dense long page. The user needs to answer one question: “Which line of work diverged, what changed, and should I continue from it?” The mock proposes a graph/list choice, visible branch identity and selected-point inspector. Desktop keeps graph and inspector together. Phone becomes a list-first point picker followed by a focused detail rather than shrinking the graph. Fork stays beside context; rewind is collapsed behind a preview and an explicit impact summary. Conversation remains responsible for reading/writing the chosen Thread.

**Removal delta if ever removed:** route/import in `App.tsx:16,349`; `Branches.tsx`, `BranchGraph`, `BranchList`, `BranchCompare`, `PointPanel`, branch-specific graph CSS and branch navigation route/node query parameters; branch family/node/excerpt/fork/rewind readers and state; compare, receipt, exact-owner, rewind impact and browser interaction tests; docs in `docs/design/branches-threads.md` and user/agent guides. It would remove a significant, genuinely unique capability and still leave CLI-level forking/rewinding but no safe visual impact preview. Therefore do not remove it.

## Redesign mock

Clean clone on branch `wip/studio-screen-value-review`: `cd web && npm ci && npm run dev`, then `http://127.0.0.1:5173/branch-review-mock.html`. It is static fixture data, uses real Studio `Button`, `Field`, and `StatusMark` components and design tokens; it does not execute a fork or rewind. PNGs: `web/designs/console/mocks/branch-review-desktop.png` and `branch-review-phone.png`. Research and decision are in this Issue. The mock implements the Branches redesign only; Monitor and Threads recommendations are removals/merges into existing surfaces, not new screens.

## Pattern sources

- GitHub compare view: two refs, explicit base/compare direction, changed files and diff; applied as selected-branch comparison with the divergence context visible. https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests
- GitHub Desktop branch workflow: branch selection, compare-to-branch and change review organized around the branch being acted on. https://docs.github.com/en/desktop/making-changes-in-a-branch/viewing-branches-in-github-desktop
- GitKraken graph: commit topology and branch lanes make divergence/merge relationships spatially legible. https://help.gitkraken.com/gitkraken-client/graph/
- Material 3 list-detail: select an item in a list, inspect a focused detail pane; on compact width the detail becomes a separate destination with return navigation. Applied to desktop graph + inspector and phone list-first point detail. https://m3.material.io/foundations/layout/understanding-layout/overview
- WAI-ARIA APG disclosure: keep less-frequent destructive detail collapsed until requested, with a named control and explicit expanded state. Applied to rewind preview. https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
