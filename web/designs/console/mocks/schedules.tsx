// Static design mock for shellboy-studio #131: schedules and services in the Activity panel.
// Fixture data and local state only; no owner, no Core call, no shell is run.
import { useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { Composer } from "../system/components/Composer";
import { Icon } from "../system/components/Icon";
import { KeyValue } from "../system/components/KeyValue";
import { ListDivider } from "../system/components/ListDivider";
import { ListRow } from "../system/components/ListRow";
import { LogBlock } from "../system/components/LogBlock";
import { Message } from "../system/components/Message";
import { PanelTabs, type PanelTabItem } from "../system/components/PanelTabs";
import { PanelPage } from "../system/components/PanelTabs/PanelPage";
import { ShellFooter, ShellToggle } from "../system/components/ShellToggle";
import { StatusMark } from "../system/components/StatusMark";
import { Switch } from "../system/components/Switch";
import { WorkSheet } from "../system/components/WorkSheet";
import { Frame, StaticSheet, ThemeRow, mountMock } from "./frame";
import "./schedules.css";

type Result = { status: "completed" | "failed" | "running"; text: string; at: string } | undefined;
type Job = {
  id: string; kind: "schedule" | "service"; title: string; command: string; cwd: string;
  when: string; whenText: string; next: string; enabled: boolean; result: Result; output: string;
};

const jobs: readonly Job[] = [
  { id: "docs", kind: "schedule", title: "Docs links", command: "./scripts/check-docs", cwd: "~/work/docs", when: "30 8 * * *", whenText: "Every day at 08:30, owner's local time", next: "Wed 08:30", enabled: true, result: { status: "completed", text: "exit 0", at: "Today 08:30" }, output: "checked 18 pages\nno broken links" },
  { id: "weekly", kind: "schedule", title: "Weekly summary", command: "./scripts/weekly-summary", cwd: "~/work/notes", when: "0 9 * * 1", whenText: "Every Monday at 09:00, owner's local time", next: "Paused", enabled: false, result: { status: "failed", text: "exit 1", at: "Mon 09:00" }, output: "error: could not read notes/index.md" },
  { id: "reminder", kind: "schedule", title: "Tag reminder", command: "shellboy message send --to human 'Tag v0.4.2'", cwd: "~/work/studio", when: "at 2026-11-25 10:00", whenText: "Once, owner's local time", next: "Wed 10:00", enabled: true, result: undefined, output: "" },
  { id: "feed", kind: "service", title: "Release feed", command: "./watch-release", cwd: "~/work/release-tools", when: "service", whenText: "Runs while started; no next occurrence", next: "Running", enabled: true, result: { status: "running", text: "Running since 07:12", at: "Today 07:12" }, output: "07:12 watching release feed\n09:40 no new tags" },
];

const tabs: readonly PanelTabItem[] = [
  { id: "work", label: "Activity", icon: "panel.work", count: 1 },
  { id: "reply-needed", label: "Reply needed", icon: "panel.reply_needed" },
  { id: "awaiting-reply", label: "Awaiting reply", icon: "panel.awaiting_reply" },
  { id: "possessions", label: "Possessions", icon: "panel.attachment" },
  { id: "info", label: "Analytics", icon: "panel.information" },
  { id: "settings", label: "Settings", icon: "panel.threadSettings" },
];

function ResultMark({ job }: { job: Job }) {
  const r = job.result;
  if (!r) return <StatusMark status="idle" label="Last result: not run yet" />;
  return <StatusMark shell status={r.status} word={false} label={`Last result: ${r.status === "running" ? r.text : `${r.status}, ${r.text}, ${r.at}`}`} />;
}

type Act = { open: (id: string) => void; toggle: (id: string) => void; remove: (id: string) => void };

/** One line: name, next run (or service state), last result, then the always-visible controls. */
function JobRow({ job, act }: { job: Job; act: Act }) {
  const service = job.kind === "service";
  return <div class="sched-row" data-sched-row={job.id}>
    <ListRow id={job.id} title={job.title} subtitle={job.next} onSelect={() => act.open(job.id)}><ResultMark job={job} /></ListRow>
    <span class="sched-row-control">{service
      ? <Button variant="ghost" onClick={() => act.toggle(job.id)}>{job.enabled ? "Stop" : "Start"}</Button>
      : <Switch label={`Enabled: ${job.title}`} stateLabel="" checked={job.enabled} onChange={() => act.toggle(job.id)} />}</span>
    <span class="sched-row-remove">{service ? null : <Button variant="ghost" icon label={`Remove ${job.title}`} title={`Remove ${job.title}`} onClick={() => act.remove(job.id)}><Icon role="action.delete" size="small" /></Button>}</span>
  </div>;
}

function ActivityList({ list, act }: { list: readonly Job[]; act: Act }) {
  const schedules = list.filter(job => job.kind === "schedule");
  const services = list.filter(job => job.kind === "service");
  return <div class="panel-list" data-panel-list="work">
    <section><ListDivider label="Running" count={1} />
      <ListRow id="run-tests" title="cargo test --workspace" subtitle="00:42" icon="work.command" onSelect={() => {}} /></section>
    <section><ListDivider label="Schedules" count={schedules.length} />{schedules.map(job => <JobRow key={job.id} job={job} act={act} />)}</section>
    <section><ListDivider label="Services" count={services.length} />{services.map(job => <JobRow key={job.id} job={job} act={act} />)}</section>
    <p class="caption muted sched-footnote">A one-time schedule leaves this list after it runs; its output stays in the shell history. Each list shows up to 64 entries.</p>
  </div>;
}

function JobDetail({ job, act, onBack }: { job: Job; act: Act; onBack: () => void }) {
  const service = job.kind === "service";
  const r = job.result;
  return <section class="panel-detail" data-panel-detail="">
    <div class="panel-detail-head"><Button variant="ghost" data-panel-back onClick={onBack}><Icon role="panel.back" size="small" />Activity</Button><h3>{service ? "Service" : "Schedule"}</h3></div>
    <div class="sched-detail">
      <div class="cmd"><Icon role="work.command" /><span class="stack"><span>{job.title}</span><span class="mono muted caption">{job.command}</span></span></div>
      <KeyValue rows={[
        { key: "Kind", value: service ? "Service" : job.when.startsWith("at ") ? "One-time schedule" : "Repeating schedule" },
        { key: service ? "Runs" : "When", value: <span class="stack">{service ? null : <code>{job.when}</code>}<span class="muted">{job.whenText}</span></span> },
        { key: service ? "State" : "Next run", value: job.next, mono: !service && job.enabled },
        { key: service ? "Started" : "Enabled", value: service ? <span class="mono">{r?.at ?? "Not started"}</span> : <Switch label={`Enabled: ${job.title}`} stateLabel={job.enabled ? "On" : "Off"} checked={job.enabled} onChange={() => act.toggle(job.id)} /> },
        ...(service ? [] : [{ key: "Last result", value: r ? <span class="sched-result"><StatusMark shell status={r.status} label={r.status === "completed" ? "Completed" : r.status === "failed" ? "Failed" : "Running"} /><span class="mono">{r.text} · {r.at}</span></span> : <span class="muted">Not run yet</span> }]),
        { key: "Directory", value: job.cwd, mono: true },
      ]} />
      {job.output ? <><h4 class="sched-output-title">{service ? "Recent output" : "Last output"}</h4><LogBlock text={job.output} boxed /></> : null}
      <div class="sched-detail-actions">{service
        ? <Button variant="ghost" onClick={() => act.toggle(job.id)}><Icon role="action.stop" size="small" />{job.enabled ? "Stop service" : "Start service"}</Button>
        : <Button variant="ghost" class="sched-remove" onClick={() => act.remove(job.id)}><Icon role="action.delete" size="small" />Remove schedule</Button>}</div>
      <p class="caption muted">{service ? "A service has no next run. Stop and Start use Core's service commands." : "There is no Run now: Core has no command for it. The switch uses Core's schedule disable and enable."}</p>
    </div>
  </section>;
}

function RemoveCopy({ job }: { job: Job }) {
  return <><p id="sched-remove-copy">"{job.title}" will be removed from this Thread. If it is running now, its shell is stopped. This can't be undone.</p>
    <Button variant="warn">Remove schedule</Button></>;
}

/** The right panel with the same structure as Conversation's RightPanel: tabs, pages, a list frame and a drill-in. */
function Panel({ start, phone }: { start?: { detail?: string; confirm?: boolean }; phone?: boolean }) {
  const [list, setList] = useState(jobs);
  const [detail, setDetail] = useState(start?.detail);
  const [removing, setRemoving] = useState<string>();
  const act: Act = {
    open: setDetail,
    toggle: id => setList(rows => rows.map(job => job.id !== id ? job : job.kind === "service"
      ? { ...job, enabled: !job.enabled, next: job.enabled ? "Stopped" : "Running" }
      : { ...job, enabled: !job.enabled, next: job.enabled ? "Paused" : jobs.find(base => base.id === id)!.next === "Paused" ? "Mon 09:00" : jobs.find(base => base.id === id)!.next })),
    remove: setRemoving,
  };
  const shown = list.find(job => job.id === detail);
  const target = list.find(job => job.id === removing);
  const confirmJob = start?.confirm ? shown : undefined;
  return <aside class="details" data-panel-root="" data-phone-panel={phone || undefined} aria-label="Thread panel">
    <PanelTabs label="Thread panel" items={tabs} selected="work" onSelect={() => {}} />
    <div class="panel-pages">
      <PanelPage id="work" hidden={false}>
        <div class="panel-list-frame" hidden={!!shown}><ActivityList list={list} act={act} /></div>
        {shown ? <JobDetail job={shown} act={act} onBack={() => setDetail(undefined)} /> : null}
      </PanelPage>
    </div>
    {!phone ? <ShellFooter side="right"><ShellToggle panel expanded label="Hide Thread panel" onClick={() => {}} /></ShellFooter> : null}
    {confirmJob ? <StaticSheet alert title="Remove this schedule?" closeLabel="Cancel"><RemoveCopy job={confirmJob} /></StaticSheet> : null}
    {target ? <WorkSheet open role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title="Remove this schedule?" closeLabel="Cancel" describedBy="sched-remove-copy" getReturnFocusTarget={() => null} onClose={() => setRemoving(undefined)}>
      <p id="sched-remove-copy">"{target.title}" will be removed from this Thread. If it is running now, its shell is stopped. This can't be undone.</p>
      <Button variant="warn" onClick={() => { setList(rows => rows.filter(job => job.id !== target.id)); setRemoving(undefined); setDetail(undefined); }}>Remove schedule</Button>
    </WorkSheet> : null}
  </aside>;
}

function Conversation() {
  return <div class="convo">
    <div class="top"><div class="crumb"><span>Threads</span><span>/</span><b>Release notes</b></div></div>
    <div class="scroll">
      <Message bot={false} who="You" at="08:12" text="Check the release docs every morning and tell me if a link breaks." copyLabel="Copy" copiedLabel="Copied" />
      <Message bot who="Shellboy" at="08:13" text="I added a daily schedule at 08:30 for the docs link check." copyLabel="Copy" copiedLabel="Copied" />
    </div>
    <div class="dock"><Composer label="Message" placeholder="Send a message or add an instruction" hint="Enter to send, Shift+Enter for a new line" sendLabel="Send" canSend busy={false} start={<Button variant="ghost"><span class="mono">gpt-6.2</span><span class="muted">medium</span></Button>} onSend={async () => false} /></div>
  </div>;
}

function Desktop({ detail }: { detail?: string }) {
  return <Frame caption={detail ? "Desktop · detail drill-in, docked in the panel" : "Desktop · Activity tab with Schedules and Services"}>
    <Conversation /><Panel start={detail ? { detail } : undefined} />
  </Frame>;
}

/** Phone: the panel opens in the Thread panel sheet; the section picker replaces the tabs; detail is full screen. */
function Phone({ caption, detail, confirm }: { caption: string; detail?: string; confirm?: boolean }) {
  return <Frame phone caption={caption}>
    <div class="sched-phone-app" aria-hidden="true"><div class="top"><div class="crumb"><b>Release notes</b></div></div></div>
    <StaticSheet title="Thread panel" closeLabel="Close"><Panel phone start={detail ? { detail, confirm } : undefined} /></StaticSheet>
  </Frame>;
}

function States({ light }: { light?: boolean }) {
  return <ThemeRow light={light}>
    <Desktop /><Desktop detail="docs" />
    <Phone caption="Phone · section picker and list" />
    <Phone caption="Phone · full-screen detail with Back" detail="docs" />
    <Phone caption="Phone · Remove confirmation" detail="docs" confirm />
  </ThemeRow>;
}

mountMock(<main class="mock-page">
  <header class="mock-intro">
    <p class="mock-kicker">Studio design study · #131</p>
    <h1>Schedules in the Activity panel</h1>
    <p>The Activity tab lists the Thread's time schedules and services from Core's existing list operations, one line each: name, next run or state, last result, and the enabled switch. A row opens a detail in the same panel; Back returns to the list. Static fixture data; no Core connection.</p>
    <ul class="mock-notes">
      <li>Pause and Resume are the switch (Core schedule disable and enable). Services use Stop and Start instead.</li>
      <li>Remove always asks first and says it stops a running shell.</li>
      <li>No Run now: Core has no such command. Core #399 (a proposed per-Run model-request ceiling) is not a schedule budget.</li>
    </ul>
  </header>
  <States />
  <States light />
</main>);
