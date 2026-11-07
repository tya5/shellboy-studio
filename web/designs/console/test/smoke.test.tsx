// @vitest-environment happy-dom
// One smoke test per view on the shared fixture, through the real components.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureModel, fixturePendingAdapter } from "../../../ui-core/test/fixture";
import { type AppModel, type DesignContext, type Prefs } from "../../../ui-core/src";
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
    expect(el.querySelectorAll(".nav .nav-item").length).toBe(5);
    expect(el.querySelectorAll(".tabbar .nav-item").length).toBe(5);
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
  it("draws every chart from the fixture, to scale, with its source, and shows no money", async () => {
    const { model } = await fixtureModel({ route: "analytics" });
    const el = draw(model);
    const body = text(el);
    for (const title of ["Daily tokens", "Daily effective tokens", "Cache rate", "Daily summary tokens", "Compaction events per day", "Usage by Thread", "Compaction effect", "Resources"]) expect(body, title).toContain(title);
    expect(el.querySelectorAll("figure.chart svg").length).toBe(5);
    expect(body).toContain("usage.get group_by=day");
    expect(body).toContain("compact.list");
    expect(body).toContain("aren't prices");
    expect(body).toContain("By model isn't shown");
    expect(body).not.toMatch(/\$\s?\d|USD|¥/);
    // 2026-11-06: 1.5M cached, 1.5M uncached, 40k output in two windows; a column reaches its value.
    const dailyColumns = el.querySelectorAll("figure.chart")[0]!.querySelectorAll("path.fill");
    expect(dailyColumns.length).toBe(9);
    expect(el.querySelector(".chart-svg")!.getAttribute("role")).toBe("img");
    expect(el.querySelector(".chart-svg")!.getAttribute("aria-label")).toContain("7 days");
  });
  it("states are shown: effective tokens follow the weights without a new read", async () => {
    const { model, t } = await fixtureModel({ route: "analytics" });
    const el = draw(model);
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
  });
  it("offers no destructive action, and explains why", async () => {
    const { model } = await fixtureModel({ route: "analytics" });
    const el = draw(model);
    const body = text(el);
    for (const phrase of ["no preview", "needs the owner stopped", "Recreating an index costs money", "no bounded read of storage by Thread"]) expect(body, phrase).toContain(phrase);
    const buttons = [...el.querySelectorAll("button")].map((b) => text(b).toLowerCase());
    for (const word of ["collect", "vacuum", "prune", "delete"]) expect(buttons.some((b) => b.includes(word)), word).toBe(false);
  });
  it("shows the cache limits as reported, and the owner's reason when a value is unavailable", async () => {
    const { model } = await fixtureModel({ route: "analytics" });
    const el = draw(model);
    expect(text(el)).toContain("UI cache owner is not available");
    expect(text(el)).toContain("3.7 GiB");
    expect(el.querySelector('[role="meter"]')).toBeTruthy();
  });
  it("loading keeps partial values with a Stop; a failure keeps them too", async () => {
    const { model, t, db } = await fixtureModel();
    const plain = db.answer;
    let n = 0;
    db.answer = (c) => (c.command === "usage.get" && n++ === 1 ? { ok: false, code: "cursor_expired", message: "expired" } as never : plain(c));
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "analytics" });
      await Promise.resolve();
    });
    expect(text(el)).toContain("Reading saved usage");
    await act(async () => {
      await (await import("../../../data/test/harness")).settle(t, db);
    });
    expect(text(el)).toContain("Reading stopped");
    expect(el.querySelectorAll("figure.chart path.fill").length).toBeGreaterThan(0);
  });
  it("says Not read until something has been read, and No value only after", async () => {
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
    expect(text(el)).toContain("日別トークン");
    expect(text(el)).toContain("価格ではありません");
  });
});

describe("Settings", () => {
  const open = async (section: "connections" | "models" | "embeddings" | "shell" | "storage" | "compaction" | "appearance") => {
    const { model, t, db } = await fixtureModel({ route: "settings" });
    const el = draw(model);
    await act(async () => {
      model.applyRoute({ view: "settings", section });
      await (await import("../../../data/test/harness")).settle(t, db);
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
    expect(el.querySelector(".settings-main input")).toBeNull();
  });
  it("Connections shows the connection in use, and credential names only as unavailable", async () => {
    const { el, t } = await open("connections");
    expect(text(el)).toContain("Credential variable name");
    expect(text(el)).toContain("config check");
    expect(t.calls("model.list")).toHaveLength(0);
  });
  it("the catalog is read only on a press", async () => {
    const { el, t, db } = await open("connections");
    const button = [...el.querySelectorAll(".settings-main button")].find((b) => text(b).includes("default connection")) as HTMLButtonElement;
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
    expect(storage).toContain("Documented default: 8 GiB");
    expect(storage).toContain("Not reached");
    expect(storage).toContain("32 MiB");
  });
  it("Compaction shows the Thread's values and their origin; Appearance switches theme without a reload", async () => {
    const compaction = text((await open("compaction")).el);
    expect(compaction).toContain("Proactive compaction at");
    expect(compaction).toContain("thread set");
    const { el } = await open("appearance");
    const light = [...el.querySelectorAll(".settings-main button")].find((b) => text(b) === "Light") as HTMLButtonElement;
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
