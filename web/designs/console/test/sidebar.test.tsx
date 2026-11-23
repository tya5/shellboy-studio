// @vitest-environment happy-dom

import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { summary, details, settle, flush } from "../../../data/test/harness";
import { loadPrefs } from "../../../ui-core/src/prefs";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
import { StatusMark } from "../system/components/StatusMark";
import { ThreadGroup } from "../system/components/ThreadGroup";

it("keeps status updates in place, persists child folds, and adds a pinned copy only after the owner event", async () => {
  const f = await fixtureModel({ route: "conversation", threadId: "lead", capabilities: ["thread.tags", "thread.cwds"], configure(db) {
    db.threads = { lead: summary("lead", { cwd: "/alpha" }), child: summary("child", { cwd: "/beta", parent_id: "lead", awaiting_named_count: 1 }), other: summary("other", { cwd: "/alpha", tags: ["project"] }) };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const designs = DESIGNS;
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, designs));
  const link = (id: string) => host.querySelector<HTMLAnchorElement>(`.side-list a[href="#/conversation/${id}"]`);
  const sides = () => [...host.querySelectorAll(".side-list [data-thread-row] a")].map(el => el.id);
  const hint = async () => { f.t.push({ t: "changed", config_changed: false, thread_ids: ["other"], list: true }); await settle(f.t, f.db); };
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    const parent = link("lead")!;
    expect(link("child")).toBeNull();
    expect(parent.closest("[data-thread-row]")?.querySelector('.children-chip[data-urgency="awaiting"] button')?.getAttribute("aria-expanded")).toBe("false");
    expect(parent.closest("[data-thread-row]")?.querySelector('.children-chip[data-urgency="awaiting"] button')?.getAttribute("aria-label")).toContain("1 children");
    const open = (key: string) => parent.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await act(async () => { open("ArrowRight"); });
    expect(link("child")).not.toBeNull();
    expect(prefs.peek().sidebarOpenParents).toEqual([JSON.stringify(["all", "lead"])]);
    const order = sides(), other = link("other")!;
    f.db.threads.other!.activity = "running";
    await act(hint);
    expect(sides()).toEqual(order);
    expect(link("other")).toBe(other);
    expect(other.querySelector('[data-status="running"] svg')).not.toBeNull();
    await act(async () => { open("ArrowLeft"); });
    expect(link("child")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('.side-list button[aria-label="Collapse All"]')!.click(); });
    expect(link("lead")).toBeNull();
    await act(async () => { f.model.openThread("child"); await settle(f.t, f.db); });
    expect(link("child")?.getAttribute("aria-current")).toBe("true");
    await act(async () => { link("lead")!.dispatchEvent(new KeyboardEvent("keydown", { key:"ArrowLeft", bubbles:true })); });
    expect(link("child")).toBeNull();
    await act(async () => { link("lead")!.dispatchEvent(new KeyboardEvent("keydown", { key:"ArrowRight", bubbles:true })); });
    await act(async () => { link("other")!.parentElement!.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click(); });
    const pin = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el => el.textContent === "Pin")!;
    await act(async () => { pin.click(); await settle(f.t, f.db); });
    expect(f.t.calls("thread.tag").at(-1)?.args).toEqual({ thread_ids: ["other"], add: ["pin"] });
    expect(sides()).toEqual(order);
    expect(f.model.actionError.peek()).toBeUndefined();
    await act(hint);
    expect(host.querySelectorAll('.side-list a[href="#/conversation/other"]')).toHaveLength(2);
    expect(sides().slice(1)).toEqual(order);
    expect(host.querySelector('.side-list section')?.getAttribute("aria-label")).toBe("Pinned");
  } finally { render(null, host); host.remove(); document.head.querySelector("#test-styles")?.remove(); f.model.dispose(); f.data.stop(); }
});

it("keeps the owner's created order on status hints and inserts a new Thread at the head on reread", async () => {
  const f = await fixtureModel({ route: "conversation", threadId: "lead", configure(db) {
    const cwd = "/alpha";
    db.threads = {
      child: summary("child", { cwd, parent_id: "lead" }),
      other: summary("other", { cwd }),
      lead: summary("lead", { cwd }),
    };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id, { cwd });
    const answer = db.answer.bind(db);
    db.answer = call => call.command === "thread.create"
      ? { ok: true, result: details("new", { cwd }) }
      : answer(call);
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const prefs = signal<ReturnType<typeof loadPrefs>>({ ...loadPrefs({ read: () => null, write() {} }, DESIGNS), sidebarOpenParents: [JSON.stringify(["all", "lead"]) ] });
  const order = () => [...host.querySelectorAll<HTMLAnchorElement>(".side-list [data-thread-row] a")].map(el => el.href.split("/").at(-1));
  const hint = async (id: string) => {
    f.t.push({ t: "changed", config_changed: false, thread_ids: [id], list: true });
    await settle(f.t, f.db);
  };
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    expect(order()).toEqual(["other", "lead", "child"]);
    Object.assign(f.db.threads.other!, { activity: "tools", updated_at: "2099-01-01T00:00:00Z" });
    await act(() => hint("other"));
    expect(order()).toEqual(["other", "lead", "child"]);
    await act(async () => {
      const creating = f.model.createThread();
      await settle(f.t, f.db);
      await creating;
    });
    expect(f.t.calls("thread.create")).toHaveLength(1);
    expect(order()).toEqual(["other", "lead", "child"]);
    f.db.threads = { new: summary("new", { cwd: "/alpha" }), ...f.db.threads };
    f.db.details.new = details("new", { cwd: "/alpha" });
    await act(() => hint("new"));
    expect(order()).toEqual(["new", "other", "lead", "child"]);
    expect(f.t.calls("thread.list").at(-1)?.args).toMatchObject({ order: "created" });
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("renders distinct shapes for the five approved status marks", () => {
  const host = document.createElement("div");
  render(<>{(["running", "awaiting", "error", "waiting", "idle"] as const).map(status => <StatusMark key={status} status={status} label={status} />)}</>, host);
  const svg = [...host.querySelectorAll("svg")];
  expect(svg).toHaveLength(5);
  expect(new Set(svg.map(icon => icon.innerHTML)).size).toBe(5);
  render(null, host);
});

it("reads owner catalogs only while the filter menu is open, independently of filtered rows", async () => {
  const f=await fixtureModel({route:"conversation",threadId:"lead",capabilities:["thread.tags","thread.cwds"],configure(db){
    db.threads={lead:summary("lead",{cwd:"/alpha",tags:["first"]}),other:summary("other",{cwd:"/beta",tags:["second"]})};
  }});
  const host=document.createElement("div"); document.body.append(host);
  const prefs=signal(loadPrefs({read:()=>null,write(){}},DESIGNS));
  const trigger=()=>host.querySelector<HTMLButtonElement>('.side-search [aria-haspopup="menu"]')!;
  const menu=()=>document.querySelector('[role="menu"]');
  const hints=async()=>{f.t.push({t:"changed",config_changed:false,thread_ids:[],list:true});await settle(f.t,f.db);};
  try {
    await act(async()=>{render(<App context={{model:f.model,prefs,designs:DESIGNS,setPrefs(){},submitToken:async()=>false}}/>,host);await settle(f.t,f.db);});
    expect(f.t.calls("thread.cwds")).toHaveLength(0);
    for (const key of ["ArrowDown", "Enter", " "]) {
      trigger().focus();
      await act(async()=>{trigger().dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));});
      await act(async()=>{await settle(f.t,f.db);});
      expect(document.activeElement).toBe(menu()?.querySelector('[role="menuitem"]'));
      await act(async()=>trigger().click());
      expect(menu()).toBeNull();
    }
    await act(async()=>trigger().click());
    await act(async()=>{await settle(f.t,f.db);});
    expect(menu()?.textContent).toContain("Directory: /beta");
    await act(async()=>{f.data.setListFilter({cwd:"/missing"}); await settle(f.t,f.db);});
    expect(f.data.threadList.peek().items).toHaveLength(0);
    expect(menu()?.textContent).toContain("Directory: /beta");
    f.db.threads.extra=summary("extra",{cwd:"/gamma"});
    await act(hints);
    expect(menu()?.textContent).toContain("Directory: /gamma");
    const beta = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Directory: /beta")!;
    beta.focus();
    delete f.db.threads.other;
    await act(hints);
    expect(document.activeElement?.textContent).toBe("Directory: /gamma");
    const count=f.t.calls("thread.cwds").length;
    await act(async()=>trigger().click());
    await act(hints);
    expect(f.t.calls("thread.cwds")).toHaveLength(count);
    await act(async()=>trigger().click());
    await act(async()=>{await settle(f.t,f.db);});
    expect(menu()).not.toBeNull();
    await act(async()=>{f.model.openThread("extra"); await settle(f.t,f.db);});
    expect(menu()).toBeNull();
    const afterNavigation = f.t.calls("thread.cwds").length;
    await act(hints);
    expect(f.t.calls("thread.cwds")).toHaveLength(afterNavigation);
  } finally {render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it("opens all ten cross-directory descendants, gives overlapping pins independent copies, and restores the trees after filtering", async () => {
  const f = await fixtureModel({ route: "conversation", threadId: "lead", capabilities: ["thread.tags", "thread.cwds"], configure(db) {
    db.threads = { lead: summary("lead", { cwd: "/alpha", tags: ["pin"] }) };
    for (let n = 0; n < 10; n++) {
      const id = `child${n}`;
      db.threads[id] = summary(id, { cwd: "/beta", parent_id: n === 9 ? "child0" : "lead", ...(n === 0 ? { tags: ["pin"], awaiting_named_count: 1 } : {}) });
    }
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, DESIGNS));
  const links = (band: string) => [...host.querySelectorAll<HTMLAnchorElement>(`.side-list section[aria-label="${band}"] a.tree-link`)];
  const fold = (band: string) => links(band).find(link => link.getAttribute("href") === "#/conversation/lead")!.parentElement!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    expect(fold("All").getAttribute("aria-label")).toContain("10 children");
    expect(fold("Pinned").getAttribute("aria-label")).toContain("10 children");
    expect(links("All")).toHaveLength(1);
    expect(links("Pinned")).toHaveLength(2);
    await act(async () => { fold("All").click(); });
    expect(links("All")).toHaveLength(11);
    expect(links("Pinned")).toHaveLength(2);
    await act(async () => { fold("Pinned").click(); });
    expect(links("Pinned")).toHaveLength(12);
    expect(links("Pinned").filter(link => link.getAttribute("href") === "#/conversation/child9")).toHaveLength(1);
    await act(async () => { f.model.openThread("child0"); await settle(f.t, f.db); });
    const copies = [...host.querySelectorAll<HTMLAnchorElement>('.side-list a[href="#/conversation/child0"]')];
    expect(copies).toHaveLength(3);
    expect(new Set(copies.map(link => link.id)).size).toBe(3);
    for (const link of copies) {
      expect(link.getAttribute("aria-current")).toBe("true");
      await act(async () => { link.parentElement!.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click(); });
      expect([...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent === "Unpin")).toBe(true);
      await act(async () => { document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    }
    await act(async () => { f.data.setListFilter({ cwd: "/beta" }); await flush(); });
    const filtered = f.t.calls("thread.list").at(-1)!;
    expect(filtered.args).toMatchObject({ cwd: "/beta" });
    expect(f.data.threadList.peek().loading).toBe(true);
    expect(links("Pinned")).toHaveLength(12);
    expect(links("All")).toHaveLength(11);
    await act(async () => { await settle(f.t, f.db); });
    expect(links("All")).toHaveLength(10);
    expect(links("Pinned").map(link => link.getAttribute("href"))).toEqual(["#/conversation/child0"]);
    expect(host.querySelector(".side-list .thread-item-child")).toBeNull();
    await act(async () => { f.data.setListFilter({}); await flush(); });
    expect(links("Pinned").map(link => link.getAttribute("href"))).toEqual(["#/conversation/child0"]);
    expect(host.querySelector(".side-list .thread-item-child")).toBeNull();
    await act(async () => { await settle(f.t, f.db); });
    expect(links("Pinned")).toHaveLength(12);
    expect(links("All")).toHaveLength(11);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it('settles the mounted tag session while hidden and ignores late results after retargeting', async () => {
  const f = await fixtureModel({ route: 'threads', threadId: 'lead', capabilities: ['thread.tags'], configure(db) {
    db.threads = { lead: summary('lead', { tags: ['old'] }), other: summary('other') };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
  } });
  const host = document.createElement('div'); document.body.append(host);
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, DESIGNS));
  const panel = () => host.querySelector<HTMLElement>('section[aria-label="Tags for 1 chosen Threads"]');
  const button = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === label)!;
  const field = () => panel()!.querySelector<HTMLInputElement>('input[aria-label="Tag to add"]')!;
  const input = (value: string) => { field().value = value; field().dispatchEvent(new Event('input', { bubbles: true })); };
  const stage = async (value: string) => { await act(async () => input(value)); await act(async () => button('Add to list').click()); };
  const open = async (id: string) => { await act(async () => {
    host.querySelector(`.side-list a[href="#/conversation/${id}"]`)!.parentElement!.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click();
  }); await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(el => el.textContent === 'Edit tags…')!.click();
  }); };
  const apply = () => button('Apply to 1 Threads');
  const close = async () => { await act(async () => button('Close').click()); };
  const finish = async (tag: string) => {
    const call = f.t.calls('thread.tag').at(-1)!;
    await act(async () => { f.db.answered.add(call.id); f.t.ok(call.id, { changed: ['lead'], unchanged: [], not_found: [], add: [tag], remove: [] }); await flush(); });
  };
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    await open('lead'); await stage('new-tag');
    await act(async () => { apply().click(); await flush(); });
    await close(); await open('lead');
    expect(apply().disabled).toBe(true); expect(field().disabled).toBe(true);
    apply().click(); expect(f.t.calls('thread.tag')).toHaveLength(1);
    await close();
    const reads = f.t.calls('thread.list').length;
    await finish('new-tag');
    expect(f.t.calls('thread.list')).toHaveLength(reads);
    await open('lead');
    expect(f.model.org.tagDraft.peek()).toMatchObject({ add: [], action: { kind: 'idle' } });
    expect(panel()?.textContent).not.toContain('new-tag');
    Object.assign(f.db.threads.lead!, { tags: ['old', 'new-tag'] });
    await act(async () => { f.t.push({ t: 'changed', config_changed: false, thread_ids: ['lead'], list: true }); await settle(f.t, f.db); });
    expect(panel()?.textContent).toContain('new-tag');
    await stage('old-request'); await act(async () => input('raw-a'));
    await act(async () => { apply().click(); await flush(); });
    await open('other');
    expect(field().value).toBe('');
    expect(f.model.org.tagDraft.peek()).toMatchObject({ targets: ['other'], add: [], action: { kind: 'idle' } });
    await stage('draft-b'); await finish('old-request');
    expect(f.model.org.tagDraft.peek()).toMatchObject({ targets: ['other'], add: ['draft-b'], action: { kind: 'idle' } });
    expect(f.t.calls('thread.tag')).toHaveLength(2);
  } finally { render(null, host); host.remove(); document.head.querySelector("#test-styles")?.remove(); f.model.dispose(); f.data.stop(); }
});

it("bolds a background completion only after the list hint and clears on open or local mark", async () => {
  const first = { node_id: "a", at: "2026-01-01T00:00:00Z" };
  const second = { node_id: "b", at: "2026-01-02T00:00:00Z" };
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, DESIGNS));
  let visible = true;
  const writes: unknown[] = [];
  const f = await fixtureModel({ route: "conversation", threadId: "lead", unreadPreferences: {
    read: () => prefs.value.sidebarUnread ?? [],
    write: records => { writes.push(records); prefs.value = { ...prefs.peek(), sidebarUnread: records }; },
    visible: () => visible,
  }, configure(db) {
    db.threads = { lead: summary("lead", { cwd: "/one" }), other: summary("other", { cwd: "/one", last_end_message: first }) };
    db.details.other = details("other", { last_end_message: second });
  } });
  const host = document.createElement("div"); document.body.append(host);
  const link = () => host.querySelector<HTMLAnchorElement>('.side-list a[href="#/conversation/other"]')!;
  const unread = () => !!link().querySelector("strong[data-unread]");
  const hint = async (detail = false) => { f.t.push({ t: "changed", config_changed: false, thread_ids: detail ? ["other"] : [], list: true }); await settle(f.t, f.db); };
  const end = (marker: typeof first) => { f.db.threads.other = summary("other", { ...f.db.threads.other, last_end_message: marker }); };
  const mark = async (label: string) => {
    await act(async () => { link().parentElement!.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click(); });
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === label)!;
    await act(async () => { item.click(); await settle(f.t, f.db); });
  };
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    expect(unread()).toBe(false);
    expect(prefs.peek().sidebarUnread?.filter(r => r.thread === "other")).toEqual([
      { thread: "other", node: "a", manual: false },
    ]);
    f.db.threads.other!.title = "Renamed";
    await act(() => hint());
    expect(unread()).toBe(false);
    f.db.threads.other = summary("other", { ...f.db.threads.other, last_end_message: second });
    expect(unread()).toBe(false);
    const reads = f.t.calls("thread.list").length;
    await act(() => hint());
    expect(f.t.calls("thread.list")).toHaveLength(reads + 1);
    expect(unread()).toBe(true);
    await mark("Mark as read");
    expect(unread()).toBe(false);
    await mark("Mark as unread");
    expect(unread()).toBe(true);
    expect(f.t.calls("thread.list")).toHaveLength(reads + 1);
    await act(async () => { f.model.openThread("other"); await settle(f.t, f.db); });
    expect(unread()).toBe(false);
    expect(prefs.peek().sidebarUnread?.find(r => r.thread === "other")?.node).toBe("b");
    end(first);
    const writesAfterOpen = writes.length;
    const detailReadsAfterOpen = f.t.calls("thread.get").length;
    await act(() => hint());
    expect(unread()).toBe(true);
    expect(writes).toHaveLength(writesAfterOpen);
    expect(f.t.calls("thread.get")).toHaveLength(detailReadsAfterOpen);
    f.db.details.other = details("other", { last_end_message: first });
    await act(() => hint(true));
    expect(unread()).toBe(false);
    visible = false;
    end(second);
    f.db.details.other = details("other", { last_end_message: second });
    const writesBeforeHidden = writes.length;
    await act(() => hint(true));
    expect(unread()).toBe(true);
    expect(writes).toHaveLength(writesBeforeHidden);
    visible = true;
    await act(() => hint(true)); // same detail ID is not a new visible completion
    expect(unread()).toBe(true);
    await act(async () => { f.model.showView("threads"); f.model.openThread("other"); await settle(f.t, f.db); });
    expect(unread()).toBe(false);
  } finally { render(null, host); host.remove(); document.head.querySelector("#test-styles")?.remove(); f.model.dispose(); f.data.stop(); }
});

it("renders the approved sidebar section band, trailing column, and disclosure behavior", async () => {
  const label = "All";
  const f = await fixtureModel({ route: "conversation", threadId: "lead", capabilities: ["thread.cwds"], configure(db) {
    db.threads = { lead: summary("lead", { cwd: "/alpha" }), other: summary("other", { cwd: "/beta", tags: ["pin"] }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, DESIGNS));
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    const group = host.querySelector<HTMLElement>('.side-list .tgroup[data-group-heading="section"][aria-label="All"]')!;
    const name = group.querySelector<HTMLElement>(".tgroup-name")!;
    const toggle = group.querySelector<HTMLButtonElement>(".tgroup-toggle")!;
    expect(toggle.classList.contains("btn")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe(`Collapse ${label}`);
    expect(toggle.querySelector(".tgroup-chevron .i")?.getAttribute("aria-hidden")).toBe("true");
    expect(group.querySelector(".tgroup-pin")).toBeNull();
    const pinned = host.querySelector('.side-list .tgroup[data-group-heading="section"][aria-label="Pinned"]')!;
    expect(pinned.querySelector(".tgroup-toggle .tgroup-pin")).not.toBeNull();
    expect(pinned.querySelector(".tgroup-toggle .tgroup-chevron")).not.toBeNull();
    expect(name.textContent).toBe(label);
    expect(group.querySelector(".tgroup-count")?.textContent).toBe("2");
    expect(group.querySelector(".tgroup-fold,.btn-link")).toBeNull();
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe(`Expand ${label}`);
    expect(group.querySelectorAll("[data-thread-row]")).toHaveLength(0);
    expect(pinned.querySelectorAll("[data-thread-row]")).toHaveLength(1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("keeps the bulk checkbox separate while the rest of its heading toggles", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const selected: boolean[] = [], toggled: boolean[] = [];
  const fold = { open: false, show: "Open", hide: "Close", showLabel: "Open folder", hideLabel: "Close folder", onToggle: () => toggled.push(!fold.open) };
  try {
    await act(async () => render(<ThreadGroup label="folder" count="3" selectLabel="Select folder" onSelect={value => selected.push(value)} fold={fold} />, host));
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const toggle = host.querySelector<HTMLButtonElement>(".tgroup-toggle")!;
    expect(toggle.className).toBe("btn tgroup-toggle");
    expect(host.querySelector<HTMLElement>(".tgroup")?.dataset.groupHeading).toBe("section");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Open folder");
    expect(toggle.querySelector(".tgroup-chevron .i")).not.toBeNull();
    expect(toggle.contains(checkbox)).toBe(false);
    expect(host.querySelectorAll("button")).toHaveLength(1);
    await act(async () => checkbox.click());
    expect(selected).toEqual([true]);
    expect(toggled).toEqual([]);
    await act(async () => toggle.click());
    expect(toggled).toEqual([true]);
  } finally { render(null, host); host.remove(); }
});
