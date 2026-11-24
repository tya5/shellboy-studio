import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, ButtonGroup, DataTable, Notice, PageHeader, Section } from "../system/components";
import { PERIODS } from "../../../ui-core/src/analytics";
import "../system/tokens/console.css";
import "../system/components.css";
import "../system/layout.css";
import "./cost-ranking.css";

const fixture = [
  { title: "Desktop release", parts: [112000, 48000, 32000] },
  { title: "Search improvements", parts: [64000, 24000, 8000] },
  { title: "API documentation", parts: [24000, 16000, 8000] },
  { title: "Keyboard review", parts: [16000, 8000, 8000] },
  { title: "Weekly notes", parts: [8000, 8000, 0] },
] as const;
type Thread = (typeof fixture)[number];
const labels = ["Conversation (other)", "Conversation cached input", "Summaries (all)"];
const number = (value: number) => value.toLocaleString("en-US");
const sampleScale = { 1: 0.125, 7: 1, 14: 1.5, 31: 2 };
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function Mock() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [detail, setDetail] = useState<Thread>();
  const trigger = useRef<number>();
  const back = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (detail) back.current?.querySelector("button")?.focus();
    else if (trigger.current !== undefined) document.querySelector<HTMLButtonElement>(`[data-rank="${trigger.current}"]`)?.focus();
  }, [detail]);
  const complete = days !== 31;
  const scale = sampleScale[days];
  const total = sum(fixture.map(item => sum(item.parts))) * scale;
  const parts = detail?.parts.map(value => value * scale);
  const dates = { 1: "Nov 23", 7: "Nov 17-23", 14: "Nov 10-23", 31: "Oct 24-Nov 23" };
  return <div class="ranking-mock">
    <PageHeader title="Analytics / By Thread" description="Compare recorded token use across Threads. Token counts are not prices or a bill."
      toolbar={<ButtonGroup label="Period">{PERIODS.map(period => <Button key={period} aria-pressed={days === period}
        onClick={() => { setDays(period); trigger.current = undefined; setDetail(undefined); }}>{period} {period === 1 ? "day" : "days"}</Button>)}</ButtonGroup>} />
    <div class="caption muted">{dates[days]}, 2026 (UTC) / Synthetic data</div>
    {detail && parts ? <Section title={detail.title} sub={`Thread Analytics / ${days}-day period`} actions={<div ref={back}><Button variant="ghost" onClick={() => setDetail(undefined)}>Back to ranking</Button></div>}>
      <DataTable flat caption="Selected Thread usage" columns={[{label:"Part"},{label:"Tokens",numeric:true}]}
        rows={parts.map((value, index) => ({ key: labels[index]!, cells: [labels[index], number(value)] }))} />
      <p class="caption muted">Mock of the existing per-Thread Analytics destination. Summary cached input stays inside Summaries.</p>
    </Section> : <Section title="Thread ranking" sub={complete ? `${number(total)} recorded tokens across ${fixture.length} Threads` : "Period scan incomplete"}
      source="Source: Core usage.get by Thread. Includes saved conversation attempts and summary requests.">
      {!complete ? <Notice tone="wait">Shares and ranks are unavailable until the period is fully read. This is not evidence of zero usage.</Notice> :
        <ol class="ranking-rows">{fixture.map((item, index) => {
          const tokens = sum(item.parts) * scale;
          const share = (100 * tokens / total).toFixed(1).replace(/\.0$/, "");
          return <li key={item.title}><Button variant="ghost" title={item.title} aria-label={`${index + 1}. ${item.title}, ${number(tokens)} tokens, ${share}% of period`}
            data-rank={index} onClick={() => { trigger.current = index; setDetail(item); }}>
            <span class="ranking-index">{index + 1}</span><span class="ranking-title">{item.title}</span>
            <span class="ranking-share">{share}%</span><span class="ranking-arrow" aria-hidden="true">&#8250;</span>
          </Button></li>;
        })}</ol>}
    </Section>}
    <Section title="Where the tokens went" sub="Three non-overlapping parts of the ranked period">
      <DataTable flat caption="Period token breakdown" columns={[{label:"Part"},{label:"Tokens",numeric:true}]}
        rows={labels.map((label, index) => ({ key: label, cells: [label, complete ? number(sum(fixture.map(item => item.parts[index]!)) * scale) : "Unavailable"] }))} />
    </Section>
  </div>;
}
render(<Mock />, document.getElementById("root")!);
