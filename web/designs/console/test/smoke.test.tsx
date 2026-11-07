// @vitest-environment happy-dom
// One smoke test per view on the shared fixture, through the real components.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { options, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureModel, fixturePendingAdapter } from "../../../ui-core/test/fixture";
import type { ServerFrame } from "../../../data/src";
import { settle } from "../../../data/test/harness";
import { type AnalyticsSection, type AppModel, type DesignContext, type Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
import { Conversation } from "../screens/Conversation";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
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
  it("toggles the rail and keeps named, titled destinations", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    const toggle = () => el.querySelector<HTMLButtonElement>(".nav-toggle button")!;
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    act(() => toggle().click());
    expect(el.querySelector(".shell")?.classList.contains("nav-collapsed")).toBe(true);
    expect(toggle().getAttribute("aria-label")).toBe("Expand navigation");
    for (const link of el.querySelectorAll(".side nav a")) {
      expect(link.getAttribute("aria-label")).toBeTruthy();
      expect(link.getAttribute("title")).toBe(link.getAttribute("aria-label"));
    }
    act(() => toggle().click());
    expect(el.querySelector(".shell")?.classList.contains("nav-collapsed")).toBe(false);
    model.dispose();
  });
});

describe("App request and guide", () => {
  it("requires review before sending the full request and shows guidance", async () => {
    const { model, t } = await fixtureModel({ route: "apps" });
    const el = draw(model);
    expect(text(el)).toContain("AGENTS.md");
    const section = [...el.querySelectorAll("section")].find((node) => text(node).includes("Create an app"))!;
    const request = section.querySelector("textarea")!;
    const cwd = section.querySelector("input")!;
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
    act(() => t.push({ t: "changed", thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    const sidebar = el.querySelector(".details")!;
    const headings = [...sidebar.querySelectorAll(".work-region h3")].map(text);
    expect(headings).toEqual(["Running", "Pending"]);
    expect(text(sidebar)).toContain("test command");
    expect(text(sidebar)).toContain("Please review");
    expect(el.querySelector(".work-strip")?.textContent).toContain("Running at least 1");
    db.work.lead = [];
    act(() => t.push({ t: "changed", thread_ids: ["lead"], list: false }));
    await act(async () => settle(t, db));
    expect(el.querySelector(".work-strip")).toBeNull();
    expect(el.querySelectorAll(".details .work-region")).toHaveLength(0);
    model.dispose();
  });
});

describe("Conversation live text", () => {
  const liveFrame = (text: string, offset = 0, extra: { gap?: boolean } = {}): ServerFrame =>
    ({ t: "live", thread_id: "lead", attempt_id: "a1", gap: false, deltas: [{ offset, reasoning: false, text }], ...extra });

  it("shows the unsaved text in a message once per animation frame, and the saved message replaces it", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["live.text"] });
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
    // The attempt ends and its message is saved: the text goes, the saved message stays.
    db.history["lead"] = [...(db.history["lead"] ?? []), { node_id: "saved-1", kind: "assistant_response", excerpt: "Final saved answer", provenance: { created_at: "2099-01-01T00:00:00+09:00", sender: { kind: "shellboy" } } }];
    act(() => {
      t.push({ t: "changed", thread_ids: ["lead"], list: false });
      t.push({ t: "live_end", thread_id: "lead" });
    });
    await act(async () => {
      await settle(t, db);
    });
    expect(bodies().some((b) => b.includes("Writing"))).toBe(false);
    expect(el.textContent).toContain("Final saved answer");
  });

  it("shows at the end of the windowed reader too, and keeps following as it grows", async () => {
    const { model, t } = await fixtureModel({ capabilities: ["live.text", "history.window"] });
    const el = draw(model);
    expect(model.longReader.value).toBeTruthy();
    const box = el.querySelector<HTMLElement>(".scroll")!;
    let height = 100;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => height });
    box.scrollTop = 0;
    for (let i = 0; i < 3; i++) {
      height += 50;
      act(() => t.push(liveFrame("word ", i * 5)));
      await act(async () => flushPromises());
      expect(box.scrollTop, "following").toBe(height);
    }
    expect(box.textContent).toContain("word word word");
    expect(box.textContent).toContain("Writing");
    expect(box.lastElementChild?.textContent).toContain("Running");
  });

  it("a Thread with no held text shows no message, and without the capability nothing is shown at all", async () => {
    const plain = await fixtureModel({ capabilities: ["live.text"] });
    const el = draw(plain.model);
    act(() => plain.t.push({ t: "live_end", thread_id: "lead" }));
    expect(el.textContent).not.toContain("Writing");
    render(null, host!);
    host?.remove();
    const off = await fixtureModel();
    const el2 = draw(off.model);
    act(() => off.t.push(liveFrame("hidden words")));
    await act(async () => flushPromises());
    expect(el2.textContent).not.toContain("hidden words");
    expect(el2.textContent).not.toContain("Writing");
  });

  it("text arriving does not re-render the Conversation, only the live message", async () => {
    const { model, t } = await fixtureModel({ capabilities: ["live.text"] });
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
    const { model } = await fixtureModel();
    const el = draw(model);
    expect(text(el)).toContain("Improve history search");
    expect(text(el)).toContain("cargo test history::search");
    expect(text(el)).toContain("exit 0");
    expect(text(el)).toContain("2.4s");
    expect(text(el)).toContain("41k / auto-summary 200k");
    expect(text(el)).not.toContain("Shellboy event v1");
    expect(el.querySelector('.st[data-status="running"]')).toBeTruthy();
    expect(el.querySelector(".bar i")).toBeTruthy();
  });
  it("offers Stop only with an open Run, and the composer needs a connection", async () => {
    const { model, t } = await fixtureModel();
    const el = draw(model);
    expect(el.querySelector(".btn.stop")).toBeTruthy();
    act(() => t.drop());
    const send = el.querySelector<HTMLButtonElement>(".composer .btn.primary")!;
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
    expect(el.querySelector(".dock .btn.warn")).toBeTruthy();
  });
  it("omits the usage and context elements when the owner reports nothing", async () => {
    const { model, t, db } = await fixtureModel();
    const lead = db.details.lead as unknown as Record<string, unknown>;
    delete lead.context_usage;
    delete lead.usage_totals;
    const el = draw(model);
    await act(async () => {
      t.push({ t: "changed", thread_ids: ["lead"], list: false });
      await (await import("../../../data/test/harness")).settle(t, db);
    });
    expect(el.querySelector(".ctx")).toBeNull();
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
    act(() => button("Pinned only").click());
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
    const chip = [...el.querySelectorAll<HTMLButtonElement>(".chip")].find((c) => text(c).includes("Completed"))!;
    act(() => chip.click());
    expect(el.querySelectorAll(".card").length).toBe(1);
  });
});

describe("Awaiting you", () => {
  it("is a designed empty state in production", async () => {
    const { model } = await fixtureModel({ route: "inbox" });
    const el = draw(model);
    expect(el.querySelector(".empty")).toBeTruthy();
    expect(text(el)).toContain("Nothing is waiting for you");
    expect(el.querySelector(".count")).toBeNull();
    expect(text(el)).toContain("Other activity");
  });
  it("renders questions from the fixture adapter and sends the answer through it", async () => {
    const pending = fixturePendingAdapter();
    const { model } = await fixtureModel({ route: "inbox", pending });
    const el = draw(model);
    expect(el.querySelectorAll(".qitem").length).toBe(2);
    expect(el.querySelector(".nav .count")?.textContent).toBe("2");
    expect(el.querySelector(".q .t")?.textContent).toBe("Should this go to company A or B?");
    const box = el.querySelector("textarea")!;
    act(() => {
      box.value = "Company A";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => el.querySelector<HTMLButtonElement>(".q .btn.primary")!.click());
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
    act(() => el.querySelector<HTMLButtonElement>('.top .right .btn[aria-expanded]')!.click());
    const buttons = [...el.querySelectorAll<HTMLButtonElement>(".panel .btn")];
    expect(buttons.map(text)).toEqual(expect.arrayContaining(["Console", "Light", "Terminal", "English", "日本語"]));
    act(() => buttons.find((b) => text(b) === "Light")!.click());
    expect(el.querySelector('.panel .btn[aria-pressed="true"]')?.textContent).toBe("Light");
  });
  it("settings closes on Escape and on a press outside, and stays open for a press inside", async () => {
    const { model } = await fixtureModel();
    const el = draw(model);
    const toggle = () => el.querySelector<HTMLButtonElement>('.top .right .btn[aria-expanded]')!;
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
    expect(el.querySelectorAll("figure.chart svg").length).toBe(1);
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
    expect(el.querySelectorAll("figure.chart")[0]!.querySelectorAll("path.fill").length).toBe(9);
    expect(el.querySelector(".chart-svg")!.getAttribute("role")).toBe("img");
    expect(el.querySelector(".chart-svg")!.getAttribute("aria-label")).toContain("7 days");
  });
  it("effective tokens follow the weights without a new read", async () => {
    const { el, model, t } = await open("overview");
    const before = t.calls("usage.get").length;
    const first = () => text(el.querySelector(".stat .stat-value")!);
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
  it("Memory shows the cache limits as reported, and the owner's reason when a value is unavailable", async () => {
    const { el, t, db } = await open("memory");
    await act(async () => {
      await settle(t, db);
    });
    expect(text(el)).toContain("UI cache owner is not available");
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
    expect(el.querySelector(".range")).toBeTruthy();
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
    expect(el.querySelectorAll("figure.chart path.fill").length).toBeGreaterThan(0);
  });
  it("says Not read until something has been read", async () => {
    const { model, t } = await fixtureModel({ route: "monitor" });
    t.drop();
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "analytics" });
    });
    expect(text(el.querySelector(".stat .stat-value")!)).toBe("Not read");
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
  it("draws lanes, points and tips from the read, with real counts and a list for phones", async () => {
    const { el } = await open();
    expect(el.querySelectorAll(".bgraph-svg .bg-tip").length).toBe(4);
    expect(el.querySelectorAll(".bgraph-svg .bg-point").length).toBe(2);
    expect(el.querySelector(".edge.on")).toBeTruthy();
    expect(text(el.querySelector(".bgraph-svg")!)).toContain("101 nodes");
    expect(text(el)).toContain("no shared prefix");
    expect(text(el)).toContain("thread.branches");
    expect(el.querySelectorAll(".blist .brow").length).toBe(4);
    expect(el.querySelector(".bgraph-svg .bg-tip")!.getAttribute("href")).toBe("#/conversation/lead");
  });
  it("omits comparing tips and usage since a point, and says so", async () => {
    const { el } = await open();
    expect(text(el)).toContain("Comparing two tips");
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
    const { model, t, db } = await fixtureModel({ route: "conversation" });
    db.history.lead = [...(db.history.lead ?? []), { node_id: "n100", kind: "assistant_response", excerpt: "Here it splits", execution_count: 0, provenance: { created_at: "2026-11-07T10:19:00.000000+00:00", sender: { kind: "assistant" } }, selection: { ordinal: 1000 } }];
    const el = draw(model);
    await act(async () => {
      void model.handle.value!.refresh();
      await settle(t, db);
    });
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
    expect(el.querySelectorAll(".tgroup").length).toBe(1);
    expect(el.querySelector("[draggable]")).toBeNull();
    expect(el.querySelector(".srow-act")).toBeNull();
    expect(text(el)).toContain("Moving a Thread under another isn't available");
    expect(text(el)).toContain("Token totals per directory aren't shown");
    const mode = (name: string) => [...el.querySelectorAll<HTMLButtonElement>(".org button")].find((b) => text(b) === name)!;
    expect(["Tree", "Directory", "State", "Tag"].every((m) => mode(m))).toBe(true);
    act(() => mode("Tag").click());
    expect(text(el)).toContain("Tags aren't available");
    expect(el.querySelector(".tgroup")).toBeNull();
    act(() => mode("Directory").click());
    expect(el.querySelectorAll(".tgroup").length).toBeGreaterThan(0);
    const state = mode("State");
    act(() => state.click());
    expect(text(el.querySelector(".tgroup")!)).toContain("Recovery wait");
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
    expect([...el.querySelectorAll(".tgroup .tgroup-name")].map(text)).toEqual(["bug hunt", "customer A"]);
    expect(el.querySelector(".srow")).toBeNull();
    const show = (n: number) => el.querySelectorAll<HTMLButtonElement>(".tgroup header .btn")[n]!;
    await go(() => show(0).click());
    expect(made.t.calls("thread.list").at(-1)!.args).toMatchObject({ tags: ["bug hunt"] });
    expect(el.querySelectorAll(".srow").length).toBe(2);
    expect([...el.querySelectorAll(".srow .tag")].map(text)).toContain("customer A");
    act(() => el.querySelector<HTMLInputElement>(".srow input")!.click());
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
    expect(text(el)).toContain("Tags changed on 1 Threads");
    await go(() => mode("Directory").click());
    expect([...el.querySelectorAll(".tgroup .tgroup-name")].map(text)).toEqual(["/home/me/dev/rag", "/home/me/dev/shellboy"]);
    act(() => { made.model.lang.value = "ja"; });
    expect(text(el)).toContain("表示");
  });
  it("archive needs a second press, states what it touches, and calls the owner", async () => {
    const { el, t, db } = await open();
    const box = el.querySelector<HTMLInputElement>(".srow input")!;
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
    act(() => el.querySelector<HTMLInputElement>(".srow input")!.click());
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

  it("Settings fills rows, reviews changes, and writes only what changed", async () => {
    const made = await fixtureModel({ route: "settings", section: "shell", capabilities: ["config.edit"] });
    const before = made.db.answer;
    const values = { shell: { kind: "bash", executable: null, env: { MY_VAR: "[redacted]" } } };
    const side = { present: true, content_hash: "h1", valid: true, error: null, values, redacted_fields: ["shell.env.MY_VAR"] };
    made.db.answer = (c) =>
      c.command === "config.get"
        ? { ok: true, result: { config_path: "/temp/config.toml", loaded: { ...side, values: { shell: { kind: "powershell", executable: null, env: {} } } }, file: side, differs: true, differing_fields: ["shell.kind"], restart: { all_fields_require_restart: true } } }
        : c.command === "config.set"
          ? { ok: true, result: { written: true, restart_required: true, changes: [{ field: "shell.executable", previous: null, value: "/bin/zsh", sensitive: false, restart_required: true }] } }
          : before(c);
    const el = draw(made.model);
    act(() => made.model.config.ensure());
    await act(async () => {
      await settle(made.t, made.db);
    });
    const main = () => text(el);
    expect(main()).toContain("every setting needs an owner restart");
    expect(main()).toContain("Applied after a restart: shell.kind");
    expect(main()).toContain("still uses powershell");
    expect(main()).toContain("Set, hidden");
    expect(main()).not.toContain("[redacted]");
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b) === name);
    const exe = el.querySelector<HTMLInputElement>('input[aria-label="Executable"], .fact input')!;
    act(() => { exe.value = "/bin/zsh"; exe.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => button("Review changes")!.click());
    expect(main()).toContain("shell.executable");
    await act(async () => {
      button("Write to file")!.click();
      await settle(made.t, made.db);
    });
    expect(made.t.calls("config.set").at(-1)!.args).toEqual({ expected_hash: "h1", changes: [{ field: "shell.executable", value: "/bin/zsh" }] });
    expect(main()).toContain("Restart required");
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
    const group = el.querySelector<HTMLInputElement>(".tgroup header input")!;
    act(() => group.click());
    expect(model.org.selected.value.size).toBe(el.querySelector(".tgroup")!.querySelectorAll(".srow").length);
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
    expect(text(el)).toContain("/tmp/x/apps/README.md");
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
    expect([...el.querySelectorAll(".apptab a")].map(text)).toEqual(["All apps", "Board"]);
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
  const open = async (section: "connections" | "models" | "embeddings" | "shell" | "storage" | "compaction" | "appearance") => {
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
    expect(nav).toEqual(["Connections", "Models & defaults", "Embeddings & indexing", "Shell", "Storage & retention", "Compaction", "Appearance"]);
    expect(el.querySelector('.secnav-item[aria-current="page"]')!.getAttribute("href")).toBe("#/settings/connections");
    expect(text(el)).toContain("Read-only");
    expect(text(el)).not.toContain("Changes take effect after owner restart");
    expect(el.querySelector(".subview-main input")).toBeNull();
  });
  it("Connections shows the connection in use, and credential names only as unavailable", async () => {
    const { el, t } = await open("connections");
    expect(text(el)).toContain("Credential variable name");
    expect(text(el)).toContain("config check");
    expect(t.calls("model.list")).toHaveLength(0);
  });
  it("the catalog is read only on a press", async () => {
    const { el, t, db } = await open("connections");
    const button = [...el.querySelectorAll(".subview-main button")].find((b) => text(b).includes("default connection")) as HTMLButtonElement;
    await act(async () => {
      button.click();
      await (await import("../../../data/test/harness")).settle(t, db);
    });
    expect(t.calls("model.list")).toHaveLength(1);
    expect(text(el)).toContain("Models: 2");
    expect(text(el)).toContain("responses");
  });
  it("Embeddings shows the index state; Storage marks documented defaults as such", async () => {
    expect(text((await open("embeddings")).el)).toContain("mock-embed");
    const storage = text((await open("storage")).el);
    expect(storage).toContain("Logical warning");
    expect(storage).not.toMatch(/Documented default|8 GiB|10 GiB/);
    expect(storage).toContain("Not reached");
    expect(storage).toContain("32 MiB");
  });
  it("Compaction shows the Thread's values and their origin; Appearance switches theme without a reload", async () => {
    const compaction = text((await open("compaction")).el);
    expect(compaction).toContain("Proactive compaction at");
    expect(compaction).toContain("thread set");
    const { el } = await open("appearance");
    const light = [...el.querySelectorAll(".subview-main button")].find((b) => text(b) === "Light") as HTMLButtonElement;
    act(() => light.click());
    expect(light.getAttribute("aria-pressed")).toBe("true");
  });
  it("the popover keeps quick choices and links to all settings", async () => {
    const { model } = await fixtureModel({ route: "monitor" });
    const el = draw(model);
    act(() => el.querySelector<HTMLButtonElement>("[data-settings-toggle]")!.click());
    const link = [...el.querySelectorAll(".panel a")].find((a) => text(a) === "All settings")!;
    expect(link.getAttribute("href")).toBe("#/settings/appearance");
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
    expect(el.querySelector(".choices")).toBeNull();
  });

  it("walks from nothing to saved, empties the key field when sent, and says a restart is needed", async () => {
    const { model, t, db } = await fixtureModel({
      route: "setup",
      capabilities: ["config.edit", "connection.setup"],
      configure: (d) =>
        owner(d as never, (c) => {
          if (c.command === "config.get") return { ok: true, result: config };
          if (c.command === "connection.test") return { ok: true, result: { http_status: 200, models: ["model-a", "model-b"], api_key_env: { name: "OPENAI_API_KEY", set: false } } };
          if (c.command === "credentials.set") return { ok: true, result: { path: "/temp/cfg/credentials.toml" } };
          if (c.command === "config.set") return { ok: true, result: { written: true, restart_required: true, changes: [] } };
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
    expect(el.querySelectorAll(".choice")).toHaveLength(6);
    await pump(() => click(el.querySelectorAll(".choice input")[1]));
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
    await pump(() => click([...el.querySelectorAll(".choices")].at(-1)!.querySelector("input")));
    await pump(() => click(button(el, "Save and use this connection")));
    expect(text(el)).toContain("Saved");
    expect(text(el)).toContain("/temp/cfg/credentials.toml");
    expect(text(el)).toContain("plain-text file");
    expect(text(el)).toContain("Restart it");
    expect(el.querySelector('a[href="#/conversation"]')).toBeTruthy();
    expect(el.innerHTML).not.toContain(KEY);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(KEY);
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
      click(el.querySelectorAll(".choice input")[4]);
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
      await pump(() => click(el.querySelectorAll(".choice input")[4]));
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
      await pump(() => click([...el.querySelectorAll(".choice input")][1]));
      expect(text(el)).toContain("Anthropic's API has no embeddings");
      await pump(() => click([...el.querySelectorAll(".choice input")][0]));
      expect(text(el)).not.toContain("Anthropic's API has no embeddings");
      expect(text(el)).toContain("can't tell which of them make embeddings");
      expect(t.calls().some((c) => /embed|index|rag/.test(c.command))).toBe(false);
    });

    it("Settings links to both flows", async () => {
      const { model, t, db } = await setupWith("settings");
      const el = draw(model);
      await pumpOf(t as never, db as never)();
      expect(text(el)).toContain("Add a connection");
      expect(el.querySelector('a[href="#/setup"]')).toBeTruthy();
      model.applyRoute({ view: "settings", section: "embeddings" });
      await pumpOf(t as never, db as never)();
      expect(el.querySelector('a[href="#/setup/embedding"]')).toBeTruthy();
    });
  });
});
