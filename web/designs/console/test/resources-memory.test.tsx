// @vitest-environment happy-dom
import { render } from "preact";
import { expect, it } from "vitest";
import { MemoryPane } from "../screens/Resources";
import { fixtureMemory, fixtureModel } from "../../../ui-core/test/fixture";
import { readMemory } from "../../../ui-core/src/resources";

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
