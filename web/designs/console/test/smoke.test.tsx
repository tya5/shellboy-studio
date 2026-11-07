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
  const value = signal<Prefs>({ design: "console", theme: "console", lang: "en", ...prefs });
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
    expect(el.querySelectorAll(".nav .nav-item").length).toBe(3);
    expect(el.querySelectorAll(".tabbar .nav-item").length).toBe(3);
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
