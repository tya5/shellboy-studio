import type { BranchItem, BranchLayout, GraphEdge, GraphPoint } from "../../../../../ui-core/src";

const LEFT = 24;
const COLUMN = 128;
const ROW = 78;
const TOP = 44;
const TIP_W = 244;
const TIP_H = 56;
const JOIN = 36;
const NAME_CHARS = 28;
const POINT_CHARS = 17;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function BranchGraph({ layout, selected, onPoint, tipHref, tipTitle, tipNote, nodesText, pointAria, startText, aria }: {
  layout: BranchLayout;
  selected: string | undefined;
  onPoint: (p: GraphPoint) => void;
  tipHref: (i: BranchItem) => string;
  tipTitle: (i: BranchItem) => string;
  tipNote: (i: BranchItem) => string;
  nodesText: (n: number) => string;
  pointAria: (p: GraphPoint) => string;
  startText: string;
  aria: string;
}) {
  const x = (c: number) => LEFT + c * COLUMN;
  const y = (r: number) => TOP + r * ROW;
  const width = x(layout.tipColumn) + TIP_W + 8;
  const height = y(layout.lanes.length - 1) + TIP_H / 2 + 12;
  const joined = new Set(layout.edges.filter((e) => e.key.startsWith("join:")).map((e) => e.key.slice(5)));
  const fromX = (e: GraphEdge): number => {
    const thread = e.key.split(":")[1] as string;
    const first = joined.has(thread) && layout.edges.find((o) => !o.key.startsWith("join:") && o.key.split(":")[1] === thread) === e;
    return x(e.fromColumn) + (first ? JOIN : 0);
  };
  return (
    <div class="bgraph" tabIndex={0} role="group" aria-label={aria}>
      <svg class="bgraph-svg" role="img" aria-label={aria} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {layout.edges.map((e) => {
          if (e.key.startsWith("join:")) {
            const sx = x(e.fromColumn);
            const sy = y(e.fromRow);
            const ey = y(e.toRow);
            return <path key={e.key} class={e.active ? "edge on" : "edge"} d={`M${sx} ${sy}C${sx + JOIN / 2} ${sy} ${sx + JOIN / 2} ${ey} ${sx + JOIN} ${ey}`} />;
          }
          const sx = fromX(e);
          const ex = x(e.toColumn);
          const row = y(e.fromRow);
          return (
            <g key={e.key}>
              <path class={e.active ? "edge on" : "edge"} d={`M${sx} ${row}H${ex}`} />
              {e.nodes !== undefined && e.nodes > 0 ? <text class="bg-note" x={(sx + ex) / 2} y={row + 18} text-anchor="middle">{nodesText(e.nodes)}</text> : null}
            </g>
          );
        })}
        {layout.lanes.filter((l) => !joined.has(l.item.threadId)).map((l) => (
          <g key={l.item.threadId}>
            <circle class={l.active || layout.edges.some((e) => e.active && e.fromRow === l.row) ? "pt on" : "pt"} cx={x(0)} cy={y(l.row)} r={5} />
            <text class="bg-note" x={x(0)} y={y(l.row) - 14}>{startText}</text>
          </g>
        ))}
        {layout.points.map((p) => (
          <g
            key={p.key}
            class="bg-point"
            tabIndex={0}
            role="button"
            aria-pressed={selected === p.key}
            aria-label={pointAria(p)}
            onClick={() => onPoint(p)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPoint(p);
              }
            }}
          >
            <circle class="pt-hit" cx={x(p.column)} cy={y(p.row)} r={16} />
            <circle class={`pt${p.active ? " on" : ""}${selected === p.key ? " sel" : ""}`} cx={x(p.column)} cy={y(p.row)} r={8} />
            {p.request ? <text class="bg-label" x={x(p.column)} y={y(p.row) - 16} text-anchor="middle">{clip(p.request, POINT_CHARS)}</text> : null}
          </g>
        ))}
        {layout.lanes.map((l) => (
          <a key={l.item.threadId} class="bg-tip" href={tipHref(l.item)} aria-label={`${tipTitle(l.item)}. ${tipNote(l.item)}`}>
            <rect class={l.active ? "tip on" : "tip"} x={x(layout.tipColumn)} y={y(l.row) - TIP_H / 2} width={TIP_W} height={TIP_H} rx={8} />
            <text class="bg-name" x={x(layout.tipColumn) + 12} y={y(l.row) - 4}>{clip(tipTitle(l.item), NAME_CHARS)}</text>
            <text class="bg-note" x={x(layout.tipColumn) + 12} y={y(l.row) + 15}>{clip(tipNote(l.item), NAME_CHARS + 8)}</text>
          </a>
        ))}
      </svg>
    </div>
  );
}
