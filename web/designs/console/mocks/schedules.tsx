import { render } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../system/components/Button";
import { Icon } from "../system/components/Icon";
import { ListRow } from "../system/components/ListRow";
import { PanelTabs } from "../system/components/PanelTabs";
import { StatusMark } from "../system/components/StatusMark";
import { WorkSheet } from "../system/components/WorkSheet";
import "../system/tokens/console.css";
import "../system/components.css";
import "../system/layout.css";
import "./schedules.css";

type Job = {
  id: string;
  title: string;
  kind: "schedule" | "service";
  enabled: boolean;
  next: string;
  cadence: string;
  cwd: string;
  command: string;
  latest: string;
  latestTone: "completed" | "failed" | "running";
  lastAt: string;
  output: string;
};

const starting: Job[] = [
  { id: "daily-check", title: "朝のドキュメント確認", kind: "schedule", enabled: true, next: "明日 08:30", cadence: "毎日 08:30 · owner のローカル時刻", cwd: "~/work/docs", command: "./scripts/check-docs", latest: "成功 · exit 0", latestTone: "completed", lastAt: "今日 08:30", output: "18 pages checked · no broken links" },
  { id: "release-watch", title: "リリース監視", kind: "service", enabled: true, next: "owner 起動時", cadence: "サービス · owner 起動時に開始", cwd: "~/work/release-tools", command: "./watch-release", latest: "実行中", latestTone: "running", lastAt: "今日 07:12", output: "Watching release feed · last check 2 min ago" },
  { id: "weekly-summary", title: "週次まとめ", kind: "schedule", enabled: false, next: "一時停止中", cadence: "毎週 月曜 09:00 · owner のローカル時刻", cwd: "~/work/notes", command: "./scripts/weekly-summary", latest: "失敗 · exit 1", latestTone: "failed", lastAt: "昨日 09:00", output: "Could not read notes/index.md" },
];
const panelItems = [{ id: "work", label: "動作", icon: "panel.work" as const }, { id: "reply-needed", label: "要返信", icon: "panel.reply_needed" as const, count: 1 }, { id: "awaiting-reply", label: "返信待ち", icon: "panel.awaiting_reply" as const }, { id: "possessions", label: "添付", icon: "panel.attachment" as const }, { id: "info", label: "情報", icon: "panel.information" as const }];

function JobList({ jobs, selected, onSelect, onToggle }: { jobs: Job[]; selected?: string; onSelect: (id: string) => void; onToggle: (job: Job) => void }) {
  return <>
    <header class="schedule-panel-head"><div><p class="schedule-kicker">Activity · Thread-owned</p><h2>予定</h2></div><Button variant="ghost" icon label="予定の追加は CLI で行います" disabled><Icon role="tab.add" /></Button></header>
    <div class="schedule-list-head"><span>名前</span><span>次の実行</span><span>最後の結果</span><span>状態</span></div>
    <div class="schedule-list" aria-label="Thread の予定一覧">
      {jobs.map(job => <div class="schedule-row" key={job.id}>
        <ListRow id={job.id} title={job.title} subtitle={`${job.kind === "schedule" ? "予定" : "サービス"} · ${job.cadence}`} icon={job.kind === "service" ? "work.command" : "panel.work"} selected={selected === job.id} onSelect={() => onSelect(job.id)} />
        <span class="schedule-next">{job.next}</span><span class="schedule-result">{job.latestTone === "running" ? <StatusMark status="running" shell label={job.latest} /> : job.latestTone === "failed" ? <StatusMark status="failed" shell label={job.latest} word /> : <StatusMark status="completed" feedback label={job.latest} word />}</span><span class={`schedule-enabled${job.enabled ? " is-enabled" : ""}`}>{job.enabled ? "有効" : "停止中"}</span>
        <Button variant="ghost" icon label={`${job.enabled ? "一時停止" : "再開"}: ${job.title}`} onClick={() => onToggle(job)}><span>{job.enabled ? "一時停止" : "再開"}</span></Button>
        <Button variant="ghost" icon label={`詳細: ${job.title}`} onClick={() => onSelect(job.id)}><Icon role="panel.information" /></Button>
      </div>)}
    </div>
    <p class="schedule-footnote">時刻指定は Core の一覧上限 64 件。1 回限りの予定は実行が settle すると一覧から消えます。</p>
  </>;
}

function JobDetail({ job, onBack, onToggle, onRemove }: { job: Job; onBack: () => void; onToggle: () => void; onRemove: () => void }) {
  return <section class="schedule-detail" aria-label={`${job.title} の詳細`}>
    <div class="schedule-detail-head"><Button variant="ghost" onClick={onBack}><Icon role="panel.back" size="small" />予定一覧</Button><h3>{job.title}</h3></div>
    <div class="schedule-detail-body">
      <div class="schedule-detail-state">{job.enabled && job.latestTone === "running" ? <StatusMark status="running" shell label={job.latest} /> : !job.enabled ? <StatusMark status="idle" label="一時停止中" /> : job.latestTone === "failed" ? <StatusMark status="failed" shell label={job.latest} word /> : <StatusMark status="completed" feedback label={job.latest} word />}<span class="schedule-kind">{job.kind === "schedule" ? "時刻指定" : "サービス"}</span></div>
      <dl class="schedule-facts"><div><dt>次の実行</dt><dd>{job.next}</dd></div><div><dt>実行間隔</dt><dd>{job.cadence}</dd></div><div><dt>最後の結果</dt><dd>{job.latest} · {job.lastAt}</dd></div><div><dt>作業場所</dt><dd><code>{job.cwd}</code></dd></div><div><dt>コマンド</dt><dd><code>{job.command}</code></dd></div></dl>
      <section class="schedule-output"><h4>最後の出力</h4><pre class="schedule-output-text">{job.output}</pre></section>
      <p class="schedule-caveat">時刻指定は shell 実行です。Core に「今すぐ実行」操作はありません。サービスは開始・停止、時刻指定は有効・無効です。#399 の提案中 per-Run request ceiling は、現在の Core には未実装で、予定回数や外部 CLI 費用上限とも異なります。</p>
    </div>
    <div class="schedule-actions"><Button variant="outline" onClick={onToggle}>{job.kind === "service" ? (job.enabled ? "サービスを停止" : "サービスを起動") : (job.enabled ? "一時停止" : "再開")}</Button><Button variant="warn" onClick={onRemove}>削除</Button></div>
  </section>;
}

function SchedulePanel() {
  const [jobs, setJobs] = useState(starting);
  const [selected, setSelected] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const active = jobs.find(job => job.id === selected);
  const toggle = (job: Job) => setJobs(rows => rows.map(row => row.id === job.id ? { ...row, enabled: !row.enabled, next: row.kind === "service" ? (!row.enabled ? "owner 起動時" : "停止中") : (!row.enabled ? "明日 08:30" : "一時停止中") } : row));
  const opener = () => document.querySelector<HTMLElement>(`[data-panel-row-id="${selected}"] button`);
  const remove = () => { setJobs(rows => rows.filter(row => row.id !== selected)); setConfirming(false); setSelected(undefined); };
  return <aside class="schedule-panel" aria-label="Activity 予定 mock">
    <PanelTabs label="右パネル" items={panelItems} selected="work" onSelect={() => {}} />
    <div class="schedule-panel-content">
      {active ? <JobDetail job={active} onBack={() => setSelected(undefined)} onToggle={() => toggle(active)} onRemove={() => setConfirming(true)} /> : <JobList jobs={jobs} selected={selected} onSelect={setSelected} onToggle={toggle} />}
    </div>
    <WorkSheet open={confirming} role="alertdialog" focusCloseOnOpen title="予定を削除しますか？" closeLabel="キャンセル" dismissOnOutside={false} describedBy="schedule-remove-copy" getReturnFocusTarget={opener} onClose={() => setConfirming(false)}>
      <p id="schedule-remove-copy">「{active?.title}」を削除し、実行中なら停止します。この操作は取り消せません。</p><Button variant="warn" onClick={remove}>予定を削除</Button>
    </WorkSheet>
  </aside>;
}

function Stage({ phone }: { phone?: boolean }) {
  const [opened, setOpened] = useState(false);
  return <section class={`schedule-stage${phone ? " schedule-stage-phone" : ""}`}>
    <div class="schedule-stage-label"><span>{phone ? "Phone · Activity panel / detail" : "Desktop · Activity panel"}</span><span>{phone ? "390 px" : "1440 px"}</span></div>
    <div class={`schedule-app${phone ? " schedule-app-phone" : ""}`}>
      <header class="schedule-app-top"><strong>shellboy</strong><span>Thread · release-notes</span><Button variant="ghost" icon label="Toggle Activity panel" onClick={() => setOpened(!opened)}><Icon role="panel.work" /></Button></header>
      <div class="schedule-app-body"><main class="schedule-conversation"><p class="schedule-time">Today · 08:12</p><div class="schedule-bubble">Please check whether the release docs are ready.</div><div class="schedule-bubble is-own">I’ll run the scheduled docs check at 08:30.</div><div class="schedule-compose">Message this Thread…</div></main>
        {!phone || opened ? <SchedulePanel /> : <div class="schedule-phone-launch"><Button onClick={() => setOpened(true)}>Open Activity · 予定</Button></div>}
      </div>
    </div>
  </section>;
}

function Mock() {
  return <main class="schedules-mock"><header class="schedules-mock-intro"><p class="schedule-kicker">STUDIO DESIGN STUDY · CORE EXISTING OPERATIONS</p><h1>予定を右パネルに出す</h1><p>Thread-owned time schedules and services · static fixture data · no Core connection or mutations</p></header><div class="schedule-stages"><Stage /><Stage phone /></div><footer class="schedule-mock-notes"><span>Run now: not shown; Core has no such command.</span><span>Removal is confirmed before the existing remove command.</span></footer></main>;
}

render(<Mock />, document.getElementById("schedules-mock")!);
