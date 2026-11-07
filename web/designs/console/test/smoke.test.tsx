// @vitest-environment happy-dom
// One smoke test per view on the shared fixture, through the real components.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureModel, fixturePendingAdapter } from "../../../ui-core/test/fixture";
import { settle } from "../../../data/test/harness";
import { type AnalyticsSection, type AppModel, type DesignContext, type Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";

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

const text = (el: Element) => el.textContent ?? "";

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
  it("draws one card per Thread, most urgent first, with chips that filter", async () => {
    const { model } = await fixtureModel({ route: "monitor" });
    const el = draw(model);
    const cards = el.querySelectorAll(".card");
    expect(cards.length).toBe(5);
    expect(cards[0]!.classList.contains("err")).toBe(true);
    expect(text(cards[0]!)).toContain("Retry");
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
    expect([...el.querySelectorAll(".secnav-pick option")].map(text)).toHaveLength(7);
    expect(el.querySelectorAll("figure.chart svg").length).toBe(1);
    expect(text(el)).not.toContain("Owner memory");
    expect(text(el)).toContain("aren't prices");
  });
  it("the phone selector navigates like the list", async () => {
    const { el, model } = await open("overview");
    const pick = el.querySelector<HTMLSelectElement>(".secnav-pick select")!;
    expect(pick.value).toBe("overview");
    await act(async () => {
      pick.value = "memory";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(model.route.value).toEqual({ view: "analytics", section: "memory" });
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
  it("groups by directory and by state, with real parent links and no fake controls", async () => {
    const { el } = await open();
    expect(el.querySelectorAll(".tgroup").length).toBeGreaterThan(0);
    expect(el.querySelector("[draggable]")).toBeNull();
    expect(text(el)).toContain("Token totals per directory aren't shown");
    const state = [...el.querySelectorAll<HTMLButtonElement>(".org button")].find((b) => text(b) === "State")!;
    act(() => state.click());
    expect(text(el.querySelector(".tgroup")!)).toContain("Recovery wait");
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
  it("opens in a tab on the app's own origin, and stays mounted while other views show", async () => {
    const { el, model } = await open("board");
    expect(frame(el).getAttribute("src")).toContain("http://127.0.0.1:8752/");
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
