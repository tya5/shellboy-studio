// Branches (#138): a Thread's lines of work as coloured vertical lanes, where each split off, the two picked lines
// compared from their split, and New branch / Rewind on a selected message. Approved mock:
// web/designs/console/mocks/branches.tsx on wip/studio-branches-redesign-mock (53cf3c7). No flicker: rows keep
// their Core-ID keys across re-reads, loading shows only on the first read and on Show more, and the selection,
// its open actions and the scroll position survive event refreshes.
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { CAPABILITY_HISTORY_WINDOW, type HistoryItem } from "../../../data/src";
import { anchorCandidate, branchTitle, headNeed, formatAge, formatRoute, laneGraph, leavingRows, plainExcerpt, type AppModel, type BranchFamily, type BranchItem, type BranchTarget, type CompareSide, type Lane, type LaneGraph, type LaneNeed, type LaneRow, type NodeExcerpt, type RewindFacts, type Translate } from "../../../ui-core/src";
import { BranchLanes, LaneName, LaneTinted, type LaneMark, type LaneRowView } from "../system/components/BranchLanes";
import { Button } from "../system/components/Button";
import { Check } from "../system/components/Check";
import { EmptyState } from "../system/components/EmptyState";
import { Field } from "../system/components/Field";
import { Icon } from "../system/components/Icon";
import { KeyValue } from "../system/components/KeyValue";
import { LoadingRows } from "../system/components/LoadingRows";
import { Notice } from "../system/components/Notice";
import { PageHeader } from "../system/components/PageHeader";
import { StatusMark } from "../system/components/StatusMark";

const markOf = (l: Lane): LaneMark => ({ column: l.column, tone: l.tone });
const conversation = (threadId: string) => formatRoute({ view: "conversation", threadId });

function who(t: Translate, kind: string | undefined): string {
  if (kind === "user") return t("branches.whoUser");
  if (kind === "assistant_response") return t("branches.whoAssistant");
  if (kind === "tool_result") return t("branches.whoTool");
  return t("branches.whoOther");
}

function Said({ t, excerpt }: { t: Translate; excerpt: NodeExcerpt }) {
  return <><b>{who(t, excerpt.kind)}</b> {plainExcerpt(excerpt.excerpt) ?? ""}</>;
}

function LaneStatus({ t, item }: { t: Translate; item: BranchItem }) {
  return item.running ? <StatusMark status="running" label={t("status.running")} /> : <StatusMark status="idle" label={t("branches.idle")} word={false} />;
}

/** One line of work: its colour and name, where it came from, its size and age, and the Compare choice. */
function LineCard({ t, lane, name, parentName, now, picked, onPick }: { t: Translate; lane: Lane; name: string; parentName: string | undefined; now: number; picked: boolean; onPick: () => void }) {
  const i = lane.item;
  const origin = i.divergence && !lane.detached && parentName ? t("branches.splitFrom", { parent: parentName, n: i.divergence.ordinal + 1 }) : lane.detached && parentName ? t("branches.apart", { parent: parentName }) : t("branches.original");
  const age = formatAge(i.tipAt, now);
  const facts = [origin, ...(i.pathNodes !== undefined ? [t("branches.messages", { n: i.pathNodes.toLocaleString("en-US") })] : []), ...(age ? [t("branches.lastAt", { age })] : [])];
  return <LaneTinted as="li" mark={markOf(lane)} class="branch-line" data-picked={picked || undefined}>
    <span class="branch-line-head"><LaneName mark={markOf(lane)} name={name} strong /><LaneStatus t={t} item={i} /></span>
    <span class="caption muted">{facts.join(" · ")}</span>
    <Check checked={picked} onChange={onPick}>{t("branches.compare")}</Check>
  </LaneTinted>;
}

function RewindFactsView({ t, facts, lane, ordinal, at }: { t: Translate; facts: RewindFacts; lane: string; ordinal: number | undefined; at: NodeExcerpt | undefined }) {
  return <>
    <KeyValue rows={[
      ...(facts.removedNodes !== undefined ? [{ key: t("branches.leaves"), value: t("branches.leavesValue", { nodes: facts.removedNodes, turns: facts.removedTurns ?? 0, lane }) }] : []),
      ...(ordinal !== undefined ? [{ key: t("branches.endsAt"), value: <>#{ordinal + 1}{at?.excerpt ? <> “{plainExcerpt(at.excerpt)}”</> : null}</> }] : []),
      { key: t("branches.keptAs"), value: t("branches.keptAsValue") },
      { key: t("branches.notUndoneKey"), value: <>{t("branches.notUndoneValue", { n: facts.shells.count })}{facts.shells.items.length ? <>: {facts.shells.items.map((c, k) => <><code key={k}>{c}</code>{k < facts.shells.items.length - 1 ? ", " : ""}</>)}</> : null}</> },
      { key: t("branches.alsoKey"), value: t("branches.alsoValue", { children: facts.children.count, replies: facts.pendingReplies.count, attachments: facts.attachmentsRemoved }) },
    ]} />
    {facts.shells.truncated || facts.children.truncated || facts.pendingReplies.truncated ? <p class="muted caption">{t("branches.truncated")}</p> : null}
    {facts.intoSummary ? <p class="muted caption">{t("branches.intoSummary")}</p> : null}
    <Notice tone="wait">{t("branches.notUndone")}</Notice>
  </>;
}

/** The selected message's actions, open under its row: New branch from here, then Rewind with its preview first. */
function PointActions({ model, target, lane, ordinal, at }: { model: AppModel; target: BranchTarget; lane: string; ordinal: number | undefined; at: NodeExcerpt | undefined }) {
  const t = model.t.value;
  const b = model.branches;
  const [prompt, setPrompt] = useState("");
  const rewind = b.rewind.value;
  const fork = b.fork.value;
  const error = b.actionError.value;
  const previewShown = rewind.kind === "ready" || rewind.kind === "rewinding" || rewind.kind === "failed" || (rewind.kind === "done" && b.canRetryRewind());
  if (previewShown) {
    return <>
      <h3>{t("branches.rewindAsk", { lane, n: ordinal !== undefined ? ordinal + 1 : "?" })}</h3>
      <RewindFactsView t={t} facts={rewind.facts} lane={lane} ordinal={ordinal} at={at} />
      {rewind.kind === "failed" ? <Notice tone="bad">{t("branches.rewindFailed", { message: rewind.error.message })}</Notice> : null}
      <div class="branch-buttons">
        <Button variant="warn" disabled={rewind.kind === "rewinding"} onClick={() => void b.confirmRewind()}>{t("branches.rewindConfirm", { lane })}</Button>
        <Button variant="ghost" disabled={rewind.kind === "rewinding"} onClick={() => b.clearActions()}>{t("branches.cancel")}</Button>
      </div>
    </>;
  }
  return <>
    <Field label={t("branches.forkRequest")} value={prompt} onInput={(e) => setPrompt(e.currentTarget.value)} />
    <div class="branch-buttons">
      <Button variant="primary" disabled={fork.kind === "forking"} onClick={() => void b.forkAt(target, prompt)}><Icon role="branch.mark" size="small" />{t("branches.forkHere")}</Button>
      <Button variant="ghost" disabled={rewind.kind === "previewing"} aria-busy={rewind.kind === "previewing" || undefined} onClick={() => void b.previewRewind(target)}>{t("branches.rewindHere", { lane })}</Button>
    </div>
    <p class="caption muted">{t("branches.forkNote", { n: ordinal !== undefined ? ordinal + 1 : "?", lane })}</p>
    {fork.kind === "failed" ? <Notice tone="bad">{t("branches.forkFailed", { message: fork.error.message })}</Notice> : null}
    {fork.kind === "done" ? <Notice actions={<a class="nav-link" href={conversation(fork.threadId)}>{t("branches.openConversation")}</a>}>{t("branches.forkDone", { title: fork.title })}</Notice> : null}
    {rewind.kind === "refused" ? <Notice tone="bad">{t("branches.refused", { message: rewind.error.message })}</Notice> : null}
    {rewind.kind === "done" ? <Notice actions={rewind.facts.branchThreadId ? <a class="nav-link" href={conversation(rewind.facts.branchThreadId)}>{t("branches.openRemoved")}</a> : undefined}>{t("branches.rewoundLane", { lane, nodes: rewind.facts.removedNodes ?? 0 })}</Notice> : null}
    {error ? <Notice tone="bad">{error}</Notice> : null}
  </>;
}

/** Rows of one compared side after the split, skipping the anchor and the one-row overlap of later pages. */
function afterSplit(pages: readonly (readonly HistoryItem[])[]): HistoryItem[] {
  return pages.flatMap((page) => page.slice(1));
}

function CompareSideView({ t, side, lane, name, now, onMore }: { t: Translate; side: CompareSide; lane: Lane | undefined; name: string; now: number; onMore: () => void }) {
  const mark = lane ? markOf(lane) : { column: 0, tone: 0 };
  const rows = afterSplit(side.pages);
  const count = side.total !== undefined && side.ordinal !== undefined ? side.total - side.ordinal - 1 : undefined;
  const age = formatAge(side.item.tipAt, now);
  const first = side.busy && side.pages.length === 0;
  return <LaneTinted as="article" mark={mark} class="branch-side">
    <header class="branch-side-head"><LaneName mark={mark} name={name} strong /><LaneStatus t={t} item={side.item} /></header>
    {count !== undefined ? <p class="caption muted">{[t("branches.afterSplit", { n: count.toLocaleString("en-US") }), ...(age ? [t("branches.lastAt", { age })] : [])].join(" · ")}</p> : null}
    {first ? <LoadingRows label={t("common.loading")} rows={2} /> : null}
    {side.error ? <Notice tone="wait">{t("branches.compareError")}</Notice> : null}
    <ol class="branch-msgs">{rows.map((row) => <li key={row.node_id}>
      <span class="caption muted mono">#{(row.selection?.ordinal ?? 0) + 1}</span>
      <span><b>{who(t, row.kind)}</b> {plainExcerpt(row.excerpt) ?? t("branches.unread")}</span>
    </li>)}</ol>
    {side.next !== undefined && side.pages.length < 4 ? <Button variant="ghost" disabled={side.busy} aria-busy={side.busy || undefined} onClick={onMore}>{side.busy ? t("common.loading") : t("branches.compareMore")}</Button> : null}
    <a class="nav-link branch-open" href={conversation(side.item.threadId)}>{t("branches.openConversation")}<Icon role="app.open" size="small" /></a>
  </LaneTinted>;
}

/** Last shown pages per side, held while a refresh of the same pair reads again, so nothing blanks out. */
type Held = Map<string, CompareSide>;

function Compare({ model, family, graph, name, held }: { model: AppModel; family: BranchFamily; graph: LaneGraph; name: (i: BranchItem) => string; held: Held }) {
  const t = model.t.value;
  const c = model.branchCompare;
  const s = c.state.value;
  const now = model.coarseNow.value;
  if (s.selected.length !== 2) return <p class="muted">{t("branches.pickTwo")}</p>;
  if (!model.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW)) return <p class="muted">{t("branches.compareNeedsReads")}</p>;
  const pair = s.selected.map((id) => family.items.find((i) => i.threadId === id));
  if (s.unavailable || (pair[0] && pair[1] && !anchorCandidate(pair[0], pair[1], family))) return <Notice tone="wait">{t("branches.cantCompare")}</Notice>;
  const sides = s.selected.map((id) => {
    const live = s.sides.find((x) => x.item.threadId === id);
    const kept = held.get(`${s.selected.join("|")}|${id}`);
    // Keep what was shown while the same side is read again; the first read shows its loading rows.
    if (live && (live.pages.length || live.error || !kept)) return live;
    return kept;
  });
  const first = sides[0];
  const anchor = first?.pages.flat().find((item) => item.node_id === first.anchor);
  const split = first?.ordinal;
  return <>
    {split !== undefined ? <p class="branch-shared"><Icon role="branch.mark" size="small" /><span>{anchor?.excerpt ? t("branches.shared", { n: split + 1, text: (plainExcerpt(anchor.excerpt) ?? "").replace(/[.。]+$/u, "") }) : t("branches.sharedNoText", { n: split + 1 })}</span></p> : null}
    <div class="branch-sides">{sides.map((side, index) => side ? <CompareSideView key={side.item.threadId} t={t} side={side} lane={graph.byId.get(side.item.threadId)} name={name(side.item)} now={now} onMore={() => void c.more(index)} /> : null)}</div>
  </>;
}

export function Branches({ model }: { model: AppModel }) {
  const t = model.t.value;
  const b = model.branches;
  const c = model.branchCompare;
  const reader = b.lanes;
  const state = b.state.value;
  const family = state.family;
  const threadId = model.selectedId.value;
  const version = reader.version.value;
  const opening = b.opening.value;
  const openFailed = b.openFailed.value;
  const compare = c.state.value;
  const target = b.target.value;
  const rewind = b.rewind.value;
  const now = model.coarseNow.value;
  const supported = model.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW);
  const rowsById = model.rowById.value;
  const [phoneView, setPhoneView] = useState<"family" | "compare">("family");
  const scroller = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const visible = useRef(new Set<string>());
  const held = useRef<Held>(new Map());
  const picked = useRef<string | undefined>(undefined);

  const graph = useMemo(() => family ? laneGraph(family, (id, o) => reader.nodeAt(id, o), (id) => b.opened(id)) : undefined, [family, version]);
  const name = (i: BranchItem) => i.title ?? rowsById.get(i.threadId)?.summary.title ?? branchTitle(i);

  const needOf = (row: LaneRow): LaneNeed | undefined => {
    const lane = graph?.byId.get(row.lane);
    if (!lane || row.kind === "run") return undefined;
    if (row.nodeId) return { kind: "node", threadId: row.lane, nodeId: row.nodeId };
    return row.kind === "start" ? headNeed(lane) : undefined;
  };
  // Rows on screen ask for their text; a re-read asks again only for what is missing (want is idempotent).
  useEffect(() => {
    if (!graph) return;
    for (const row of graph.rows) if (visible.current.has(row.key)) { const need = needOf(row); if (need) b.want(need); }
  });
  const onVisible = (key: string, on: boolean) => {
    if (on) visible.current.add(key); else visible.current.delete(key);
    const row = graph?.rows.find((r) => r.key === key);
    const need = row && needOf(row);
    if (need) on ? b.want(need) : b.release(need);
  };

  // Default comparison: this Thread and the first line it can be compared with, once per Thread opened.
  useEffect(() => {
    if (!family || !graph || picked.current === family.threadId || compare.selected.length) return;
    const current = family.items.find((i) => i.threadId === family.threadId) ?? graph.lanes[0]?.item;
    const other = current && graph.lanes.map((l) => l.item).find((i) => i !== current && anchorCandidate(current, i, family));
    if (!current || !other) return;
    picked.current = family.threadId;
    c.choose(current.threadId);
    c.choose(other.threadId);
  }, [family, graph, compare.selected.length]);

  // Read the comparison when the pair changes, or when either side's tip or size changes in a re-read.
  useEffect(() => {
    if (!family || compare.selected.length !== 2 || compare.sides.some((x) => x.busy)) return;
    const fresh = compare.selected.every((id) => {
      const side = compare.sides.find((x) => x.item.threadId === id);
      const item = family.items.find((i) => i.threadId === id);
      return side && item && side.item.tipNodeId === item.tipNodeId && side.item.pathNodes === item.pathNodes;
    });
    if (!fresh && !compare.unavailable) void c.refresh(family);
  }, [family, compare, supported]);
  const pairKey = compare.selected.join("|");
  for (const side of compare.sides) if (side.pages.length && !side.busy && !side.error) held.current.set(`${pairKey}|${side.item.threadId}`, side);
  for (const key of [...held.current.keys()]) if (!key.startsWith(`${pairKey}|`) || compare.selected.length !== 2) held.current.delete(key);

  // The selected message: a row on the graph, or (from a Conversation link) a node shown above the graph.
  const targetRow = target ? graph?.rows.find((r) => r.lane === target.threadId && r.nodeId === target.nodeId) : undefined;
  const targetExcerpt = reader.node(target?.nodeId);
  const targetOrdinal = targetRow?.ordinal ?? targetExcerpt?.ordinal;
  useEffect(() => {
    if (target && !targetRow) b.want({ kind: "node", threadId: target.threadId, nodeId: target.nodeId });
  });

  // Phone: the comparison is its own view; coming back restores where the lane list was.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box && phoneView === "family") box.scrollTop = savedScroll.current;
  }, [phoneView]);
  const openCompare = () => { savedScroll.current = scroller.current?.scrollTop ?? 0; setPhoneView("compare"); if (scroller.current) scroller.current.scrollTop = 0; };

  if (threadId === undefined)
    return <div class="branches"><div class="branches-main"><EmptyState role="empty.branches" title={t("branches.noThread")} body={t("branches.noThreadBody")} /></div></div>;

  const current = family?.items.find((i) => i.threadId === family.threadId);
  const title = current ? name(current) : (rowsById.get(threadId)?.summary.title ?? threadId.slice(0, 8));
  const lanes = graph?.lanes ?? [];
  const nameOf = (id: string) => { const i = graph?.byId.get(id)?.item; return i ? name(i) : id.slice(0, 8); };

  const previewing = (rewind.kind === "ready" || rewind.kind === "rewinding" || rewind.kind === "failed") && target && rewind.target.threadId === target.threadId && rewind.target.nodeId === target.nodeId;
  const leaving = graph && previewing && targetOrdinal !== undefined ? leavingRows(graph, target!.threadId, targetOrdinal) : new Set<string>();
  const targetLane = target ? nameOf(target.threadId) : "";
  const actions = target ? <PointActions key={JSON.stringify([target.threadId, target.nodeId, b.targetRevision.value])} model={model} target={target} lane={targetLane} ordinal={targetOrdinal} at={targetExcerpt} /> : null;

  const firstRows = new Set<string>();
  const seenLanes = new Set<string>();
  for (const row of graph?.rows ?? []) if (!seenLanes.has(row.lane)) { seenLanes.add(row.lane); firstRows.add(row.key); }
  const views: LaneRowView[] = graph ? graph.rows.map((row) => {
    const lane = graph.byId.get(row.lane)!;
    const item = lane.item;
    const laneName = name(item);
    const base = { key: row.key, kind: row.kind, lane: markOf(lane), pass: row.pass.map((id) => markOf(graph.byId.get(id)!)), branchTo: row.branchTo.map((id) => markOf(graph.byId.get(id)!)), leaving: leaving.has(row.key) };
    if (row.kind === "run") {
      const from = row.from!, to = row.to!;
      const busy = opening.has(row.key);
      const canOpen = supported && b.canOpenMore();
      return { ...base, run: {
        text: from === to ? t("branches.runOne", { n: from + 1 }) : t("branches.run", { n: (to - from + 1).toLocaleString("en-US"), from: from + 1, to: to + 1 }),
        action: busy ? t("common.loading") : openFailed.has(row.key) ? t("branches.showFailed") : canOpen ? t("branches.showMore") : supported ? t("branches.openedMax") : undefined,
        busy,
        label: t("branches.showMoreAria", { from: from + 1, to: to + 1 }),
        ...(canOpen ? { onOpen: () => void b.open(row.lane, row.key, from, to) } : {}),
      }, leavingNote: targetOrdinal !== undefined ? t("branches.leavingNote", { lane: laneName, n: targetOrdinal + 1 }) : undefined };
    }
    const excerpt = reader.node(row.nodeId);
    const need = needOf(row);
    const failed = need ? b.failedFor(need) : false;
    const fallback = row.kind === "split" ? family!.items.find((i) => i.parentId === row.lane && i.divergence?.nodeId === row.nodeId)?.divergence?.request : row.kind === "tip" ? item.tipRequest : undefined;
    const pending = !excerpt && supported && !failed;
    const whoText = excerpt ? who(t, excerpt.kind) : fallback ? (row.kind === "tip" ? t("branches.lastRequest") : t("branches.request")) : undefined;
    const text: ComponentChildren = excerpt ? plainExcerpt(excerpt.excerpt) ?? ""
      : fallback ? fallback
      : row.kind === "start" ? (lane.start > 0 ? t("branches.firstAfter") : t("branches.startText"))
      : t("branches.unread");
    const shared = row.kind === "tip" && lane.end !== undefined && lane.end < lane.start;
    const meta = shared ? t("branches.noOwn") : row.ordinal !== undefined ? t("branches.at", { n: row.ordinal + 1, lane: laneName }) : laneName;
    const head = row.kind === "tip" ? <><LaneName mark={markOf(lane)} name={laneName} strong /><LaneStatus t={t} item={item} />{item.threadId === family?.threadId ? <span class="caption muted">{t("branches.thisThread")}</span> : null}<span class="caption muted">{t("branches.latest")}</span></> : undefined;
    const note = row.branchTo.length ? <>{row.branchTo.map((id) => <span key={id} class="branch-split-name"><Icon role="branch.mark" size="small" /><LaneName mark={markOf(graph.byId.get(id)!)} name={nameOf(id)} strong /></span>)}<span class="muted">{t("branches.splitsHere")}</span></> : undefined;
    return { ...base, first: firstRows.has(row.key) && (lane.start === 0 || lane.detached), head, who: pending ? undefined : whoText, text, pending, meta, note };
  }) : [];
  const selectedKey = targetRow?.key;
  const pickedLanes = compare.selected.map((id) => graph?.byId.get(id)).filter((l): l is Lane => !!l);
  const pick = (id: string) => {
    const chosen = compare.selected;
    if (!chosen.includes(id) && chosen.length >= 2) c.choose(chosen[0]!);
    c.choose(id);
  };
  const choose = (key: string) => {
    const row = graph?.rows.find((r) => r.key === key);
    if (!row?.nodeId) return;
    b.choose(key === selectedKey ? undefined : { threadId: row.lane, nodeId: row.nodeId });
  };

  return <div class="branches" data-phone-view={phoneView}>
    <div class="branches-main" ref={scroller}>
      <div class="branches-family">
        <PageHeader title={t("view.branches")} description={lanes.length > 1 ? t("branches.intro", { title, n: lanes.length }) : lanes.length === 1 ? t("branches.introOne", { title }) : undefined} />
        {state.error ? <Notice tone="bad" actions={<Button variant="ghost" onClick={() => void b.read(threadId)}>{t("common.refresh")}</Button>}>{t("common.readError", { message: state.error.message })}</Notice> : null}
        {!family && state.loading ? <LoadingRows label={t("common.loading")} rows={3} /> : null}
        {family?.familyTruncated ? <Notice tone="wait">{t("branches.familyTruncated", { n: family.familyThreads ?? 256 })}</Notice> : null}
        {family?.ancestorsTruncated ? <Notice tone="wait">{t("branches.ancestorsTruncated")}</Notice> : null}
        {family?.rootParentUnavailable ? <p class="muted caption">{t("branches.rootParent")}</p> : null}
      </div>
      {graph ? <section class="branches-lines" aria-label={t("branches.linesAria")}>
        <h2 class="branches-h branches-phone-only">{t("branches.compareTwo")}</h2>
        <ul class="branch-lines">{lanes.map((l) => <LineCard key={l.item.threadId} t={t} lane={l} name={name(l.item)} parentName={l.parent ? name(l.parent) : undefined} now={now} picked={compare.selected.includes(l.item.threadId)} onPick={() => pick(l.item.threadId)} />)}</ul>
      </section> : null}
      {graph ? <div class="branches-columns">
        <section class="branches-where" aria-label={t("branches.where")}>
          <h2 class="branches-h">{t("branches.where")}</h2>
          <p class="caption muted branches-key">{t("branches.keyBefore")} <span class="branches-key-split" aria-hidden="true" /> {t("branches.keyAfter")}</p>
          {target && !targetRow ? <div class="branch-pinned">
            <p class="branch-pinned-head"><b>{t("branches.selected")}</b> <span class="caption muted">{targetOrdinal !== undefined ? t("branches.at", { n: targetOrdinal + 1, lane: targetLane }) : targetLane}</span></p>
            {targetExcerpt ? <p class="branch-pinned-text"><Said t={t} excerpt={targetExcerpt} /></p> : null}
            <div class="branch-pinned-actions" role="group" aria-label={t("branches.actionsAria", { n: targetOrdinal !== undefined ? targetOrdinal + 1 : "?" })}>{actions}</div>
          </div> : null}
          <BranchLanes label={t("branches.graphAria", { title })} columns={graph.columns} rows={views} selected={selectedKey} onSelect={choose} actions={targetRow ? actions : undefined} selectedLabel={t("branches.actionsAria", { n: targetOrdinal !== undefined ? targetOrdinal + 1 : "?" })} onVisible={onVisible} />
        </section>
        <section class="branches-compare" aria-label={t("branches.differ")}>
          <div class="branches-phone-only branches-back"><Button variant="ghost" onClick={() => setPhoneView("family")}><Icon role="panel.back" size="small" />{t("view.branches")}</Button></div>
          <h2 class="branches-h">{t("branches.differ")}</h2>
          {family ? <Compare model={model} family={family} graph={graph} name={name} held={held.current} /> : null}
        </section>
      </div> : null}
    </div>
    {graph && lanes.length > 1 ? <div class="branches-bar branches-phone-only">
      <span class="caption branches-bar-text">{pickedLanes.length === 2 ? <><LaneName mark={markOf(pickedLanes[0]!)} name={name(pickedLanes[0]!.item)} /> {t("branches.and")} <LaneName mark={markOf(pickedLanes[1]!)} name={name(pickedLanes[1]!.item)} /></> : t("branches.compareCount")}</span>
      <Button variant="primary" disabled={pickedLanes.length !== 2} onClick={openCompare}>{t("branches.compare")}</Button>
    </div> : null}
  </div>;
}
