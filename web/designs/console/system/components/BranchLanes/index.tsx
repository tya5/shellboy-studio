import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** A lane's drawing column and its colour slot (one of the three chart tokens). */
export interface LaneMark { column: number; tone: number }

export interface LaneRowView {
  /** Stable key from Core IDs; the row element and its point stay mounted while it is unchanged. */
  key: string;
  kind: "start" | "message" | "split" | "run" | "tip";
  lane: LaneMark;
  /** Lanes whose line only runs past this row. */
  pass: readonly LaneMark[];
  /** Lanes that leave at this row's node: one connector each. */
  branchTo: readonly LaneMark[];
  /** The lane starts here: no line above the point. */
  first?: boolean;
  /** Above the point: the lane's name and state on its latest message. */
  head?: ComponentChildren;
  /** The point's two lines: who and the excerpt (or `pending` until it is read), then where it is. */
  who?: ComponentChildren;
  text?: ComponentChildren;
  pending?: boolean;
  meta?: ComponentChildren;
  /** Below the point: which lanes split off here. */
  note?: ComponentChildren;
  /** A collapsed run: its words, and "Show more" when it can open. */
  run?: { text: ComponentChildren; action?: ComponentChildren; onOpen?: () => void; busy?: boolean; label?: string };
  /** A rewind preview would take this row off its lane. */
  leaving?: boolean;
  leavingNote?: ComponentChildren;
}

const laneStyle = (m: LaneMark): JSX.CSSProperties => ({ "--lane": `var(--chart-${m.tone + 1})`, "--c": m.column }) as JSX.CSSProperties;

function LaneCell({ row }: { row: LaneRowView }) {
  const fade = row.leaving ? " lanes-fade" : "";
  return <span class="lanes-cell" aria-hidden="true">
    {row.pass.map((m, i) => <span key={`p${i}`} class="lanes-line lanes-full" style={laneStyle(m)} />)}
    {row.kind === "run"
      ? <span class={`lanes-line lanes-full lanes-dashed${fade}`} style={laneStyle(row.lane)} />
      : <>
        {row.first ? null : <span class={`lanes-line lanes-above${fade}`} style={laneStyle(row.lane)} />}
        {row.kind === "tip" ? null : <span class={`lanes-line lanes-below${fade}`} style={laneStyle(row.lane)} />}
      </>}
    {row.branchTo.map((m, i) => {
      // The connector leaves the parent's diamond and ends at the top of the child's column, which can lie on
      // either side: a column freed by an ended lane may be to the parent's left.
      const left = m.column < row.lane.column;
      return <svg key={`b${i}`} class="lanes-curve" data-dir={left ? "left" : "right"} style={{ ...laneStyle(m), "--from": Math.min(m.column, row.lane.column), "--span": Math.abs(m.column - row.lane.column) } as JSX.CSSProperties} viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={left ? "M100 0C100 70 0 35 0 100" : "M0 0C0 70 100 35 100 100"} vector-effect="non-scaling-stroke" />
      </svg>;
    })}
    {row.kind === "run" ? null : <span class={`lanes-node lanes-node-${row.kind}${fade}`} style={laneStyle(row.lane)} />}
  </span>;
}

/**
 * A Thread family as vertical commit-graph lanes, top is oldest. Each row has a fixed height for its kind, so
 * re-reads never move what is on screen; the selected row's `actions` open under it. `onVisible` reports rows
 * entering and leaving the viewport, so their text is read only while seen.
 */
export function BranchLanes({ label, columns, rows, selected, onSelect, actions, selectedLabel, onVisible }: {
  label: string;
  columns: number;
  rows: readonly LaneRowView[];
  selected: string | undefined;
  onSelect: (key: string) => void;
  actions?: ComponentChildren;
  /** Accessible name of the actions group under the selected row. */
  selectedLabel?: string;
  onVisible?: (key: string, visible: boolean) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const observer = useRef<IntersectionObserver | undefined>(undefined);
  const report = useRef(onVisible);
  report.current = onVisible;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const o = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.key;
        if (key) report.current?.(key, e.isIntersecting);
      }
    });
    observer.current = o;
    return () => { o.disconnect(); observer.current = undefined; };
  }, []);
  useEffect(() => {
    const items = list.current?.querySelectorAll<HTMLElement>(":scope > li[data-key]") ?? [];
    // Without an observer every row counts as seen; observing a row twice is a no-op.
    if (!observer.current) { for (const el of items) report.current?.(el.dataset.key!, true); return; }
    for (const el of items) observer.current.observe(el);
  });
  return <ol ref={list} class="branch-lanes" aria-label={label} style={{ "--lanes": columns } as JSX.CSSProperties}>
    {rows.map((row) => {
      const isSelected = row.key === selected;
      return <li key={row.key} data-key={row.key} class="lanes-row" data-kind={row.kind} data-selected={isSelected || undefined} data-leaving={row.leaving || undefined}>
        <LaneCell row={row} />
        <div class="lanes-body">
          {row.head ? <span class="lanes-head">{row.head}</span> : null}
          {row.leaving && row.leavingNote ? <span class="lanes-leaves caption">{row.leavingNote}</span> : null}
          {row.run
            ? row.run.onOpen
              ? <button type="button" class="lanes-run" aria-busy={row.run.busy || undefined} aria-label={row.run.label} disabled={row.run.busy} onClick={row.run.onOpen}><span class="lanes-run-text">{row.run.text}</span>{row.run.action ? <span class="lanes-run-action">{row.run.action}</span> : null}</button>
              : <span class="lanes-run"><span class="lanes-run-text">{row.run.text}</span>{row.run.action ? <span class="lanes-run-action">{row.run.action}</span> : null}</span>
            : <button type="button" class="lanes-point" aria-expanded={isSelected} onClick={() => onSelect(row.key)}>
              <span class="lanes-text">{row.pending ? <span class="lanes-pending" aria-hidden="true" /> : <>{row.who ? <b class="lanes-who">{row.who}</b> : null}{row.who ? " " : null}{row.text}</>}</span>
              <span class="lanes-meta caption">{row.meta}</span>
            </button>}
          {row.note ? <span class="lanes-note caption">{row.note}</span> : null}
          {isSelected && actions ? <div class="lanes-actions" role="group" aria-label={selectedLabel}>{actions}</div> : null}
        </div>
      </li>;
    })}
  </ol>;
}

/** A lane's colour paired with its name: the colour never stands alone. */
export function LaneName({ mark, name, strong }: { mark: LaneMark; name: ComponentChildren; strong?: boolean }) {
  return <span class={`lanes-name${strong ? " lanes-name-strong" : ""}`} style={laneStyle(mark)}><span class="lanes-swatch" aria-hidden="true" /><span class="lanes-name-text">{name}</span></span>;
}

/** A card or panel that belongs to one lane: its edge takes the lane's colour (`var(--lane)`). */
export function LaneTinted({ as = "div", mark, class: extra, children, ...rest }: { as?: "li" | "article" | "div"; mark: LaneMark; class?: string; children: ComponentChildren } & Omit<JSX.HTMLAttributes<HTMLElement>, "as" | "class" | "style">) {
  const Tag = as as "div";
  return <Tag {...(rest as JSX.HTMLAttributes<HTMLDivElement>)} class={`lanes-tinted${extra ? ` ${extra}` : ""}`} style={laneStyle(mark)}>{children}</Tag>;
}
