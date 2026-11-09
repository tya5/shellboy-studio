import { useEffect, useRef, useState } from "preact/hooks";
import { CAPABILITY_HISTORY_WINDOW } from "../../../data/src";
import { branchLayout, branchTitle, formatClock, formatRoute, statusLabel, type AppModel, type BranchFamily, type BranchItem, type BranchTarget, type GraphPoint, type RewindFacts, type Translate } from "../../../ui-core/src";
import { BranchGraph, BranchList, Button, ButtonGroup, Check, EmptyState, Field, KeyValue, Notice } from "../system/components";
import { Rich } from "./Rich";

const tipRoute = (i: BranchItem) => formatRoute({ view: "conversation", threadId: i.threadId });

function BranchExcerpt({ model, item }: { model: AppModel; item: BranchItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [saved, save] = useState<{ item?: BranchItem; facts: { split?: string; request?: string; answer?: string } }>({ facts: {} });
  const facts = saved.item === item ? saved.facts : {};
  const supported = model.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW) && model.data.owner.value.state === "connected" && !model.data.threadList.value.stale && !model.data.threadList.value.loading && !model.branches.state.value.loading && !model.branches.state.value.error;
  useEffect(() => {
    if (!supported || !ref.current) return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) {
        if (!release) release = model.branches.excerptBatch.show(item, facts => save({ item, facts }));
      } else { release?.(); release = undefined; save({ facts: {} }); }
    }, { rootMargin: "0px" });
    observer.observe(ref.current.parentElement ?? ref.current);
    return () => { release?.(); save({ facts: {} }); observer.disconnect(); };
  }, [model, item, supported]);
  if (!supported) return null;
  const t = model.t.value;
  return <div ref={ref} class="branch-excerpts"><p><b>{t("branches.splitExcerpt")}</b> {facts.split ?? t("branches.excerptUnknown")}</p><p><b>{t("branches.firstRequest")}</b> {facts.request ?? t("branches.excerptUnknown")}</p><p><b>{t("branches.latestAnswer")}</b> {facts.answer ?? t("branches.excerptUnknown")}</p></div>;
}

function RewindPreview({ t, facts }: { t: Translate; facts: RewindFacts }) {
  return (
    <>
      <KeyValue
        rows={[
          ...(facts.removedNodes !== undefined ? [{ key: t("branches.leaving"), value: t("branches.leavingValue", { nodes: facts.removedNodes, turns: facts.removedTurns ?? 0 }), mono: true }] : []),
          ...(facts.pathBefore !== undefined && facts.pathAfter !== undefined ? [{ key: t("branches.path"), value: t("branches.pathValue", { before: facts.pathBefore, after: facts.pathAfter }), mono: true }] : []),
          { key: t("branches.shells"), value: facts.shells.count, mono: true },
          { key: t("branches.children"), value: facts.children.count, mono: true },
          { key: t("branches.replies"), value: facts.pendingReplies.count, mono: true },
          { key: t("branches.attachments"), value: facts.attachmentsRemoved, mono: true },
        ]}
      />
      {facts.shells.items.length > 0 ? (
        <ul class="steps-list">
          {facts.shells.items.map((c, i) => (
            <li key={i} class="mono caption">{c}</li>
          ))}
        </ul>
      ) : null}
      {facts.shells.truncated || facts.children.truncated || facts.pendingReplies.truncated ? <div class="muted caption">{t("branches.truncated")}</div> : null}
      {facts.intoSummary ? <div class="muted caption">{t("branches.intoSummary")}</div> : null}
      <Notice tone="wait">{t("branches.notUndone")}</Notice>
      <div class="muted caption">{t("branches.undoPath")}</div>
    </>
  );
}

function PointPanel({ model, target, title, request, branches, ordinal }: { model: AppModel; target: BranchTarget; title: string; request: string | undefined; branches: number | undefined; ordinal: number | undefined }) {
  const t = model.t.value;
  const b = model.branches;
  const [prompt, setPrompt] = useState("");
  const rewind = b.rewind.value;
  const fork = b.fork.value;
  return (
    <>
      <h3>{t("branches.point")}</h3>
      <KeyValue
        rows={[
          { key: t("branches.onThread"), value: title },
          { key: t("branches.node"), value: target.nodeId.slice(0, 8), mono: true },
          ...(ordinal !== undefined ? [{ key: t("branches.position"), value: ordinal + 1, mono: true }] : []),
          ...(branches !== undefined ? [{ key: t("branches.leave"), value: branches, mono: true }] : []),
        ]}
      />
      {request ? <div class="muted">{request}</div> : null}

      <h3>{t("branches.forkTitle")}</h3>
      <div class="muted caption">{t("branches.forkBody")}</div>
      <Field ariaLabel={t("branches.newRequest")} value={prompt} onInput={e => setPrompt(e.currentTarget.value)} />
      <div class="band">
        <Button variant="primary" disabled={fork.kind === "forking"} onClick={() => void b.forkAt(target, prompt)}>{t("branches.fork")}</Button>
      </div>
      {fork.kind === "failed" ? <Notice tone="bad">{t("branches.forkFailed", { message: fork.error.message })}</Notice> : null}
      {fork.kind === "done" ? <Notice actions={<a class="btn link" href={formatRoute({ view: "conversation", threadId: fork.threadId })}>{t("monitor.open")}</a>}>{t("branches.forked", { title: fork.title })}</Notice> : null}

      <h3>{t("branches.rewindTitle", { title })}</h3>
      {rewind.kind === "idle" || rewind.kind === "previewing" || rewind.kind === "refused" ? (
        <>
          <div class="muted caption">{t("branches.rewindBody")}</div>
          <div class="band">
            <Button disabled={rewind.kind === "previewing"} onClick={() => void b.previewRewind(target)}>{rewind.kind === "previewing" ? t("common.loading") : t("branches.preview")}</Button>
          </div>
          {rewind.kind === "refused" ? <Notice tone="bad">{t("branches.refused", { message: rewind.error.message })}</Notice> : null}
        </>
      ) : null}
      {rewind.kind === "ready" || rewind.kind === "rewinding" || rewind.kind === "failed" ? (
        <>
          <div class="muted caption">{t("branches.previewNote")}</div>
          <RewindPreview t={t} facts={rewind.facts} />
          {rewind.kind === "failed" ? <Notice tone="bad">{t("branches.rewindFailed", { message: rewind.error.message })}</Notice> : null}
          <div class="band">
            <Field ariaLabel={t("branches.newRequest")} value={prompt} onInput={e => setPrompt(e.currentTarget.value)} />
            <Button variant="warn" disabled={rewind.kind === "rewinding"} onClick={() => void b.confirmRewind(prompt)}>{t("branches.confirm")}</Button>
            <Button disabled={rewind.kind === "rewinding"} onClick={() => b.clearActions()}>{t("branches.cancel")}</Button>
          </div>
        </>
      ) : null}
      {rewind.kind === "done" ? (
        <Notice actions={rewind.facts.branchThreadId ? <a class="btn link" href={formatRoute({ view: "conversation", threadId: rewind.facts.branchThreadId })}>{t("branches.openRemoved")}</a> : undefined}>
          {t("branches.rewound", { nodes: rewind.facts.removedNodes ?? 0 })}
        </Notice>
      ) : null}
    </>
  );
}

export function Branches({ model }: { model: AppModel }) {
  const t = model.t.value;
  const b = model.branches;
  const [page, setPage] = useState<{ family?: BranchFamily; index: number }>({ index: 0 });
  const [rename, setRename] = useState<Record<string, string>>({});
  const state = b.state.value;
  const family = state.family;
  const excerptPage = page.family === family ? page.index : 0;
  const setExcerptPage = (index: number) => setPage({ family, index });
  const threadId = model.selectedId.value;

  const rows = model.rowById.value;
  const title = (i: BranchItem) => i.title ?? rows.get(i.threadId)?.summary.title ?? branchTitle(i);
  const note = (i: BranchItem): string => {
    const parts: string[] = [];
    if (i.state === "current") parts.push(t("branches.current"));
    if (i.divergenceUnknown) parts.push(t("branches.noShared"));
    else if (i.divergence && !i.divergence.parentContinues) parts.push(t("branches.extends"));
    const status = rows.get(i.threadId)?.status;
    if (i.running) parts.push(t("status.running"));
    else if (status) parts.push(statusLabel(t, status));
    if (i.prunedOriginals) parts.push(t("branches.pruned"));
    const at = i.tipAt ? `${i.tipAt.slice(5, 10)} ${formatClock(i.tipAt) ?? ""}` : undefined;
    if (at) parts.push(at);
    return parts.join(", ");
  };
  if (threadId === undefined)
    return (
      <div class="branches" data-layout="list">
        <div class="branches-main"><EmptyState icon="branch" title={t("branches.noThread")} body={t("branches.noThreadBody")} /></div>
      </div>
    );
  const layout = family ? branchLayout(family) : undefined;
  const target = b.target.value;
  const point = target ? layout?.points.find((p) => p.threadId === target.threadId && p.nodeId === target.nodeId) : undefined;
  const pick = (p: GraphPoint) => model.navigate({ view: "branches", threadId, nodeId: p.nodeId });
  const onThread = target ? family?.items.find((i) => i.threadId === target.threadId) : undefined;
  const items = layout?.lanes.map((l) => l.item) ?? [];
  const fromHere = (i: BranchItem) => (i.divergence && i.parentId ? <a class="btn" href={formatRoute({ view: "branches", threadId, nodeId: i.divergence.nodeId })}>{t("branches.choose")}</a> : undefined);
  const current = family?.items.find((i) => i.threadId === family.threadId);
  return (
    <div class="branches" data-layout={b.layout.value}>
      <div class="branches-main">
        <div class="head">
          <div class="pagehead">
            <h1>{t("view.branches")}</h1>
            <div class="muted">{current ? `${title(current)}. ` : ""}{t("branches.sub")}</div>
          </div>
          <span class="branch-layout">
            <ButtonGroup label={t("branches.layout")}>
              <Button aria-pressed={b.layout.value === "graph"} onClick={() => (b.layout.value = "graph")}>{t("branches.graph")}</Button>
              <Button aria-pressed={b.layout.value === "list"} onClick={() => (b.layout.value = "list")}>{t("branches.list")}</Button>
            </ButtonGroup>
          </span>
        </div>
        {state.error ? <Notice tone="bad" actions={<Button onClick={() => void b.read(threadId)}>{t("common.refresh")}</Button>}>{t("common.readError", { message: state.error.message })}</Notice> : null}
        {!family && state.loading ? <div class="muted">{t("common.loading")}</div> : null}
        {family && layout ? (
          <>
            {family.familyTruncated ? <Notice tone="wait">{t("branches.familyTruncated", { n: family.familyThreads ?? 256 })}</Notice> : null}
            {family.ancestorsTruncated ? <Notice tone="wait">{t("branches.ancestorsTruncated")}</Notice> : null}
            {family.rootParentUnavailable ? <div class="muted caption">{t("branches.rootParent")}</div> : null}
            <BranchGraph
              layout={layout}
              selected={point?.key}
              onPoint={pick}
              tipHref={tipRoute}
              tipTitle={title}
              tipNote={note}
              nodesText={(n) => t("branches.nodes", { n: n.toLocaleString("en-US") })}
              pointAria={(p) => t("branches.pointAria", { request: p.request ?? p.nodeId.slice(0, 8), n: p.branches })}
              startText={t("branches.start")}
              aria={t("branches.aria", { threads: items.length, points: layout.points.length })}
            />
            <div class="band"><Button disabled={!b.selection.value.size || b.actionBusy.value} onClick={() => void b.archiveSelected()}>{t("branches.archiveSelected")}</Button></div>
            {b.actionError.value ? <Notice tone="bad">{b.actionError.value}</Notice> : null}
            <BranchList
              label={t("view.branches")}
              rows={items.slice(excerptPage * 8, (excerptPage + 1) * 8).map((i) => {
                const action = <div class="band"><Check checked={b.selection.value.has(i.threadId)} onChange={() => b.toggleBranch(i.threadId)}>{t("branches.select")}</Check><Field ariaLabel={t("branches.rename")} placeholder={t("branches.rename")} value={rename[i.threadId] ?? ""} onInput={e => setRename({ ...rename, [i.threadId]: e.currentTarget.value })} /><Button disabled={!(rename[i.threadId] ?? "").trim() || b.actionBusy.value} onClick={() => void b.renameBranch(i.threadId, rename[i.threadId] ?? "")}>{t("branches.rename")}</Button>{fromHere(i)}</div>;
                return {
                  key: i.threadId,
                  depth: i.depth,
                  title: title(i),
                  href: tipRoute(i),
                  note: [note(i), i.nodesAfterDivergence !== undefined ? t("branches.after", { n: i.nodesAfterDivergence.toLocaleString("en-US") }) : i.pathNodes !== undefined ? t("branches.nodes", { n: i.pathNodes.toLocaleString("en-US") }) : ""].filter(Boolean).join(", "),
                  current: i.state === "current",
                  excerpt: <BranchExcerpt model={model} item={i} />,
                  ...(action ? { action } : {}),
                };
              })}
            />
            <ButtonGroup label={t("view.branches")}><Button disabled={excerptPage === 0} onClick={() => { b.excerptBatch.reset(); setExcerptPage(excerptPage - 1); }}>{t("branches.previousBatch")}</Button><Button disabled={(excerptPage + 1) * 8 >= items.length} onClick={() => { b.excerptBatch.reset(); setExcerptPage(excerptPage + 1); }}>{t("threads.more")}</Button></ButtonGroup>
            <div class="muted caption">{t("branches.hint")}</div>

          </>
        ) : null}
      </div>
      <aside class="branches-side" aria-label={t("branches.point")}>
        {target ? (
          <PointPanel model={model} target={target} title={onThread ? title(onThread) : (rows.get(target.threadId)?.summary.title ?? target.threadId.slice(0, 8))} request={point?.request} branches={point?.branches} ordinal={point?.ordinal} />
        ) : (
          <div class="muted caption"><Rich text={t("branches.pick")} /></div>
        )}
      </aside>
    </div>
  );
}
