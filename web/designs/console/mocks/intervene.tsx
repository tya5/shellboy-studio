import { render, type ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { Field } from "../system/components/Field";
import { Icon } from "../system/components/Icon";
import { ListRow } from "../system/components/ListRow";
import { LogBlock } from "../system/components/LogBlock";
import { StatusMark } from "../system/components/StatusMark";
import { WorkSheet } from "../system/components/WorkSheet";
import "../system/tokens/console.css";
import "../system/components.css";
import "../system/layout.css";
import "./intervene.css";

const log = "Preparing release notes…\n\n> npm run verify\n\nWaiting for stdin: approve deployment? [y/N]";
function ShellRow({ onOpen }: { onOpen: (target: HTMLButtonElement) => void }) {
  return <ListRow id="run-7" title="npm run verify" command="~/work/shellboy-studio" subtitle="Running · foreground · 02:14" icon="status.running" waiting onSelect={onOpen}><StatusMark status="running" label="Running" /></ListRow>;
}
function Controls({ phone = false }: { phone?: boolean }) {
  const [detail, setDetail] = useState(false);
  const [confirm, setConfirm] = useState<"shell" | "turn" | null>(null);
  const [toast, setToast] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const say = (message: string) => { setToast(message); setTimeout(() => setToast(""), 2200); };
  return <section class={`intervene-device${phone ? " is-phone" : ""}`}>
    <header class="intervene-toolbar"><div><p class="intervene-eyebrow">SHELLBOY · FOREGROUND SESSION</p><h2>Release verification</h2></div><StatusMark status="running" label="Running" /></header>
    <div class="intervene-shell-row"><ShellRow onOpen={target => { opener.current = target; setDetail(true); }} /><Button variant="ghost" onClick={() => setDetail(true)}>Inspect</Button></div>
    <div class="intervene-output"><div class="intervene-output-head"><span>Shell output</span><span>stdin waiting</span></div><LogBlock text={log} boxed /></div>
    <div class="intervene-commands">
      <div class="intervene-composer"><Field label="Message this Thread" value="Please review the verification result." /><Field as="select" label="Delivery" value="boundary" options={[{ value:"boundary", label:"Next boundary" }, { value:"now", label:"Now" }]} onSelectChange={value => say(value === "now" ? "Now releases the foreground wait." : "Queued for the next boundary.")} /><p class="intervene-help"><Icon role="panel.information" size="small" />Next boundary queues delivery safely. Now releases the foreground wait immediately.</p><Button variant="primary" onClick={() => say("Fixture: message would be sent")}>Send</Button></div>
      <div class="intervene-turn-actions"><Button variant="stop" onClick={() => setConfirm("turn")}>Stop Turn</Button><Button variant="warn" disabled aria-describedby="core402-turn">Interrupt Turn</Button><span id="core402-turn" class="core-note">Core #402 · not available yet</span></div>
    </div>
    {toast && <p role="status" class="intervene-toast">{toast}</p>}
    <WorkSheet open={detail} title="Foreground shell" closeLabel="Back" onClose={() => setDetail(false)} getReturnFocusTarget={() => opener.current}>
      <p class="intervene-path">Thread · release-notes · PID 18422 · 02:14</p>
      <div class="intervene-detail-status"><StatusMark status="running" label="Waiting for stdin" /><span>Prompt: approve deployment? [y/N]</span></div>
      <div class="intervene-action-group"><Button variant="outline" disabled aria-describedby="core402-background">Move to background</Button><span id="core402-background" class="core-note">Core #402 · pending support</span><Button variant="stop" onClick={() => setConfirm("shell")}>Stop this shell</Button></div>
      <div class="intervene-input"><Field label="Send input" value="y" /><div class="intervene-input-actions"><Button variant="primary" onClick={() => { say("Fixture: shell.write input"); setDetail(false); }}>Send input</Button><Button variant="outline" onClick={() => { say("Fixture: shell.eof"); setDetail(false); }}>Send EOF</Button></div><p class="intervene-help">Input goes only to this shell's waiting stdin.</p></div>
    </WorkSheet>
    <WorkSheet open={confirm !== null} title={confirm === "turn" ? "Stop this Turn?" : "Stop this shell?"} role="alertdialog" describedBy="stop-copy" closeLabel="Cancel" onClose={() => setConfirm(null)} getReturnFocusTarget={() => opener.current}>
      <p id="stop-copy">{confirm === "turn" ? "The active Turn will stop. Its current shell may remain running." : "The shell will be stopped and its running command will be interrupted. This cannot be undone."}</p><Button variant="stop" onClick={() => { const target = confirm; setConfirm(null); say(target === "turn" ? "Fixture: run.stop" : "Fixture: shell.stop"); if (target === "shell") setDetail(false); }}>{confirm === "turn" ? "Stop Turn" : "Stop this shell"}</Button>
    </WorkSheet>
  </section>;
}
function Device({ title, children }: { title: string; children: ComponentChildren }) { return <section class="intervene-variant"><p class="intervene-variant-label">{title}</p>{children}</section>; }
function Mock() {
  return <main class="intervene-mock"><header class="intervene-intro"><p class="intervene-eyebrow">DESIGN STUDY · CORE BOUNDARY CALLED OUT</p><h1>Intervene in a foreground shell</h1><p>Separate a waiting shell from its Turn. Send at the next boundary by default; choose Now only when immediate delivery is intended.</p></header><div class="intervene-grid"><Device title="Desktop · shell row opens drill-in"><Controls /></Device><Device title="Phone · visible, touch-sized actions"><Controls phone /></Device></div><footer class="intervene-legend"><span><b>Available Core calls</b> `shell.stop` · `shell.write` · `shell.eof` · message send `deliver: now`</span><span><b>Core #402 required</b> Move to background · Interrupt Turn</span></footer></main>;
}
render(<Mock />, document.getElementById("mock")!);
