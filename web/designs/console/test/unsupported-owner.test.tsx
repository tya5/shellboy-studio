// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { settle } from "../../../data/test/harness";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { Conversation } from "../screens/Conversation";

it("fails closed with an explicit notice when the owner lacks history.window", async () => {
  const f = await fixtureModel({ capabilities: [] });
  const host = document.createElement("div");
  document.body.append(host);
  try {
    f.model.applyRoute({ view: "conversation", threadId: "lead" });
    await settle(f.t, f.db);
    await act(async () => render(<Conversation model={f.model} />, host));
    expect(host.textContent).toContain(f.model.t.value("convo.unsupportedOwner"));
    expect(f.t.calls("history.window")).toHaveLength(0);
    expect(f.t.calls("history.list")).toHaveLength(0);
  } finally {
    render(null, host);
    host.remove();
    f.model.dispose();
    f.data.stop();
  }
});
