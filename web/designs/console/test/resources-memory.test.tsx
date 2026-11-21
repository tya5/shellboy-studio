// @vitest-environment happy-dom
import { render } from "preact";
import { expect, it } from "vitest";
import { MemoryPane } from "../screens/Resources";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { settle } from "../../../data/test/harness";

it.each(["en", "ja"] as const)("renders cache absence as a localized card value without collapsing other cards (%s)", async lang => {
 const f=await fixtureModel(); const host=document.createElement("div"); document.body.append(host);
 try {
  f.model.lang.value=lang;
  f.model.insights.refreshRead("memory"); await settle(f.t,f.db);
  render(<MemoryPane model={f.model}/>,host);
  const text=host.textContent ?? "";
  expect(text).toContain(lang === "en" ? "Not reported" : "報告なし");
  expect(text).toContain("56 KiB");
  expect(host.querySelector("[data-memory-cache-cards]")?.textContent).toContain(f.model.t.value("res.memory.serveCacheUnavailable", { missing: f.model.t.value("common.notReported") }));
  expect(text).not.toContain("UI cache owner is not available");
  expect(text).not.toContain("owner is not available");
  expect(host.querySelectorAll(".meter").length).toBe(4);
 } finally { render(null,host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it.each(["unsupported", "invalid_response", "disconnected"] as const)("renders a stable localized cache card for %s without changing owner state", async issue => {
 for (const lang of ["en", "ja"] as const) {
  const f=await fixtureModel();const host=document.createElement("div");document.body.append(host);
  try {
   f.model.lang.value=lang;
   f.model.insights.memory.value={loading:false,value:undefined,error:issue === "unsupported"
     ? {kind:"owner",code:"invalid_argument",message:"synthetic",details:{reason:"unknown_field",name:"memory",command:"status"}}
     : {kind:issue === "disconnected" ? "connection_lost" : "invalid_response",message:"synthetic"}};
   f.model.insights.bridge.value={loading:false,value:{rssBytes:1024,reason:undefined},error:undefined};
   const ownerBefore=f.model.data.owner.peek();
   render(<MemoryPane model={f.model}/>,host);
   const memory=host.querySelector('.meters[data-memory-cache-cards]');
   const card=memory?.querySelector('.meters .meter');
   expect(memory).not.toBeNull();expect(card).not.toBeNull();
   expect(card?.querySelector('.meter-text span')?.textContent).toBe(f.model.t.value('res.caches'));
   expect(card?.querySelector('.meter-text .caption')?.textContent).toBe(f.model.t.value(`res.memory.${issue}`));
   expect(card?.querySelector('[role="meter"]')).toBeNull();
   const bridge=[...host.querySelectorAll('section')].find(section=>section.getAttribute('aria-label')===f.model.t.value('res.bridge'));
   expect(bridge).not.toBeNull();expect(bridge?.textContent).toContain("1 KiB");
   expect(f.model.data.owner.peek()).toBe(ownerBefore);
   expect(host.textContent).not.toContain('owner is not available');
  } finally { render(null,host);host.remove();f.model.dispose();f.data.stop(); }
 }
});



it.each(["en", "ja"] as const)("shows a localized failed-refresh state while retaining the previous memory facts (%s)", async lang => {
 let failed = false;
 const f=await fixtureModel({configure(db){const answer=db.answer.bind(db);db.answer=call=>call.command==="status"&&(call.args as {memory?:boolean}).memory&&failed?{ok:false,code:"invalid_argument",message:"unsupported memory field",details:{reason:"unknown_field",name:"memory",command:"status",request_may_have_been_applied:false}}:answer(call);}});
 const host=document.createElement("div");document.body.append(host);
 try {
  f.model.lang.value=lang;
  f.model.insights.refreshRead("memory");await settle(f.t,f.db);
  expect(f.model.insights.memory.peek().value).toBeDefined();
  failed=true;f.model.insights.refreshRead("memory");await settle(f.t,f.db);
  expect(f.model.insights.memory.peek().value?.caches).toHaveLength(4);
  expect(f.model.insights.memory.peek().error).toMatchObject({kind:"owner",code:"invalid_argument"});
  render(<MemoryPane model={f.model}/>,host);
  const cacheSection=[...host.querySelectorAll("section")].find(section=>section.getAttribute("aria-label")===f.model.t.value("res.caches"))!;
  expect(cacheSection.querySelectorAll(".meter")).toHaveLength(4);
  expect(host.querySelector('[role="status"]')?.textContent).toContain(f.model.t.value("res.memory.unsupported"));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(f.model.t.value("res.memory.readFailedStale"));
  expect(cacheSection.textContent).toContain("56 KiB");
 } finally {render(null,host);host.remove();f.model.dispose();f.data.stop();}
});


it("renders one localized first-failure Meter without stale-value wording or raw transport text", async () => {
 const f=await fixtureModel();const host=document.createElement("div");document.body.append(host);
 try {
  f.model.lang.value="ja";
  f.model.insights.memory.value={loading:false,value:undefined,error:{kind:"busy",message:"PRIVATE TRANSPORT DETAIL"}};
  render(<MemoryPane model={f.model}/>,host);
  const cards=host.querySelectorAll('.meters[data-memory-cache-cards] .meter');
  expect(cards).toHaveLength(1);
  expect(cards[0]?.textContent).toContain(f.model.t.value("res.memory.readFailed"));
  expect(host.textContent).not.toContain("PRIVATE TRANSPORT DETAIL");
  expect(host.textContent).not.toContain(f.model.t.value("res.memory.readFailedStale"));
 } finally {render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it("keeps the global owner connected when only the memory status operation is unsupported", async () => {
 const f=await fixtureModel({configure(db){const answer=db.answer.bind(db);db.answer=call=>call.command==="status"&&(call.args as {memory?:boolean}).memory?{ok:false,code:"invalid_argument",message:"unsupported memory field",details:{reason:"unknown_field",name:"memory",command:"status",request_may_have_been_applied:false}}:answer(call);}});
 try {
  const before=f.model.data.owner.peek();expect(before.state).toBe("connected");
  f.model.insights.refreshRead("memory");await settle(f.t,f.db);
  expect(f.model.insights.memory.peek().error).toMatchObject({kind:"owner",code:"invalid_argument"});
  expect(f.model.data.owner.peek()).toBe(before);
 } finally {f.model.dispose();f.data.stop();}
});
