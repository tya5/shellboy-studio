import { render, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { Field } from "../system/components/Field";
import { ListRow } from "../system/components/ListRow";
import { LogBlock } from "../system/components/LogBlock";
import { PanelTabs, type PanelTabItem } from "../system/components/PanelTabs";
import "../system/tokens/console.css";
import "../system/components.css";
import "../system/layout.css";
import "./studio128-touch.css";

const sections: readonly PanelTabItem[] = [
  { id: "work", label: "Activity", icon: "panel.work", count: 2 },
  { id: "reply-needed", label: "Reply needed", icon: "panel.reply_needed", count: 1 },
  { id: "awaiting-reply", label: "Awaiting reply", icon: "panel.awaiting_reply" },
  { id: "possessions", label: "Possessions", icon: "panel.attachment" },
  { id: "info", label: "Analytics", icon: "panel.information" },
  { id: "settings", label: "Settings", icon: "panel.threadSettings" },
];
const label = (item: PanelTabItem) => item.count ? `${item.label} (${item.count})` : item.label;
const fixtures = ["Review documentation", "Check the release notes", "Verify desktop package"];
const output = ["Checking the documentation...", "", "[warning] The preview for docs/guides/examples/a-very-long-directory-name-with-another-long-segment/release-notes.md is newer than its source.", "", "3 files checked", "Done."].join("\n");

function Phone({ caption, children }: { caption: string; children: ComponentChildren }) {
  return <div class="mock-variant"><p class="mock-caption">{caption}</p><div class="app mock-phone">{children}</div></div>;
}
function Compare({ n, title, before, after, note }: { n: number; title: string; before: ComponentChildren; after: ComponentChildren; note: string }) {
  return <section class="mock-case" id={`item-${n}`}><h2>{n}. {title}</h2><p>{note}</p><div class="mock-compare"><Phone caption="Before">{before}</Phone><Phone caption="Proposed">{after}</Phone></div></section>;
}
function Header({ children }: { children: ComponentChildren }) { return <header class="mock-header">{children}</header>; }
function Panel({ before }: { before?: boolean }) {
  const [selected, choose] = useState("work");
  const section = sections.find(item => item.id === selected)!;
  return <><Header>Right panel</Header><div class="mock-body">
    {before ? <PanelTabs label="Right panel section" items={sections} selected={selected} onSelect={choose} /> :
      <Field as="select" label="Right panel section" value={selected} options={sections.map(item => ({ value: item.id, label: label(item) }))} onSelectChange={choose} />}
    <div id={before ? `panel-page-${section.id}` : undefined} role={before ? "tabpanel" : undefined} aria-labelledby={before ? `panel-tab-${section.id}` : undefined}>
      <h3>{section.label}</h3>{selected === "work" ? fixtures.slice(0, 2).map((title, i) => <ListRow key={title} id={`fixture-${i}`} title={title} subtitle={i ? "Queued" : "Running"} onSelect={() => {}} />) : <p class="muted">Example section.</p>}
    </div></div></>;
}
function DrillIn({ before }: { before?: boolean }) {
  const [open, setOpen] = useState(true);
  const list = <><Header>Activity</Header><div class="mock-body"><ListRow id="sample-activity" title={fixtures[0]!} subtitle="Finished" icon="panel.work" onSelect={() => setOpen(true)} /></div></>;
  const detail = <><Header><Button variant="ghost" onClick={() => setOpen(false)}>{before ? "Close" : "Back to Activity"}</Button></Header><div class="mock-body mock-scroll"><h3>{fixtures[0]}</h3><p>Finished · 3 files checked</p><LogBlock text="Documentation check complete." boxed /></div></>;
  if (!open) return list;
  return before ? <>{list}<div class="mock-scrim"/><div class="mock-bottom-sheet">{detail}</div></> : detail;
}
function Preview({ before }: { before?: boolean }) {
  return <div class={before ? "mock-dialog mock-dialog-before" : "mock-dialog mock-dialog-after"}>
    <Header><h3>Delete selected Threads?</h3><Button variant="ghost">Close</Button></Header>
    <div class="mock-body mock-scroll"><p>Review the exact selection before permanently deleting it. Unselected descendants stay.</p><ul>{[...fixtures, "Inspect asset manifest", "Check pair version", "Verify upgrade guide", "Read packaging checklist", "Check install links"].map(title => <li key={title}>{title}</li>)}</ul><Button variant="warn" disabled>Delete selected Threads</Button></div>
  </div>;
}
function Output({ before }: { before?: boolean }) {
  const [wrap, setWrap] = useState(true);
  return <><Header>Tool output</Header><div class={`mock-body mock-scroll ${!before && wrap ? "mock-wrap" : ""}`}>
    {!before && <Button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Wrap lines</Button>}
    <LogBlock text={output} boxed />
    <p class="muted">{before ? "Swipe the log sideways to read the full path." : "Wrapping is visual only. The original line stays intact."}</p>
  </div></>;
}
function Earlier({ before }: { before?: boolean }) {
  const [shown, show] = useState(false);
  return <><Header>Conversation</Header><div class="mock-body mock-scroll">
    {before ? null : shown ? <p role="status">Earlier messages loaded</p> : <Button onClick={() => show(true)}>Load earlier messages</Button>}
    {shown && <p class="mock-message">I linked the release checklist.</p>}
    <p class="mock-message">Can you check the documentation?</p><p class="mock-message">The guide links all resolve.</p>
  </div></>;
}

render(<main class="mock-page">
  <header class="mock-intro"><p class="mock-caption">Shellboy Studio · #128</p><h1>Phone &amp; touch review</h1><p>Five before-and-after proposals at 390 CSS px or narrower. Static fixture data; no Studio owner, navigation, or destructive actions.</p><nav aria-label="Mock sections">{[3, 4, 5, 6, 7].map(n => <a key={n} href={`#item-${n}`}>Item {n}</a>)}</nav></header>
  <Compare n={3} title="Right panel sections" note="Replace sideways tabs with one labeled section picker on phones. Keep the tab rail on wide screens." before={<Panel before />} after={<Panel />} />
  <Compare n={4} title="Activity drill-in" note="Use a full-screen detail with Back on phones. On a wide layout the same Activity and detail selection belong in the docked panel." before={<DrillIn before />} after={<DrillIn />} />
  <Compare n={5} title="Long confirmation" note="Keep the title and Close visible; only the body scrolls. The final action follows the preview, not a fixed footer." before={<Preview before />} after={<Preview />} />
  <Compare n={6} title="Long tool output" note="Wrap by default on phones, with an explicit switch for column-aligned output. Detail has one vertical scroll owner." before={<Output before />} after={<Output />} />
  <Compare n={7} title="Earlier history" note="Before: a pull can request older history, but there is no visible control. Proposed: expose that same action at the upper edge of a short history." before={<Earlier before />} after={<Earlier />} />
</main>, document.getElementById("mock")!);
