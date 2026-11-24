// Static design mock for shellboy-studio #141: Core status, Restart, Stop and Start from Studio.
// Fixture data only. Nothing here calls Studio, the launcher or Core, and no owner is started or stopped.
import type { ComponentChildren } from "preact";
import { Button } from "../system/components/Button";
import { Disclosure } from "../system/components/Disclosure";
import { FactList, type Fact } from "../system/components/FactList";
import { GuideCopy } from "../system/components/GuideCopy";
import { Icon } from "../system/components/Icon";
import { ListDivider } from "../system/components/ListDivider";
import { ListRow } from "../system/components/ListRow";
import { LogBlock } from "../system/components/LogBlock";
import { Message } from "../system/components/Message";
import { Notice } from "../system/components/Notice";
import { PageHeader } from "../system/components/PageHeader";
import { Section } from "../system/components/Section";
import type { SectionNavItem } from "../system/components/SectionNav";
import { StatusMark } from "../system/components/StatusMark";
import { SubView } from "../system/components/SubView";
import { Frame, StaticSheet, ThemeRow, mountMock } from "./frame";
import "./core-management.css";

type Life = "running" | "starting" | "stopped";
type State = {
  id: string; caption: string; life: Life; external?: boolean; full?: boolean;
  recovered?: boolean; pending?: boolean; dialog?: "restart" | "stop";
};

const STATES: readonly State[] = [
  { id: "running", caption: "Running (whole page)", life: "running", full: true },
  { id: "starting", caption: "Starting: the stage Core reports (#398)", life: "starting" },
  { id: "stopped", caption: "Stopped by you, with Start", life: "stopped" },
  { id: "recovered", caption: "Exited unexpectedly, started again once", life: "running", recovered: true },
  { id: "pending", caption: "Restart pending after a setting change", life: "running", pending: true },
  { id: "restart", caption: "Restart confirmation: save and stop, then start", life: "running", pending: true, dialog: "restart" },
  { id: "stop", caption: "Stop confirmation: the work that stops", life: "running", dialog: "stop" },
  { id: "external", caption: "Browser, Core started outside Studio (whole page)", life: "running", external: true, full: true },
];

const DATA_DIR = "~/Library/Application Support/shellboy";
const START_COMMAND = `shellboy serve --data-dir "${DATA_DIR}"`;
const RUNS = [
  { id: "r1", title: "Release notes", subtitle: "Run · 12 min" },
  { id: "r2", title: "Docs link check", subtitle: "Run · 2 min" },
];
const SHELLS = [
  { id: "s1", title: "cargo test", subtitle: "Release notes · 00:42" },
  { id: "s2", title: "./watch-release", subtitle: "Release tools · service" },
  { id: "s3", title: "npm run dev", subtitle: "Studio mock · 1 h 10 min" },
];
const PENDING = ["Default model (General)", "Summary: auto-summary threshold (Summary)"];
const SUPERVISION_RULE = "If Core exits unexpectedly, Studio starts it again once. Restart and Stop here are your own choices: they never count as an unexpected exit and never trigger that automatic start.";

/** Mock-only glyph. The implementation would add a `play` glyph and a `core.start` role to the Icon registry. */
function StartGlyph() {
  return <svg class="cm-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>;
}

function Mark({ s, word = true }: { s: State; word?: boolean }) {
  if (s.life === "starting") return <StatusMark feedback status="waiting" word={word} label="Starting" />;
  if (s.life === "stopped") return <StatusMark shell status="stopped" word={word} label="Stopped" />;
  return <StatusMark feedback status="completed" word={word} label="Running" />;
}

function HeaderActions({ s }: { s: State }) {
  if (s.life === "stopped") return <Button variant="primary"><StartGlyph />Start</Button>;
  const restart = s.external ? null : <Button disabled={s.life === "starting"}><Icon role="action.retry" size="small" />Restart</Button>;
  return <>{restart}<Button variant="warn"><Icon role="action.stop" size="small" />Stop</Button></>;
}

function StatusSummary({ s }: { s: State }) {
  const line = s.life === "starting"
    ? <>Checking and updating the database<span class="mono muted cm-stage-id">database_migration</span></>
    : s.life === "stopped" ? "You stopped Core at 10:40. It stays stopped until you press Start."
    : s.external ? "Started outside Studio. Connected since 08:02." : "Ready since 09:12 (3 h 04 min).";
  return <div class="sect cm-summary" data-life={s.life}>
    <span class="cm-summary-mark"><Mark s={s} word={false} /></span>
    <div class="cm-summary-text">
      <strong>{s.life === "starting" ? "Starting" : s.life === "stopped" ? "Stopped" : "Running"}</strong>
      <span>{line}</span>
      {s.life === "starting" ? <span class="caption muted">This is the step Core reports now. Studio shows no percentage and no time estimate; a database update after an upgrade can take a while. Stop lets the current step reach a safe point first; it does not undo a database update.</span> : null}
    </div>
  </div>;
}

function Owner({ s }: { s: State }) {
  const facts: Fact[] = s.life === "stopped" ? [
    { label: "Last version", value: "0.15.0", mono: true },
    { label: "Last instance", value: "8d2f61c4-3b7e-4c19-9a52-0e6d4f1b7a30", mono: true },
    { label: "Stopped", value: "Today 10:40 · ended cleanly" },
    { label: "Data directory", value: DATA_DIR, mono: true },
  ] : [
    { label: "Version", ...(s.life === "starting" ? { note: "Core reports it once it is ready." } : { value: "0.15.0", mono: true }) },
    { label: "Instance", ...(s.life === "starting" ? { note: "Core gives its instance once it is ready." } : { value: "8d2f61c4-3b7e-4c19-9a52-0e6d4f1b7a30", mono: true }) },
    { label: "Started by", value: s.external ? "Outside Studio" : "Studio (this app)", note: s.external ? <>For example <code>shellboy serve</code> in a terminal.</> : undefined },
    s.external
      ? { label: "Connected since", value: "Today 08:02", note: "Studio did not start this Core, so it only knows when it connected." }
      : { label: "Ready since", ...(s.life === "starting" ? { note: "Not ready yet." } : { value: "Today 09:12 · 3 h 04 min" }) },
    { label: "Data directory", value: DATA_DIR, mono: true },
  ];
  return <Section title="Owner" sub="Read from Core when Studio connects, and from the launcher when Studio started it."><FactList missing="Not available" facts={facts} /></Section>;
}

function WorkList({ compact }: { compact?: boolean }) {
  return <div class="panel-list cm-work" data-compact={compact || undefined}>
    <section><ListDivider label="Runs" count={RUNS.length} />{RUNS.map(r => <ListRow key={r.id} id={r.id} title={r.title} subtitle={r.subtitle} icon="nav.conversation" onSelect={() => {}}><StatusMark status="running" word={false} label="Running" /></ListRow>)}</section>
    <section><ListDivider label="Shells" count={SHELLS.length} />{SHELLS.map(r => <ListRow key={r.id} id={r.id} title={r.title} subtitle={r.subtitle} icon="work.command" onSelect={() => {}}><StatusMark shell status="running" word={false} label="Running" /></ListRow>)}</section>
  </div>;
}

function LiveWork({ s }: { s: State }) {
  const body = s.life === "running"
    ? <WorkList />
    : <p class="muted cm-plain">{s.life === "starting" ? "Shown once Core is ready." : "Nothing runs while Core is stopped. Threads show the last saved state, and messages can't be sent."}</p>;
  return <Section title="Running now" sub={s.life === "running" ? "2 Runs and 3 shells" : undefined} actions={s.life === "running" ? <a class="nav-link" href="#monitor">Open Monitor</a> : undefined}>{body}</Section>;
}

function Supervision({ s }: { s: State }) {
  if (s.external) return <Section title="If Core exits">
    <p class="cm-plain">Studio didn't start this Core, so it doesn't supervise it: if it exits, nothing starts it again, and Studio can't restart it or start it after a stop.</p>
  </Section>;
  const automatic = s.recovered ? "Used at 09:12. A further unexpected exit waits for you." : s.life === "stopped" ? "Available again after you press Start." : "Available: one automatic start.";
  return <Section title="If Core exits unexpectedly" sub={SUPERVISION_RULE}>
    <FactList missing="Not available" facts={[
      { label: "Automatic start", value: automatic, note: "Pressing Start or Restart makes it available again. Readiness and time do not." },
    ]} />
  </Section>;
}

function RecoveredNotice({ open }: { open?: boolean }) {
  return <Notice tone="wait" title="Core exited unexpectedly at 09:12, and Studio started it again">
    <span>Exit: <code>exit status 101</code>. That was the one automatic start. If Core exits unexpectedly again, Studio shows why and waits for you to press Start. Runs that were running at 09:12 show "Interrupted" in the Monitor.</span>
    <Disclosure class="cm-log" open={open}><summary>Last lines of owner.log</summary><LogBlock boxed text={"09:12:03 shell s-41 exited 0\n09:12:07 error: storage worker stopped: disk I/O error\n09:12:07 owner exiting with status 101"} /></Disclosure>
  </Notice>;
}

function PendingNotice({ external }: { external?: boolean }) {
  return <Notice tone="wait" title="2 saved settings apply after Core restarts" actions={external ? undefined : <Button class="cm-pending-restart"><Icon role="action.retry" size="small" />Restart…</Button>}>
    <ul class="cm-bullets">{PENDING.map(p => <li key={p}>{p}</li>)}</ul>
    <span class="caption">Saved from Studio since this Core started. Restart when the work below can stop.</span>
  </Notice>;
}

function ExternalStart() {
  return <GuideCopy title="Start it again" note="After a stop, run this in a terminal on the machine where Core runs, then return here; Studio reconnects by itself." line={START_COMMAND} copy="Copy" copied="Copied" failed="Copy failed. Select the command and copy it." />;
}

function Body({ s, phone }: { s: State; phone?: boolean }) {
  return <>
    <StatusSummary s={s} />
    {s.recovered ? <RecoveredNotice open={!phone} /> : null}
    {s.pending ? <PendingNotice external={s.external} /> : null}
    <LiveWork s={s} />
    <Owner s={s} />
    <Supervision s={s} />
    {s.external ? <ExternalStart /> : null}
  </>;
}

function StopsList() {
  return <div class="cm-stops">
    <p class="cm-plain"><strong>This stops:</strong></p>
    <WorkList compact />
    <p class="caption muted cm-plain">Stopped Runs show "Interrupted by app exit" and don't resume by themselves. Enabled services start again with Core.</p>
  </div>;
}

function RestartSheet() {
  return <StaticSheet alert title="Restart Core?" closeLabel="Cancel">
    <div class="cm-sheet-copy" id="cm-restart-copy">
      <ol class="cm-steps">
        <li>Core stops taking new work, saves, and stops the work below.</li>
        <li>Studio waits for Core to close.</li>
        <li>Studio starts Core again; the 2 saved settings then apply.</li>
      </ol>
      <StopsList />
      <p class="cm-plain">This restart is your choice, so it never triggers the automatic start, and it makes that start available again.</p>
      <Button variant="primary"><Icon role="action.retry" size="small" />Restart Core</Button>
    </div>
  </StaticSheet>;
}

function StopSheet({ external }: { external?: boolean }) {
  return <StaticSheet alert title="Stop Core?" closeLabel="Cancel">
    <div class="cm-sheet-copy" id="cm-stop-copy">
      <p class="cm-plain">Core stops taking new work, saves, stops the work below and closes. {external ? "Studio can't start this Core again; use the command on this page." : "It stays stopped until you press Start: a stop you choose never triggers the automatic start."}</p>
      <StopsList />
      <p class="caption muted cm-plain">While Core is stopped, Threads show the last saved state, and schedules and services don't run.</p>
      <Button variant="warn"><Icon role="action.stop" size="small" />Stop Core</Button>
    </div>
  </StaticSheet>;
}

const NAV: readonly (Omit<SectionNavItem, "current" | "href"> & { key: string })[] = [
  { key: "general", role: "settings.general", label: "General", description: "Defaults for new Threads", group: "Start here" },
  { key: "connections", role: "settings.connections", label: "Connections", description: "API endpoints and authentication", group: "Start here" },
  { key: "compaction", role: "settings.compaction", label: "Summary", description: "When and how summaries happen", group: "Agent" },
  { key: "index", role: "settings.index", label: "Indexing", description: "Automatic history indexing", group: "Agent" },
  { key: "agent", role: "settings.agent", label: "Guide registration", description: "Agent guidance", group: "Agent" },
  { key: "appearance", role: "settings.appearance", label: "Appearance", description: "Theme and interface language", group: "Display" },
  { key: "storage", role: "settings.storage", label: "Storage", description: "Limits and how long data is kept", group: "Data" },
  // Mock: the cube glyph stands in for a new `settings.core` role.
  { key: "core", role: "work.execution", label: "Core", description: "Status, Restart and Stop", group: "This app" },
  { key: "studio", role: "settings.studio", label: "Studio", description: "Access and application information", group: "This app" },
];

function Settings({ s, phone }: { s: State; phone?: boolean }) {
  const items: SectionNavItem[] = NAV.map(n => ({ ...n, href: `#settings/${n.key}`, current: n.key === "core" }));
  const description = s.external ? "The Shellboy owner this browser is attached to. It was started outside Studio." : "The Shellboy owner that runs your Threads, shells and schedules. Studio started it.";
  return <SubView title="Settings" items={items} groupedNav searchLabel="Search settings" close={{ href: "#conversation", label: "Close" }}>
    <PageHeader title="Core" description={description} actions={<div class="cm-actions"><HeaderActions s={s} /></div>} />
    <Body s={s} phone={phone} />
  </SubView>;
}

/** The desktop status bar. Its first item becomes the Core status entry; it only opens Settings › Core. */
function StatusBar({ s }: { s: State }) {
  const text = s.life === "starting" ? "Core starting: checking the database" : s.life === "stopped" ? "Core stopped" : s.pending ? "Core running" : "Core running";
  return <footer class="status">
    <a class="cm-status-entry" href="#settings/core" aria-label={`${text}. Open Core settings`}><Mark s={s} word={false} /><span>{text}</span>{s.pending ? <span class="cm-status-pending">· restart pending</span> : null}</a>
    <span class="owner-dir">Owner <span class="mono"><bdi>{DATA_DIR}</bdi></span></span>
    <div class="right">{s.life === "running" ? <span>Live updates</span> : null}{s.external ? null : <Button>Quit Studio</Button>}</div>
  </footer>;
}

function Sheet({ s }: { s: State }) {
  return s.dialog === "restart" ? <RestartSheet /> : s.dialog === "stop" ? <StopSheet external={s.external} /> : null;
}

function Desktop({ s }: { s: State }) {
  return <Frame caption={`Desktop · ${s.caption}`}>
    <div class="cm-app" data-full={s.full || undefined}><Settings s={s} /><StatusBar s={s} /></div>
    <Sheet s={s} />
  </Frame>;
}

function Phone({ s }: { s: State }) {
  return <Frame phone caption={`Phone · ${s.caption}`}>
    <div class="cm-app" data-full={s.full || undefined}><Settings s={s} phone /></div>
    <Sheet s={s} />
  </Frame>;
}

/** Elsewhere in Studio: a full-width banner while Core is not running normally, linking to Settings › Core. */
function BannerElsewhere({ phone }: { phone?: boolean }) {
  const s = STATES.find(x => x.id === "stopped")!;
  const content = <div class="cm-app">
    <Notice banner>Core is stopped. You are seeing the last saved state. <a class="nav-link" href="#settings/core">Open Core</a></Notice>
    <div class="convo">
      <div class="top"><div class="crumb"><span>Threads</span><span>/</span><b>Release notes</b></div></div>
      <div class="scroll">
        <Message bot={false} who="You" at="10:31" text="Run the release checks again after lunch." copyLabel="Copy" copiedLabel="Copied" />
        <Message bot who="Shellboy" at="10:32" text="Started cargo test --workspace and the docs link check." copyLabel="Copy" copiedLabel="Copied" />
      </div>
    </div>
    {phone ? null : <StatusBar s={s} />}
  </div>;
  return <Frame phone={phone} caption={phone ? "Phone · another view: the banner opens Core" : "Desktop · another view: the banner and the status entry open Core"}>{content}</Frame>;
}

function Row({ children }: { children: ComponentChildren }) {
  return <div class="cm-row">{children}</div>;
}

function States({ light }: { light?: boolean }) {
  return <ThemeRow light={light}>
    {STATES.map(s => <Row key={s.id}><Desktop s={s} /><Phone s={s} /></Row>)}
    <Row><BannerElsewhere /><BannerElsewhere phone /></Row>
  </ThemeRow>;
}

// `?theme=dark` or `?theme=light` renders one theme, so each capture stays under the browser's texture limit.
const theme = new URLSearchParams(location.search).get("theme");

mountMock(<main class="mock-page">
  <header class="mock-intro">
    <p class="mock-kicker">Studio design study · #141</p>
    <h1>Core status, Restart and Stop in Studio</h1>
    <p>Frames are window-sized and start at the top, except the first row, which shows the whole page. Settings › Core holds the Core view and its actions. On desktop, the status bar's first item shows Core's state and opens that view. While Core is not running normally, every view shows a banner that also links there. Static fixture data; no Core connection, and nothing is started or stopped.</p>
    <ul class="mock-notes">
      <li>The rule appears in the page, in both confirmations and in the crash message: an explicit Restart or Stop never triggers the automatic start. Studio starts Core again by itself only after an unexpected exit, and only once per manual Start (#115).</li>
      <li>Restart saves and stops through owner.shutdown, waits for Core to close, then starts it through the desktop launcher. No new Core command is needed.</li>
      <li>Starting shows the stage Core reports (#398) and its typed id, with no percentage and no time estimate.</li>
      <li>A browser attached to a Core started elsewhere gets the status and Stop only, plus the command to start Core again.</li>
      <li>Every action is a visible, labelled button, so nothing needs hover. The Start glyph is mock-only and needs a new icon role.</li>
    </ul>
  </header>
  {theme !== "light" ? <States /> : null}
  {theme !== "dark" ? <States light /> : null}
</main>);
