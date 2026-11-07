import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { niceMax } from "../../../../../ui-core/src";
import { DataTable } from "../DataTable";

export interface ChartSeries {
  id: string;
  label: string;
  /** A validated chart hue, or `neutral` for a single series with no identity to carry. */
  tone: "1" | "2" | "3" | "neutral";
}

export interface ChartPoint {
  key: string;
  /** Short label for the axis. */
  label: string;
  /** Absent means the owner reported nothing: nothing is drawn, and it is not zero. */
  values: Record<string, number | undefined>;
  /** Shown with the value, e.g. that some records had no value. */
  note?: string | undefined;
}

const HEIGHT = 168;
const AXIS_BOTTOM = 22;
const AXIS_LEFT = 46;
const END_ROOM = 8;
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;
const LABEL_MIN = 44;
const MIN_SEGMENT = 2;
const TIP_WIDTH = 220;
const TIP_GAP = 8;

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounded at the data end, square at the baseline. */
const column = (x: number, y: number, w: number, h: number, round: boolean): string => {
  const r = round ? Math.min(RADIUS, w / 2, h) : 0;
  return `M${x} ${y + h}V${y + r}${r ? `Q${x} ${y} ${x + r} ${y}` : ""}H${x + w - r}${r ? `Q${x + w} ${y} ${x + w} ${y + r}` : ""}V${y + h}Z`;
};

export function Chart({
  kind,
  title,
  sub,
  source,
  series,
  points,
  format,
  floorMax,
  whole,
  ariaSummary,
  tableLabel,
  categoryLabel,
  noData,
  extra,
}: {
  kind: "columns" | "line";
  title: string;
  sub?: ComponentChildren;
  source: ComponentChildren;
  series: ChartSeries[];
  points: ChartPoint[];
  format: (n: number) => string;
  /** The axis reaches at least this, e.g. 1 for a rate. */
  floorMax?: number;
  /** Counts: no tick between whole numbers. */
  whole?: boolean;
  ariaSummary: string;
  tableLabel: string;
  categoryLabel: string;
  noData: string;
  extra?: ComponentChildren;
}) {
  const [ref, width] = useWidth(560);
  const [active, setActive] = useState<number | undefined>(undefined);
  const total = (p: ChartPoint): number => series.reduce((sum, s) => sum + (p.values[s.id] ?? 0), 0);
  const hasData = points.some((p) => series.some((s) => p.values[s.id] !== undefined));
  const peak = Math.max(0, ...points.map(total));
  const max = Math.max(niceMax(peak), floorMax ?? 0);
  const plotH = HEIGHT - AXIS_BOTTOM - END_ROOM;
  const plotW = Math.max(40, width - AXIS_LEFT - END_ROOM);
  const band = plotW / Math.max(points.length, 1);
  const y = (v: number) => END_ROOM + plotH - (v / max) * plotH;
  const x = (i: number) => AXIS_LEFT + band * i;
  const barW = Math.min(MAX_BAR, Math.max(2, band - GAP));
  const every = Math.max(1, Math.ceil(LABEL_MIN / band));
  const lastIndex = points.length - 1;
  const showLabel = (i: number) => (lastIndex - i) % every === 0;
  const current = active !== undefined ? points[active] : undefined;
  // Beside the hovered column, so it never hides the mark it describes.
  const tipLeft = active === undefined ? 0 : x(active) + band + TIP_GAP + TIP_WIDTH <= width ? x(active) + band + TIP_GAP : Math.max(0, x(active) - TIP_GAP - TIP_WIDTH);

  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive(Math.min(lastIndex, Math.max(0, (active ?? (step > 0 ? -1 : lastIndex + 1)) + step)));
    } else if (e.key === "Escape") setActive(undefined);
  };

  const line = (s: ChartSeries) => {
    const segments: string[] = [];
    let open = false;
    let d = "";
    points.forEach((p, i) => {
      const v = p.values[s.id];
      if (v === undefined) {
        if (d) segments.push(d);
        d = "";
        open = false;
        return;
      }
      d += `${open ? "L" : "M"}${x(i) + band / 2} ${y(v)}`;
      open = true;
    });
    if (d) segments.push(d);
    return segments;
  };

  return (
    <figure class="chart">
      <figcaption class="chart-head">
        <h3>{title}</h3>
        {sub ? <div class="muted caption">{sub}</div> : null}
      </figcaption>
      {series.length > 1 ? (
        <ul class="legend">
          {series.map((s) => (
            <li key={s.id}>
              <span class={`swatch t${s.tone}`} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div class="chart-plot" ref={ref}>
        {hasData ? (
          <svg
            class="chart-svg"
            role="img"
            aria-label={ariaSummary}
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            tabIndex={0}
            onKeyDown={key}
            onBlur={() => setActive(undefined)}
            onPointerLeave={() => setActive(undefined)}
          >
            {[0, max / 2, max].filter((v) => !whole || Number.isInteger(v)).map((v) => (
              <g key={v}>
                <line class={v === 0 ? "axis" : "grid"} x1={AXIS_LEFT} x2={width - END_ROOM} y1={y(v)} y2={y(v)} />
                <text class="tick" x={AXIS_LEFT - 6} y={y(v) + 4} text-anchor="end">{format(v)}</text>
              </g>
            ))}
            {points.map((p, i) => (showLabel(i) ? <text key={p.key} class="tick" x={x(i) + band / 2} y={HEIGHT - 6} text-anchor="middle">{p.label}</text> : null))}
            {active !== undefined ? <rect class="chart-band" x={x(active)} y={END_ROOM} width={band} height={plotH} /> : null}
            {kind === "columns"
              ? points.map((p, i) => {
                  let cursor = y(0);
                  const present = series.filter((s) => (p.values[s.id] ?? 0) > 0);
                  return (
                    <g key={p.key}>
                      {present.map((s, n) => {
                        const natural = ((p.values[s.id] as number) / max) * plotH;
                        const gap = n > 0 ? GAP : 0;
                        const h = Math.max(MIN_SEGMENT, natural - gap);
                        const top = cursor - gap - h;
                        cursor = Math.min(cursor - natural, top);
                        return <path key={s.id} class={`fill t${s.tone}`} d={column(x(i) + (band - barW) / 2, top, barW, h, n === present.length - 1)} />;
                      })}
                    </g>
                  );
                })
              : series.map((s) => (
                  <g key={s.id}>
                    {line(s).map((d) => (
                      <path key={d} class={`stroke t${s.tone}`} d={d} />
                    ))}
                    {points.map((p, i) => {
                      const v = p.values[s.id];
                      if (v === undefined) return null;
                      const isolated = points[i - 1]?.values[s.id] === undefined && points[i + 1]?.values[s.id] === undefined;
                      return i === active || isolated || i === lastIndex ? <circle key={p.key} class={`dot t${s.tone}`} cx={x(i) + band / 2} cy={y(v)} r={4} /> : null;
                    })}
                  </g>
                ))}
            {points.map((p, i) => (
              <rect key={p.key} class="chart-hit" x={x(i)} y={0} width={band} height={HEIGHT} onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} onPointerDown={() => setActive(i)} />
            ))}
          </svg>
        ) : (
          <div class="chart-empty muted">{noData}</div>
        )}
        {current ? (
          <div class="chart-tip" role="status" style={{ left: `${tipLeft}px`, width: `${TIP_WIDTH}px` }}>
            <div class="tip-head">{current.key}</div>
            {series.map((s) => {
              const v = current.values[s.id];
              return (
                <div class="tip-row" key={s.id}>
                  <span class={`tip-key t${s.tone}`} aria-hidden="true" />
                  <b>{v === undefined ? noData : format(v)}</b>
                  <span>{s.label}</span>
                </div>
              );
            })}
            {current.note ? <div class="tip-note">{current.note}</div> : null}
          </div>
        ) : null}
      </div>
      {extra}
      <details class="chart-table">
        <summary>{tableLabel}</summary>
        <DataTable
          flat
          caption={title}
          columns={[{ label: categoryLabel }, ...series.map((s) => ({ label: s.label, numeric: true }))]}
          rows={points.map((p) => ({
            key: p.key,
            cells: [
              <>
                {p.key}
                {p.note ? <div class="muted caption">{p.note}</div> : null}
              </>,
              ...series.map((s) => {
                const v = p.values[s.id];
                return v === undefined ? <span class="muted">{noData}</span> : format(v);
              }),
            ],
          }))}
        />
      </details>
      <div class="sect-source">{source}</div>
    </figure>
  );
}
