// @vitest-environment happy-dom
// Witnesses for the design system v2 foundations (#97): the shared parts screens build on.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { Button, ButtonGroup, EmptyState, Field, LoadingCount, Notice, PageHeader } from "../system/components";

let host: HTMLElement;
const mount = (node: preact.ComponentChild) => {
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(node, host));
  return host;
};
afterEach(() => { render(null, host); host.remove(); });

it("names button variants by action strength with outline as the default", () => {
  const root = mount(<><Button>Cancel</Button><Button variant="ghost">Refresh</Button><Button variant="primary">Save</Button><Button variant="link">Undo</Button></>);
  expect([...root.querySelectorAll("button")].map((b) => b.className)).toEqual(["btn", "btn btn-ghost", "btn btn-primary", "btn btn-link"]);
});

it("keeps ButtonGroup a labelled group of pressed buttons", () => {
  const root = mount(<ButtonGroup label="View"><Button aria-pressed>Cards</Button><Button aria-pressed={false}>Tiles</Button></ButtonGroup>);
  const group = root.querySelector(".btn-group")!;
  expect(group.getAttribute("role")).toBe("group");
  expect(group.getAttribute("aria-label")).toBe("View");
});

it("stacks a visible field name, help and error and ties them to the control", () => {
  const root = mount(<Field label="Output weight" help="Weight of output tokens." error="Enter 0 or more." class="mono" value="-1" />);
  const input = root.querySelector("input")!;
  const name = root.querySelector<HTMLLabelElement>(".form-field-label")!;
  expect(name.htmlFor).toBe(input.id);
  expect(input.getAttribute("aria-label")).toBeNull();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const described = input.getAttribute("aria-describedby")!.split(" ");
  expect(described.map((id) => root.querySelector(`[id="${id}"]`)?.textContent)).toEqual(["Weight of output tokens.", "Enter 0 or more."]);
});

it("keeps an unlabelled field a bare wrapper named by ariaLabel", () => {
  const root = mount(<Field ariaLabel="Search threads" placeholder="Name or text" />);
  expect(root.firstElementChild?.className).toBe("form-field-root");
  expect(root.querySelector("input")?.getAttribute("aria-label")).toBe("Search threads");
  expect(root.querySelector("input")?.hasAttribute("aria-describedby")).toBe(false);
});

it("renders the compact empty state as an icon and two lines, and the view variant with a heading", () => {
  const root = mount(<><EmptyState compact role="empty.conversation" title="No activity yet" body="Commands the agent runs appear here." /><EmptyState role="empty.inbox" title="Nothing awaits you" body="Questions from Threads appear here." /></>);
  const [compact, view] = [...root.querySelectorAll(".empty-state-root")];
  expect(compact!.classList.contains("empty-compact")).toBe(true);
  expect(compact!.querySelector(".i.icon-small")).not.toBeNull();
  expect([...compact!.querySelectorAll(".empty-compact-copy p")].map((p) => p.className)).toEqual(["empty-compact-what", "empty-compact-how"]);
  expect(compact!.querySelector("h2")).toBeNull();
  expect(view!.querySelector("h2")?.textContent).toBe("Nothing awaits you");
});

it("draws the application banner as a status row in the wait tone", () => {
  const root = mount(<Notice banner icon="status.waiting">Running without authentication.</Notice>);
  const banner = root.querySelector(".notice")!;
  expect(banner.className).toBe("notice wait notice-banner");
  expect(banner.getAttribute("role")).toBe("status");
  expect(banner.firstElementChild?.classList.contains("i")).toBe(true);
});

it("stands in for an unread count without a number", () => {
  const root = mount(<><LoadingCount /><LoadingCount small onRaised /></>);
  const [line, small] = [...root.querySelectorAll(".loadcount")];
  expect(line!.getAttribute("aria-hidden")).toBe("true");
  expect(small!.className).toBe("loadcount loadcount-small loadcount-on-raised");
  expect(root.textContent).toBe("");
});

it("gives a page one title and makes a labelled toolbar one Tab stop with arrow keys", () => {
  const root = mount(<PageHeader title="Monitor" description="Threads that run or wait for you" actions={<Button variant="ghost">Refresh</Button>} toolbarLabel="Filter Threads" count="46 of 46"
    toolbar={<><Field ariaLabel="Search" /><Button>All</Button><Button>Pinned</Button><Button disabled>Off</Button></>} />);
  expect(root.querySelectorAll("h1")).toHaveLength(1);
  expect(root.querySelector(".page-header-copy p")?.textContent).toBe("Threads that run or wait for you");
  const bar = root.querySelector<HTMLElement>("[role=toolbar]")!;
  expect(bar.getAttribute("aria-label")).toBe("Filter Threads");
  const [search, all, pinned] = [...bar.querySelectorAll<HTMLElement>("input,button:not(:disabled)")];
  expect([search, all, pinned].map((control) => control!.tabIndex)).toEqual([0, -1, -1]);
  act(() => { all!.focus(); });
  expect([search, all, pinned].map((control) => control!.tabIndex)).toEqual([-1, 0, -1]);
  act(() => { all!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(document.activeElement).toBe(pinned);
  act(() => { search!.focus(); search!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(document.activeElement).toBe(search);
  expect(bar.lastElementChild?.textContent).toBe("46 of 46");
});

it("leaves a short toolbar without the toolbar role", () => {
  const root = mount(<PageHeader title="Branches" toolbar={<Button>Compare</Button>} />);
  expect(root.querySelector("[role=toolbar]")).toBeNull();
  expect(root.querySelector("button")?.tabIndex).toBe(0);
});
