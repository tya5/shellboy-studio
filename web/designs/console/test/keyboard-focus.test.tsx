// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { Composer } from "../system/components/Composer";
import { ListRow } from "../system/components/ListRow";
import { PanelPage } from "../system/components/PanelTabs/PanelPage";
import { StepRow } from "../system/components/StepRow";
// @ts-expect-error The CSS contract is checked against the shipped source in happy-dom.
import { readFileSync } from "node:fs";

const host = document.createElement("div");
const show = (node: Parameters<typeof render>[0]) => {
  if (!host.isConnected) document.body.append(host);
  act(() => render(node, host));
};
afterEach(() => { act(() => render(null, host)); host.remove(); });

it.each([false, true])("continues the row's Tab order (backward=%s)", async backward => {
  show(<><button id="before">Before</button><ListRow id="sample" title="Sample" onSelect={() => {}}
    actions={[{ key: "action", label: "Action", run() {} }]} />
    <button disabled>Disabled</button><div hidden><button>Hidden</button></div><button id="after">After</button></>);
  const row = host.querySelector<HTMLButtonElement>(".panel-list-main")!;
  row.focus();
  await act(async () => { row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  const item = document.querySelector<HTMLButtonElement>("[role=menuitem]")!;
  expect(document.activeElement).toBe(item);
  const tab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: backward, bubbles: true, cancelable: true });
  act(() => { item.dispatchEvent(tab); });
  expect(tab.defaultPrevented).toBe(true);
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector(backward ? "#before" : "#after"));
});

it("makes only an active panel without a tab stop focusable itself", async () => {
  const panel = () => host.querySelector<HTMLElement>("[role=tabpanel]")!;
  show(<PanelPage id="work" hidden={false}><p>Nothing to do</p><button hidden>Hidden</button></PanelPage>);
  expect(panel().getAttribute("tabindex")).toBe("0");
  panel().focus();
  expect(document.activeElement).toBe(panel());
  show(<PanelPage id="work" hidden={false}><button>Open detail</button></PanelPage>);
  await vi.waitFor(() => expect(panel().hasAttribute("tabindex")).toBe(false));
  show(<PanelPage id="work" hidden><p>Hidden panel</p></PanelPage>);
  expect(panel().hasAttribute("tabindex")).toBe(false);
});

it("keeps the base outline for a focused collapsed Work row", () => {
  show(<div class="step-group-list"><StepRow open={false} command="Example" status={null} onToggle={() => {}}>Output</StepRow></div>);
  const summary = host.querySelector<HTMLElement>("summary")!;
  summary.focus();
  expect(document.activeElement).toBe(summary);
  expect(summary.closest("details")?.open).toBe(false);
  const base = readFileSync("designs/console/system/shared/base.css", "utf8");
  const work = readFileSync("designs/console/system/shared/work.css", "utf8");
  expect(base).toMatch(/:focus-visible\{outline:2px solid var\(--accent\)/);
  for (const match of work.matchAll(/\.step-group-list>\.step>summary:focus-visible\{([^}]*)\}/g)) {
    expect(match[1]).not.toMatch(/(?:^|;)\s*outline:/);
  }
});

it("moves focus back to the composer only when its focused Stop disappears", () => {
  const draw = (running: boolean) => show(<><Composer label="Draft" placeholder="" hint="" sendLabel="Send" canSend busy={false}
    stop={running ? { label: "Stop", run() {} } : undefined} onSend={async () => false} /><button id="other">Other</button></>);
  const stop = () => host.querySelector<HTMLButtonElement>('[aria-label="Stop"]');
  draw(true);
  stop()!.focus();
  expect(document.activeElement).toBe(stop());
  draw(false);
  expect(stop()).toBeNull();
  expect(document.activeElement).toBe(host.querySelector("textarea"));
  draw(true);
  const other = host.querySelector<HTMLButtonElement>("#other")!;
  other.focus();
  draw(false);
  expect(document.activeElement).toBe(other);
});
