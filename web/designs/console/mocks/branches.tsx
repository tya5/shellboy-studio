// Static design mock for shellboy-studio #138: the Branches screen answers "where did this Thread split,
// how do the lines differ, and which one do I continue from". Fixture data and local state only: no owner,
// no Core call; Fork and Rewind never run. Patterns and sources: docs/design/branches-redesign-research.md.
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { Check } from "../system/components/Check";
import { Field } from "../system/components/Field";
import { Icon } from "../system/components/Icon";
import { KeyValue } from "../system/components/KeyValue";
import { Notice } from "../system/components/Notice";
import { PageHeader } from "../system/components/PageHeader";
import { StatusMark } from "../system/components/StatusMark";
import { Frame, ThemeRow, mountMock } from "./frame";
import "./branches.css";

type LaneId = "a" | "b" | "c";
type Who = "You" | "Shellboy";
type Lane = { id: LaneId; col: number; name: string; running: boolean; origin: string; current?: boolean; last: string };
/** One visible message, or a collapsed run of messages between two visible ones. */
type Item = { n: number; who: Who; text: ComponentChildren; quote?: string } | { from: number; to: number };

// Each lane has its own colour token and its name is always written next to the colour.
const lanes: readonly Lane[] = [
  { id: "a", col: 0, name: "Release notes", running: false, origin: "The original line", current: true, last: "2 h ago" },
  { id: "b", col: 1, name: "Streaming output", running: true, origin: "Split from Release notes after #6", last: "4 min ago" },
  { id: "c", col: 2, name: "Streaming + retry", running: false, origin: "Split from Streaming output after #10", last: "18 min ago" },
];
const lane = (id: LaneId) => lanes.find(l => l.id === id)!;
const laneStyle = (id: LaneId) => ({ "--lane": `var(--chart-${lane(id).col + 1})`, "--c": lane(id).col }) as JSX.CSSProperties;

const shared: Item[] = [
  { n: 1, who: "You", text: "Draft the v0.15 release notes from the changelog." },
  { from: 2, to: 5 },
  { n: 6, who: "You", text: "Compare provider behavior before writing.", quote: "Compare provider behavior before writing" },
];
const history: Record<LaneId, Item[]> = {
  a: [...shared,
    { n: 7, who: "You", text: "Keep the stable renderer and list the fixes." },
    { n: 8, who: "Shellboy", text: "Kept it. 12 fixes drafted under Fixed." },
    { from: 9, to: 12 },
    { n: 13, who: "You", text: "Lint the notes and fix the headings." },
    { n: 14, who: "Shellboy", text: "Notes are done and linted. Ready to tag." }],
  b: [...shared,
    { n: 7, who: "You", text: "Try streaming output for long answers." },
    { n: 8, who: "Shellboy", text: "Prototype streams chunks as they arrive." },
    { n: 9, who: "You", text: "What happens on a retry?" },
    { n: 10, who: "Shellboy", text: "Retries drop the chunks already shown.", quote: "Retries drop the chunks already shown" },
    { n: 11, who: "You", text: "Keep it behind a flag for now." },
    { n: 12, who: "Shellboy", text: <>Merged behind <code>--stream</code>. Retry gap noted.</> }],
  c: [] as Item[],
};
history.c = [...history.b.filter(i => ("n" in i ? i.n : i.to) <= 10),
  { n: 11, who: "You", text: "Add retry with backoff and replay the chunks." },
  { n: 12, who: "Shellboy", text: "Retry test fails on a timeout." }];
const counts: Record<LaneId, number> = { a: 14, b: 12, c: 12 };

/** The last message both lines share: the split the comparison starts from. */
function splitOf(x: LaneId, y: LaneId): number {
  const nx = history[x].flatMap(i => "n" in i ? [i] : []);
  const ny = history[y].flatMap(i => "n" in i ? [i] : []);
  let last = 0;
  for (const m of nx) { const o = ny.find(k => k.n === m.n); if (!o || o.text !== m.text) break; last = m.n; }
  return last;
}

// Graph rows, top to bottom in Conversation's reading order. Lanes are depth first: a lane's rows follow its
// parent's tip; the lane's line runs down beside the parent from the split. `pass` lists lanes whose line only
// runs through the row.
type Row = { key: string; lane: LaneId; kind: "start" | "message" | "split" | "run" | "tip"; item: Item; branchTo?: LaneId; pass: LaneId[] };
const at = (id: LaneId, n: number) => history[id].find(i => "n" in i && i.n === n)!;
const rows: readonly Row[] = [
  { key: "a1", lane: "a", kind: "start", item: at("a", 1), pass: [] },
  { key: "a2", lane: "a", kind: "run", item: { from: 2, to: 5 }, pass: [] },
  { key: "a6", lane: "a", kind: "split", item: at("a", 6), branchTo: "b", pass: [] },
  { key: "a7", lane: "a", kind: "message", item: at("a", 7), pass: ["b"] },
  { key: "a8", lane: "a", kind: "message", item: at("a", 8), pass: ["b"] },
  { key: "a9", lane: "a", kind: "run", item: { from: 9, to: 13 }, pass: ["b"] },
  { key: "a14", lane: "a", kind: "tip", item: at("a", 14), pass: ["b"] },
  { key: "b7", lane: "b", kind: "message", item: at("b", 7), pass: [] },
  { key: "b8", lane: "b", kind: "run", item: { from: 8, to: 9 }, pass: [] },
  { key: "b10", lane: "b", kind: "split", item: at("b", 10), branchTo: "c", pass: [] },
  { key: "b11", lane: "b", kind: "message", item: at("b", 11), pass: ["c"] },
  { key: "b12", lane: "b", kind: "tip", item: at("b", 12), pass: ["c"] },
  { key: "c11", lane: "c", kind: "message", item: at("c", 11), pass: [] },
  { key: "c12", lane: "c", kind: "tip", item: at("c", 12), pass: [] },
];
const LEAVING = new Set(["a9", "a14"]);

function LaneName({ id, strong }: { id: LaneId; strong?: boolean }) {
  return <span class={`bx-lane-name${strong ? " strong" : ""}`} style={laneStyle(id)}><span class="bx-swatch" aria-hidden="true" />{lane(id).name}</span>;
}
function LaneStatus({ id }: { id: LaneId }) {
  const l = lane(id);
  return l.running ? <StatusMark status="running" label="Running" /> : <StatusMark status="idle" label="Idle" word={false} />;
}

/** The lanes drawn for one row: through-lines, the row's own line above and below its point, a split curve. */
function LaneCell({ row, leaving }: { row: Row; leaving: boolean }) {
  const first = row.kind === "start";
  return <span class="bx-cell" aria-hidden="true">
    {row.pass.map(id => <span key={id} class="bx-line bx-full" style={laneStyle(id)} />)}
    {row.kind === "run"
      ? <span class={`bx-line bx-full bx-dashed${leaving ? " bx-fade" : ""}`} style={laneStyle(row.lane)} />
      : <>
        {first ? null : <span class={`bx-line bx-above${leaving ? " bx-fade" : ""}`} style={laneStyle(row.lane)} />}
        {row.kind === "tip" ? null : <span class="bx-line bx-below" style={laneStyle(row.lane)} />}
      </>}
    {row.branchTo ? <svg class="bx-curve" style={{ ...laneStyle(row.branchTo), "--from": lane(row.lane).col, "--span": lane(row.branchTo).col - lane(row.lane).col } as JSX.CSSProperties} viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d="M0 0C0 70 100 35 100 100" vector-effect="non-scaling-stroke" />
    </svg> : null}
    {row.kind === "run" ? null : <span class={`bx-node bx-node-${row.kind}${leaving ? " bx-fade" : ""}`} style={laneStyle(row.lane)} />}
  </span>;
}

function Excerpt({ item }: { item: Item }) {
  if (!("n" in item)) return <span class="caption muted">{item.to - item.from + 1} more messages (#{item.from}–#{item.to})</span>;
  return <span class="bx-text"><b class="bx-who">{item.who}</b> {item.text}</span>;
}

type GraphState = { selected?: string; rewinding?: boolean };

function GraphRow({ row, state, onSelect, children }: { row: Row; state: GraphState; onSelect?: (key: string) => void; children?: ComponentChildren }) {
  const leaving = !!state.rewinding && LEAVING.has(row.key);
  const selected = state.selected === row.key;
  const item = row.item;
  const label = row.kind === "tip" ? <span class="bx-tip-label"><LaneName id={row.lane} strong /><LaneStatus id={row.lane} />{lane(row.lane).current ? <span class="caption muted">This Thread</span> : null}<span class="caption muted">latest</span></span> : null;
  return <li class="bx-row" data-kind={row.kind} data-selected={selected || undefined} data-leaving={leaving || undefined}>
    <LaneCell row={row} leaving={leaving} />
    <div class="bx-body">
      {label}
      {leaving && row.kind === "run" ? <span class="bx-leaves caption">Leaves Release notes if you rewind to #8</span> : null}
      {"n" in item
        ? <button type="button" class="bx-point" aria-pressed={selected} onClick={() => onSelect?.(row.key)}>
          <Excerpt item={item} />
          <span class="caption muted bx-meta">#{item.n} on {lane(row.lane).name}</span>
        </button>
        : <span class="bx-run"><Excerpt item={item} /></span>}
      {row.branchTo ? <span class="bx-split caption"><Icon role="branch.mark" size="small" /><LaneName id={row.branchTo} strong /><span class="muted">splits off here</span></span> : null}
      {children}
    </div>
  </li>;
}

function PointActions({ onRewind }: { onRewind: () => void }) {
  return <div class="bx-actions" role="group" aria-label="Actions for message #8">
    <Field label="New request for the new branch" value="Make it a short changelog instead." onInput={() => {}} />
    <div class="bx-buttons">
      <Button variant="primary"><Icon role="branch.mark" size="small" />New branch from here</Button>
      <Button variant="ghost" onClick={onRewind}>Rewind Release notes to here…</Button>
    </div>
    <p class="caption muted">A new branch keeps #1–#8 and sends your request there. Release notes stays as it is.</p>
  </div>;
}

function RewindImpact() {
  return <KeyValue rows={[
    { key: "Leaves", value: <span><b>6 messages</b> (#9–#14, 3 turns) leave Release notes</span> },
    { key: "Kept as", value: <span>A new branch, “Release notes · rewound”. Open it to get them back.</span> },
    { key: "Ends at", value: "#8 “Kept it. 12 fixes drafted under Fixed.”" },
    { key: "Not undone", value: <span>2 shell commands and the files they changed: <code>./scripts/lint-notes</code>, <code>git commit -am notes</code></span> },
    { key: "Also", value: "No branches start in that part, no replies are expected, no attachments." },
  ]} />;
}

function RewindPreview({ onCancel }: { onCancel: () => void }) {
  return <div class="bx-actions bx-rewind" role="group" aria-label="Rewind preview">
    <h3>Rewind Release notes to #8?</h3>
    <RewindImpact />
    <Notice tone="wait">The marked rows leave this Thread. Shell effects and files are not rolled back.</Notice>
    <div class="bx-buttons">
      <Button variant="warn">Rewind Release notes</Button>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

function Graph({ state, onSelect, actions }: { state: GraphState; onSelect?: (key: string) => void; actions?: (key: string) => ComponentChildren }) {
  return <ol class="bx-graph" aria-label="Branches of Release notes, top is oldest">
    {rows.map(row => <GraphRow key={row.key} row={row} state={state} onSelect={onSelect}>{actions?.(row.key)}</GraphRow>)}
  </ol>;
}

/** The lines of work, each with its colour, name, where it came from, and whether it is in the comparison. */
function Lines({ picked, onPick }: { picked: LaneId[]; onPick: (id: LaneId) => void }) {
  return <ul class="bx-lines" aria-label="Lines of work">
    {lanes.map(l => <li key={l.id} class="bx-line-card" style={laneStyle(l.id)} data-picked={picked.includes(l.id) || undefined}>
      <span class="bx-line-head"><LaneName id={l.id} strong /><LaneStatus id={l.id} /></span>
      <span class="caption muted">{l.origin} · {counts[l.id]} messages · last {l.last}</span>
      <Check checked={picked.includes(l.id)} onChange={() => onPick(l.id)}>Compare</Check>
    </li>)}
  </ul>;
}

function Side({ id, split }: { id: LaneId; split: number }) {
  const after = history[id].filter(i => ("n" in i ? i.n : i.from) > split);
  const n = counts[id] - split;
  return <article class="bx-side" style={laneStyle(id)}>
    <header class="bx-side-head"><LaneName id={id} strong /><LaneStatus id={id} /></header>
    <p class="caption muted bx-side-meta">{n} messages after the split · last {lane(id).last}</p>
    <ol class="bx-msgs">{after.map((i, k) => <li key={k} data-run={"n" in i ? undefined : ""}>
      {"n" in i ? <span class="caption muted mono">#{i.n}</span> : null}
      <Excerpt item={i} />
    </li>)}</ol>
    <a class="nav-link bx-open" href="#conversation">Open in Conversation<Icon role="app.open" size="small" /></a>
  </article>;
}

function Compare({ picked, stacked }: { picked: LaneId[]; stacked?: boolean }) {
  const [x, y] = picked as [LaneId, LaneId];
  const split = splitOf(x, y);
  const base = history[x].find(i => "n" in i && i.n === split);
  return <section class="bx-compare" data-stacked={stacked || undefined} aria-label="Compare two lines">
    <h2 class="bx-h">How do they differ?</h2>
    <p class="bx-shared"><Icon role="branch.mark" size="small" /><span>Both share #1–#{split}, up to “{base && "n" in base ? base.quote ?? base.text : ""}”. Below is only what each did after that.</span></p>
    <div class="bx-sides"><Side id={x} split={split} /><Side id={y} split={split} /></div>
  </section>;
}

const intro = "Release notes split into 3 lines of work. See where each one split off, compare two of them, and continue from the one you want.";

function Desktop({ rewinding }: { rewinding?: boolean }) {
  const [picked, setPicked] = useState<LaneId[]>(["a", "b"]);
  const [selected, setSelected] = useState<string | undefined>("a8");
  const [rewind, setRewind] = useState(!!rewinding);
  const pick = (id: LaneId) => setPicked(p => p.includes(id) ? (p.length > 2 ? p.filter(k => k !== id) : p) : [p[1]!, id]);
  return <Frame caption={rewinding ? "Desktop · Rewind to here… marks what leaves, then asks" : "Desktop · lines of work, where they split, compare, and a selected message's actions"}>
    <div class="bx-app">
      <div class="top"><div class="crumb"><span>Release notes</span><span>/</span><b>Branches</b></div></div>
      <div class="bx-page">
        <PageHeader title="Branches" description={intro} />
        <Lines picked={picked} onPick={pick} />
        <div class="bx-columns">
          <section class="bx-where" aria-label="Where it split">
            <h2 class="bx-h">Where did it split?</h2>
            <p class="caption muted bx-key">Time runs down. Each colour is one line of work; <span class="bx-key-split" aria-hidden="true" /> marks a split. Select a message to branch or rewind from it.</p>
            <Graph state={{ selected, rewinding: rewind }} onSelect={key => { setSelected(key); setRewind(false); }}
              actions={key => key !== selected ? null : rewind ? <RewindPreview onCancel={() => setRewind(false)} /> : <PointActions onRewind={() => setRewind(true)} />} />
          </section>
          <Compare picked={picked} />
        </div>
      </div>
    </div>
  </Frame>;
}

function PhoneTop({ back, title }: { back?: string; title: string }) {
  return <div class="top bx-phone-top">{back
    ? <Button variant="ghost"><Icon role="panel.back" size="small" />{back}</Button>
    : null}<div class="crumb"><b>{title}</b></div></div>;
}

function PhoneFamily({ state }: { state: GraphState }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Static capture: start scrolled so the split above the selected message and its actions are in view.
  useLayoutEffect(() => {
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>(state.rewinding ? '[data-selected]' : '[data-kind=split]');
    if (box && row && state.selected) box.scrollTop = row.offsetTop - box.offsetTop - 8;
  }, [state.selected, state.rewinding]);
  return <div class="bx-phone">
    <PhoneTop title="Release notes · Branches" />
    <div class="bx-phone-scroll" ref={scroller}>
      <PageHeader title="Branches" description={intro} />
      <h2 class="bx-h">Where did it split?</h2>
      <p class="caption muted bx-key">Time runs down. Each colour is one line of work; <span class="bx-key-split" aria-hidden="true" /> marks a split. Tap a message to branch or rewind from it.</p>
      <Graph state={state} actions={key => key !== state.selected ? null : state.rewinding ? <RewindPreview onCancel={() => {}} /> : <PointActions onRewind={() => {}} />} />
      <h2 class="bx-h">Compare two lines</h2>
      <Lines picked={["a", "b"]} onPick={() => {}} />
    </div>
    <div class="bx-phone-bar"><span class="caption"><LaneName id="a" /> and <LaneName id="b" /></span><Button variant="primary">Compare</Button></div>
  </div>;
}

function Phone({ caption, view }: { caption: string; view: "family" | "compare" | "point" | "rewind" }) {
  return <Frame phone caption={caption}>
    {view === "compare"
      ? <div class="bx-phone"><PhoneTop back="Branches" title="Compare" /><div class="bx-phone-scroll"><Compare picked={["a", "b"]} stacked /></div></div>
      : <PhoneFamily state={view === "family" ? {} : { selected: "a8", rewinding: view === "rewind" }} />}
  </Frame>;
}

function States({ light }: { light?: boolean }) {
  return <ThemeRow light={light}>
    <Desktop />
    <Desktop rewinding />
    <Phone caption="Phone · lines and the lane graph" view="family" />
    <Phone caption="Phone · compare, stacked" view="compare" />
    <Phone caption="Phone · tapped message: its actions open under it" view="point" />
    <Phone caption="Phone · Rewind to here… marks what leaves, then asks" view="rewind" />
  </ThemeRow>;
}

mountMock(<main class="mock-page">
  <header class="mock-intro">
    <p class="mock-kicker">Studio design study · #138</p>
    <h1>Branches: where it split, how the lines differ, continue from one</h1>
    <p>A Thread's branches as coloured lanes (commit-graph style), the two picked lines compared from their split point, and branch or rewind on a selected message. Static fixture data; no Core connection, nothing is forked or rewound.</p>
    <ul class="mock-notes">
      <li>Every lane colour is paired with its name: on the line cards, at the lane's latest message, at the split, and in the comparison.</li>
      <li>Rewind marks the rows that would leave on the graph and lists the owner's dry-run facts before the second, explicit press.</li>
      <li>Phones keep the vertical lanes as a full-width list with 44 px rows; a tapped message opens its actions under it, and Compare opens its own stacked view.</li>
    </ul>
  </header>
  <States />
  <States light />
</main>);
