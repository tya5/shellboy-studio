import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, ButtonGroup, DataTable, Notice, PageHeader, Section } from "../system/components";
import { PERIODS } from "../../../ui-core/src/analytics";
import "../system/tokens/console.css";
import "../system/tokens/light.css";
import "../system/components.css";
import "../system/layout.css";
import "./cost-ranking.css";

const fixture = [
  { title: "Desktop release", parts: [112000, 48000, 32000] },
  { title: "Search improvements", parts: [64000, 24000, 8000] },
  { title: "API documentation", parts: [24000, 16000, 8000] },
  { title: "Keyboard review", parts: [12000, 24000, 12000] },
  { title: "Weekly notes", parts: [8000, 32000, 0] },
] as const;
type Thread = (typeof fixture)[number];
const labels = ["Conversation (other)", "Conversation cached input", "Summaries (all)"];
const metrics = [
  { label: "Excl. cached", name: "Excluding cached input", segments: [0, 2] },
  { label: "Total", name: "Total tokens", segments: [0, 1, 2] },
  { label: "Cached input", name: "Conversation cached input", segments: [1] },
  { label: "Summaries", name: "Summary tokens", segments: [2] },
] as const;
const number = (value: number) => value.toLocaleString("en-US");
const sampleScale = { 1: 0.125, 7: 1, 14: 1.5, 31: 2 };
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function Mock() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [metricIndex, setMetric] = useState(0);
  const [detail, setDetail] = useState<Thread>();
  const trigger = useRef<string>();
  const back = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail) back.current?.querySelector("button")?.focus();
    else if (trigger.current !== undefined) Array.from(document.querySelectorAll<HTMLButtonElement>("[data-rank]")).find(button => button.title === trigger.current)?.focus();
  }, [detail]);
  const complete = days !== 31;
  const scale = sampleScale[days];
  const metric = metrics[metricIndex]!;
  const segments: readonly number[] = metric.segments;
  const valueOf = (item: Thread) => sum(segments.map(part => item.parts[part]!));
  const ranked = [...fixture].sort((a, b) => valueOf(b) - valueOf(a) || a.title.localeCompare(b.title));
  const total = sum(fixture.map(valueOf)) * scale;
  const barMax = Math.max(1, ...fixture.map(valueOf));
  const parts = detail?.parts.map(value => value * scale);
  const dates = { 1: "Nov 23", 7: "Nov 17-23", 14: "Nov 10-23", 31: "Oct 24-Nov 23" };
  return <div class="ranking-mock">
    <PageHeader title="Analytics / By Thread" description="Compare recorded token use across Threads. Token counts are not prices or a bill."
      toolbar={<div class="ranking-controls">
        <ButtonGroup label="Period">{PERIODS.map(period => <Button key={period} aria-pressed={days === period}
          onClick={() => { setDays(period); trigger.current = undefined; setDetail(undefined); }}>{period} {period === 1 ? "day" : "days"}</Button>)}</ButtonGroup>
        <ButtonGroup label="Comparison metric">{metrics.map((item, index) => <Button key={item.name} aria-label={item.name}
          aria-pressed={index === metricIndex} onClick={() => setMetric(index)}>{item.label}</Button>)}</ButtonGroup>
      </div>} />
    <div class="caption muted">{dates[days]}, 2026 (UTC) / Synthetic data</div>
    {detail && parts ? <Section title={detail.title} sub={`Thread Analytics / ${days}-day period`} actions={<div ref={back}><Button variant="ghost" onClick={() => setDetail(undefined)}>Back to ranking</Button></div>}>
      <DataTable flat caption="Selected Thread usage" columns={[{label:"Part"},{label:"Tokens",numeric:true}]}
        rows={parts.map((value, index) => ({ key: labels[index]!, cells: [labels[index], number(value)] }))} />
      <p class="caption muted">Mock of the existing per-Thread Analytics destination. Summary cached input stays inside Summaries.</p>
    </Section> : <Section title="Thread ranking" sub={complete ? `${metric.name}: ${number(total)} across ${fixture.length} Threads` : "Period scan incomplete"}
      source="Source: Core usage.get by Thread. Includes saved conversation attempts and summary requests.">
      {!complete ? <Notice tone="wait">Shares and ranks are unavailable until the period is fully read. This is not evidence of zero usage.</Notice> :
        <>
          <ul class="ranking-legend" aria-label="Bar segments">{segments.map(index => <li key={index}>
            <span aria-hidden="true" class={`ranking-segment segment-${index + 1}`} />{labels[index]}</li>)}</ul>
          <p class="caption muted">Bars, values and shares use the selected metric. Open a row for its exact breakdown.</p>
          <div class="ranking-table"><DataTable flat centerRows caption={`Thread ranking by ${metric.name}`} columns={[
            { label: "Rank", numeric: true }, { label: "Thread" }, { label: "Tokens", numeric: true }, { label: "Share", numeric: true },
          ]} rows={ranked.map((item, index) => {
            const tokens = valueOf(item) * scale;
            const fraction = total ? tokens / total : undefined;
            const share = fraction === undefined ? "—" : fraction > 0 && fraction < 0.001 ? "<0.1%" : `${(100 * fraction).toFixed(1).replace(/\.0$/, "")}%`;
            return { key: item.title, cells: [index + 1,
              <Button variant="ghost" title={item.title} aria-label={`Open breakdown for ${item.title}`} data-rank={index}
                onClick={() => { trigger.current = item.title; setDetail(item); }}>
                <span class="ranking-title">{item.title}</span>
                <span class="ranking-bar" aria-hidden="true">{item.parts.map((value, part) => value && segments.includes(part) ?
                  <span key={part} class={`ranking-segment segment-${part + 1}`} style={{ flexBasis: `${value / barMax * 100}%` }} /> : null)}</span>
              </Button>, number(tokens), share] };
          })} /></div>
        </>}
    </Section>}
    <Section title="Where the tokens went" sub="Three non-overlapping parts of the period total, regardless of metric">
      <DataTable flat caption="Period token breakdown" columns={[{label:"Part"},{label:"Tokens",numeric:true}]}
        rows={labels.map((label, index) => ({ key: label, cells: [label, complete ? number(sum(fixture.map(item => item.parts[index]!)) * scale) : "Unavailable"] }))} />
    </Section>
  </div>;
}
if (new URLSearchParams(location.search).get("theme") === "light") document.documentElement.dataset.ds = "light";
render(<Mock />, document.getElementById("root")!);
