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
  const hint = async () => { f.t.push({ t: "changed", config_changed: false, thread_ids: ["other"], list: true }); await settle(f.t, f.db); };
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
    await act(async () => { host.querySelector<HTMLButtonElement>('.side-list button[aria-label="Collapse alpha"]')!.click(); });
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
    expect(sides()[0]).toBe("thread-link-sidebar-other");
    expect(host.querySelector('.side-list section')?.getAttribute("aria-label")).toBe("Pinned");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
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
  const prefs = signal<ReturnType<typeof loadPrefs>>({ ...loadPrefs({ read: () => null, write() {} }, DESIGNS), sidebarOpenParents: ["lead"] });
  const order = () => [...host.querySelectorAll(".side-list [data-thread-row] a")].map(el => el.id.replace("thread-link-sidebar-", ""));
  const hint = async (id: string) => {
    f.t.push({ t: "changed", thread_ids: [id], list: true });
    await settle(f.t, f.db);
  };
  try {
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs: change => { prefs.value = { ...prefs.peek(), ...change }; }, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
    expect(order()).toEqual(["child", "other", "lead"]);
    Object.assign(f.db.threads.other!, { activity: "tools", updated_at: "2099-01-01T00:00:00Z" });
    await act(() => hint("other"));
    expect(order()).toEqual(["child", "other", "lead"]);
    await act(async () => {
      const creating = f.model.createThread();
      await settle(f.t, f.db);
      await creating;
    });
    expect(f.t.calls("thread.create")).toHaveLength(1);
    expect(order()).toEqual(["child", "other", "lead"]);
    f.db.threads = { new: summary("new", { cwd: "/alpha" }), ...f.db.threads };
    f.db.details.new = details("new", { cwd: "/alpha" });
    await act(() => hint("new"));
    expect(order()).toEqual(["new", "child", "other", "lead"]);
    expect(f.t.calls("thread.list").at(-1)?.args).toMatchObject({ order: "created" });
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

it("reads owner catalogs only while the filter menu is open, independently of filtered rows", async () => {
  const f=await fixtureModel({route:"conversation",threadId:"lead",capabilities:["thread.tags","thread.cwds"],configure(db){
    db.threads={lead:summary("lead",{cwd:"/alpha",tags:["first"]}),other:summary("other",{cwd:"/beta",tags:["second"]})};
  }});
  const host=document.createElement("div"); document.body.append(host);
  const prefs=signal(loadPrefs({read:()=>null,write(){}},DESIGNS));
  const trigger=()=>host.querySelector<HTMLButtonElement>('.side-search [aria-haspopup="menu"]')!;
  const menu=()=>document.querySelector('[role="menu"]');
  const hints=async()=>{f.t.push({t:"changed",thread_ids:[],list:true});await settle(f.t,f.db);};
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

it("shows cross-group child counts without a disclosure control or arrow action", async () => {
  const f=await fixtureModel({route:"conversation", threadId:"lead", configure(db){
    db.threads={lead:summary("lead",{cwd:"/alpha"}), child:summary("child",{cwd:"/beta", parent_id:"lead", awaiting_human_count:1, tags:["pin"]})};
  }});
  const host=document.createElement("div"); document.body.append(host);
  const prefs=signal(loadPrefs({read:()=>null,write(){}},DESIGNS));
  try {
    await act(async()=>{render(<App context={{model:f.model,prefs,designs:DESIGNS,setPrefs:change=>{prefs.value={...prefs.peek(),...change};},submitToken:async()=>false}}/>,host);await settle(f.t,f.db);});
    const row=host.querySelector('#thread-link-sidebar-lead')!;
    const chip=row.parentElement!.querySelector('[data-urgency="awaiting"]')!;
    expect(chip.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('1 children');
    expect(chip.querySelector('button')).toBeNull();
    for (const key of ['ArrowRight','ArrowLeft']) expect(row.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))).toBe(true);
    expect(prefs.peek().sidebarOpenParents).toEqual([]);
  } finally {render(null,host);host.remove();f.model.dispose();f.data.stop();}
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
    host.querySelector(`#thread-link-sidebar-${id}`)!.parentElement!.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click();
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
    await act(async () => { render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => false }} />, host); await settle(f.t, f.db); });
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
    await act(async () => { f.t.push({ t: 'changed', thread_ids: ['lead'], list: true }); await settle(f.t, f.db); });
    expect(panel()?.textContent).toContain('new-tag');
    await stage('old-request'); await act(async () => input('raw-a'));
    await act(async () => { apply().click(); await flush(); });
    await open('other');
    expect(field().value).toBe('');
    expect(f.model.org.tagDraft.peek()).toMatchObject({ targets: ['other'], add: [], action: { kind: 'idle' } });
    await stage('draft-b'); await finish('old-request');
    expect(f.model.org.tagDraft.peek()).toMatchObject({ targets: ['other'], add: ['draft-b'], action: { kind: 'idle' } });
    expect(f.t.calls('thread.tag')).toHaveLength(2);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
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
  const link = () => host.querySelector<HTMLAnchorElement>("#thread-link-sidebar-other")!;
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
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});
