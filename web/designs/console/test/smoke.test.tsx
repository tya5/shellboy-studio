import { pendingReply } from "../../../data/test/harness";
import type { Signal } from "@preact/signals-core";
// @vitest-environment happy-dom
// One smoke test per view on the shared fixture, through the real components.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { options, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowOwner } from "../../../ui-core/test/window-owner";
import { fixtureModel, fixturePendingAdapter } from "../../../ui-core/test/fixture";
import type { ServerFrame } from "../../../data/src";
import { settle } from "../../../data/test/harness";
import { type AnalyticsSection, type AppModel, type DesignContext, type Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
import { Conversation } from "../screens/Conversation";
import { characterAssets } from "../system/character-assets";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function draw(model: AppModel, prefs: Partial<Prefs> = {}) {
  const value = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 }, ...prefs });
  const context: DesignContext = {
    model,
    designs: DESIGNS,
    prefs: value,
    setPrefs(change) {
      value.value = { ...value.value, ...change };
      model.lang.value = value.value.lang;
    },
    submitToken: async () => true,
  };
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(<App context={context} />, host!));
  return host;
}

const flushPromises = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const text = (el: Element) => el.textContent ?? "";

describe("Desktop navigation", () => {
  it("renders only the normal shell footer or the standalone Settings footer", async () => {
    const { model, t, data } = await fixtureModel({ route: "monitor" });
    try {
      t.push({ t: "hello", bridge_version: "0.0.1", desktop: true, data_dir: "/temp/owner-a",
        owner: { state: "connected", info: { protocol_version: 10, instance_id: "i1", capabilities: ["history.window"] } } });
      const el = draw(model);
      const footers = () => el.querySelectorAll("footer.status");
      expect(footers()).toHaveLength(1);
      expect(footers()[0]?.querySelector("button")?.textContent).toBe(model.t.value("launcher.exit"));
      act(() => model.applyRoute({ view: "settings", section: "general" }));
      expect(footers()).toHaveLength(1);
      expect(footers()[0]?.textContent).toContain("/temp/owner-a");
      expect(footers()[0]?.querySelector("button")).toBeNull();
    } finally { model.dispose(); data.stop(); }
  });

  it("toggles the rail and keeps named, titled destinations", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    const toggle = () => el.querySelector<HTMLButtonElement>(".shell-footer-left .shell-toggle")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().querySelector(".shell-toggle-strip")?.classList.contains("filled")).toBe(true);
    expect(el.querySelector(".side-header .brand-logo")).not.toBeNull();
    expect(el.querySelector(".nav-toggle")).toBeNull();
    expect(el.querySelector(".menu")).not.toBeNull();
    const navGlyphs = [...el.querySelectorAll(".side nav .nav-item .i")].map(icon => icon.innerHTML);
    act(() => toggle().click());
    expect(el.querySelector(".shell")?.classList.contains("nav-collapsed")).toBe(true);
    expect(toggle().getAttribute("aria-label")).toBe("Expand navigation");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().querySelector(".shell-toggle-strip")?.classList.contains("filled")).toBe(false);
    expect([...el.querySelectorAll(".side nav .nav-item .i")].map(icon => icon.innerHTML)).toEqual(navGlyphs);
    for (const link of el.querySelectorAll(".side nav a")) {
      expect(link.getAttribute("aria-label")).toBeTruthy();
      expect(link.getAttribute("title")).toBe(link.getAttribute("aria-label"));
    }
    act(() => toggle().click());
    expect(el.querySelector(".shell")?.classList.contains("nav-collapsed")).toBe(false);
    model.dispose();
  });

  it("anchors the right footer toggle to the rail tab column and keeps counts on rail icons", async () => {
    const { model } = await fixtureModel({ route: "conversation" });
    const el = draw(model);
    Object.defineProperty(el.querySelector(".app"), "clientWidth", { configurable: true, value: 1300 });
    const panel = el.querySelector<HTMLElement>(".details")!;
    const toggle = () => panel.querySelector<HTMLButtonElement>(".shell-footer-right .shell-toggle")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelector(".panel-tabs-rail")).toBeNull();
    const openCounts = [...panel.querySelectorAll(".panel-tab-count")].map(node => text(node));
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(panel.hasAttribute("data-panel-rail")).toBe(true);
    expect(panel.querySelectorAll(".panel-tabs-rail").length).toBe(1);
    expect([...panel.querySelectorAll(".panel-tab-count")].map(node => text(node))).toEqual(openCounts);
    expect(toggle().querySelector(".shell-toggle-strip.filled")).toBeNull();
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    model.dispose();
  });
});

describe("Thread model picker", () => {
  it("opens from the composer model and effort chip and explains when changes apply", async () => {
    const { model, t, db } = await fixtureModel();
    const el = draw(model);
    const button = [...el.querySelectorAll<HTMLButtonElement>(".composer-row button")].find((b) => text(b).includes("example-model ·"))!;
    act(() => button.click());
    await act(async () => { await settle(t, db); });
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain("next request");
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Search models or enter an ID"]')).not.toBeNull();
    const other = [...el.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => text(item) === "Other")!;
    act(() => other.click());
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Other"]')).not.toBeNull();
    model.dispose();
  });
});

describe("App request and guide", () => {
  it("requires review before sending the full request and shows guidance", async () => {
    const { model, t } = await fixtureModel({ route: "apps" });
    const el = draw(model);
    expect(text(el)).toContain("AGENTS.md");
    act(() => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b) === "New app")!.click());
    const section = [...el.querySelectorAll("section")].find((node) => text(node).includes("Create an app"))!;
    act(() => [...section.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b) === "Enter another folder")!.click());
    const request = section.querySelector("textarea")!;
    const cwd = section.querySelectorAll("input")[1]!;
    act(() => {
      request.value = "Make a board";
      request.dispatchEvent(new Event("input", { bubbles: true }));
      cwd.value = "/work";
      cwd.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const review = [...section.querySelectorAll("button")].find((b) => text(b) === "Review request")!;
    expect(t.calls("thread.create")).toHaveLength(0);
    act(() => review.click());
    const preview = section.querySelector<HTMLTextAreaElement>("textarea[readonly]")!;
    expect(preview.value).toContain("$SHELLBOY_DATA_DIR/studio/agent-guide.md");
    expect(preview.value).toContain("Make a board");
    expect(t.calls("thread.create")).toHaveLength(0);
    model.dispose();
  });
});

describe("Conversation work regions", () => {
  it("shows nonempty regions in the sidebar and one compact strip; removes them on a hint", async () => {
    const { model, t, db } = await fixtureModel();
    db.work.lead = [
      { kind: "shell", id: "exec-1", execution_id: "exec-1", thread_id: "lead", run_id: "run-1", state: "running" },
      { kind: "message", id: "m", message_id: "m", thread_id: "lead", state: "held" },
    ];
    db.bodies.m = "Please review";
    db.shells.lead = [{ execution_id: "exec-1", state: "running", command_excerpt: "test command" }];
    const el = draw(model);
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    const sidebar = el.querySelector(".details")!;
    const headings = [...sidebar.querySelectorAll("#panel-page-work h3 > span:first-child")].map(text);
    expect(headings).toEqual(["Running", "Waiting for history"]);
    expect(text(sidebar)).toContain("test command");
    expect(text(sidebar)).toContain("Please review");
    expect(el.querySelector(".work-strip")?.textContent).toContain("Conversation work");
    expect(el.querySelector(".work-strip")?.textContent).not.toContain("Running at least");
    db.work.lead = [];
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    expect(el.querySelector(".work-strip")).toBeNull();
    expect(el.querySelectorAll("#panel-page-work [data-panel-row-id]")).toHaveLength(0);
    model.dispose();
  });
});

describe("Conversation live text", () => {
  const liveFrame = (text: string, offset = 0, extra: { gap?: boolean } = {}): ServerFrame =>
    ({ t: "live", thread_id: "lead", attempt_id: "a1", gap: false, deltas: [{ offset, reasoning: false, text }], ...extra });

  it("retains unsaved text while displaying independent ordinary saved prose", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["live.text", "history.window"] });
    const el = draw(model);
    const bodies = () => [...el.querySelectorAll(".msg")].map((m) => m.textContent ?? "");
    expect(bodies().some((b) => b.includes("Writing"))).toBe(false);
    act(() => {
      t.push(liveFrame("Streaming "));
      t.push(liveFrame("words", 10));
    });
    await act(async () => flushPromises());
    const live = bodies().find((b) => b.includes("Writing"));
    expect(live).toContain("Streaming words");
    expect(el.textContent).not.toContain("missed");
    act(() => t.push(liveFrame("later", 500, { gap: true })));
    await act(async () => flushPromises());
    expect(el.textContent).toContain("Part of this text was missed");
    expect(el.textContent).toContain("later");
    // A bare live_end has no exact terminal receipt: keep the live text and independent saved prose.
    db.history["lead"] = [...(db.history["lead"] ?? []), { node_id: "saved-1", kind: "assistant_response", excerpt: "Final saved answer", items: [{item_identity:"text",kind:"text",text:"Final saved answer",text_complete:true}], provenance: { created_at: "2099-01-01T00:00:00+09:00", sender: { kind: "shellboy" } } }];
    act(() => {
      t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
      t.push({ t: "live_end", thread_id: "lead" });
    });
    await act(async () => {
      await settle(t, db);
    });
    const retainedPreview = el.querySelector('[data-live-overlay]')!;
    expect(retainedPreview).not.toBeNull();
    expect(retainedPreview.textContent).toContain("later");
    expect(retainedPreview.querySelector('small.mono')?.textContent).toBe(model.t.value("convo.live"));
    expect(el.querySelector('[data-node="saved-1"]')?.textContent).toContain("Final saved answer");
    expect(retainedPreview.contains(el.querySelector('[data-node="saved-1"]'))).toBe(false);
    expect(el.textContent).toContain("Final saved answer");
    await act(async()=>{const group=el.querySelector<HTMLDetailsElement>("[data-work-group]");if(group){group.open=true;group.dispatchEvent(new Event("toggle"));}await flushPromises();});
    expect(el.textContent).not.toContain("Checking response kind");
    expect(el.querySelector("[data-internal-records]")).not.toBeNull();
    expect(el.textContent).toContain("later");
  });

  it("keeps an unanchored live reply and a new saved human independently visible", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["live.text", "history.window"] });
    const el = draw(model);
    act(() => t.push(liveFrame("Live answer")));
    await act(async () => flushPromises());
    db.history.lead = [...(db.history.lead ?? []), { node_id: "user-new", kind: "user", excerpt: "New human message", provenance: { sender: { kind: "human" } } }];
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    expect(text(el)).toContain("Live answer");
    expect(el.querySelector('[data-node="user-new"]')).not.toBeNull();
    model.dispose();
  });

  it("preserves canonical saved order without inventing an unanchored live insertion ordinal", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["live.text", "history.window"] });
    const el = draw(model);
    act(() => t.push(liveFrame("Answer before save")));
    await act(async () => flushPromises());
    db.history.lead = [...(db.history.lead ?? []), { node_id: "saved-order", kind: "assistant_response", excerpt: "Saved answer", items: [{item_identity:"text",kind:"text",text:"Saved answer",text_complete:true}], provenance: { sender: { kind: "shellboy" } } }];
    act(() => t.push({ t: "live_end", thread_id: "lead" }));
    await act(async () => settle(t, db));
    db.history.lead = [...db.history.lead, { node_id: "user-order", kind: "user", excerpt: "Later human", provenance: { sender: { kind: "human" } } }];
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    expect(text(el)).toContain("Saved answer");
    expect(text(el)).toContain("Answer before save");
    expect(text(el)).toContain("Later human");
    expect(text(el).indexOf("Saved answer")).toBeLessThan(text(el).indexOf("Later human"));
    model.dispose();
  });

  it.each(['running', 'completed'] as const)('renders one authoritative conversation status in the accepted window (%s)', async status => {
    const owner = new WindowOwner(7);
    const { model } = await fixtureModel({ capabilities: ['history.window'], configure: db => {
      const base = db.answer.bind(db);
      db.threads.lead = { ...db.threads.lead!, state: status };
      db.answer = call => call.command === 'history.window' ? owner.answer(call) : base(call);
    } });
    const el = draw(model);
    await act(async () => flushPromises());
    const statuses = [...el.querySelectorAll('.conversation-status')];
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.getAttribute('role')).toBe('status');
    model.dispose();
  });

  it("keeps the saved human row before the unmatched live suffix in the windowed reader", async () => {
    const owner = new WindowOwner(8);
    owner.decorate = (i, item) => i === 8 ? { ...item, kind: "user", excerpt: "Forbidden aggregate human", items:[{kind:"text",item_identity:"body",text:"Window human",text_complete:true}] } : item;
    const { model, t, db } = await fixtureModel({ capabilities: ["live.text", "history.window"], configure(db) {
      const base = db.answer.bind(db);
      db.answer = (c) => c.command === "history.window" ? owner.answer(c) : base(c);
    } });
    const el = draw(model);
    await act(async () => settle(t, db));
    act(() => t.push(liveFrame("Window live answer")));
    await act(async () => flushPromises());
    owner.append(1);
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    expect(text(el)).toContain("Window live answer");
    expect(text(el)).toContain("Window human");
    expect(text(el).indexOf("Window human")).toBeLessThan(text(el).indexOf("Window live answer"));
    model.dispose();
  });

  it("shows at the end of the windowed reader too, and keeps following as it grows", async () => {
    const owner = new WindowOwner(0);
    const callbacks: ResizeObserverCallback[] = [];
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { callbacks.push(callback); } observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    const { model, t } = await fixtureModel({ capabilities: ["live.text", "history.window"], route: "conversation", threadId: "lead", configure: db => {
      // An empty but supported positional snapshot isolates scroll-follow from synthetic saved-row sizing.
      db.history.lead = [];
      const base = db.answer.bind(db);
      db.answer = call => call.command === "history.window" ? owner.answer(call) : base(call);
    } });
    const el = draw(model);
    expect(model.longReader.value).toBeTruthy();
    const box = el.querySelector<HTMLElement>(".scroll")!;
    let height = 100;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => height });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 0 });
    box.scrollTop = height;
    for (let i = 0; i < 3; i++) {
      height += 50;
      await act(async () => {
        t.push(liveFrame("word ", i * 5));
        callbacks[0]!([], {} as ResizeObserver);
        const pending = [...frames.values()]; frames.clear();
        for (const callback of pending) callback(0);
        await flushPromises();
      });
      expect(box.scrollTop, "following").toBe(height);
    }
    expect(box.textContent).toContain("word word word");
    expect(box.textContent).toContain("Writing");
    expect(el.querySelector(".convo > .conversation-status")?.textContent).toContain("Running");
    expect(box.querySelector(".conversation-status")).toBeNull();
    expect(el.querySelectorAll(".conversation-status")).toHaveLength(1);
  });

  it("a Thread with no held text shows no message, and an unsupported owner is explicitly unavailable and does not render partial history", async () => {
    const plain = await fixtureModel({ capabilities: ["live.text", "history.window"] });
    const el = draw(plain.model);
    act(() => plain.t.push({ t: "live_end", thread_id: "lead" }));
    expect(el.textContent).not.toContain("Writing");
    render(null, host!);
    host?.remove();
    const off = await fixtureModel({ capabilities: ["live.text"] });
    const el2 = draw(off.model);
    act(() => off.t.push(liveFrame("hidden words")));
    await act(async () => flushPromises());
    expect(el2.textContent).toContain("Conversation history is unavailable");
    expect(el2.textContent).not.toContain("hidden words");
    expect(el2.textContent).not.toContain("Writing");
  });

  it("text arriving does not re-render the Conversation, only the live message", async () => {
    const { model, t } = await fixtureModel({ capabilities: ["live.text", "history.window"] });
    const el = draw(model);
    let conversation = 0;
    const previous = options.diffed;
    options.diffed = (vnode) => {
      if (vnode.type === Conversation) conversation++;
      previous?.(vnode);
    };
    try {
      for (let i = 0; i < 20; i++) {
        act(() => t.push(liveFrame("word ", i * 5)));
        await act(async () => flushPromises());
      }
    } finally {
      options.diffed = previous;
    }
    expect(el.textContent).toContain("word word word");
    expect(conversation).toBe(0);
  });
});

describe("Conversation", () => {
  it("shows the Thread, its steps and measured context, and hides bookkeeping", async () => {
    const { model } = await fixtureModel({configure(db){
      // This control asserts the public history execution metadata, not a shell-map join.
      db.history.lead=(db.history.lead as import('../../../data/src/protocol').HistoryItem[]).map(node=>({...node,executions:node.executions?.map(execution=>execution.execution_id==='exec-1'?{...execution,exit_code:0}:execution)}));
    }});
    const el = draw(model);
    expect(text(el)).toContain("Improve history search");
    expect(text(el)).toContain("1 tool");
    expect(text(el)).not.toContain("cargo test history::search");
    await act(async () => {
      const row=model.conversation.value.find(row=>row.type==='steps')!;
      model.openToolGroups.value=new Set([row.id]);
      if(row.type==='steps')model.toolStepChoices.value=new Map(row.steps.map(step=>[step.executionId,true]));
      const group=el.querySelector<HTMLDetailsElement>('[data-work-group]');if(group){group.open=true;group.dispatchEvent(new Event('toggle'));}
      await flushPromises();
    });
    expect(el.querySelector("[data-work-group] .work-element-row")).toBeTruthy();
    expect(text(el)).toContain("cargo test history::search");
    expect(text(el)).toContain("exited");
    const exitedExecution=[...el.querySelectorAll('[data-execution-id]')].find(row=>row.textContent?.includes('cargo test history::search'));
    expect(exitedExecution?.querySelector('.work-element-row')?.getAttribute('data-exit-code')).toBe('0');
    Object.defineProperty(el.querySelector('.app'), 'clientWidth', { configurable: true, value: 1280 });
    await act(async () => {
      const row = model.conversation.value.find(row => row.type === "steps");
      if (row?.type === "steps") model.openInPanel({ kind: "step", id: row.steps[0]!.executionId });
    });
    expect(el.querySelector("[data-panel-detail]")?.textContent).toContain("2.4s");
    expect(el.querySelector(".top [data-context-state]")).toBeNull();
    const ring = el.querySelector<HTMLButtonElement>('.composer-row button[aria-label="Context: Below threshold"]')!;
    expect(ring).not.toBeNull();
    act(() => ring.click());
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Analytics");
    expect(el.querySelector('#panel-page-info:not([hidden])')).not.toBeNull();
    expect(text(el)).not.toContain("Shellboy event v1");
    expect(el.querySelector('.st[data-status="running"]')).toBeTruthy();
  });
  it("offers Stop only with an open Run, and the composer needs a connection", async () => {
    const { model, t } = await fixtureModel();
    const el = draw(model);
    expect(el.querySelector(".btn-stop")).toBeTruthy();
    act(() => t.drop());
    const send = el.querySelector<HTMLButtonElement>(".composer-root .btn-primary")!;
    expect(send.disabled).toBe(true);
  });
  it("shows recovery with the owner's words and a Retry", async () => {
    const { model, t, db } = await fixtureModel();
    const el = draw(model);
    await act(async () => {
      model.openThread("broken");
      await (await import("../../../data/test/harness")).settle(t, db);
    });
    expect(text(el)).toContain("provider: connection interrupted");
    expect(el.querySelector(".dock .btn-warn")).toBeTruthy();
  });
  it("loads Thread totals only in a visible Analytics observation, including reopening", async () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly notify: ResizeObserverCallback) {}
      observe(target: Element) { observers.set(target, this.notify); }
      unobserve(target: Element) { observers.delete(target); }
      disconnect() { for (const [target, notify] of observers) if (notify === this.notify) observers.delete(target); }
    });
    const { model, t, db } = await fixtureModel();
    const el = draw(model);
    const panel = el.querySelector<HTMLElement>("[data-panel-root]")!;
    const info = () => el.querySelector("[data-panel-info]")?.textContent ?? "";
    const reveal = (shown: boolean) => act(() => {
      panel.style.display = shown ? "block" : "none";
      observers.get(panel)!([], {} as ResizeObserver);
    });
    expect(t.calls("usage.get")).toHaveLength(0);
    act(() => model.setPanelTab("info"));
    reveal(false);
    expect(t.calls("usage.get")).toHaveLength(0);
    reveal(true);
    await act(async () => { await settle(t, db); });
    expect(t.calls("usage.get").map(call => call.args)).toEqual([{ thread_id: "lead" }]);
    expect(info()).toContain("75%");
    await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await settle(t, db); });
    expect(t.calls("usage.get")).toHaveLength(2);
    reveal(false);
    expect(info()).not.toContain("75%");
    await act(async () => { t.push({ t: "resync" }); await settle(t, db); });
    expect(t.calls("usage.get")).toHaveLength(2);
    reveal(true);
    expect(info()).not.toContain("75%");
    const pending = t.calls("usage.get").at(-1)!;
    act(() => { model.setPanelTab("work"); });
    expect(t.cancels()).toContain(pending.id);
    await act(async () => { await settle(t, db); });
    expect(info()).not.toContain("75%");
    expect(t.calls("usage.get")).toHaveLength(3);
  });
  it("edits and resets only the selected Thread setting, then waits for hint readback before Undo", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["thread.settings"], configure(db) {
      Object.assign(db.details.lead!, { spill: false, effective_spill: false, auto_compact_at: null, effective_auto_compact_at: 200000 });
    } });
    const el = draw(model);
    act(() => model.setPanelTab("settings"));
    const row = (key: string) => el.querySelector<HTMLElement>(`[data-setting-id="thread.${key}"]`)!;
    const button = (key: string, label: string) => [...row(key).querySelectorAll("button")].find(x => x.textContent === label)!;
    expect(row("auto_compact_at").textContent).toContain("200000Default");
    expect(row("cwd").textContent).not.toContain("Default");
    expect(row("spill").textContent).toContain("OffSet for this Thread");
    act(() => button("cwd", "Change").click());
    const input = row("cwd").querySelector("input")!;
    expect(document.activeElement).toBe(input);
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(button("cwd", "Change"));
    expect(t.calls("thread.set")).toHaveLength(0);
    act(() => button("spill", "Reset to default").click());
    const call = t.calls("thread.set").at(-1)!;
    expect(call.args).toEqual({ thread_id: "lead", spill: "" });
    const reads = t.calls("thread.get").length;
    await act(async () => { t.ok(call.id, { ...db.details.lead, spill: null, effective_spill: true }); });
    expect(row("spill").textContent).toContain("OffSet for this Thread");
    expect(button("spill", "Undo")).toBeUndefined();
    expect(t.calls("thread.get")).toHaveLength(reads);
    db.answered.add(call.id);
    db.details.lead = { ...db.details.lead!, spill: null, effective_spill: true };
    await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await settle(t, db); });
    expect(row("spill").textContent).toContain("OnDefault");
    act(() => button("spill", "Undo").click());
    expect(t.calls("thread.set").at(-1)?.args).toEqual({ thread_id: "lead", spill: "off" });
  });
  it("closes an untouched title editor without writing the display title", async () => {
    const { model, t } = await fixtureModel({ capabilities: ["thread.settings"] });
    const el = draw(model);
    act(() => model.setPanelTab("settings"));
    const row = el.querySelector<HTMLElement>('[data-setting-id="thread.title"]')!;
    const action = (name: string) => [...row.querySelectorAll("button")].find(button => button.textContent === name)!;
    act(() => action("Change").click());
    expect(row.querySelector("input")?.value).toBe(model.details.value?.title);
    await act(async () => { action("Save").click(); });
    expect(row.querySelector("input")).toBeNull();
    expect(t.calls("thread.set")).toHaveLength(0);
  });

  it("closes untouched inherited threshold and spill editors without creating overrides", async () => {
    const { model, t } = await fixtureModel({ capabilities: ["thread.settings"], configure(db) {
      db.details.lead = { ...db.details.lead!, auto_compact_at: null, effective_auto_compact_at: 200000,
        spill: null, effective_spill: true };
    } });
    const el = draw(model);
    act(() => model.setPanelTab("settings"));
    for (const [key, prefill] of [["auto_compact_at", "200000"], ["spill", "on"]] as const) {
      const row = el.querySelector<HTMLElement>(`[data-setting-id="thread.${key}"]`)!;
      const action = (name: string) => [...row.querySelectorAll("button")].find(button => button.textContent === name)!;
      act(() => action("Change").click());
      expect(row.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")?.value).toBe(prefill);
      await act(async () => { action("Save").click(); });
      expect(row.querySelector("input, select")).toBeNull();
      expect(row.textContent).toContain("Default");
    }
    expect(t.calls("thread.set")).toHaveLength(0);
  });

  it("clears an unreadable output override without calling it unset or offering a guessed Undo", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["thread.settings"], configure(db) {
      db.details.lead = { ...db.details.lead!, max_tokens: Number.MAX_SAFE_INTEGER + 1 };
    } });
    const el = draw(model);
    act(() => model.setPanelTab("settings"));
    const row = () => el.querySelector<HTMLElement>('[data-setting-id="thread.max_tokens"]')!;
    expect(row().textContent).toContain(model.t.value("common.notReadable"));
    expect(row().textContent).toContain("Set for this Thread");
    expect(row().textContent).not.toContain("Not set");
    act(() => [...row().querySelectorAll("button")].find(b => b.textContent === "Reset to default")!.click());
    const call = t.calls("thread.set").at(-1)!;
    expect(call.args).toEqual({ thread_id: "lead", max_tokens: "" });
    const readback = { ...db.details.lead!, max_tokens: null, effective_max_tokens: 32768 };
    db.answered.add(call.id);
    await act(async () => { t.ok(call.id, readback); });
    expect(row().textContent).toContain("Set for this Thread");
    db.details.lead = readback;
    await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await settle(t, db); });
    expect(row().textContent).toContain("32768Default");
    expect(row().textContent).not.toContain("Undo");
  });
  it("omits the usage and context elements when the owner reports nothing", async () => {
    const { model, t, db } = await fixtureModel();
    const lead = db.details.lead as unknown as Record<string, unknown>;
    delete lead.context_usage;
    const el = draw(model);
    await act(async () => {
      t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
      await (await import("../../../data/test/harness")).settle(t, db);
    });
    expect(el.querySelector("[data-context-state]")).toBeNull();
    expect(text(el)).not.toContain("Usage");
  });
});

describe("Monitor", () => {
  it("switches to tiles, pins a thread and filters pinned tiles without old-owner history reads", async () => {
    const { model, t } = await fixtureModel({ route: "monitor" });
    const el = draw(model);
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b) === name)!;
    act(() => button("Tiles").click());
    expect(el.querySelectorAll(".monitor-tile")).toHaveLength(3);
    expect(el.querySelector(".tile-content")?.textContent).toBe("");
    expect(el.querySelector<HTMLAnchorElement>(".tile-main")!.getAttribute("href")).toContain("conversation");
    act(() => button("Pin").click());
    act(() => [...el.querySelectorAll<HTMLButtonElement>(".monitor-tabs button")].find((b) => text(b).startsWith("Pinned "))!.click());
    expect(el.querySelectorAll(".monitor-tile")).toHaveLength(1);
    expect(text(el)).toContain("Unpin");
    expect(t.calls("history.list")).toHaveLength(0);
    model.dispose();
  });
  it("paginates panes and retains one selection when switching views", async () => {
    const { model } = await fixtureModel({ route: "monitor", configure: (db) => {
      for (let i = 0; i < 4; i++) db.threads[`extra-${i}`] = { ...db.threads.lead!, thread_id: `extra-${i}`, title: `Extra ${i}` };
    } });
    const el = draw(model);
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b) === name)!;
    act(() => button("Tiles").click());
    expect(el.querySelectorAll(".monitor-tile")).toHaveLength(6);
    expect(el.querySelector(".pane-grid")?.getAttribute("data-count")).toBe("6");
    act(() => button("Next page").click());
    expect(el.querySelectorAll(".monitor-tile")).toHaveLength(3);
    act(() => button("Cards").click());
    const input = [...el.querySelectorAll<HTMLInputElement>("input")].find((e) => e.getAttribute("aria-label") === "Search threads" && e.closest(".mon"))!;
    act(() => { input.value = "Extra"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.querySelectorAll(".card")).toHaveLength(4);
    act(() => button("Tiles").click());
    expect(el.querySelectorAll(".monitor-tile")).toHaveLength(4);
    expect([...el.querySelectorAll(".tile-header")].every((e) => text(e).includes("Extra"))).toBe(true);
    model.dispose();
  });
  it("keeps a pinned status change visible, retains filters on view switch, and clears them", async () => {
    const { model, t, db } = await fixtureModel({ route: "monitor" });
    const el = draw(model);
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".monitor-controls button")].find((b) => text(b) === name || text(b).startsWith(name + " "))!;
    const lead = [...el.querySelectorAll(".card")].find((c) => c.querySelector("h2")?.textContent === "Improve history search")!;
    act(() => lead.querySelector<HTMLButtonElement>("button")!.click());
    act(() => button("Filters").click());
    const running = [...el.querySelectorAll<HTMLButtonElement>(".monitor-popover-panel .chip")].find((c) => text(c).includes("Running"))!;
    act(() => running.click());
    const before = [...el.querySelectorAll(".card h2")].map(text);
    db.threads.lead = { ...db.threads.lead!, activity: "completed", state: "completed" };
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: [], list: true }));
    await act(async () => settle(t, db));
    expect([...el.querySelectorAll(".card h2")].map(text)).toEqual(before);
    expect(text(el)).toContain("No longer matches the filter");
    act(() => button("Tiles").click());
    expect(el.querySelector('.monitor-popover-panel .chip[aria-pressed="true"]')).toBeTruthy();
    act(() => [...el.querySelectorAll<HTMLButtonElement>(".monitor-tabs button")].find((b) => text(b).startsWith("Pinned "))!.click());
    expect([...el.querySelectorAll(".tile-header")].map(text).join()).toContain("Improve history search");
    act(() => button("All").click());
    act(() => button("Clear all").click());
    expect(el.querySelector('.monitor-popover-panel .chip[aria-pressed="true"]')).toBeNull();
    expect(text(el)).not.toContain("No longer matches the filter");
    expect(el.querySelector('.tile-header button[aria-pressed="true"]')).toBeTruthy();
    model.dispose();
  });
  it("draws one card per Thread, most urgent first, with chips that filter", async () => {
    const { model } = await fixtureModel({ route: "monitor" });
    const el = draw(model);
    const cards = el.querySelectorAll(".card");
    expect(cards.length).toBe(5);
    expect(cards[0]!.classList.contains("err")).toBe(true);
    expect(text(cards[0]!)).toContain("Retry");
    expect(text(el)).not.toContain("Connection interrupted");
    expect(el.querySelector(".card.lead")).toBeTruthy();
    expect(text(el)).toContain("Parent: Improve history search");
    act(() => [...el.querySelectorAll<HTMLButtonElement>(".monitor-tools button")].find((b) => text(b) === "Filters")!.click());
    const chip = [...el.querySelectorAll<HTMLButtonElement>(".chip")].find((c) => text(c).includes("No action needed"))!;
    act(() => chip.click());
    expect(el.querySelectorAll(".card").length).toBe(1);
  });
});

describe("Awaiting you", () => {
  it("is a designed empty state in production", async () => {
    const { model } = await fixtureModel({ route: "inbox" });
    const el = draw(model);
    expect(el.querySelector(".empty-state-root")).toBeTruthy();
    expect(text(el)).toContain("Nothing is waiting for you");
    expect(el.querySelector(".count")).toBeNull();
    expect(text(el)).toContain("Other activity");
  });
  it("renders synthetic legacy 17+ without fabricating an oldest age", async () => {
    const pending = fixturePendingAdapter([{ id: "legacy", threadId: "lead", threadTitle: "Legacy", question: "Synthetic legacy question", askedAt: undefined, count: 17, countExact: false }]);
    const { model } = await fixtureModel({ route: "inbox", pending });
    const el = draw(model);
    expect(text(el)).toContain("Legacy (17+)");
    expect(text(el)).toContain("Synthetic legacy question");
    expect(el.querySelector(".qitem")?.textContent).not.toMatch(/ago|minute|hour/);
  });
  it("renders questions from the fixture adapter and sends the answer through it", async () => {
    const pending = fixturePendingAdapter();
    const { model } = await fixtureModel({ route: "inbox", pending });
    const el = draw(model);
    expect(el.querySelectorAll(".qitem").length).toBe(2);
    expect(el.querySelector(".nav .count")?.textContent).toBe("2");
    expect(el.querySelector(".q .question-card-text")?.textContent).toBe("Should this go to company A or B?");
    const box = el.querySelector("textarea")!;
    act(() => {
      box.value = "Company A";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => el.querySelector<HTMLButtonElement>(".q .btn-primary")!.click());
    expect(pending.answers).toEqual([["q1", "Company A"]]);
  });
});

describe("Frame", () => {
  it("offers all views as links in both the sidebar and the phone tab bar", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    expect(el.querySelectorAll(".nav .nav-item").length).toBe(8);
    expect(el.querySelectorAll(".tabbar > .nav-item").length).toBe(3);
    expect(text(el.querySelector(".tabbar .more-tab")!)).toBe("More");
  });
  it("switches language without a reload", async () => {
    const { model } = await fixtureModel({ route: "inbox" });
    const el = draw(model);
    act(() => {
      model.lang.value = "ja";
    });
    expect(text(el)).toContain("あなた待ちはありません");
  });
  it("settings lists Console, Light and Terminal and changes the theme preference", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    act(() => el.querySelector<HTMLButtonElement>('.top .right .btn[data-settings-toggle]')!.click());
    const buttons = [...el.querySelectorAll<HTMLButtonElement>(".panel .btn")];
    expect(buttons.map(text)).toEqual(expect.arrayContaining(["Console", "Light", "Terminal", "English", "日本語"]));
    act(() => buttons.find((b) => text(b) === "Light")!.click());
    expect(el.querySelector('.panel .btn[aria-pressed="true"]')?.textContent).toBe("Light");
  });
  it("settings closes on Escape and on a press outside, and stays open for a press inside", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    const toggle = () => el.querySelector<HTMLButtonElement>('.top .right .btn[data-settings-toggle]')!;
    act(() => toggle().click());
    act(() => { el.querySelector(".panel")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(el.querySelector(".panel")).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(el.querySelector(".panel")).toBeNull();
    act(() => toggle().click());
    act(() => { el.querySelector(".top h1, .top .crumb, main, .main")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(el.querySelector(".panel")).toBeNull();
    act(() => toggle().click());
    expect(el.querySelector(".panel")).not.toBeNull();
    act(() => { toggle().dispatchEvent(new Event("pointerdown", { bubbles: true })); toggle().click(); });
    expect(el.querySelector(".panel")).toBeNull();
  });
  it("names the owner being down", async () => {
    const { model, t } = await fixtureModel();
    const el = draw(model);
    act(() => t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } }));
    expect(text(el)).toContain("Shellboy isn't reachable");
  });
  it("shows a token prompt when the bridge keeps refusing the browser", async () => {
    const { model, t } = await fixtureModel();
    const el = draw(model);
    act(() => {
      t.drop();
      t.handlers!.onClose();
    });
    expect(text(el)).toContain("Connect to the bridge");
    expect(el.querySelector('input[type="password"]')).toBeTruthy();
  });
});

describe("Analytics", () => {
  const open = async (section: AnalyticsSection) => {
    const made = await fixtureModel({ route: "analytics", section });
    const el = draw(made.model);
    return { ...made, el };
  };
  it("lists its sections with the shared navigation and shows one pane at a time", async () => {
    const { el } = await open("overview");
    expect([...el.querySelectorAll(".secnav-item")].map(text)).toEqual(["Overview", "Tokens", "Compaction", "By Thread", "Storage", "Memory", "Index"]);
    expect(el.querySelector('.secnav-item[aria-current="page"]')!.getAttribute("href")).toBe("#/analytics/overview");
    expect(el.querySelector(".secnav select")).toBeNull();
    expect(el.querySelectorAll("figure.chart-figure svg").length).toBe(1);
    expect(text(el)).not.toContain("Owner memory");
    expect(text(el)).toContain("aren't prices");
  });
  it("Tokens draws to its data, with sources, and shows no money", async () => {
    const { el } = await open("tokens");
    const body = text(el);
    expect(body).toContain("usage.get group_by=day");
    expect(body).toContain("By model isn't shown");
    expect(body).not.toMatch(/\$\s?\d|USD|¥/);
    // 2026-11-05 to 11-07, three parts each. Small parts stay visible.
    expect(el.querySelectorAll("figure.chart-figure")[0]!.querySelectorAll("path.chart-fill").length).toBe(9);
    expect(el.querySelector(".chart-svg")!.getAttribute("role")).toBe("img");
    expect(el.querySelector(".chart-svg")!.getAttribute("aria-label")).toContain("7 days");
  });
  it("effective tokens follow the weights without a new read", async () => {
    const { el, model, t } = await open("overview");
    const before = t.calls("usage.get").length;
    const first = () => text(el.querySelector(".stat-root .stat-value")!);
    const was = first();
    const n = el.querySelector<HTMLInputElement>('input[aria-label="Cached weight n"]')!;
    await act(async () => {
      n.value = "1";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(first()).not.toBe(was);
    expect(t.calls("usage.get").length).toBe(before);
    expect(model.route.value.section).toBe("overview");
  });
  it("Storage offers no destructive action, and explains why", async () => {
    const { el, t, db } = await open("storage");
    await act(async () => {
      await settle(t, db);
    });
    const body = text(el);
    for (const phrase of ["no preview", "needs the owner stopped", "no bounded read of storage by Thread", "3.7 GiB"]) expect(body, phrase).toContain(phrase);
    const buttons = [...el.querySelectorAll("button")].map((b) => text(b).toLowerCase());
    for (const word of ["collect", "vacuum", "prune", "delete"]) expect(buttons.some((b) => b.includes(word)), word).toBe(false);
  });
  it("Index says recreating costs money", async () => {
    const { el, t, db } = await open("index");
    await act(async () => {
      await settle(t, db);
    });
    expect(text(el)).toContain("Recreating an index costs money");
    expect(text(el)).toContain("mock-embed");
  });
  it("Memory shows cache limits and localized missing values when a value is unavailable", async () => {
    const { el, t, db } = await open("memory");
    await act(async () => {
      await settle(t, db);
    });
    expect(text(el)).toContain("Not reported");
    expect(el.querySelector('[role="meter"]')).toBeTruthy();
    expect(text(el)).toContain("Bridge resident memory");
    expect(text(el)).toContain("40 MiB");
  });
  it("By Thread reads on opening; Show compaction goes to its section", async () => {
    const { el, t, db, model } = await open("threads");
    await act(async () => {
      await settle(t, db);
    });
    expect(text(el)).toContain("Improve history search");
    const show = [...el.querySelectorAll("button")].find((b) => text(b) === "Show compaction")!;
    await act(async () => {
      show.click();
      await settle(t, db);
    });
    expect(model.route.value).toEqual({ view: "analytics", section: "compaction" });
    expect(text(el)).toContain("Compaction effect");
    expect(el.querySelector(".tbl.stack [data-label='Summary tokens']")).toBeTruthy();
    expect(el.querySelector(".range-bar-track")).toBeTruthy();
  });
  it("loading keeps partial values with a Stop; a failure keeps them too", async () => {
    const { model, t, db } = await fixtureModel();
    const plain = db.answer;
    let n = 0;
    db.answer = (c) => (c.command === "usage.get" && n++ === 1 ? { ok: false, code: "cursor_expired" } : plain(c));
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "analytics", section: "tokens" });
      await Promise.resolve();
    });
    expect(text(el)).toContain("Reading saved usage");
    await act(async () => {
      await settle(t, db);
    });
    expect(text(el)).toContain("Reading stopped");
    expect(el.querySelectorAll("figure.chart-figure path.chart-fill").length).toBeGreaterThan(0);
  });
  it("says Not read until something has been read", async () => {
    const { model, t } = await fixtureModel({ route: "monitor" });
    t.drop();
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "analytics" });
    });
    expect(text(el.querySelector(".stat-root .stat-value")!)).toBe("Not read");
  });
  it("speaks Japanese", async () => {
    const { model } = await fixtureModel({ route: "analytics" });
    const el = draw(model, { lang: "ja" });
    act(() => { model.lang.value = "ja"; });
    expect(text(el)).toContain("実効トークン");
    expect(text(el)).toContain("価格ではありません");
  });
});

describe("Branches", () => {
  const open = async () => {
    const made = await fixtureModel({ route: "branches" });
    const el = draw(made.model);
    await act(async () => {
      await settle(made.t, made.db);
    });
    return { ...made, el };
  };
  it("does not issue history-window reads or invent excerpts without the capability", async () => {
    const made = await fixtureModel({ route: "branches", capabilities: [] });
    const el = draw(made.model);
    await act(async () => { await settle(made.t, made.db); });
    expect(made.t.calls("history.window")).toHaveLength(0);
    expect(el.querySelectorAll(".branch-excerpts")).toHaveLength(0);
  });
  it("draws lanes, points and tips from the read, with real counts and a list for phones", async () => {
    const { el } = await open();
    expect(el.querySelectorAll(".bgraph-svg .bg-tip").length).toBe(4);
    expect(el.querySelectorAll(".bgraph-svg .bg-point").length).toBe(2);
    expect(el.querySelector(".branch-graph-edge[aria-current=true]")).toBeTruthy();
    expect(text(el.querySelector(".bgraph-svg")!)).toContain("101 nodes");
    expect(text(el)).toContain("no shared prefix");
    expect(text(el)).not.toContain("thread.branches");
    expect(el.querySelectorAll(".blist .brow").length).toBe(4);
    expect(el.querySelector(".bgraph-svg .bg-tip")!.getAttribute("href")).toBe("#/conversation/lead");
  });
  it("does not show developer-only missing data notes", async () => {
    const { el } = await open();
    expect(text(el)).not.toContain("Comparing two tips");
    expect([...el.querySelectorAll("button")].some((b) => /side by side/i.test(text(b)))).toBe(false);
  });
  it("a rewind shows its preview first, what isn't undone and the undo path, then asks", async () => {
    const { el, model, t, db } = await open();
    await act(async () => {
      model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    });
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".branches-side button")].find((b) => text(b) === name);
    expect(button("Rewind")).toBeUndefined();
    await act(async () => {
      button("Preview rewind")!.click();
      await settle(t, db);
    });
    const panel = text(el.querySelector(".branches-side")!);
    expect(panel).toContain("125 nodes, 25 turns");
    expect(panel).toContain("cargo test");
    expect(panel).toContain("shell effects aren't undone");
    expect(panel).toContain("stays as a new child Thread");
    expect(panel).toContain("Nothing has changed");
    expect(t.calls("thread.rewind")).toHaveLength(1);
    await act(async () => {
      button("Rewind")!.click();
      await settle(t, db);
    });
    expect(t.calls("thread.rewind")).toHaveLength(2);
    expect(el.querySelector(".branches-side a.btn")!.getAttribute("href")).toBe("#/conversation/kept");
  });
  it("Fork from here reports the new Thread with a link", async () => {
    const { el, model, t, db } = await open();
    await act(async () => {
      model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    });
    await act(async () => {
      [...el.querySelectorAll<HTMLButtonElement>(".branches-side button")].find((b) => text(b) === "Fork from here")!.click();
      await settle(t, db);
    });
    expect(text(el.querySelector(".branches-side")!)).toContain("Forked as Forked");
  });
  it("a conversation row carries a mark only where the read reports a point", async () => {
    const { model } = await fixtureModel({ route: "conversation", threadId: "lead", configure: db => {
      // Seed the branch point before the first accepted positional snapshot is read.
      db.history.lead = [{ node_id: "n100", kind: "assistant_response", excerpt: "Here it splits", items: [{ item_identity: "split-text", kind: "text", text: "Here it splits", text_complete: true }], execution_count: 0, provenance: { created_at: "2026-11-07T10:19:00.000000+00:00", sender: { kind: "assistant" } }, selection: { ordinal: 0 } }];
    } });
    const el = draw(model);
    const marks = [...el.querySelectorAll<HTMLAnchorElement>(".bmark")];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]!.getAttribute("href")).toBe("#/branches/lead/n100");
  });
  it("speaks Japanese", async () => {
    const { el, model } = await open();
    act(() => { model.lang.value = "ja"; });
    expect(text(el)).toContain("分岐点と先端");
  });
});

describe("Threads", () => {
  const open = async () => {
    const made = await fixtureModel({ route: "threads" });
    const el = draw(made.model);
    await act(async () => {
      await settle(made.t, made.db);
    });
    return { ...made, el };
  };
  it("offers four display modes; on v0.10.0 moving and tags say why they aren't there, with no fake controls", async () => {
    const { el } = await open();
    expect(el.querySelectorAll(".view .tgroup").length).toBe(1);
    expect(el.querySelector("[draggable]")).toBeNull();
    expect(el.querySelector(".srow-act")).toBeNull();
    expect(text(el)).toContain("Moving a Thread under another isn't available");
    expect(text(el)).toContain("Token totals per directory aren't shown");
    const mode = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".org button")].find((b) => text(b) === name)!;
    expect(["Tree", "Directory", "State", "Tag"].every((m) => mode(m))).toBe(true);
    act(() => mode("Tag").click());
    expect(text(el)).toContain("Tags aren't available");
    expect(el.querySelector(".view .tgroup")).toBeNull();
    act(() => mode("Directory").click());
    expect(el.querySelectorAll(".view .tgroup").length).toBeGreaterThan(0);
    const state = mode("State");
    act(() => state.click());
    expect(text(el.querySelector(".view .tgroup")!)).toContain("Error");
    const recovery = [...el.querySelectorAll<HTMLElement>(".view .tgroup")].find(group => text(group).includes("Error"))!;
    const checkbox = recovery.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    const disclosure = recovery.querySelector<HTMLButtonElement>(".tgroup-toggle")!;
    expect(disclosure.getAttribute("aria-label")).toBe("Hide the Threads under Error");
    const rowCount = recovery.querySelectorAll("[data-thread-row]").length;
    expect(rowCount).toBeGreaterThan(0);
    act(() => checkbox.click());
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(checkbox.checked).toBe(true);
    act(() => disclosure.click());
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(recovery.querySelectorAll("[data-thread-row]")).toHaveLength(0);
    act(() => disclosure.click());
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(recovery.querySelectorAll("[data-thread-row]")).toHaveLength(rowCount);
  });
  it("with tags and directories on the owner: headings from the owner, members on demand, tags on rows and edited from a selection", async () => {
    const made = await fixtureModel({
      route: "threads",
      capabilities: ["thread.tags", "thread.cwds"],
      configure: (db) => {
        (db.threads.lead as { tags?: string[] }).tags = ["bug hunt", "customer A"];
        (db.threads.broken as { tags?: string[] }).tags = ["bug hunt"];
      },
    });
    const el = draw(made.model);
    const go = async (f: () => void) => {
      await act(async () => {
        f();
        await settle(made.t, made.db);
      });
    };
    const mode = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".org button")].find((b) => text(b) === name)!;
    await go(() => mode("Tag").click());
    expect(text(el)).not.toContain("Tags aren't available");
    expect([...el.querySelectorAll(".view .tgroup .tgroup-name")].map(text)).toEqual(["bug hunt", "customer A"]);
    expect(el.querySelector(".org-rows [data-thread-row]")).toBeNull();
    const show = (n: number) => el.querySelectorAll<HTMLButtonElement>(".view .tgroup header .btn")[n]!;
    await go(() => show(0).click());
    expect(made.t.calls("thread.list").at(-1)!.args).toMatchObject({ tags: ["bug hunt"] });
    expect(el.querySelectorAll(".org-rows [data-thread-row]").length).toBe(2);
    expect([...el.querySelectorAll(".select-row-root .select-row-tag")].map(text)).toContain("customer A");
    act(() => el.querySelector<HTMLInputElement>(".select-row-root input")!.click());
    const tagsButton = [...el.querySelectorAll<HTMLButtonElement>(".selbar button")].find((b) => text(b) === "Tags")!;
    act(() => tagsButton.click());
    const field = el.querySelector<HTMLInputElement>("input[aria-label='Tag to add']")!;
    act(() => {
      field.value = "later";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await go(() => [...el.querySelectorAll<HTMLButtonElement>(".btn")].find((b) => text(b) === "Add to list")!.click());
    await go(() => [...el.querySelectorAll<HTMLButtonElement>(".btn")].find((b) => /^Apply to 1/.test(text(b)))!.click());
    expect(made.t.calls("thread.tag")).toHaveLength(1);
    expect(text(el)).not.toContain("Tags changed on 1 Threads");
    await go(() => mode("Directory").click());
    expect([...el.querySelectorAll(".view .tgroup .tgroup-name")].map(text)).toEqual(["/home/me/dev/rag", "/home/me/dev/shellboy"]);
    act(() => { made.model.lang.value = "ja"; });
    expect(text(el)).toContain("表示");
  });
  it("archive needs a second press, states what it touches, and calls the owner", async () => {
    const { el, t, db } = await open();
    const box = el.querySelector<HTMLInputElement>(".select-row-root input")!;
    act(() => box.click());
    expect(text(el.querySelector(".selbar")!)).toContain("Selected: 1");
    const archive = () => [...el.querySelectorAll<HTMLButtonElement>(".selbar button")].find((b) => /archive/i.test(text(b)))!;
    act(() => archive().click());
    expect(t.calls("thread.archive")).toHaveLength(0);
    expect(text(archive())).toBe("Confirm archive");
    await act(async () => {
      archive().click();
      await settle(t, db);
    });
    expect(t.calls("thread.archive")).toHaveLength(1);
    expect(text(el)).toContain("Nothing was deleted");
    expect(el.querySelector(".selbar")).toBeNull();
  });
  it("Archived offers Unarchive with one press", async () => {
    const { el, t, db } = await open();
    await act(async () => {
      [...el.querySelectorAll<HTMLButtonElement>(".org button")].find((b) => text(b) === "Archived")!.click();
      await settle(t, db);
    });
    act(() => el.querySelector<HTMLInputElement>(".select-row-root input")!.click());
    const go = [...el.querySelectorAll<HTMLButtonElement>(".selbar button")].find((b) => text(b) === "Unarchive")!;
    await act(async () => {
      go.click();
      await settle(t, db);
    });
    expect(t.calls("thread.unarchive")).toHaveLength(1);
  });
  it("the status bar says which owner this is, in every view", async () => {
    for (const route of ["conversation", "monitor", "inbox", "apps", "branches", "threads", "analytics", "settings"] as const) {
      const made = await fixtureModel({ route });
      const el = draw(made.model);
      await act(async () => {
        await settle(made.t, made.db);
      });
      expect(el.querySelector(".status .owner-dir")?.textContent, route).toContain("/temp/owner-a");
    }
  });

  it("opens the Conversation picker before Settings and updates its connections on a config mark", async () => {
    let connections: Record<string, object> = { c: {}, other: {} };
    let hash = "first";
    const { model, t, db, data } = await fixtureModel({ route: "conversation", threadId: "lead",
      capabilities: ["history.window", "config.edit", "thread.settings"], configure(db) {
        const answer = db.answer.bind(db);
        db.answer = (call) => {
          if (call.command !== "config.get") return answer(call);
          const side = { present: true, content_hash: hash, valid: true, values: { connections }, redacted_fields: [] };
          return { ok: true, result: { loaded: side, file: side, differs: false, restart: { all_fields_require_restart: false } } };
        };
      },
    });
    try {
      const el = draw(model);
      const trigger = () => el.querySelector<HTMLButtonElement>(".model-picker-anchor > button")!;
      const choices = () => [...new Set(Array.from(el.querySelectorAll(".model-picker-list button"), button => button.textContent!.split(" / ")[0]))];
      expect(t.calls("config.get")).toHaveLength(0);
      await act(async () => { trigger().click(); await settle(t, db); });
      expect(t.calls("config.get")).toHaveLength(1);
      expect(choices()).toEqual(["c", "other"]);
      connections = { c: {}, third: {} };
      hash = "second";
      await act(async () => {
        t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
        await settle(t, db);
      });
      expect(t.calls("config.get")).toHaveLength(2);
      expect(choices()).toEqual(["c", "third"]);
      await act(async () => {
        trigger().click();
        t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
        await settle(t, db);
      });
      expect(t.calls("config.get")).toHaveLength(2);
    } finally { model.dispose(); data.stop(); }
  });

  it("Settings saves a preset effort immediately as one config field", async () => {
    const made = await fixtureModel({ route: "settings", section: "general", capabilities: ["config.edit"] });
    const before = made.db.answer;
    const values = { default_model: "model-a", default_connection: "proxy", connections: { proxy: { default_effort: "" } } };
    const side = { present: true, content_hash: "effort-hash", valid: true, error: null, values, redacted_fields: [] };
    let file = side;
    made.db.answer = (call) => {
      if (call.command === "config.get") return { ok: true, result: { loaded: side, file, differs: file !== side, restart: { all_fields_require_restart: false } } };
      if (call.command === "config.set") {
        file = { ...side, content_hash: "effort-saved", values: { ...values, connections: { proxy: { default_effort: "high" } } } };
        return { ok: true, result: { written: true, content_hash: file.content_hash, restart_required: true, changes: [{ field: "connections.proxy.default_effort", previous: "", value: "high", restart_required: true, applied_to_running_owner: false }] } };
      }
      return before(call);
    };
    const el = draw(made.model);
    act(() => made.t.push({ t: "changed", thread_ids: [], list: false, config_changed: true }));
    await act(async () => { await settle(made.t, made.db); });
    const high = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => text(button) === "high")!;
    act(() => high.click());
    await act(async () => { await settle(made.t, made.db); });
    expect(high.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { void made.model.config.configChanged(); await settle(made.t, made.db); });
    expect(made.t.calls("config.set")).toHaveLength(1);
    expect(made.t.calls("config.set")[0]!.args).toEqual({ expected_hash: "effort-hash", changes: [{ field: "connections.proxy.default_effort", value: "high" }] });
    expect(high.getAttribute("aria-pressed")).toBe("true");
    expect(made.model.config.read.value.value?.file.contentHash).toBe("effort-saved");
    expect(text(el)).toContain("Applies after the owner restarts");
  });

  it("Settings groups sections and filters navigation by names and descriptions", async () => {
    const made = await fixtureModel({ route: "settings", section: "general" });
    const el = draw(made.model);
    await act(async () => { await settle(made.t, made.db); });
    expect(text(el)).toContain("Getting started");
    expect(text(el)).toContain("Agent");
    const search = el.querySelector<HTMLInputElement>('.secnav-search input')!;
    act(() => { search.value = "summaries"; search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(text(el)).toContain("Summary");
    expect(el.querySelectorAll(".secnav-item")).toHaveLength(1);
  });

  it("Settings search targets repeated connection fields by their stable path", async () => {
    const values = { connections: { alpha: { request_timeout_ms: 10 }, "beta.prod": { request_timeout_ms: 20 } } };
    const loaded = { values };
    const file = { values, content_hash: "timeouts", valid: true, present: true };
    const { model, t, db } = await fixtureModel({ route: "settings", section: "connections", capabilities: ["config.edit"], configure(db) {
      const answer = db.answer;
      db.answer = (call) => call.command === "config.get" ? { ok: true, result: { loaded, file } } : answer(call);
    } });
    const el = draw(model);
    await act(async () => { await settle(t, db); });
    const search = el.querySelector<HTMLInputElement>(".secnav-search input")!;
    act(() => { search.value = "request timeout"; search.dispatchEvent(new Event("input", { bubbles: true })); });
    const hits = [...el.querySelectorAll<HTMLAnchorElement>(".secnav-results a")];
    expect(hits.map(text)).toEqual(["Connections / alpha / Request timeout (ms)", "Connections / beta.prod / Request timeout (ms)"]);
    act(() => hits[1]!.click());
    expect(el.querySelector("[data-highlighted]")?.getAttribute("data-setting-id")).toBe('connections."beta.prod".request_timeout_ms');
  });

  it("Settings restores refused text and custom effort even when Core returns the same values", async () => {
    const values = { default_connection: "proxy", connections: { proxy: { base_url: "https://example.invalid", default_effort: "custom-original" } } };
    const file = { values, content_hash: "unchanged", valid: true, present: true };
    const { model, t, db } = await fixtureModel({ route: "settings", section: "connections", capabilities: ["config.edit"], configure(db) {
      const answer = db.answer;
      db.answer = (call) => call.command === "config.get" ? { ok: true, result: { loaded: file, file } } : call.command === "config.set" ? { ok: false, code: "invalid_argument", message: "Refused by Core" } : answer(call);
    } });
    const el = draw(model);
    await act(async () => { await settle(t, db); });
    const commit = async (input: HTMLInputElement, value: string) => {
      act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
      act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      await act(async () => { await settle(t, db); });
    };
    const url = () => el.querySelector<HTMLInputElement>('[data-setting-id="connections.proxy.base_url"] input')!;
    await commit(url(), "https://refused.invalid");
    expect(url().value).toBe(values.connections.proxy.base_url);
    expect(text(el)).toContain("Refused by Core");
    act(() => model.applyRoute({ view: "settings", section: "general" }));
    await act(async () => { await settle(t, db); });
    const effort = () => el.querySelector<HTMLInputElement>('[data-setting-id="default-effort"] input')!;
    await commit(effort(), "custom-refused");
    expect(effort().value).toBe("custom-original");
    expect(text(el)).toContain("Refused by Core");
    expect(t.calls("config.set")).toHaveLength(2);
  });

  it("Settings says editing isn't available on a v0.10.0 owner, and draws no control", async () => {
    const made = await fixtureModel({ route: "settings", section: "storage" });
    const el = draw(made.model);
    await act(async () => {
      await settle(made.t, made.db);
    });
    expect(text(el)).toContain("this Shellboy (v0.10.0) has no operation for it");
    expect(text(el)).toContain("Owner doesn't report this");
    expect(el.querySelector(".subview-main input")).toBeNull();
  });

  it("Settings saves a connection/model choice atomically, rereads, and undoes both fields", async () => {
    const made = await fixtureModel({ route: "settings", section: "general", capabilities: ["config.edit"] });
    const before = made.db.answer;
    const values = { default_connection: "proxy", default_model: "old-model", connections: { proxy: {}, second: {} } };
    let side = { present: true, content_hash: "h1", valid: true, error: null, values, redacted_fields: [] };
    made.db.answer = (c) => {
      if (c.command === "config.get") return { ok: true, result: { loaded: side, file: side, differs: false } };
      if (c.command === "model.list") return { ok: true, result: { api: "responses", connection: (c.args as { connection: string }).connection, models: [(c.args as { connection: string }).connection === "second" ? "new-model" : "old-model"] } };
      if (c.command === "config.set") {
        side = side.content_hash === "h1" ? { ...side, content_hash: "h2", values: { ...values, default_connection: "second", default_model: "new-model" } } : { ...side, content_hash: "h3", values };
        return { ok: true, result: { written: true, content_hash: side.content_hash, restart_required: false, changes: [] } };
      }
      return before(c);
    };
    const el = draw(made.model);
    act(() => made.t.push({ t: "changed", thread_ids: [], list: false, config_changed: true }));
    await act(async () => { await settle(made.t, made.db); });
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".subview-main button")].find((b) => text(b) === name)!;
    act(() => button("proxy / old-model").click());
    await act(async () => { await settle(made.t, made.db); });
    act(() => button("second / new-model").click());
    await act(async () => { await settle(made.t, made.db); });
    expect(made.t.calls("config.set").map((c) => c.args)).toEqual([{ expected_hash: "h1", changes: [{ field: "default_connection", value: "second" }, { field: "default_model", value: "new-model" }] }]);
    await act(async () => { void made.model.config.configChanged(); await settle(made.t, made.db); });
    expect(button("second / new-model")).toBeDefined();
    act(() => button("Undo").click());
    await act(async () => { await settle(made.t, made.db); });
    expect(made.t.calls("config.set").at(-1)!.args).toEqual({ expected_hash: "h2", changes: [{ field: "default_connection", value: "proxy" }, { field: "default_model", value: "old-model" }] });
    await act(async () => { void made.model.config.configChanged(); await settle(made.t, made.db); });
    expect(button("proxy / old-model")).toBeDefined();
  });

  it("with the capability: picker, preview, then Move; a refusal shows the owner's words", async () => {
    const made = await fixtureModel({ route: "threads", capabilities: ["thread.reparent"] });
    const el = draw(made.model);
    await act(async () => {
      await settle(made.t, made.db);
    });
    expect(el.querySelector("[draggable=true]")).toBeTruthy();
    expect(text(el)).not.toContain("isn't available: this Shellboy (v0.10.0)");
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b) === name);
    act(() => el.querySelector<HTMLButtonElement>(".srow-act")!.click());
    expect(text(el)).toContain("New parent for");
    act(() => button("No parent (independent)")!.click());
    expect(made.t.calls("thread.set")).toHaveLength(0);
    expect(text(el)).toContain("independent, with no parent");
    await act(async () => {
      button("Move")!.click();
      await settle(made.t, made.db);
    });
    expect(made.t.calls("thread.set")).toHaveLength(1);
    expect(text(el)).toContain("Moved");
  });
  it("a group's checkbox selects its rows", async () => {
    const { el, model } = await open();
    const group = el.querySelector<HTMLInputElement>(".view .tgroup header input")!;
    act(() => group.click());
    expect(model.org.selected.value.size).toBe(el.querySelector(".view .tgroup")!.querySelectorAll("[data-thread-row]").length);
  });
});

describe("Apps", () => {
  const open = async (appName?: string) => {
    const made = await fixtureModel({ route: "apps" });
    const el = draw(made.model);
    await act(async () => {
      await settle(made.t, made.db);
    });
    if (appName) {
      await act(async () => {
        made.model.applyRoute({ view: "apps", appName });
        await settle(made.t, made.db);
      });
    }
    return { ...made, el };
  };
  const frame = (el: Element) => el.querySelector<HTMLIFrameElement>("iframe")!;
  it("lists apps, with a broken one saying why and no way to open it", async () => {
    const { el } = await open();
    const cards = [...el.querySelectorAll(".card")];
    expect(cards.map((c) => text(c.querySelector("h2")!))).toEqual(["Board", "Half made"]);
    expect(text(cards[1]!)).toContain("app.json can't be read");
    expect(cards[1]!.querySelector("a")).toBeNull();
    expect(cards[0]!.querySelector("a")!.getAttribute("href")).toBe("#/apps/board");
    expect(el.querySelector("details")?.hasAttribute("open")).toBe(false);
  });
  it("says what to do when there are none, and ships nothing of its own", async () => {
    const { model, t, db } = await fixtureModel({ route: "monitor" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "apps.list" ? { ok: true, result: { dir: "/tmp/x/apps", apps: [] } } : plain(c));
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "apps" });
      await settle(t, db);
    });
    expect(text(el)).toContain("No apps yet");
    expect(el.querySelector(".card")).toBeNull();
  });
  it("opens sandboxed in a tab, with no same-origin, and stays mounted while other views show", async () => {
    const { el, model } = await open("board");
    expect(frame(el).getAttribute("src")).toBe("/a/s1/index.html");
    expect(frame(el).getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame(el).getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect([...el.querySelectorAll(".apptab a")].map(text)).toEqual(["Board"]);
    expect(text(el.querySelector(".apptabs-all")!)).toBe("All apps");
    expect(el.querySelector('.apptab button[aria-label="Reload Board"]')).toBeNull();
    expect(el.querySelector('.apps-toolbar button[aria-label="Reload Board"]')).toBeTruthy();
    const before = frame(el);
    await act(async () => {
      model.applyRoute({ view: "monitor" });
    });
    expect(frame(el)).toBe(before);
    expect(el.querySelector(".apps-host.off")).toBeTruthy();
    await act(async () => {
      model.applyRoute({ view: "apps", appName: "board" });
    });
    expect(frame(el)).toBe(before);
    expect(el.querySelector(".apps-host.off")).toBeNull();
  });
  it("opens another name inline and lists previously opened names on the card", async () => {
    const { el, model, t, db } = await open("board");
    const plain = db.answer;
    db.answer = (c) => c.command === "apps.instances" ? { ok: true, result: { items: ["alpha"] } } : c.command === "apps.instance.create" ? { ok: true, result: {} } : plain(c);
    act(() => el.querySelector<HTMLButtonElement>(".apptab-add")!.click());
    const input = el.querySelector<HTMLInputElement>(".apptab-name input")!;
    act(() => { input.value = "bad/name"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.querySelector<HTMLButtonElement>(".apptab-name button")!.disabled).toBe(true);
    act(() => { input.value = "alpha"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { el.querySelector<HTMLFormElement>(".apptab-name")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(t, db); });
    expect(model.route.value).toEqual({ view: "apps", appName: "board", appInstance: "alpha" });
    expect(text(el.querySelector(".apps-toolbar strong")!)).toBe("Board: alpha");
    expect(text(el)).not.toContain("Instance");
    await act(async () => { model.applyRoute({ view: "apps" }); await settle(t, db); });
    expect(el.querySelector('.card .app-names a[href="#/apps/board/alpha"]')).toBeTruthy();
  });
  it("manually reloads the open app with a fresh file session", async () => {
    const { el, model, t, db } = await open("board");
    const before = frame(el);
    const plain = db.answer;
    db.answer = (call) => call.command === "apps.open" ? { ok: true, result: { name: "board", title: "Board", url: "/a/s2/index.html", thread: "lead" } } : plain(call);
    const button = el.querySelector<HTMLButtonElement>('button[aria-label="Reload Board"]')!;
    await act(async () => { button.click(); await settle(t, db); });
    expect(t.calls("apps.open")).toHaveLength(2);
    expect(frame(el)).not.toBe(before);
    expect(frame(el).getAttribute("src")).toBe("/a/s2/index.html");
    expect(model.route.value).toEqual({ view: "apps", appName: "board" });
    expect(t.calls("apps.call")).toHaveLength(0);
  });
  it("closing a tab removes its page and returns to the list", async () => {
    const { el, model } = await open("board");
    await act(async () => {
      el.querySelector<HTMLButtonElement>(".apptab-close")!.click();
    });
    expect(el.querySelector("iframe")).toBeNull();
    expect(model.route.value).toEqual({ view: "apps" });
  });
  it("shows an app's errors as text, with a button that sends them to the bound Thread", async () => {
    const { el, model, t, db } = await open("board");
    await act(async () => {
      model.apps.report("board", { kind: "script", message: "<b>boom</b>", where: "app.js:3" });
    });
    expect(text(el)).toContain("<b>boom</b>");
    expect(el.querySelector(".apps-alerts b")).toBeNull();
    expect(el.querySelector(".apptab .st.bad")).toBeTruthy();
    const originalAnswer=db.answer.bind(db);
    db.answer=call=>call.command==="message.send"?{ok:true,result:{message_id:"app-report",thread_id:(call.args as {thread_id:string}).thread_id}}:originalAnswer(call);
    const send = [...el.querySelectorAll<HTMLButtonElement>(".apps-alerts button")].find((b) => text(b) === "Send to the bound Thread")!;
    await act(async () => {
      send.click();
      await settle(t, db);
    });
    const call = t.calls("message.send").at(-1)!;
    expect((call.args as { thread_id: string; text: string }).thread_id).toBe("lead");
    expect((call.args as { text: string }).text).toContain("boom");
    expect(text(el)).toContain("Sent to the bound Thread");
  });
  it("a deleted bound Thread leaves the app open, and says so", async () => {
    const { model, t, db } = await fixtureModel({ route: "monitor" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.get" && (c.args as { thread_id: string }).thread_id === "lead" ? { ok: false, code: "thread_not_found" } : plain(c));
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "apps", appName: "board" });
      await settle(t, db);
    });
    expect(frame(el)).toBeTruthy();
    expect(text(el)).toContain("no longer exists");
    await act(async () => {
      model.apps.report("board", { kind: "script", message: "x", where: undefined });
    });
    expect([...el.querySelectorAll(".apps-alerts button")].some((b) => text(b) === "Send to the bound Thread")).toBe(false);
  });
});

describe("Phone tabs", () => {
  it("More holds Analytics and Settings, marks itself current, and closes on a choice", async () => {
    const { model } = await fixtureModel({ route: "analytics" });
    const el = draw(model);
    const button = el.querySelector<HTMLButtonElement>(".more-tab button")!;
    expect(button.getAttribute("aria-current")).toBe("page");
    act(() => button.click());
    const links = [...el.querySelectorAll<HTMLAnchorElement>(".more-panel a")];
    expect(links.map(text)).toEqual(["Apps", "Branches", "Threads", "Analytics", "Settings"]);
    act(() => links[4]!.click());
    expect(el.querySelector(".more-panel")).toBeNull();
    act(() => button.click());
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(el.querySelector(".more-panel")).toBeNull();
  });
  it("Awaiting you, Conversation and Monitor have tabs of their own, in that order", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    expect([...el.querySelectorAll(".tabbar > .nav-item")].map(text)).toEqual(["Awaiting you", "Conversation", "Monitor"]);
  });
});

describe("Settings", () => {
  const open = async (section: "connections" | "general" | "index" | "storage" | "compaction" | "studio" | "agent" | "appearance") => {
    const { model, t, db } = await fixtureModel({ route: "settings" });
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "settings", section });
      await settle(t, db);
    });
    return { el, model, t, db };
  };
  it("lists the sections as links, and says it is read-only with no restart promise", async () => {
    const { el } = await open("connections");
    const nav = [...el.querySelectorAll(".secnav-item")].map(text);
    expect(nav).toEqual(["General", "Connections", "Summary", "Indexing", "Agent", "Storage & capacity", "Appearance", "Studio"]);
    expect(el.querySelector('.secnav-item[aria-current="page"]')!.getAttribute("href")).toBe("#/settings/connections");
    expect(text(el)).toContain("Read-only");
    expect(text(el)).not.toContain("Changes take effect after owner restart");
    expect(el.querySelector(".subview-main input")).toBeNull();
  });
  it.each(["responses", "chat_completions", "anthropic_messages"])("edits an optional maximum output token count in %s", async (api) => {
    let maxTokens: number | undefined;
    let hash = "before";
    const { model, t, db } = await fixtureModel({ route: "settings", section: "connections", capabilities: ["config.edit"], configure(db) {
      const answer = db.answer;
      db.answer = (call) => {
        if (call.command === "config.get") {
          const file = { present: true, valid: true, content_hash: hash, values: { connections: { proxy: { api, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }) } } } };
          const loaded = { ...file, values: { connections: { proxy: { api, max_tokens: 32768 } } } };
          return { ok: true, result: { file, loaded } };
        }
        if (call.command === "config.set") {
          const { changes } = call.args as { changes: { value?: number }[] };
          maxTokens = changes[0]!.value;
          hash = maxTokens === undefined ? "cleared" : "saved";
          return { ok: true, result: { written: true, content_hash: hash } };
        }
        return answer(call);
      };
    } });
    const el = draw(model);
    const input = () => el.querySelector<HTMLInputElement>('input[aria-label="Maximum output tokens"]')!;
    const mark = () => t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    const reads = t.calls("config.get").length;
    expect(input().value).toBe("");
    expect(t.calls("config.set")).toHaveLength(0);
    const description = el.querySelector(`[id="${input().getAttribute("aria-describedby")}"]`);
    expect(description?.textContent).toContain("Claude and similar models may be cut short");
    expect(description?.textContent).toContain("Anthropic Messages is recommended for Claude");
    act(() => { input().value = "4096"; input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { await settle(t, db); });
    expect(t.calls("config.set").map((call) => call.args)).toEqual([{ expected_hash: "before", changes: [{ field: "connections.proxy.max_tokens", value: 4096 }] }]);
    await act(async () => { mark(); await settle(t, db); });
    expect(t.calls("config.get")).toHaveLength(reads + 1);
    act(() => model.applyRoute({ view: "settings", section: "general" }));
    act(() => model.applyRoute({ view: "settings", section: "connections" }));
    await act(async () => { await settle(t, db); });
    expect(input().value).toBe("4096");
    expect(t.calls("config.get")).toHaveLength(reads + 1);
    act(() => { input().value = ""; input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await act(async () => { await settle(t, db); });
    expect(t.calls("config.set").at(-1)!.args).toEqual({ expected_hash: "saved", changes: [{ field: "connections.proxy.max_tokens" }] });
    await act(async () => { mark(); await settle(t, db); });
    expect(input().value).toBe("");
    expect(t.calls("config.get")).toHaveLength(reads + 2);
  });
  it("shows indexing cost and links storage use to Analytics", async () => {
    expect(text((await open("index")).el)).toContain("may incur charges");
    const { el } = await open("storage");
    expect(el.querySelector('a[href="#/analytics/storage"]')).toBeTruthy();
  });
  it("shows the Studio access guidance without developer source labels", async () => {
    const { el } = await open("studio");
    expect(text(el)).toContain("HTTPS reverse proxy or VPN");
    expect(text(el)).toContain("shellboy-studio guide user");
    expect(text(el)).not.toContain("tailscale serve");
    expect(text(el)).toContain("--allow-host");
    expect(text(el)).toContain("Apps folder");
    expect(text(el)).not.toContain("Source:");
  });
  it("points per-thread settings to Conversation and keeps appearance choices", async () => {
    expect(text((await open("compaction")).el)).toContain("conversation screen");
    const { el } = await open("appearance");
    const light = [...el.querySelectorAll(".subview-main button")].find((b) => text(b) === "Light") as HTMLButtonElement;
    act(() => light.click());
    expect(light.getAttribute("aria-pressed")).toBe("true");
    const auto = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => text(button) === "Auto")!;
    act(() => auto.click());
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    expect(light.getAttribute("aria-pressed")).toBe("false");
  });
  it("the popover keeps quick choices and links to all settings", async () => {
    const { model } = await fixtureModel({ route: "monitor" });
    const el = draw(model);
    act(() => el.querySelector<HTMLButtonElement>("[data-settings-toggle]")!.click());
    const link = [...el.querySelectorAll(".panel a")].find((a) => text(a) === "All settings")!;
    expect(link.getAttribute("href")).toBe("#/settings/general");
  });
});

describe("Setup", () => {
  const KEY = "sk-smoke-SECRET-42";
  const owner = (db: { answer: (c: never) => unknown }, reply: (c: { command: string; args?: unknown }) => unknown) => {
    const before = db.answer.bind(db);
    db.answer = ((c: { command: string; args?: unknown }) => reply(c) ?? before(c as never)) as never;
  };
  const config = { config_path: "/temp/cfg/config.toml", loaded: { present: false, content_hash: "c".repeat(64), values: {}, redacted_fields: [] }, file: { present: false, content_hash: "c".repeat(64), valid: true, values: {}, redacted_fields: [] }, restart: { all_fields_require_restart: true } };
  const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
  const button = (el: Element, label: string) => [...el.querySelectorAll("button, a.btn")].find((b) => b.textContent?.trim() === label) as HTMLElement | undefined;

  it("on an owner without the operations, says so and gives the manual steps", async () => {
    const { model } = await fixtureModel({ route: "setup" });
    const el = draw(model);
    expect(text(el)).toContain("Setting up here needs a newer Shellboy");
    expect(text(el)).toContain("shellboy config init");
    expect(el.querySelector(".choice-list-root")).toBeNull();
  });

  it("sets a key through Settings connection setup and clears it from Connections", async () => {
    let configured = false;
    let keySource = "none";
    const { model, t, db } = await fixtureModel({
      route: "settings",
      section: "connections",
      capabilities: ["config.edit", "connection.setup"],
      configure: (d) =>
        owner(d as never, (c) => {
          if (c.command === "config.get") {
            if (!configured) return { ok: true, result: config };
            const loaded = { ...config.loaded, present: true, values: { connections: { openai: { base_url: "https://example.invalid" } } }, credential_source: { openai: keySource } };
            return { ok: true, result: { ...config, loaded, file: { ...config.file, ...loaded } } };
          }
          if (c.command === "connection.test") return { ok: true, result: { http_status: 200, models: ["model-a", "model-b"], api_key_env: { name: "OPENAI_API_KEY", set: false } } };
          if (c.command === "credentials.set") {
            keySource = "stored";
            return { ok: true, result: { connection: "openai", stored: true, replaced: false, key_source: "stored", credentials_path: "/owner-reported/credentials.toml", permissions_tightened: false, changed_by: null } };
          }
          if (c.command === "credentials.clear") {
            keySource = "none";
            return { ok: true, result: { connection: "openai", cleared: true, key_source: "none", credentials_path: "/owner-reported/credentials.toml", changed_by: null } };
          }
          if (c.command === "config.set") {
            configured = true;
            return { ok: true, result: { written: true, restart_required: true, changes: [] } };
          }
          return undefined;
        }),
    });
    const el = draw(model);
    const pump = async (work?: () => void) => {
      await act(async () => {
        work?.();
        await settle(t, db);
      });
    };
    await pump();
    expect(el.querySelector('a[href="#/setup"]')).toBeTruthy();
    await pump(() => model.applyRoute({ view: "setup" }));
    expect(el.querySelectorAll(".choice-list-option")).toHaveLength(6);
    await pump(() => click(el.querySelectorAll(".choice-list-option input")[1]));
    const field = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(text(el)).toContain("An API key is required");
    expect(el.querySelector('a[href="https://platform.openai.com/api-keys"]')).toBeTruthy();
    await pump(() => {
      field.value = KEY;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pump(() => click(button(el, "Test connection")));
    expect(text(el)).toContain("The model list was fetched: 2 models (HTTP 200).");
    expect(el.querySelector('input[type="password"]')).toBeNull();
    expect(el.innerHTML).not.toContain(KEY);
    await pump(() => click([...el.querySelectorAll(".choice-list-root")].at(-1)!.querySelector("input")));
    await pump(() => click(button(el, "Save and use this connection")));
    expect(text(el)).toContain("Saved");
    expect(text(el)).toContain("/owner-reported/credentials.toml");
    expect(text(el)).toContain("plain-text file");
    expect(text(el)).toContain("Restart it");
    expect(el.querySelector('a[href="#/conversation"]')).toBeTruthy();
    expect(el.innerHTML).not.toContain(KEY);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(KEY);
    expect(t.calls("credentials.set")).toHaveLength(1);
    await pump(() => model.applyRoute({ view: "settings", section: "connections" }));
    await pump(() => click(button(el, "Remove stored key")));
    expect(t.calls("credentials.clear")).toHaveLength(0);
    await pump(() => click(button(el, "Confirm removal")));
    expect(t.calls("credentials.clear").map(call => call.args)).toEqual([{ connection: "openai" }]);
    expect(text(el)).toContain("Stored key removed.");
    await act(async () => {
      t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
      await settle(t, db);
    });
    expect(model.config.read.value.value?.loaded.credentialSource?.openai).toBe("none");
  });

  it("warns beside the Local model picker about Ollama's context", async () => {
    const { model, t, db } = await fixtureModel({
      route: "setup",
      capabilities: ["connection.setup"],
      configure: (d) =>
        owner(d as never, (c) => {
          if (c.command === "config.get") return { ok: true, result: config };
          if (c.command === "connection.test") return { ok: true, result: { http_status: 200, models: ["llama"] } };
          return undefined;
        }),
    });
    const el = draw(model, { lang: "en" });
    await act(async () => void (await settle(t, db)));
    await act(async () => {
      click(el.querySelectorAll(".choice-list-option input")[4]);
      await settle(t, db);
    });
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Address"]')!.value).toBe("http://localhost:11434/v1");
    await act(async () => {
      click(button(el, "Test connection"));
      await settle(t, db);
    });
    expect(text(el)).toContain("4k tokens");
    expect(text(el)).toContain("64k");
    expect(el.querySelector('a[href="https://docs.ollama.com/context-length"]')).toBeTruthy();
  });

  describe("several connections and embeddings", () => {
    const file = {
      default_connection: "proxy",
      connections: { proxy: { base_url: "http://localhost:4000/v1", api: "chat_completions" }, claude: { base_url: "https://api.anthropic.com/v1", api: "anthropic_messages" } },
    };
    const withFile = { config_path: "/temp/cfg/config.toml", loaded: { present: true, content_hash: "d".repeat(64), values: file, redacted_fields: [] }, file: { present: true, content_hash: "d".repeat(64), valid: true, values: file, redacted_fields: [] }, restart: { all_fields_require_restart: true } };
    const setupWith = (route: "setup" | "settings") =>
      fixtureModel({
        route,
        capabilities: ["config.edit", "connection.setup"],
        configure: (d) =>
          owner(d as never, (c) => {
            if (c.command === "config.get") return { ok: true, result: withFile };
            if (c.command === "connection.test") return { ok: true, result: { http_status: 200, models: ["embed-a", "chat-b"] } };
            if (c.command === "config.set") return { ok: true, result: { written: true, restart_required: true, changes: [] } };
            return undefined;
          }),
      });
    const pumpOf = (t: never, db: never) => async (work?: () => void) => {
      await act(async () => {
        work?.();
        await settle(t, db);
      });
    };

    it("asks before replacing a connection and offers the default as a choice", async () => {
      const { model, t, db } = await setupWith("setup");
      const el = draw(model);
      const pump = pumpOf(t as never, db as never);
      await pump();
      await pump(() => click(el.querySelectorAll(".choice-list-option input")[4]));
      await pump(() => click(button(el, "Test connection")));
      expect(text(el)).toContain("Make this the default connection and model");
      const name = el.querySelector<HTMLInputElement>('input[aria-label="Connection name"]')!;
      expect(name.value).toBe("local");
      await pump(() => {
        name.value = "proxy";
        name.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(text(el)).toContain("already exists");
      expect([...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Save"))?.hasAttribute("disabled")).toBe(true);
    });

    it("shows the Anthropic case, the plain warning and no embeddings request", async () => {
      const { model, t, db } = await setupWith("setup");
      const el = draw(model);
      const pump = pumpOf(t as never, db as never);
      await pump();
      model.applyRoute({ view: "setup", step: "embedding" });
      await pump();
      expect(text(el)).toContain("starts automatic indexing of new conversation text");
      expect(text(el)).toContain("may cost money");
      expect(text(el)).toContain("only when you ask");
      await pump(() => click([...el.querySelectorAll(".choice-list-option input")][1]));
      expect(text(el)).toContain("Anthropic's API has no embeddings");
      await pump(() => click([...el.querySelectorAll(".choice-list-option input")][0]));
      expect(text(el)).not.toContain("Anthropic's API has no embeddings");
      expect(text(el)).toContain("can't tell which of them make embeddings");
      expect(t.calls().some((c) => /embed|index|rag/.test(c.command))).toBe(false);
    });

    it("Settings links to connection setup and edits embedding settings", async () => {
      const { model, t, db } = await setupWith("settings");
      model.applyRoute({ view: "settings", section: "connections" });
      const el = draw(model);
      await pumpOf(t as never, db as never)();
      expect(text(el)).toContain("Add a connection");
      expect(el.querySelector('a[href="#/setup"]')).toBeTruthy();
      model.applyRoute({ view: "settings", section: "index" });
      await pumpOf(t as never, db as never)();
      expect(text(el)).toContain("Embedding settings");
    });
  });
});


describe("Character status information", () => {
  it("keeps tool description and concurrent count alongside running activity", async () => {
    const { model, t, db } = await fixtureModel({ configure(db) {
      db.history.lead = (db.history.lead ?? []).map(node => node.kind === "assistant_response" && node.excerpt ? {...node,items:[{item_identity:"ordinary-text",kind:"text",text:node.excerpt,text_complete:true}]} : node);
      db.work.lead = ["verify", "inspect"].map((id) => ({ kind: "shell", id, thread_id: "lead", run_id: "run-1", execution_id: id, state: "running", started_at: "2026-11-07T10:19:00Z" }));
      db.shells.lead = [
        { execution_id: "verify", state: "running", description: "Verify query ranking", command_excerpt: "npm run check" },
        { execution_id: "inspect", state: "running", command_excerpt: "git diff --check" },
      ];
    } });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      const status = el.querySelector(".conversation-status")!;
      expect(status.textContent).toContain("Running tools");
      expect(status.textContent).toContain("Verify query ranking");
      expect(status.textContent).toContain("Running at least 2");
      expect(status.textContent).toContain("1m");
      expect(el.querySelector(".dock")?.contains(status)).toBe(false);
      expect(status.querySelector(".character-status")).not.toBeNull();
      const avatars = [...el.querySelectorAll(".character-avatar")];
      expect(avatars.length).toBeGreaterThan(0);
      expect(avatars.every(avatar => avatar.getAttribute("src") === characterAssets.neutral)).toBe(true);
    } finally { model.dispose(); }
  });
});


describe("approved Studio brand", () => {
  it("shows inline accent-following logo at the existing sidebar position", async () => {
    const { model } = await fixtureModel();
    try {
      const el = draw(model);
      const brand = el.querySelector(".side .brand svg.brand-logo")!;
      expect(brand.getAttribute("aria-hidden")).toBe("true");
      expect(brand.querySelector(".logo-tile")?.getAttribute("fill")).toBe("var(--accent)");
      expect(brand.querySelector(".logo-wink")?.getAttribute("stroke")).toBe("var(--accent)");
      expect(brand.querySelectorAll("rect,path,ellipse")).toHaveLength(5);
      expect(brand.parentElement?.textContent).toContain("Shellboy");
    } finally { model.dispose(); }
  });
});

describe("limited Branches comparison UI", () => {
  it("keeps compare selection out of archive selection and shows honest limits in the existing screen", async () => {
    const { model, t, db } = await fixtureModel();
    try {
      model.navigate({ view: "branches", threadId: "lead" }); await settle(t, db);
      const el = draw(model); await act(flushPromises);
      expect(text(el)).toContain("Limited two-tip comparison");
      expect(text(el)).toContain("Not an exact LCA");
      expect(text(el)).toContain("Recorded creation kind");
      const comparison = [...el.querySelectorAll("label")].find(x => x.textContent?.includes("Compare (up to two)"));
      expect(comparison).toBeDefined();
      const input = comparison!.querySelector("input")!;
      act(() => input.click());
      expect(model.branchCompare.state.value.selected).toHaveLength(1);
      expect(model.branches.selection.value.size).toBe(0);
      expect(t.calls("thread.archive")).toHaveLength(0);
      expect(t.calls("thread.fork")).toHaveLength(0);
      expect(t.calls("thread.rewind")).toHaveLength(0);
      model.navigate({ view: "monitor" });
      expect(model.branchCompare.state.value.selected).toEqual([]);
    } finally { model.dispose(); }
  });
});

it("keeps same-message Inbox DOM and draft across updates/reorder, but resets a different message", async () => {
  const pending = fixturePendingAdapter(); const { model } = await fixtureModel({ route: "inbox", pending });
  try {
    const el = draw(model); const box = el.querySelector("textarea")!;
    act(() => { box.value = "synthetic draft"; box.dispatchEvent(new Event("input", { bubbles:true })); });
    const original = pending.items.value;
    act(() => { (pending.items as Signal<typeof pending.items.value>).value = [original[1]!, { ...original[0]!, question:"Updated same message" }]; });
    // Keep the original picked message selected, rather than silently switching with order.
    expect(el.querySelector("textarea")).toBe(box); expect(box.value).toBe("synthetic draft");
    expect(el.querySelector(".q .question-card-text")?.textContent).toBe("Updated same message");
    act(() => { (pending.items as Signal<typeof pending.items.value>).value = [original[1]!]; });
    expect(el.querySelector("textarea")).not.toBe(box); expect(el.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  } finally { model.dispose(); }
});

it("real HumanInbox reread does not transiently unmount or lose the message draft", async () => {
  const { model, t, db } = await fixtureModel({ route:"inbox", realPending:true });
  try {
    db.replies = [pendingReply("stable-human", "lead", {kind:"name",name:"human"}, "Stable question"), pendingReply("claude-only", "lead", {kind:"name",name:"claude"}, "Claude-only question")];
    t.push({ t: "changed", thread_ids: [], list: true, config_changed: false }); await settle(t,db);
    expect(model.pending.items.value, JSON.stringify({error:model.pending.error?.value,calls:t.calls("thread.get").map(x=>x.args)})).not.toEqual([]);
    expect(model.pending.items.value.map(row => row.id)).toEqual(["stable-human"]);
    const el=draw(model); const box=el.querySelector("textarea")!; expect(box).toBeTruthy();
    expect(el.textContent).not.toContain("Claude-only question");
    act(()=>{box.value="kept draft";box.dispatchEvent(new Event("input",{bubbles:true}));});
    act(()=>{t.push({ t: "changed", thread_ids: [], list: true, config_changed: false });});
    expect(el.querySelector("textarea")).toBe(box);expect(box.value).toBe("kept draft");expect(el.querySelector(".qdetail .empty-state-root")).toBeNull();
    expect(el.querySelector("textarea")).toBe(box); await act(async()=>settle(t,db));
    expect(el.querySelector("textarea")).toBe(box);expect(box.value).toBe("kept draft");
  } finally {model.dispose();}
});
