import { describe, expect, it } from "vitest";
import { flush, settle } from "../../data/test/harness";
import { errorReportText, formatRoute, MAX_APP_CALLS, MAX_APP_ERRORS, parseRoute, readAppMessage } from "../src";
import { fixtureModel } from "./fixture";

describe("routes", () => {
  it("keeps the open app in the hash", () => {
    for (const r of [{ view: "apps" }, { view: "apps", appName: "board" }, { view: "apps", appName: "board", appInstance: "one_2" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});

describe("instance paths", () => {
  it("rejects traversal, separators, invalid encodings and excess segments", () => {
    for (const hash of ["#/apps/board/..", "#/apps/board/a%2Fb", "#/apps/board/%", "#/apps/board/a/b"]) {
      expect(parseRoute(hash)).toEqual({ view: "apps" });
    }
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

describe("the API relay", () => {
  const opened = async () => {
    const made = await fixtureModel({ route: "apps" });
    void made.model.apps.open("board");
    await settle(made.t, made.db);
    return made;
  };
  it("forwards a call for the tab's app and returns the gateway's reply", async () => {
    const { t, db, model } = await opened();
    const reply = model.apps.call("board", "data.read", { path: "a" });
    await settle(t, db);
    expect(await reply).toEqual({ ok: true, result: { echoed: "data.read" } });
    expect(t.calls("apps.call")[0]!.args).toEqual({ name: "board", op: "data.read", args: { path: "a" } });
  });
  it("hint waits don't take the slots ordinary reads need", async () => {
    const { t, db, model } = await opened();
    const plain = db.answer;
    db.answer = (c) => (c.command === "apps.call" ? plain(c) : plain(c));
    const before = t.calls().length;
    for (let i = 0; i < 6; i++) void model.apps.call("board", "data.wait", {});
    expect(t.calls().length).toBe(before + 6);
    await settle(t, db);
  });
  it("bounds an app's outstanding calls, and closing the tab cancels them", async () => {
    const { t, model } = await opened();
    const calls = Array.from({ length: MAX_APP_CALLS + 1 }, () => model.apps.call("board", "data.wait", {}));
    expect(await calls[MAX_APP_CALLS]).toMatchObject({ ok: false, error: { code: "busy" } });
    model.apps.close("board");
    expect(t.cancels().length).toBe(MAX_APP_CALLS);
    expect(await calls[0]).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });
  it("keeps an app's file session out of error text", () => {
    const m = readAppMessage({ shellboy: true, type: "error", message: `Couldn't load http://h:1/a/${"a".repeat(32)}/gone.js`, where: `http://h:1/a/${"b".repeat(32)}/x.js:3` });
    expect(m).toMatchObject({ message: "Couldn't load gone.js", where: "x.js:3" });
  });
  it("accepts only known shapes from a page", () => {
    expect(readAppMessage({ shellboy: true, type: "call", id: 1, op: "x", args: { a: 1 } })).toEqual({ type: "call", id: 1, op: "x", args: { a: 1 } });
    for (const bad of [{ shellboy: true, type: "call" }, { shellboy: true, type: "call", id: "1", op: "x" }]) expect(readAppMessage(bad)).toBeUndefined();
  });
});

describe("AppsModel over the fake transport", () => {
  it("loads one bounded folder page and cancels it when the panel closes", async () => {
    const { t, db, model } = await fixtureModel({ route: "apps" });
    const read = model.apps.loadFolders();
    expect(t.calls("thread.cwds").at(-1)?.args).toEqual({ limit: 200 });
    await settle(t, db);
    await read;
    expect(model.apps.folders.value.names).toContain("/home/me/dev/shellboy");
    void model.apps.loadFolders();
    model.apps.leaveFolders();
    expect(t.cancels().length).toBeGreaterThan(0);
    model.dispose();
  });

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
    expect(model.apps.tabs.value[0]).toMatchObject({ url: "/a/s1/index.html", thread: "lead", threadState: "ok" });
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

describe("create app request", () => {
  it("creates a Thread with the chosen folder, then sends the reviewed text", async () => {
    const { model, t } = await fixtureModel({ route: "apps" });
    const text = "First read $SHELLBOY_DATA_DIR/studio/agent-guide.md\n\nMake a board";
    const result = model.createAppRequest(text, "/work");
    await flush();
    const create = t.calls("thread.create").at(-1)!;
    expect(create.args).toEqual({ cwd: "/work" });
    t.ok(create.id, { thread_id: "new-thread", title: "New" });
    await flush();
    const send = t.calls("message.send").at(-1)!;
    expect(send.args).toEqual({ thread_id: "new-thread", text });
    t.ok(send.id, { message_id: "new-message", thread_id: "new-thread" });
    expect(await result).toBe(true);
    expect(model.route.value).toEqual({ view: "conversation", threadId: "new-thread" });
    model.dispose();
  });
});
