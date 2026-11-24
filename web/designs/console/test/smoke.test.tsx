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
import { fixtureDb, fixtureModel, fixturePendingAdapter, usageItem, usagePage } from "../../../ui-core/test/fixture";
import { ShellboyData, type ServerFrame } from "../../../data/src";
import { connected, FakeTransport, settle, summary } from "../../../data/test/harness";
import { AppModel, noPending, type AnalyticsSection, type DesignContext, type Prefs } from "../../../ui-core/src";
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
  it("renders one status footer, with the desktop Exit, in the shell and on Settings", async () => {
    const { model, t, data } = await fixtureModel({ route: "inbox" });
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
      expect(footers()[0]?.querySelector("button")?.textContent).toBe(model.t.value("launcher.exit"));
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
    const { model, t, db } = await fixtureModel({ capabilities: ["history.window", "thread.settings"] });
    const el = draw(model);
    const button = [...el.querySelectorAll<HTMLButtonElement>(".composer-row button")].find((b) => text(b).includes("example-model"))!;
    button.focus();
    act(() => button.click());
    expect(document.activeElement).toBe(el.querySelector('input[aria-label="Search models or enter an ID"]'));
    await act(async () => { await settle(t, db); });
    expect(el.querySelector('[role="dialog"]')?.textContent).toContain("next request");
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Search models or enter an ID"]')).not.toBeNull();
    const other = [...el.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => text(item) === "Other")!;
    act(() => other.click());
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Other"]')).not.toBeNull();
    model.dispose();
  });
});

it("keeps the context disclosure before the first measurement and after summarizing", async () => {
  const { model, t, db } = await fixtureModel({ configure(db) {
    delete db.details.lead!.context_usage;
    db.details.lead!.summarizing = true;
  } });
  const el = draw(model);
  const ring = () => el.querySelector('.context-ring');
  expect(ring()?.getAttribute('data-context-state')).toBe('summarizing');
  db.details.lead = { ...db.details.lead!, summarizing: false };
  await act(async () => { t.push({ t: 'changed', thread_ids: ['lead'], list: false, config_changed: false }); await settle(t, db); });
  expect(ring()?.getAttribute('data-context-state')).toBe('unknown');
  expect(ring()?.querySelectorAll('circle')).toHaveLength(1);
  const button = ring()!.closest('button')!;
  expect(button.getAttribute('aria-label')).toContain('unknown');
  act(() => button.click());
  expect(model.panelTab.value).toBe('info');
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

describe("Conversation right-panel activity", () => {
  it("shows nonempty activity sections in the right panel and removes them on a hint", async () => {
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
    expect(headings).toEqual(["Running", "Waiting for history", "Schedules", "Services"]);
    expect(text(sidebar)).toContain("test command");
    expect(text(sidebar)).toContain("Please review");
    db.work.lead = [];
    act(() => t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
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

  it("updates the footer and sidebar together from fresh page-two activity and reply facts", async () => {
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "lead", configure(db) {
      const list = [...Array.from({ length: 50 }, (_, i) => summary(`first-${i}`)), { ...db.threads.lead!, activity: "completed" }];
      const base = db.answer.bind(db);
      db.answer = call => call.command === "thread.list"
        ? ((call.args as { thread_ids?: string[]; cursor?: string }).thread_ids
          ? { ok: true, result: { items: (call.args as { thread_ids: string[] }).thread_ids.flatMap(id => db.threads[id] ? [db.threads[id]] : []) } }
          : (call.args as { cursor?: string }).cursor
            ? { ok: true, result: { items: [{ ...db.threads.lead!, activity: db.threads.lead!.activity }] } }
            : { ok: true, result: { items: list.slice(0, 50), next_cursor: "page-two" } })
        : base(call);
      db.threads.lead = list[50]!;
    } });
    try {
      const el = draw(model);
      await act(async () => { const more = model.data.loadMoreThreads(); await settle(t, db); await more; });
      const footer = () => el.querySelector(".conversation-status")?.textContent;
      const mark = () => [...el.querySelectorAll('[data-sidebar-row]')].find(row => row.querySelector('a[href*="lead"]'))?.querySelector('[data-status]')?.getAttribute('data-status');
      expect(footer()).toBe("");
      expect(el.querySelector('.conversation-status [data-status="idle"]')?.getAttribute("aria-label")).toBe("No activity");
      expect(el.querySelector('[data-conversation-header] [data-status="idle"]')?.textContent).toBe("");
      expect(mark()).toBe("idle");
      for (const [activity, count, status] of [["awaiting_model", 0, "running"], ["tools", 0, "running"], ["completed", 1, "awaiting"], ["completed", 0, "idle"]] as const) {
        db.threads.lead = summary("lead", { ...db.threads.lead, activity, awaiting_named_count: count });
        await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: true, config_changed: false }); await settle(t, db); });
        expect(mark()).toBe(status);
        if (status === "running") expect(footer()).not.toContain(model.t.value("status.completed"));
        else if (status === "awaiting") expect(footer()).toContain(model.t.value("status.awaiting"));
        else expect(footer()).toBe("");
        expect(el.querySelector("[data-conversation-header] [data-status]")?.getAttribute("data-status")).toBe(status);
      }
      for (const [activity, label] of [["recovery", "Recovery wait"], ["failed", "Failed"]] as const) {
        db.threads.lead = summary("lead", { ...db.threads.lead, activity, awaiting_named_count: 0 });
        await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: true, config_changed: false }); await settle(t, db); });
        const status = el.querySelector(".conversation-status")!;
        expect(status.textContent).toContain(label);
        expect(status.querySelector(".character-status")?.getAttribute("src")).toBe(characterAssets.error);
      }
    } finally { model.dispose(); }
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
    expect(statuses[0]!.hasAttribute('role')).toBe(false);
    expect(el.querySelector('[data-conversation-announcement][role="status"][aria-live="polite"]')?.textContent).toBeTruthy();
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
    // One place (#103): the status line holds the reason and the only Retry; the dock repeats neither.
    const status = el.querySelector(".conversation-status")!;
    expect(text(status)).toContain("provider: connection interrupted");
    expect([...el.querySelectorAll("button")].filter(button => text(button).trim() === "Retry").map(button => status.contains(button))).toEqual([true]);
    expect(text(el.querySelector(".dock")!)).not.toContain("provider: connection interrupted");
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
    expect(info()).toContain("Reading");
    expect(info()).not.toContain("Owner doesn't report this");
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
  it("explains when an AGENTS change takes effect after readback", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["thread.settings"] });
    const el = draw(model);
    act(() => model.setPanelTab("settings"));
    const row = el.querySelector('[data-setting-id="thread.agents"]')!;
    const button = (label: string) => [...row.querySelectorAll("button")].find(b => b.textContent === label)!;
    act(() => button("Change").click());
    const input = row.querySelector("input")!;
    act(() => { input.value = "/fixture/new-agents.md"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => button("Save").click());
    const call = t.calls("thread.set").at(-1)!;
    expect(call.args).toEqual({ thread_id: "lead", agents: "/fixture/new-agents.md" });
    const saved = { ...db.details.lead!, agents_path: "/fixture/new-agents.md" };
    db.answered.add(call.id);
    await act(async () => { t.ok(call.id, saved); });
    db.details.lead = saved;
    await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await settle(t, db); });
    expect(text(row)).toContain("Applies on the next new Turn");
    expect(text(row)).not.toContain("Applies now");
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
  it("keeps an unfilled context disclosure without reporting usage when the owner has no measurement", async () => {
    const { model, t, db } = await fixtureModel();
    const lead = db.details.lead as unknown as Record<string, unknown>;
    delete lead.context_usage;
    const el = draw(model);
    await act(async () => {
      t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
      await (await import("../../../data/test/harness")).settle(t, db);
    });
    expect(el.querySelector("[data-context-state]")?.getAttribute("data-context-state")).toBe("unknown");
    expect(text(el)).not.toContain("Usage");
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
    const pending = fixturePendingAdapter([{ id: "legacy", threadId: "lead", question: "Synthetic legacy question", askedAt: undefined }]);
    const { model } = await fixtureModel({ route: "inbox", pending, configure(db) {
      db.threads.lead = summary("lead", { awaiting_named_count: 17, awaiting_named_count_exact: false });
    } });
    const el = draw(model);
    expect(text(el)).toContain("t-lead (17+)");
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
    expect(el.querySelectorAll(".nav .nav-item").length).toBe(6);
    expect(el.querySelectorAll(".tabbar > .nav-item").length).toBe(2);
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

describe("Recorded usage (#118)", () => {
  const group = (key: string, input = 100) => usageItem(key, { input, cached: 40, output: 3, count: 1 });
  const choose = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll("button")).find(b => b.textContent === label);
  async function byThread(items: ReturnType<typeof usageItem>[]) {
    const r = await fixtureModel({ route: "analytics", section: "threads", configure(db) {
      const orig = db.answer.bind(db);
      db.answer = c => c.command === "usage.get" ? { ok: true, result: (c.args as { group_by?: string }).group_by === "model"
        ? usagePage([group("historical-model", 100)]) : usagePage(items) } : orig(c);
    } });
    const el = draw(r.model);
    act(() => choose(el, "Detailed usage table")!.click());
    return { ...r, el };
  }
  const dispose = (r: Awaited<ReturnType<typeof fixtureModel>>) => { r.model.dispose(); r.data.stop(); };
  it("opens a selected Thread's historical model totals with the existing owner read", async () => {
    const r = await byThread([group("lead")]);
    try {
      expect(r.t.calls("usage.get").some(c => (c.args as { group_by?: string }).group_by === "model")).toBe(false);
      expect(choose(r.el, "Show models")).toBeDefined();
      act(() => choose(r.el, "Show models")!.click());
      await act(async () => { await settle(r.t, r.db); });
      expect(text(r.el)).toContain("historical-model");
      expect(r.t.calls("usage.get").at(-1)?.args).toMatchObject({ thread_id: "lead", group_by: "model" });
    } finally { dispose(r); }
  });
  async function info() {
    const r = await fixtureModel({ configure(db) {
      const orig = db.answer.bind(db);
      db.answer = c => c.command === "usage.get" ? { ok: true, result: {
        ...group("lead"), thread_id: "lead", coverage: { scope_complete: true },
        model_attempts: { ...group("lead").model_attempts, ...usageItem("lead", { input: 23, cached: 4, output: 7, state: "failed", count: 1 }).model_attempts },
        compaction: usageItem("lead", { input: 100, cached: 40, output: 3, compactions: 1, summary: [71, 16, 8] }).compaction,
      } } : orig(c);
    } });
    let notify!: ResizeObserverCallback;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      private callback: ResizeObserverCallback;
      observe(target: Element) { if (target.hasAttribute("data-panel-root")) notify = this.callback; }
      unobserve() {}
      disconnect() {}
    });
    const el = draw(r.model);
    await act(async () => { r.model.setPanelTab("info"); el.querySelector<HTMLElement>("[data-panel-root]")!.style.display = "block"; notify([], {} as ResizeObserver); });
    await act(async () => { await settle(r.t, r.db); });
    return { ...r, panel: el.querySelector("[data-panel-info]")! };
  }
  it("includes failed attempts in the mounted Thread Info totals", async () => {
    const r = await info();
    try { expect(r.panel).not.toBeNull(); expect(text(r.panel)).toContain("123"); } finally { dispose(r); }
  });
  it("does not claim an exact cached share across different request sets", async () => {
    const g = group("lead", 200); g.cache.unknown_pair_count = 1; g.model_attempts.completed!.cached_tokens.unknown_count = 1;
    const r = await byThread([g]);
    try { const row = r.el.querySelector("tbody tr")!; expect(text(row)).not.toContain("20%"); expect(text(row)).toContain("No value"); } finally { dispose(r); }
  });
  it("shows separate summary tokens in both Thread Info and By Thread", async () => {
    const r = await info();
    try { expect(r.panel).not.toBeNull(); expect(text(r.panel)).toContain("Summary tokens"); expect(text(r.panel)).toContain("71"); } finally { dispose(r); }
    const t = await byThread([usageItem("lead", { input: 100, cached: 40, output: 3, compactions: 1, summary: [71, 16, 8] })]);
    try { expect(text(t.el.querySelector("tbody tr")!)).toContain("71"); } finally { dispose(t); }
  });
  it("labels an unfinished period total while the second page is held", async () => {
    const r = await fixtureModel({ route: "analytics", section: "overview", settle: false });
    try {
      await act(async () => {
        const orig = r.db.answer.bind(r.db);
        r.db.answer = c => { if (c.command === "usage.get" && (c.args as { cursor?: string }).cursor) throw Error("hold next page"); return orig(c); };
        await expect(settle(r.t, r.db)).rejects.toThrow("hold next page");
      });
      const el = draw(r.model);
      expect(text(el.querySelector(".stats")!)).toContain("Aggregating");
    } finally { dispose(r); }
  });
  it("shows weighted floors but withholds ratios after a period walk with gaps", async () => {
    for (const section of ["threads", "overview"] as const) {
      const r = await fixtureModel({ route: "analytics", section, configure(db) {
        const orig = db.answer.bind(db);
        db.answer = c => c.command === "usage.get" ? { ok: true, result: {
          ...usagePage([group("lead", 1200)]), excluded_time_count: 1,
        } } : orig(c);
      } });
      try {
        const el = draw(r.model);
        if (section === "threads") act(() => choose(el, "Detailed usage table")!.click());
        const values = el.querySelector(section === "threads" ? "tbody tr" : ".stats")!;
        expect(text(values)).toContain("At least 1,179");
        expect(text(values)).toContain("Period scan incomplete");
      } finally { dispose(r); }
    }
  });
  it("shows a summary-only weighted floor when some summary counters are unknown", async () => {
    const g = usageItem("lead", { input: 100, cached: 0, output: 0, compactions: 2, summary: [71, 16, 8] });
    g.compaction.output_tokens.unknown_count = 1;
    const r = await fixtureModel({ route: "analytics", section: "overview", configure(db) {
      const orig = db.answer.bind(db);
      db.answer = c => c.command === "usage.get" ? { ok: true, result: usagePage([g]) } : orig(c);
    } });
    try {
      const stats = draw(r.model).querySelector(".stats")!;
      expect(text(stats)).toMatch(/Summary cost\s*At least 47/);
      expect(text(stats)).toMatch(/Effective tokens\s*At least 147/);
    } finally { dispose(r); }
  });
  it("ranks a heavy Thread by the same safe lower bound it displays, with independent row actions", async () => {
    const heavy = usageItem("heavy", { input: 18000, cached: null, output: 0, unknown: 1 });
    const r = await byThread([...Array.from({ length: 26 }, (_, i) => group(`thread-${i}`)), heavy]);
    try {
      const row = r.el.querySelector<HTMLTableRowElement>("tbody tr")!;
      expect(row.cells[0]?.textContent).toContain("heavy");
      expect(row.cells[4]?.textContent).toBe("At least 1,800");
      expect(row.querySelector(".btn-group")).toBeNull();
      expect(row.querySelectorAll("button[aria-pressed]")).toHaveLength(1);
    } finally { dispose(r); }
  });
  it("labels effective usage and cache rate while By Thread is still aggregating", async () => {
    const r = await fixtureModel({ route: "analytics", section: "threads", settle: false, configure(db) {
      const orig = db.answer.bind(db);
      db.answer = c => {
        if (c.command !== "usage.get") return orig(c);
        if ((c.args as { cursor?: string }).cursor) throw Error("hold next page");
        return { ok: true, result: usagePage([group("lead")], "second") };
      };
    } });
    try {
      await expect(settle(r.t, r.db)).rejects.toThrow("hold next page");
      const el = draw(r.model);
      act(() => choose(el, "Detailed usage table")!.click());
      const row = el.querySelector<HTMLTableRowElement>("tbody tr")!;
      expect(row.cells[4]?.textContent).toBe("Aggregating");
      expect(row.cells[5]?.textContent).toBe("Aggregating");
    } finally { dispose(r); }
  });
  it("can reveal the 26th Thread using the already-read groups", async () => {
    const r = await byThread(Array.from({ length: 26 }, (_, i) => group(`thread-${String(i).padStart(2, "0")}`, 200 - i)));
    try {
      expect(r.el.querySelectorAll("tbody tr")).toHaveLength(25);
      const before = r.t.calls("usage.get").length;
      expect(choose(r.el, "Show more usage rows")).toBeDefined();
      act(() => choose(r.el, "Show more usage rows")!.click());
      expect(r.el.querySelectorAll("tbody tr")).toHaveLength(26);
      expect(r.t.calls("usage.get")).toHaveLength(before);
    } finally { dispose(r); }
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
    expect(body).not.toContain("By model isn't shown");
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
    const n = el.querySelector<HTMLLabelElement>('.form-field-label')!.control as HTMLInputElement;
    await act(async () => {
      n.value = "1";
      n.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(first()).not.toBe(was);
    expect(t.calls("usage.get").length).toBe(before);
    expect(model.route.value.section).toBe("overview");
  });
  it("shows LoadingRows in both Storage sections before their first reads return", async () => {
    const { model, t, db } = await fixtureModel({ route: "inbox" });
    try {
      model.applyRoute({ view: "analytics", section: "storage" });
      const el = draw(model);
      const sections = [...el.querySelectorAll(".subview-main section")].slice(0, 2);
      expect(sections).toHaveLength(2);
      for (const section of sections) expect(section.querySelector('.loadrows[role="status"]')).toBeTruthy();
      expect(text(el.querySelector(".subview-main header button")!)).toBe("Refresh");
      await act(async () => { await settle(t, db); });
      for (const section of sections) expect(section.querySelector(".loadrows")).toBeNull();
    } finally { model.dispose(); }
  });
  it("renders Index read error details in a LogBlock", async () => {
    const message = JSON.stringify({ error: "synthetic index read failure" });
    const { model } = await fixtureModel({ route: "analytics", section: "index", configure(db) {
      const answer = db.answer.bind(db);
      db.answer = call => call.command === "index.status" ? { ok: false, code: "invalid_argument", message } : answer(call);
    } });
    try {
      const el = draw(model);
      expect(text(el.querySelector(".subview-main pre.log")!)).toContain(message);
    } finally { model.dispose(); }
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
    const facts = [...el.querySelectorAll(".subview-main section .fact-list-root")];
    expect(facts).toHaveLength(2);
    expect(text(facts[1]!)).toContain("Bridge resident memory");
    expect(text(facts[1]!)).toContain("40 MiB");
  });
  it("By Thread reads on opening; Show compaction goes to its section", async () => {
    const { el, t, db, model } = await open("threads");
    await act(async () => {
      await settle(t, db);
    });
    expect(text(el)).toContain("Improve history search");
    act(() => el.querySelector<HTMLButtonElement>("table[data-compact] tbody button")!.click());
    const show = [...el.querySelectorAll("button")].find((b) => text(b) === "Show compaction")!;
    await act(async () => {
      show.click();
      await settle(t, db);
    });
    expect(model.route.value).toEqual({ view: "analytics", section: "compaction" });
    expect(text(el)).toContain("Compaction effect");
    expect(el.querySelector(".tbl.tbl-stack [data-label='Summary tokens']")).toBeTruthy();
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
    const { model, t } = await fixtureModel({ route: "inbox" });
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
  const visibleOnly = (seen: (el: Element) => boolean) => vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ isIntersecting: seen(target), target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {}
    disconnect() {}
  });
  const open = async (capabilities?: string[]) => {
    const made = await fixtureModel({ route: "branches", capabilities });
    const el = draw(made.model);
    await act(async () => {
      await settle(made.t, made.db);
    });
    return { ...made, el };
  };
  it("reads excerpts only for rows on screen, with bounded single-node windows", async () => {
    visibleOnly((el) => (el as HTMLElement).dataset.key?.startsWith("fork-a|") ?? false);
    const made = await open();
    await act(async () => { await settle(made.t, made.db); });
    // Lane rows read 160-character excerpts; the comparison's own reads (256) are separate and bounded by it.
    const reads = made.t.calls("history.window").map((call) => call.args as Record<string, unknown>).filter((a) => a.excerpt_chars === 160);
    expect(reads.length).toBeGreaterThan(0);
    expect(new Set(reads.map((a) => a.thread_id))).toEqual(new Set(["fork-a"]));
    for (const a of reads) expect(Number(a.before) + Number(a.after) + 1).toBeLessThanOrEqual(2);
  });
  it("does not issue history-window reads or invent excerpts without the capability", async () => {
    visibleOnly(() => true);
    const { el, t } = await open([]);
    expect(t.calls("history.window")).toHaveLength(0);
    expect(el.querySelector(".lanes-pending")).toBeNull();
    expect(text(el.querySelector('[data-key="lead|split|n100"]')!)).toContain("Request step 21");
  });
  it("draws one lane per Thread with real counts, splits where the read reports them, and a detached lane apart", async () => {
    const { el } = await open();
    const keys = [...el.querySelectorAll<HTMLElement>(".branch-lanes > li")].map((li) => li.dataset.key);
    expect(keys).toEqual(["lead|start", "lead|run|1", "lead|split|n100", "lead|run|101", "lead|split|n150", "lead|run|151", "lead|tip", "fork-a|start", "fork-a|run|102", "fork-a|tip", "rewound|start", "rewound|run|152", "rewound|tip", "plain-child|start", "plain-child|run|1", "plain-child|tip"]);
    expect(text(el.querySelector('[data-key="lead|run|1"]')!)).toContain("99 more messages (#2–#100)");
    expect(text(el.querySelector('[data-key="lead|split|n100"]')!)).toContain("splits off here");
    expect(el.querySelectorAll(".branch-line")).toHaveLength(4);
    expect(text(el)).toContain("Started apart from Improve history search");
    expect(el.querySelector('[data-key="plain-child|start"] .lanes-above')).toBeNull();
    expect(el.querySelector('[data-key="fork-a|start"] .lanes-above')).not.toBeNull();
    expect(text(el)).not.toContain("thread.branches");
    expect(text(el)).not.toContain("Source:");
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
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".lanes-actions button")].find((b) => text(b).startsWith(name));
    expect(el.querySelector(".branch-lanes > li[data-selected]")?.getAttribute("data-key")).toBe("lead|split|n100");
    expect(button("Rewind Improve history search to here")).toBeDefined();
    await act(async () => {
      button("Rewind Improve history search to here")!.click();
      await settle(t, db);
    });
    const panel = text(el.querySelector(".lanes-actions")!);
    expect(panel).toContain("125 messages (25 turns) leave Improve history search");
    expect(panel).toContain("cargo test");
    expect(panel).toContain("shell effects aren't undone");
    expect(panel).toContain("A new branch keeps them");
    expect(t.calls("thread.rewind")).toHaveLength(1);
    await act(async () => {
      button("Rewind Improve history search")!.click();
      await settle(t, db);
    });
    expect(t.calls("thread.rewind")).toHaveLength(2);
    expect(el.querySelector(".lanes-actions a.nav-link")!.getAttribute("href")).toBe("#/conversation/kept");
  });
  it("New branch from here reports the new Thread with a link", async () => {
    const { el, model, t, db } = await open();
    await act(async () => {
      model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    });
    await act(async () => {
      [...el.querySelectorAll<HTMLButtonElement>(".lanes-actions button")].find((b) => text(b) === "New branch from here")!.click();
      await settle(t, db);
    });
    expect(text(el.querySelector(".lanes-actions")!)).toContain("Made the new branch Forked.");
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
    expect(text(el)).toContain("どこで分かれた？");
  });
});

describe("Settings controls previously colocated with Threads", () => {
  it("the status bar says which owner this is, in every view", async () => {
    for (const route of ["conversation", "inbox", "apps", "branches", "analytics", "settings"] as const) {
      const made = await fixtureModel({ route });
      const el = draw(made.model);
      await act(async () => {
        await settle(made.t, made.db);
      });
      expect(el.querySelector(".status .owner-dir")?.textContent, route).toContain("/temp/owner-a");
    }
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
    const effort = el.querySelector('[data-setting-id="default-effort"]')!;
    const other = [...effort.querySelectorAll("button")].find((button) => text(button) === "Other")!;
    expect(effort.querySelector("input")).toBeNull();
    act(() => other.click());
    expect(effort.querySelector('input[aria-label="Other"]')).toBeTruthy();
    expect(made.t.calls("config.set")).toHaveLength(0);
    const high = [...effort.querySelectorAll("button")].find((button) => text(button) === "high")!;
    act(() => high.click());
    await act(async () => { await settle(made.t, made.db); });
    expect(high.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { void made.model.config.configChanged(); await settle(made.t, made.db); });
    expect(made.t.calls("config.set")).toHaveLength(1);
    expect(made.t.calls("config.set")[0]!.args).toEqual({ expected_hash: "effort-hash", changes: [{ field: "connections.proxy.default_effort", value: "high" }] });
    expect(high.getAttribute("aria-pressed")).toBe("true");
    expect(effort.querySelector("input")).toBeNull();
    expect(made.model.config.read.value.value?.file.contentHash).toBe("effort-saved");
    expect(text(el)).toContain("Applies after the owner restarts");
  });

  it("mounts guide paths in one list with row actions and one labelled add row", async () => {
    const pointer = "/fixture/studio/agent-pointer.md";
    const guide = "/fixture/team-guide.md";
    const file = { valid: true, content_hash: "guides", values: { extra_instructions: [guide, pointer] } };
    const { model, t, db } = await fixtureModel({ route: "settings", section: "agent", configure(db) {
      const answer = db.answer;
      db.answer = call => call.command === "config.get" ? { ok: true, result: { file } } : answer(call);
    } });
    const el = draw(model);
    await act(async () => { model.guideRegistration.update("/fixture", true); await settle(t, db); });
    const section = el.querySelector('[data-setting-id="guide.files"]')!;
    const list = section.querySelector("ul.guide-file-list")!;
    expect([...list.children].map(row => row.querySelector("code")?.textContent)).toEqual([guide, pointer]);
    const removes = [...list.querySelectorAll<HTMLButtonElement>("li > button.btn-ghost")];
    expect(removes.map(button => [text(button), button.disabled])).toEqual([["Remove file", false], ["Remove file", true]]);
    const addRow = section.querySelector(".guide-file-add")!;
    const input = addRow.querySelector("input")!;
    const add = addRow.querySelector<HTMLButtonElement>(":scope > button.btn-ghost")!;
    expect(addRow.querySelector("label[for]")?.getAttribute("for")).toBe(input.id);
    expect(add.disabled).toBe(true);
    act(() => { input.value = "/fixture/new.md"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(add.disabled).toBe(false);
    expect(section.querySelector(".work-row")).toBeNull();
    expect(t.calls("config.set")).toHaveLength(0);
  });

  it("retains the guide path on refusal and clears it only after success", async () => {
    const pointer = "/fixture/studio/agent-pointer.md";
    const file = { valid: true, content_hash: "guides", values: { extra_instructions: [pointer] } };
    let refuse = true;
    const { model, t, db } = await fixtureModel({ route: "settings", section: "agent", configure(db) {
      const answer = db.answer;
      db.answer = call => call.command === "config.get" ? { ok: true, result: { file } }
        : call.command === "config.set" ? refuse ? { ok: false, code: "operation_conflict", message: "Guide file changed" }
          : { ok: true, result: { written: true, changes: [] } } : answer(call);
    } });
    const el = draw(model);
    await act(async () => { model.guideRegistration.update("/fixture", true); await settle(t, db); });
    const section = el.querySelector('[data-setting-id="guide.files"]')!;
    const input = section.querySelector("input")!;
    const add = section.querySelector<HTMLButtonElement>(".guide-file-add > button")!;
    act(() => { input.value = "/fixture/new.md"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { add.click(); await settle(t, db); });
    expect(input.value).toBe("/fixture/new.md");
    expect(text(section)).toContain("Guide file changed");
    refuse = false;
    await act(async () => { add.click(); await settle(t, db); });
    expect(input.value).toBe("");
    expect(text(section.querySelector("ul")!)).toContain("/fixture/new.md");
  });

  it("focuses Settings model search and restores the trigger on Escape", async () => {
    const values = { connections: { proxy: {} }, default_connection: "proxy", default_model: "test-model" };
    const file = { present: true, valid: true, content_hash: "models", values };
    const { model, t, db } = await fixtureModel({ route: "settings", section: "general", capabilities: ["config.edit"], configure(db) {
      const answer = db.answer;
      db.answer = call => call.command === "config.get" ? { ok: true, result: { file, loaded: file } } : answer(call);
    } });
    const el = draw(model);
    await act(async () => { await settle(t, db); });
    const trigger = el.querySelector<HTMLButtonElement>('[data-setting-id="default_model"] button')!;
    const originalUrl = window.location.href;
    const settingsHash = "#/settings/general";
    window.history.replaceState(null, "", settingsHash);
    try {
      for (const target of ["search", "trigger"]) {
        trigger.focus();
        act(() => trigger.click());
        const search = el.querySelector<HTMLInputElement>(".model-picker input")!;
        expect(search).not.toBeNull();
        expect(document.activeElement).toBe(search);
        const recipient = target === "search" ? search : trigger;
        recipient.focus();
        const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        act(() => { recipient.dispatchEvent(escape); });
        expect(window.location.hash).toBe(settingsHash);
        expect(model.route.peek().view).toBe("settings");
        expect(escape.defaultPrevented).toBe(true);
        expect(el.querySelector(".model-picker")).toBeNull();
        expect(document.activeElement).toBe(trigger);
      }
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("mounts Content to index as a named multi-choice fieldset", async () => {
    const values = { indexing: { auto_kinds: ["user", "summary"] } };
    const file = { valid: true, content_hash: "index-kinds", present: true, values };
    const { model, t, db } = await fixtureModel({ route: "settings", section: "index", capabilities: ["config.edit"], configure(db) {
      const answer = db.answer;
      db.answer = call => call.command === "config.get" ? { ok: true, result: { loaded: file, file } } : answer(call);
    } });
    const el = draw(model);
    await act(async () => { await settle(t, db); });
    const group = el.querySelector<HTMLFieldSetElement>("fieldset.settings-checks")!;
    expect(text(group.querySelector("legend")!)).toBe("Content to index");
    expect(group.disabled).toBe(false);
    const choices = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(choices.map(choice => choice.checked)).toEqual([true, true, false, false, false, false]);
    expect(t.calls("config.set")).toHaveLength(0);
  });

  it("Settings groups sections and filters navigation by names and descriptions", async () => {
    const made = await fixtureModel({ route: "settings", section: "general" });
    const el = draw(made.model);
    await act(async () => { await settle(made.t, made.db); });
    expect(text(el)).toContain("Getting started");
    expect(el.querySelector('.secnav-group[aria-label="Agent"] h3 svg')).toBeNull();
    expect(text(el.querySelector('a[href="#/settings/agent"]')!)).toBe("Guide registration");
    const search = el.querySelector<HTMLInputElement>('.secnav-search input')!;
    expect(search.placeholder).toBe("Search settings");
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
    const { model, t, db } = await fixtureModel({ route: "inbox" });
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
      model.applyRoute({ view: "inbox" });
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
    const { model, t, db } = await fixtureModel({ route: "inbox" });
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
    expect(links.map(text)).toEqual(["Apps", "Branches", "Analytics", "Settings"]);
    act(() => links[3]!.click());
    expect(el.querySelector(".more-panel")).toBeNull();
    act(() => button.click());
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(el.querySelector(".more-panel")).toBeNull();
  });
  it("Awaiting you and Conversation have tabs of their own, in that order", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    expect([...el.querySelectorAll(".tabbar > .nav-item")].map(text)).toEqual(["Awaiting you", "Conversation"]);
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
    expect(nav).toEqual(["General", "Connections", "Summary", "Indexing", "Guide registration", "Storage & capacity", "Appearance", "Studio", "Core"]);
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
    const { model } = await fixtureModel({ route: "inbox" });
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
  const button = (el: Element, label: string) => [...el.querySelectorAll("button, a.btn, a.nav-link")].find((b) => b.textContent?.trim() === label) as HTMLElement | undefined;

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
    expect(text(el)).toContain("Saved, but not yet active");
    expect(text(el)).toContain("stop it with Ctrl+C");
    expect(text(el)).toContain("run the same command again");
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
  it("keeps the compare choice separate from actions and compares only pairs with a confirmed split", async () => {
    const { model, t, db } = await fixtureModel();
    try {
      model.navigate({ view: "branches", threadId: "lead" }); await settle(t, db);
      const el = draw(model); await act(async () => { await settle(t, db); });
      expect(text(el)).toContain("How do they differ?");
      expect(model.branchCompare.state.value.selected).toEqual(["lead", "fork-a"]);
      const card = (name: string) => [...el.querySelectorAll(".branch-line")].find((c) => text(c.querySelector(".lanes-name")!).includes(name))!;
      act(() => card("Plain child").querySelector<HTMLInputElement>("input")!.click());
      expect(model.branchCompare.state.value.selected).toEqual(["fork-a", "plain-child"]);
      expect(text(el)).toContain("These two can't be compared here.");
      expect(t.calls("thread.archive")).toHaveLength(0);
      expect(t.calls("thread.fork")).toHaveLength(0);
      expect(t.calls("thread.rewind")).toHaveLength(0);
      model.navigate({ view: "inbox" });
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
