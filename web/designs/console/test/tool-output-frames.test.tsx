// @vitest-environment happy-dom
import "@preact/signals";
import { effect } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { flush, settle } from "../../../data/test/harness";
import { Conversation } from "../screens/Conversation";
for (const saved of ["", "Synthetic saved body"]) it(`keeps validated ${saved === "" ? "empty" : "body"} output across held refresh frames and unchanged results`, async () => {
  const { model, t, db } = await fixtureModel({ configure(db) { db.outputs["exec-1"] = saved; db.history.lead=[{node_id:"actual-tool",kind:"assistant_response",items:[{kind:"tool_call",item_identity:"call",execution_ids:["exec-1"]}],executions:[{execution_id:"exec-1",kind:"shell",state:"running",started_at:"2026-01-01T00:00:00Z"}]}]; db.shells.lead = [{ execution_id: "exec-1", state: "running", started_at: "2026-01-01T00:00:00Z" }]; } });
  model.openToolGroups.value = new Set(["step:exec-1"]);
  model.toolStepChoices.value = new Map([["exec-1", true]]);
  const host = document.createElement("div"); document.body.append(host);
  act(() => render(<Conversation model={model} />, host)); await act(async () => { await settle(t, db); });
  await act(async()=>{const work=host.querySelector<HTMLDetailsElement>("[data-work-group]")!;expect(work.open).toBe(false);work.open=true;work.dispatchEvent(new Event("toggle"));await settle(t,db);});
  expect(host.querySelector('[data-execution="exec-1"]')?.closest('[data-work-group]')).not.toBeNull();
  await act(async()=>{await settle(t,db);});
  const snapshot = model.outputs.peek().get("exec-1"); expect(snapshot?.loading).toBe(false);
  let changes = 0; const unwatch = effect(() => { model.outputs.value; changes++; }); const before = changes;
  const expected = saved || model.t.peek()("details.outputEmpty");
  try {
    for (let refresh = 0; refresh < 3; refresh++) {
      const release = model.watchOutput("exec-1"); await act(async () => { await flush(); });
      const held = t.calls("shell.read").at(-1)!; db.answered.add(held.id);
      for (let frame = 0; frame < 3; frame++) {
        act(() => { model.now.value += 1000; });
        await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
        expect(host.textContent).toContain(expected); expect(host.textContent).not.toContain(model.t.peek()("details.outputLoading"));
        expect(model.outputs.peek().get("exec-1")).toBe(snapshot);
      }
      act(() => t.ok(held.id, { execution_id: "exec-1", text: saved })); await act(async () => { await flush(); });
      expect(model.outputs.peek().get("exec-1")).toBe(snapshot); release();
    }
    expect(changes).toBe(before);
  } finally { unwatch(); render(null, host); host.remove(); model.dispose(); }
});
