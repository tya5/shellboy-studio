// @vitest-environment happy-dom
import { render } from "preact";
import { expect, it } from "vitest";
import { MemoryPane } from "../screens/Resources";
import { fixtureMemory, fixtureModel } from "../../../ui-core/test/fixture";
import { readMemory } from "../../../ui-core/src/resources";
import { settle } from "../../../data/test/harness";

it.each(["en", "ja"] as const)("renders cache absence as a localized card value without collapsing other cards (%s)", async lang => {
 const f=await fixtureModel(); const host=document.createElement("div"); document.body.append(host);
 try {
  f.model.lang.value=lang;
  f.model.insights.memory.value={loading:false,value:readMemory(fixtureMemory),error:undefined};
  render(<MemoryPane model={f.model}/>,host);
  const text=host.textContent ?? "";
  expect(text).toContain(lang === "en" ? "Not reported" : "報告なし");
  expect(text).toContain("56 KiB");
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
   f.model.insights.memory.value={loading:false,value:undefined,error:{kind:"resource_read",issue} as never};
   f.model.insights.bridge.value={loading:false,value:{rssBytes:1024,reason:undefined},error:undefined};
   const ownerBefore=f.model.data.owner.peek();
   render(<MemoryPane model={f.model}/>,host);
   const memory=host.querySelector('.meters[data-memory-cache-cards]');
   const card=memory?.querySelector('.meters .meter');
   expect(memory).not.toBeNull();expect(card).not.toBeNull();
   expect(card?.querySelector('.meter-text span')?.textContent).toBe(f.model.t.value('res.caches'));
   expect(card?.querySelector('.meter-text .caption')?.textContent).toBe(f.model.t.value(`res.memory.${issue}`));
   expect(card?.querySelector('[role="meter"]')).toBeNull();
   expect(host.querySelector('[data-bridge-memory]')).not.toBeNull();
   expect(host.querySelector('[data-bridge-memory]')?.textContent).toContain("1 KiB");
   expect(f.model.data.owner.peek()).toBe(ownerBefore);
   expect(host.textContent).not.toContain('owner is not available');
  } finally { render(null,host);host.remove();f.model.dispose();f.data.stop(); }
 }
});


it("keeps the global owner connected when only the memory status operation is unsupported", async () => {
 const f=await fixtureModel({configure(db){const answer=db.answer.bind(db);db.answer=call=>call.command==="status"&&(call.args as {memory?:boolean}).memory?{ok:false,code:"operation_not_found"}:answer(call);}});
 try {
  const before=f.model.data.owner.peek();expect(before.state).toBe("connected");
  f.model.insights.refreshRead("memory");await settle(f.t,f.db);
  expect(f.model.insights.memory.peek().error).toEqual({kind:"resource_read",issue:"unsupported",message:"unsupported"});
  expect(f.model.data.owner.peek()).toBe(before);
 } finally {f.model.dispose();f.data.stop();}
});
