import type { ComponentChildren } from "preact";

export function RankedBar({ name, parts, max }: { name: string; parts: readonly number[]; max: number }) {
  return <span class="ranked-bar-label"><span class="ranked-bar-name">{name}</span>
    <span class="ranked-bar-track" aria-hidden="true">{parts.map((value, index) => value > 0 ?
      <span key={index} data-series={index} style={{ flexBasis: `${100 * (value / max)}%` }} /> : null)}</span>
  </span>;
}

export function RankedBarLegend({ labels }: { labels: readonly (ComponentChildren | undefined)[] }) {
  return <ul class="ranked-bar-legend">{labels.map((label, index) => label === undefined ? null :
    <li key={index}><span data-series={index} aria-hidden="true" />{label}</li>)}</ul>;
}
