// Static design mock for shellboy-studio #134: intervening in a long-running foreground shell.
// Fixture data and local state only; no owner, no Core call, no shell is run.
import { useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { ButtonGroup } from "../system/components/ButtonGroup";
import { Composer } from "../system/components/Composer";
import { ConversationCharacter } from "../system/components/ConversationCharacter";
import { Field } from "../system/components/Field";
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
import { StepRow } from "../system/components/StepRow";
import { WorkSheet } from "../system/components/WorkSheet";
import { Frame, StaticSheet, ThemeRow, mountMock } from "./frame";
import "./intervene.css";

const shell = { id: "exec-7", command: "npm run verify", cwd: "~/work/studio", elapsed: "02:14", prompt: "Approve deployment? [y/N]" };
const output = "> npm run verify\n130 test files passed\nPreview built: dist/\nApprove deployment? [y/N]";
const tabs: readonly PanelTabItem[] = [
  { id: "work", label: "Activity", icon: "panel.work", count: 2 },
  { id: "reply-needed", label: "Reply needed", icon: "panel.reply_needed" },
  { id: "awaiting-reply", label: "Awaiting reply", icon: "panel.awaiting_reply" },
  { id: "possessions", label: "Possessions", icon: "panel.attachment" },
  { id: "info", label: "Analytics", icon: "panel.information" },
  { id: "settings", label: "Settings", icon: "panel.threadSettings" },
];
const CORE_402 = "Needs Core #402";

type Mode = "next" | "now";
const modeCopy: Record<Mode, string> = {
  next: "Next boundary: arrives after the running shell returns. Nothing is interrupted.",
  now: "Now: the Turn stops waiting for the shell and reads your message now. The shell keeps running.",
};

/** Send timing, shown above the composer while a shell holds the Turn in the foreground. */
function SendMode({ start }: { start: Mode }) {
  const [mode, setMode] = useState(start);
  return <div class="iv-send-mode">
    <ButtonGroup label="Send timing">
      <Button aria-pressed={mode === "next"} onClick={() => setMode("next")}>Next boundary</Button>
      <Button aria-pressed={mode === "now"} onClick={() => setMode("now")}>Now</Button>
    </ButtonGroup>
    <p class="iv-send-mode-copy" id="iv-send-mode-copy">{modeCopy[mode]}</p>
  </div>;
}

function Conversation({ mode, phone }: { mode: Mode; phone?: boolean }) {
  return <div class="convo">
    <div class="top"><div class="crumb">{phone ? null : <><span>Threads</span><span>/</span></>}<b>Release verification</b></div></div>
    <div class="scroll">
      <Message bot={false} who="You" at="10:40" text="Verify the release and deploy the preview." copyLabel="Copy" copiedLabel="Copied" />
      <Message bot who="Shellboy" at="10:41" text="Running the verification. It asks before deploying." copyLabel="Copy" copiedLabel="Copied" />
      <StepRow open={false} command={shell.command} status={<StatusMark shell status="running" word={false} label="Running" />} duration={shell.elapsed} onToggle={() => {}}>{null}</StepRow>
    </div>
    <div class="work-row conversation-status"><ConversationCharacter name="thinking" running={false} /><span>Running</span><span data-status-description>{shell.command} · waiting for input</span><span>{shell.elapsed}</span></div>
    <div class="dock">
      <SendMode start={mode} />
      <Composer label="Message" placeholder="Send a message or add an instruction" hint="Enter to send, Shift+Enter for a new line" sendLabel="Send" canSend busy={false}
        start={<Button variant="ghost" class="iv-model"><span class="mono">gpt-6.2</span><span class="muted">medium</span></Button>}
        context={<Button variant="ghost" disabled aria-describedby="iv-interrupt-note" title={CORE_402}>Interrupt Turn</Button>}
        stop={{ label: "Stop", run: () => {} }} onSend={async () => false} />
      <p class="iv-note" id="iv-interrupt-note">Interrupt Turn ends only this Turn, like Esc in the terminal. {CORE_402}. Stop still stops the whole Run.</p>
    </div>
    {phone ? <div class="phone-panel-footer"><ShellFooter side="right"><ShellToggle panel expanded={false} label="Show Thread panel" onClick={() => {}} /></ShellFooter></div> : null}
  </div>;
}

/** The open row menu, drawn statically so it can sit in a picture. It mirrors Menu's look. Menu omits disabled
 * entries today; showing Move to background disabled here needs Menu to render them as aria-disabled. */
function StaticRowMenu() {
  return <div class="iv-menu" role="menu" aria-label={`Actions for ${shell.command}`}>
    <span class="iv-menu-item" role="menuitem">Send input…</span>
    <span class="iv-menu-item" role="menuitem" aria-disabled="true"><span class="iv-menu-copy">Move to background<small>{CORE_402}</small></span></span>
    <span class="iv-menu-separator" role="separator" />
    <span class="iv-menu-item iv-menu-item-destructive" role="menuitem">Stop this shell…</span>
  </div>;
}

function ActivityList({ open, menu }: { open: () => void; menu?: boolean }) {
  return <div class="panel-list" data-panel-list="work">
    <section><ListDivider label="Running" count={1} />
      <div class="iv-row">
        <ListRow id={shell.id} title={shell.command} subtitle={`stdin · ${shell.elapsed}`} icon="work.command" waiting menuLabel={`Actions for ${shell.command}`}
          actions={[{ key: "input", label: "Send input…", run: open }, { key: "stop", label: "Stop this shell…", run: open }]} onSelect={open} />
        {menu ? <StaticRowMenu /> : null}
      </div>
    </section>
    <section><ListDivider label="Waiting for history" count={1} />
      <ListRow id="msg-2" title="Also check the changelog links." subtitle="Next boundary" icon="panel.awaiting_reply" onSelect={() => {}} /></section>
  </div>;
}

function ShellDetail({ onBack, onStop }: { onBack: () => void; onStop: () => void }) {
  return <section class="panel-detail" data-panel-detail="">
    <div class="panel-detail-head"><Button variant="ghost" data-panel-back onClick={onBack}><Icon role="panel.back" size="small" />Activity</Button><h3>Execution details</h3></div>
    <div class="iv-detail">
      <div class="cmd"><Icon role="work.command" /><span>{shell.command}</span></div>
      <KeyValue rows={[
        { key: "Status", value: <StatusMark shell status="running" label="Running" /> },
        { key: "Turn", value: "Waiting for this shell" },
        { key: "Duration", value: shell.elapsed, mono: true },
        { key: "Directory", value: shell.cwd, mono: true },
      ]} />
      <section class="iv-group iv-input" aria-labelledby="iv-input-title">
        <h4 id="iv-input-title">Waiting for input</h4>
        <p class="iv-prompt"><code>{shell.prompt}</code></p>
        <Field label="Text to send" value="y" help="Goes only to this shell's standard input." />
        <div class="iv-actions"><Button variant="primary">Send input</Button><Button>Send EOF</Button></div>
      </section>
      <section class="iv-group" aria-labelledby="iv-shell-title">
        <h4 id="iv-shell-title">This shell</h4>
        <div class="iv-shell-actions">
          <Button variant="ghost" disabled aria-describedby="iv-bg-note">Move to background</Button>
          <p class="iv-note" id="iv-bg-note">{CORE_402}. The shell keeps running and the Turn goes on without waiting.</p>
          <Button variant="ghost" class="iv-stop-shell" onClick={onStop}><Icon role="action.stop" size="small" />Stop this shell…</Button>
        </div>
      </section>
      <h4 class="iv-output-title">Output</h4>
      <LogBlock text={output} boxed />
    </div>
  </section>;
}

const stopCopy = `"${shell.command}" is interrupted and can't be resumed. The Turn goes on and sees the shell as stopped. Stop in the composer is separate: it stops the whole Run.`;

function Panel({ start, phone }: { start?: { detail?: boolean; menu?: boolean; confirm?: boolean }; phone?: boolean }) {
  const [detail, setDetail] = useState(!!start?.detail);
  const [confirming, setConfirming] = useState(false);
  return <aside class="details" data-panel-root="" data-phone-panel={phone || undefined} aria-label="Thread panel">
    <PanelTabs label="Thread panel" items={tabs} selected="work" onSelect={() => {}} />
    <div class="panel-pages">
      <PanelPage id="work" hidden={false}>
        <div class="panel-list-frame" hidden={detail}><ActivityList open={() => setDetail(true)} menu={start?.menu} /></div>
        {detail ? <ShellDetail onBack={() => setDetail(false)} onStop={() => setConfirming(true)} /> : null}
      </PanelPage>
    </div>
    {!phone ? <ShellFooter side="right"><ShellToggle panel expanded label="Hide Thread panel" onClick={() => {}} /></ShellFooter> : null}
    {start?.confirm ? <StaticSheet alert title="Stop this shell?" closeLabel="Cancel"><p>{stopCopy}</p><Button variant="warn">Stop shell</Button></StaticSheet> : null}
    {confirming ? <WorkSheet open role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title="Stop this shell?" closeLabel="Cancel" describedBy="iv-stop-copy" getReturnFocusTarget={() => null} onClose={() => setConfirming(false)}>
      <p id="iv-stop-copy">{stopCopy}</p><Button variant="warn" onClick={() => { setConfirming(false); setDetail(false); }}>Stop shell</Button>
    </WorkSheet> : null}
  </aside>;
}

function Desktop({ caption, mode, detail, menu }: { caption: string; mode: Mode; detail?: boolean; menu?: boolean }) {
  return <Frame caption={caption}><Conversation mode={mode} /><Panel start={{ detail, menu }} /></Frame>;
}

function PhonePanel({ caption, detail, menu, confirm }: { caption: string; detail?: boolean; menu?: boolean; confirm?: boolean }) {
  return <Frame phone caption={caption}>
    <Conversation mode="next" phone />
    <StaticSheet title="Thread panel" closeLabel="Close"><Panel phone start={{ detail, menu, confirm }} /></StaticSheet>
  </Frame>;
}

function States({ light }: { light?: boolean }) {
  return <ThemeRow light={light}>
    <Desktop caption="Desktop · running shell row with its menu; send timing Next boundary (default)" mode="next" menu />
    <Desktop caption="Desktop · shell detail drill-in; send timing Now" mode="now" detail />
    <Frame phone caption="Phone · conversation: send timing, Interrupt Turn beside Stop"><Conversation mode="next" phone /></Frame>
    <PhonePanel caption="Phone · section picker, shell row menu" menu />
    <PhonePanel caption="Phone · full-screen shell detail with Back" detail />
    <PhonePanel caption="Phone · Stop this shell confirmation" detail confirm />
  </ThemeRow>;
}

mountMock(<main class="mock-page">
  <header class="mock-intro">
    <p class="mock-kicker">Studio design study · #134</p>
    <h1>Intervene in a foreground shell</h1>
    <p>A shell that holds the Turn in the foreground gets its own controls on its Activity row and in its detail, separate from Stop for the Run. While it runs, the composer offers a send timing. Static fixture data; no Core connection.</p>
    <ul class="mock-notes">
      <li>Available in Core today: <code>shell.write</code> (Send input), <code>shell.eof</code> (Send EOF), <code>shell.stop</code> (Stop this shell) and <code>message send --deliver now</code> (Now).</li>
      <li>Disabled until Core #402: Move to background (<code>shell.background</code>) and Interrupt Turn (<code>turn.interrupt</code>).</li>
      <li>Send input and Send EOF appear only while the shell waits on standard input.</li>
    </ul>
  </header>
  <States />
  <States light />
</main>);
