// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { details, flush, settle, summary } from "../../../data/test/harness";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { Conversation } from "../screens/Conversation";

it("restores a Thread's draft on return without submitting it from another Thread", async () => {
  const { model, data, t, db } = await fixtureModel({ route: "conversation", threadId: "a", configure(owner) {
    owner.threads = { a: summary("a"), b: summary("b") };
    owner.details = { a: details("a"), b: details("b") };
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const area = () => host.querySelector<HTMLTextAreaElement>("#composer")!;
  const type = (text: string) => { area().value = text; area().dispatchEvent(new Event("input", { bubbles: true })); };
  const enter = () => area().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const open = (threadId: string) => act(async () => { model.navigate({ view: "conversation", threadId }); await settle(t, db); });
  try {
    await act(async () => { render(<Conversation model={model} />, host); await settle(t, db); });
    act(() => type("Only for A"));
    await open("b");
    expect(area().value).toBe("");
    await act(async () => { enter(); await flush(); });
    expect(t.calls("message.send")).toHaveLength(0);
    await open("a");
    expect(area().value).toBe("Only for A");
    await open("b");
    await act(async () => { type("Only for B"); enter(); await flush(); });
    const sends = t.calls("message.send");
    expect(sends).toHaveLength(1);
    expect(sends[0]!.args).toMatchObject({ thread_id: "b", text: "Only for B" });
  } finally {
    render(null, host);
    host.remove();
    model.dispose();
    data.stop();
  }
});
