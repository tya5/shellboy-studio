// Static design mock for shellboy-studio #140: the expanded shell step in Conversation, before and after.
// Fixture data and local state only; nothing here calls Studio or Core. Product screens never import it.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { Disclosure } from "../system/components/Disclosure";
import { Icon } from "../system/components/Icon";
import { LogBlock } from "../system/components/LogBlock";
import { StatusMark } from "../system/components/StatusMark";
import { WorkElementRow, formatWorkElementDisplay } from "../system/components/WorkElementRow";
import type { ShellStatusKey } from "../../../ui-core/src/status";
import { Frame, ThemeRow, mountMock } from "./frame";
import "./shell-step.css";

// ---------- Fixtures ----------

type Segment = { stream: "stdout" | "stderr"; text: string };
type Fixture = {
  key: string;
  caption: string;
  description?: string;
  command: string;
  cwd: string;
  time: string;
  state: string; // raw machine state, as the issuer sends it today
  status: ShellStatusKey;
  exit?: number;
  duration: string;
  output?: Segment[];
  cutOff?: boolean;
  reclaimed?: boolean;
};

const CWD = "~/Workspace/shellboy-studio/web";
const longPath = (n: number) => `designs/console/screens/conversation/very-long-directory-name-for-wrapping/segment-${String(n).padStart(2, "0")}/Conversation.tsx`;
const longLines = Array.from({ length: 64 }, (_, i) => `${longPath(i % 9)}:${120 + i * 7}:      if (next && !open) model.openInPanel({ kind: "step", id: step.executionId }, panelFocusReturn(opener));`).join("\n");

const RUNNING: Fixture = {
  key: "running", caption: "Running (streaming)", description: "Run the web checks", command: "npm run check", cwd: CWD, time: "14:02", state: "running", status: "running", duration: "12.4s",
  output: [{ stream: "stdout", text: "> shellboy-studio-frontend@0.4.1 check\n> npm run -s typecheck && node designs/console/system/check-raw-px.mjs && vitest run\n\nraw-px: 0 new offenders\n RUN  v5.0.4 /Users/me/Workspace/shellboy-studio/web\n\n ✓ designs/layering.test.ts (3 tests) 41ms\n ✓ ui-core/test/format.test.ts (18 tests) 22ms\n ✓ designs/console/test/output-lines.test.tsx (6 tests) 310ms" }],
};
const SUCCEEDED: Fixture = {
  key: "ok", caption: "Succeeded", command: "git status --short --branch", cwd: "~/Workspace/shellboy-studio", time: "14:03", state: "exited", status: "completed", exit: 0, duration: "184ms",
  output: [{ stream: "stdout", text: "## wip/studio-shell-step-mock...origin/main [ahead 2]\n M web/designs/console/mocks/shell-step.tsx\n?? docs/design/shell-step-research.md" }],
};
const FAILED: Fixture = {
  key: "failed", caption: "Failed with stderr", description: "Run the shell integration test", command: "cargo test --test shell -- --nocapture stdin_deadline_reports_partial_bytes", cwd: "~/Workspace/shellboy", time: "14:05", state: "exited", status: "failed", exit: 101, duration: "2m 14s",
  output: [
    { stream: "stdout", text: "running 1 test\ntest stdin_deadline_reports_partial_bytes ... FAILED\n\nfailures:\n\n---- stdin_deadline_reports_partial_bytes stdout ----" },
    { stream: "stderr", text: "thread 'stdin_deadline_reports_partial_bytes' panicked at tests/shell.rs:412:9:\nassertion `left == right` failed\n  left: 4096\n right: 8192\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace" },
    { stream: "stdout", text: "\nfailures:\n    stdin_deadline_reports_partial_bytes\n\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 41 filtered out; finished in 134.02s" },
    { stream: "stderr", text: "error: test failed, to rerun pass `--test shell`" },
  ],
};
const LONG: Fixture = {
  key: "long", caption: "Long output (wraps on phone)", command: "rg -n \"openInPanel\\(\" designs/console --glob '!**/test/**'", cwd: CWD, time: "14:06", state: "exited", status: "completed", exit: 0, duration: "96ms",
  output: [{ stream: "stdout", text: longLines }],
};
const CUT: Fixture = {
  key: "cut", caption: "Truncated (read limit)", description: "Print the full owner log", command: "shellboy owner log --all", cwd: "~", time: "14:08", state: "exited", status: "completed", exit: 0, duration: "3.1s",
  output: [{ stream: "stdout", text: Array.from({ length: 12 }, (_, i) => `2026-11-24T05:${String(10 + i).padStart(2, "0")}:04Z INFO control: turn ${4810 + i} adopted, 2 tool calls, 0 waits`).join("\n") }], cutOff: true,
};
const RECLAIMED: Fixture = {
  key: "gone", caption: "Reclaimed by cleanup", command: "du -sh ~/Library/Caches/* | sort -h | tail -20", cwd: "~", time: "Nov 20", state: "exited", status: "completed", exit: 0, duration: "1.8s", reclaimed: true,
};
const AFTER_STATES = [RUNNING, SUCCEEDED, FAILED, LONG, CUT, RECLAIMED];
const BEFORE_STATES = [RUNNING, FAILED, LONG];

const fullText = (f: Fixture) => (f.output ?? []).map(s => s.text).join("\n");
const lineCount = (f: Fixture) => fullText(f) === "" ? 0 : fullText(f).split("\n").length;

// StepView formats the issued display, then shows the terminal mark for a known shell execution.
function display(f: Fixture) {
  return { ...formatWorkElementDisplay({
    iconRole: "work.tool", typeAccessibleLabel: "Shell command",
    contentLabel: { text: f.description ?? f.command, context: [{ name: "time", value: f.time }] },
    state: { source: "wire", value: f.state, executionStatus: f.status, ...(f.exit !== undefined ? { exitCode: f.exit } : {}) },
    detailPolicy: "existing-shell-output",
  }), iconRole: "work.terminal" as const };
}

/** The real group chrome around Work members (Conversation renderWorkGroup markup). */
function WorkGroup({ label, status, children }: { label: string; status: ShellStatusKey; children: ComponentChildren }) {
  return <div class="conversation-row steps">
    <Disclosure class="step step-group" open data-work-group="mock">
      <summary aria-label={`Work: ${label}`}><Icon role="work.group" /><span class="tool-group-label">{label}</span><StatusMark shell status={status} label={status === "running" ? "Running" : status === "failed" ? "Failed" : "Completed"} /><span class="meta" /></summary>
      <div class="step-group-list">{children}</div>
    </Disclosure>
  </div>;
}

function Member({ f, children }: { f: Fixture; children: ComponentChildren }) {
  return <div class="conversation-row" data-work-item-key={f.key}><div data-tool-call-id={f.key}><div data-execution-id={f.key}>
    <WorkElementRow display={display(f)} anchorKey={f.key} detailPolicy="existing-shell-output" open onToggle={() => {}}>{children}</WorkElementRow>
  </div></div></div>;
}

function Conversation({ children }: { children: ComponentChildren }) {
  return <div class="convo"><div class="scroll-frame"><div class="scroll mock-scroll">{children}</div></div></div>;
}

// ---------- Before: today's StepView detail markup (Conversation.tsx StepView + Output) ----------

function BeforeDetail({ f, phone }: { f: Fixture; phone?: boolean }) {
  const [wrap, setWrap] = useState(!!phone);
  return <>
    {f.description ? <div class="mono muted caption">{f.command}</div> : null}
    <div class="output-actions"><Button onClick={() => {}}>Copy</Button><Button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>Wrap lines</Button></div>
    <div class={`output-log${wrap ? " output-wrapped" : ""}`}><LogBlock text={fullText(f) || "No output."} /></div>
    {f.cutOff ? <div class="caption muted">Output is cut off here. This view reads only the first part.</div> : null}
  </>;
}

function Before({ phone }: { phone?: boolean }) {
  return <Conversation>
    <WorkGroup label="3 tools (1 failed) · Running" status="running">
      {BEFORE_STATES.map(f => <Member key={f.key} f={f}><BeforeDetail f={f} phone={phone} /></Member>)}
    </WorkGroup>
  </Conversation>;
}

// ---------- After ----------

// Plain line glyphs the system lacks today (Lucide shapes, stroke 1.7, currentColor). The build adds them
// as Icon roles: output.copy, output.copied, output.wrap, output.openDetails.
const glyph = {
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  wrap: <><path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4" /><path d="m16 16-2 2 2 2" /><path d="M3 18h7" /></>,
  panel: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18M10 15l-3-3 3-3" /></>,
} satisfies Record<string, JSX.Element>;
function MockIcon({ name }: { name: keyof typeof glyph }) {
  return <svg class="i ss-icon" viewBox="0 0 24 24" aria-hidden="true">{glyph[name]}</svg>;
}

/** Icon-only ghost button with an accessible name and a tooltip on hover and keyboard focus. */
function IconAction({ label, tip, pressed, shown, done, onClick, children }: { label: string; tip?: string; pressed?: boolean; shown?: boolean; done?: boolean; onClick: () => void; children: ComponentChildren }) {
  return <span class={`ss-tip${shown ? " ss-tip-shown" : ""}${done ? " ss-done" : ""}`} data-tip={tip ?? label}>
    <Button variant="ghost" icon label={label} aria-pressed={pressed} onClick={onClick}>{children}</Button>
  </span>;
}

function CopyAction({ label, text, announce, shown, tipShown }: { label: string; text: string; announce: (message: string) => void; shown?: boolean; tipShown?: boolean }) {
  const [copied, setCopied] = useState(!!shown);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    // Success only after the write resolves (Primer copy pattern).
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true); announce("Copied");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    }, () => announce("Couldn't copy"));
  };
  return <IconAction label={label} tip={copied ? "Copied" : label} shown={copied && tipShown} done={copied} onClick={copy}><MockIcon name={copied ? "check" : "copy"} /></IconAction>;
}

function OutputBody({ f, wrap }: { f: Fixture; wrap: boolean }) {
  return <pre class={`log ss-log${wrap ? " ss-wrap" : ""}`} tabIndex={0} aria-label="Output">{(f.output ?? []).map((s, i) => s.stream === "stderr"
    ? <span key={i} class="ss-stderr"><span class="ss-stream" aria-hidden="true">stderr</span><span class="ss-sr">stderr: </span>{s.text}{"\n"}</span>
    : <span key={i}>{s.text}{"\n"}</span>)}</pre>;
}

function AfterDetail({ f, phone, copiedShown }: { f: Fixture; phone?: boolean; copiedShown?: boolean }) {
  const [wrap, setWrap] = useState(!!phone);
  const [message, setMessage] = useState("");
  const announce = (text: string) => setMessage(previous => previous === text ? `${text} ` : text);
  const lines = lineCount(f);
  const stderr = (f.output ?? []).filter(s => s.stream === "stderr").reduce((n, s) => n + s.text.split("\n").length, 0);
  const exit = f.status === "running" ? undefined : f.exit;
  return <div class="ss-block" data-status={f.status}>
    <div class="ss-command">
      <code class="ss-command-text">{f.command}</code>
      <CopyAction label="Copy command" text={f.command} announce={announce} />
    </div>
    <div class="ss-facts">
      <span class="ss-fact ss-status">
        <StatusMark shell status={f.status} label={f.status === "running" ? "Running" : f.status === "failed" ? "Failed" : "Completed"} word={exit === undefined} />
        {exit !== undefined ? <span class="mono">exit {exit}</span> : null}
      </span>
      <span class="ss-fact mono"><span class="ss-sr">Duration </span>{f.status === "running" ? `${f.duration} so far` : f.duration}</span>
      <span class="ss-fact ss-cwd mono"><span class="ss-sr">Directory </span><bdi>{f.cwd}</bdi></span>
    </div>
    {f.reclaimed ? <div class="ss-gone caption muted" role="note">
      <Icon role="conversation.outputLimit" size="small" />
      <span>Output is no longer kept: storage cleanup removed it. The command, exit code and duration remain.</span>
    </div> : <>
      <div class="ss-output"><div class="ss-output-bar">
        <span class="caption muted ss-output-facts">{f.status === "running" ? `Output · ${lines} lines so far` : `Output · ${lines} lines`}{stderr ? ` · ${stderr} stderr` : ""}</span>
        <span class="ss-actions">
          <IconAction label="Wrap lines" pressed={wrap} onClick={() => setWrap(!wrap)}><MockIcon name="wrap" /></IconAction>
          <CopyAction label="Copy output" text={fullText(f)} announce={announce} shown={copiedShown} tipShown={!phone} />
          <IconAction label="Open execution details" onClick={() => {}}><MockIcon name="panel" /></IconAction>
        </span>
      </div>
      <OutputBody f={f} wrap={wrap} /></div>
      {f.cutOff ? <div class="ss-note caption muted" role="note"><Icon role="conversation.outputLimit" size="small" /><span>Output is cut off here. This view reads only the first part.</span></div> : null}
    </>}
    <span class="ss-sr" role="status" aria-live="polite" aria-atomic="true">{message}</span>
  </div>;
}

function After({ phone }: { phone?: boolean }) {
  return <Conversation>
    {AFTER_STATES.map(f => <div key={f.key} class="ss-state">
      <p class="ss-state-label">{f.caption}</p>
      <WorkGroup label="1 tool" status={f.status}>
        <Member f={f}><AfterDetail f={f} phone={phone} copiedShown={f.key === "ok"} /></Member>
      </WorkGroup>
    </div>)}
  </Conversation>;
}

// ---------- Page ----------

function Themes({ light }: { light?: boolean }) {
  return <ThemeRow light={light}>
    <Frame caption="Before · desktop (today: StepView + Output)"><Before /></Frame>
    <Frame caption="After · desktop"><After /></Frame>
    <Frame caption="Before · phone, 390 px" phone><Before phone /></Frame>
    <Frame caption="After · phone, 390 px" phone><After phone /></Frame>
  </ThemeRow>;
}

mountMock(<main class="mock-page">
  <header class="mock-intro">
    <p class="mock-kicker">Studio design mock · #140</p>
    <h1>Expanded shell step</h1>
    <p>The detail under an open shell row becomes one command block: the full command with Copy, a facts line (status and exit code, duration, directory), then the output with its own icon actions. Calm, dense, and readable without colour.</p>
    <ul class="mock-notes">
      <li>Actions are icon-only ghost buttons with an accessible name and a tooltip on hover and keyboard focus; 32 px on desktop, 44 px at phone width. Nothing is hover-only.</li>
      <li>Copy swaps to a check and the tooltip to "Copied" for 1.5 s after the clipboard write resolves, and a polite live region announces it. The Succeeded state shows that moment.</li>
      <li>stderr runs carry a "stderr" gutter tag and a rule, not only colour. This needs Core's shell.read to return each segment's stream; today it returns one merged text, so the build shows one stream until then.</li>
      <li>Output keeps the bounded, windowed log (#125) and wraps by default at phone width (#128). "Open execution details" opens the existing right-panel detail.</li>
    </ul>
  </header>
  <Themes />
  <Themes light />
</main>);
