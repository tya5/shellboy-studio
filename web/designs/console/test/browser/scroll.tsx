// Development-only synthetic owner/bridge. No network transport, credentials or owner data.
import "@preact/signals";
import { render } from "preact";
import { signal } from "@preact/signals-core";
import { fixtureModel } from "../../../../ui-core/test/fixture";
import { WindowOwner } from "../../../../ui-core/test/window-owner";
import { App } from "../../screens/App";
import { DESIGNS } from "../../../registry";
import type { Prefs, DesignContext } from "../../../../ui-core/src";
import "../../system/tokens/console.css";
import "../../system/components.css";
import "../../system/layout.css";

const params = new URLSearchParams(location.search);
const owner = new WindowOwner(Number(params.get("total") ?? 100_000));
owner.decorate = (i, item) => (params.has("dense") || i % 10 === 5) ? { ...item, kind: "assistant_response", excerpt: `Synthetic tool ${i}`,
  execution_count: 1, executions: [{ execution_id: `ex-${i}`, command_excerpt: `echo synthetic-${i}`, state: "exited" }] }
  : { ...item, excerpt: `Synthetic row ${i}. **Measured history**, not an estimate.\n\n${"A bounded fixture for reading position. ".repeat(i % 4 + 1)}` };
const r = await fixtureModel({ capabilities: ["history.window", "live.text"], configure(db) {
  const base = db.answer.bind(db);
  db.answer = (call) => call.command === "history.window" ? owner.answer(call) : base(call);
  db.outputs = new Proxy(db.outputs, { get: (target, key: string) => target[key] ?? "synthetic output\n".repeat(35) });
} });
let held = false;
let liveOffset = 0;
const interval = setInterval(() => {
  for (const call of r.t.calls()) {
    if (r.db.answered.has(call.id) || (held && call.command === "history.window")) continue;
    r.db.answered.add(call.id);
    const result = r.db.answer(call);
    if (result.ok) r.t.ok(call.id, result.result);
    else r.t.ownerError(call.id, result.code, result.message ?? result.code, result.details);
  }
}, 10);
const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
const context: DesignContext = { model: r.model, prefs, designs: DESIGNS, submitToken: async () => true,
  setPrefs: (change) => { prefs.value = { ...prefs.value, ...change }; } };
render(<App context={context} />, document.getElementById("root")!);
const win = r.model.longReader.peek()!;
const box = () => document.querySelector<HTMLElement>(".scroll-frame > .scroll")!;
const snapshot = (ordinal?: number) => {
  const b = box(), top = b.getBoundingClientRect().top;
  const rows = [...b.querySelectorAll<HTMLElement>("[data-o]")];
  const first = ordinal === undefined ? rows.find((row) => row.getBoundingClientRect().height > 0 && row.getBoundingClientRect().bottom > top + 1)
    : rows.find((row) => Number(row.dataset.o) === ordinal);
  return { scrollTop: b.scrollTop, scrollHeight: b.scrollHeight, clientHeight: b.clientHeight,
    ordinal: first ? Number(first.dataset.o) : undefined, offset: first ? first.getBoundingClientRect().top - top : undefined,
    range: win.renderRange(), following: win.following.peek(), total: win.total, windows: win.windowsHeld,
    measurements: win.measurementsHeld, reads: win.readsInFlight, calls: r.t.calls("history.window").length,
    listCalls: r.t.calls("history.list").length, domRows: rows.length, openGroups: r.model.openToolGroups.peek().size, stepChoices: r.model.toolStepChoices.peek().size };
};
const api = {
  snapshot,
  hold: (value: boolean) => { held = value; },
  top: () => { box().scrollTop = 0; },
  middle: () => { box().scrollTop = (box().scrollHeight - box().clientHeight) / 2; },
  bottom: () => { box().scrollTop = box().scrollHeight; },
  jump: () => { const button = document.querySelector<HTMLButtonElement>(".jump-newest button"); if (!button) throw new Error("No return-to-newest button"); button.click(); },
  live: (text: string) => { r.t.push({ t: "live", thread_id: "lead", attempt_id: "synthetic-live", gap: false,
    deltas: [{ offset: liveOffset, reasoning: false, text }] }); liveOffset += text.length; },
  endLive: () => { r.t.push({ t: "live_end", thread_id: "lead" }); liveOffset = 0; },
  append: (count: number) => { owner.append(count); win.changed(); },
  rewrite: (total: number) => { owner.rewrite(total); win.changed(); },
  grow: (ordinal: number, height: number) => { const row = box().querySelector<HTMLElement>(`[data-o="${ordinal}"]`); if (row) row.style.paddingBottom = `${height}px`; },
  dispose: () => { clearInterval(interval); render(null, document.getElementById("root")!); r.model.dispose(); r.data.stop(); },
};
(window as unknown as { scrollFixture: typeof api }).scrollFixture = api;
document.body.dataset.ready = "yes";
