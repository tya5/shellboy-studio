import { describe, expect, it } from "vitest";
import { settle } from "../../data/test/harness";
import { errorReportText, formatRoute, MAX_APP_ERRORS, parseRoute, readAppMessage } from "../src";
import { fixtureModel } from "./fixture";

describe("routes", () => {
  it("keeps the open app in the hash", () => {
    for (const r of [{ view: "apps" }, { view: "apps", appName: "board" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});

describe("messages from an app's page", () => {
  it("accepts only the known shapes, and bounds the text", () => {
    expect(readAppMessage({ shellboy: true, type: "ready" })).toEqual({ type: "ready" });
    expect(readAppMessage({ shellboy: true, type: "error", kind: "script", message: "x", where: "a.js:1" })).toEqual({ type: "error", kind: "script", message: "x", where: "a.js:1" });
    for (const bad of [null, "x", {}, { shellboy: true }, { shellboy: true, type: "error" }, { shellboy: true, type: "run" }, { type: "ready" }]) expect(readAppMessage(bad)).toBeUndefined();
    const long = readAppMessage({ shellboy: true, type: "error", message: "m".repeat(5000) });
    expect(long?.type === "error" && long.message.length).toBe(2000);
  });
  it("the report names the app and its folder", () => {
    const text = errorReportText({ name: "board", title: "Board" }, [{ kind: "load", message: "gone.js", where: undefined }]);
    expect(text).toContain("apps/board");
    expect(text).toContain("load: gone.js");
    expect(errorReportText({ name: "b", title: "B" }, [{ kind: "k", message: "m".repeat(9000), where: undefined }]).length).toBe(8000);
  });
});

describe("AppsModel over the fake transport", () => {
  it("reads nothing until the view opens, and asks the gateway for one ticket per open", async () => {
    const quiet = await fixtureModel({ route: "monitor" });
    expect(quiet.t.calls("apps.list")).toHaveLength(0);
    const { t, db, model } = await fixtureModel({ route: "apps" });
    expect(t.calls("apps.list")).toHaveLength(1);
    expect(model.apps.list.value.apps.map((a) => a.name)).toEqual(["board", "half"]);
    expect(model.apps.list.value.apps[1]!.problem).toContain("app.json");
    model.applyRoute({ view: "apps", appName: "board" });
    await settle(t, db);
    model.applyRoute({ view: "monitor" });
    model.applyRoute({ view: "apps", appName: "board" });
    await settle(t, db);
    expect(t.calls("apps.open")).toHaveLength(1);
    expect(model.apps.tabs.value).toHaveLength(1);
    expect(model.apps.tabs.value[0]).toMatchObject({ origin: "http://127.0.0.1:8752", thread: "lead", threadState: "ok" });
  });
  it("Refresh shows a new app without a restart", async () => {
    const { t, db, model } = await fixtureModel({ route: "apps" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "apps.list" ? { ok: true, result: { apps: [{ name: "fresh", title: "Fresh" }] } } : plain(c));
    void model.apps.refresh();
    await settle(t, db);
    expect(model.apps.list.value.apps.map((a) => a.name)).toEqual(["fresh"]);
  });
  it("a refused open reports it and opens no tab", async () => {
    const { t, db, model } = await fixtureModel({ route: "apps" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "apps.open" ? { ok: false, code: "app_broken" } : plain(c));
    void model.apps.open("half");
    await settle(t, db);
    expect(model.apps.tabs.value).toHaveLength(0);
    expect(model.apps.openError.value?.name).toBe("half");
  });
  it("an archived or deleted bound Thread keeps the tab", async () => {
    const { t, db, model } = await fixtureModel({ route: "apps" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.get" ? { ok: true, result: { thread_id: "lead", title: "x", archived_at: "2026-11-01T00:00:00+00:00" } } : plain(c));
    void model.apps.open("board");
    await settle(t, db);
    expect(model.apps.tabs.value[0]!.threadState).toBe("archived");
    model.apps.close("board");
    db.answer = (c) => (c.command === "thread.get" ? { ok: false, code: "thread_not_found" } : plain(c));
    void model.apps.open("board");
    await settle(t, db);
    expect(model.apps.tabs.value[0]!.threadState).toBe("missing");
  });
  it("keeps a bounded number of errors per tab", async () => {
    const { t, db, model } = await fixtureModel({ route: "apps" });
    void model.apps.open("board");
    await settle(t, db);
    for (let i = 0; i < MAX_APP_ERRORS + 5; i++) model.apps.report("board", { kind: "script", message: String(i), where: undefined });
    const errors = model.apps.tabs.value[0]!.errors;
    expect(errors).toHaveLength(MAX_APP_ERRORS);
    expect(errors.at(-1)!.message).toBe(String(MAX_APP_ERRORS + 4));
  });
});
