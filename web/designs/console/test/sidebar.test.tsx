// @vitest-environment happy-dom
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { summary, details, settle } from "../../../data/test/harness";
import { loadPrefs } from "../../../ui-core/src/prefs";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
import { StatusMark } from "../system/components/StatusMark";

it("keeps status updates in place, persists child folds, and moves pins only after the owner event", async () => {
  const f = await fixtureModel({ route: "conversation", threadId: "lead", capabilities: ["thread.tags", "thread.cwds"], configure(db) {
    db.threads = { lead: summary("lead", { cwd: "/alpha" }), child: summary("child", { cwd: "/alpha", parent_id: "lead", awaiting_human_count: 1 }), other: summary("other", { cwd: "/alpha", tags: ["project"] }) };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const designs = DESIGNS;
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, designs));
  const link = (id: string) => host.querySelector<HTMLAnchorElement>(`#thread-link-sidebar-${id}`);
  const sides = () => [...host.querySelectorAll(".side-list [data-thread-row] a")].map(el => el.id);
  const hint = async () => { f.t.push({ t: "changed", thread_ids: ["other"], list: true }); await settle(f.t, f.db); };
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    const parent = link("lead")!;
    expect(link("child")).toBeNull();
    expect(parent.parentElement?.querySelector('[data-urgency="awaiting"] button')?.getAttribute("aria-expanded")).toBe("false");
    const open = (key: string) => parent.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await act(async () => { open("ArrowRight"); });
    expect(link("child")).not.toBeNull();
    expect(prefs.peek().sidebarOpenParents).toEqual(["lead"]);
    const order = sides(), other = link("other")!;
    f.db.threads.other!.activity = "running";
    await act(hint);
    expect(sides()).toEqual(order);
    expect(link("other")).toBe(other);
    expect(other.querySelector('[data-status="running"] svg')).not.toBeNull();
    await act(async () => { open("ArrowLeft"); });
    expect(link("child")).toBeNull();
    await act(async () => { f.model.openThread("child"); await settle(f.t, f.db); });
    expect(link("child")?.getAttribute("aria-current")).toBe("true");
    await act(async () => { other.parentElement!.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click(); });
    const pin = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el => el.textContent === "Pin")!;
    await act(async () => { pin.click(); await settle(f.t, f.db); });
    expect(f.t.calls("thread.tag").at(-1)?.args).toEqual({ thread_ids: ["other"], add: ["pin"] });
    expect(sides()).toEqual(order);
    await act(hint);
    expect(sides()[0]).toBe("thread-link-sidebar-other");
    expect(host.querySelector('.side-list section')?.getAttribute("aria-label")).toBe("Pinned");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("renders distinct shapes for the five approved status marks", () => {
  const host = document.createElement("div");
  render(<>{(["running", "awaiting", "completed", "failed", "idle"] as const).map(status => <StatusMark key={status} status={status} label={status} />)}</>, host);
  const svg = [...host.querySelectorAll("svg")];
  expect(svg).toHaveLength(5);
  expect(new Set(svg.map(icon => icon.innerHTML)).size).toBe(5);
  render(null, host);
});
