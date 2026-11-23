import { signal } from "@preact/signals-core";
import { mount } from "../..";
import { DESIGNS } from "../../../registry";
import { fixtureModel, settle } from "../../../../ui-core/test/fixture";
import type { Prefs } from "../../../../ui-core/src";

const f = await fixtureModel({ route: "conversation", threadId: "lead", lang: "ja", capabilities: ["thread.settings", "history.window", "attachment.list.page"], configure(db) {
  Object.assign(db.details.lead!, { title: "履歴の検索を確認", cwd: "/fixture/shellboy-studio", agents_path: "/fixture/AGENTS.md", connection: "proxy", model: "gpt-6.2-sol", effort: "high", max_tokens: 8192,
    effective_max_tokens: 8192, auto_compact_at: null, effective_auto_compact_at: 150000, auto_compact_target_percent: null, effective_auto_compact_target_percent: 20,
    summary_max_chars: 16000, effective_summary_max_chars: 16000, spill: false, effective_spill: false,
    last_compaction: { bounded_candidate: { kind: "summary", record_kind: "retained_replacement", at: "2026-11-22T18:00:00Z" }, coverage: { latest_complete: true } } });
} });
const theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "console";
document.documentElement.dataset.ds = theme;
const prefs = signal<Prefs>({ design: "console", theme, lang: "ja", weights: { cached: 0.1, output: 5 } });
mount(document.getElementById("app")!, { model: f.model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
await settle(f.t, f.db);
f.t.onCall = call => queueMicrotask(() => {
  const answer = f.db.answer(call);
  if (answer.ok) f.t.ok(call.id, answer.result);
  else f.t.ownerError(call.id, answer.code, answer.message, answer.details);
});
