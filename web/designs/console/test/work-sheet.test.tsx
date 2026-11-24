// @vitest-environment happy-dom
import "../system/components.css";
// @ts-expect-error Node reads verify the production modal scroll-lock CSS contract.
import { readFileSync } from "node:fs";
import "../system/tokens/console.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { WorkSheet } from "../system/components/WorkSheet";

const layoutCss = readFileSync("designs/console/system/layout.css", "utf8");

it("locks app scroll panes and only dismisses on a genuine primary backdrop click", async () => {
  const host = document.createElement("div");
  const opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.append(host, opener);
  opener.focus();
  let open = true;
  const onClose = vi.fn(() => { open = false; draw(); });
  const returnTarget = vi.fn(() => opener);
  const draw = () => render(<WorkSheet open={open} title="Work" closeLabel="Close" getReturnFocusTarget={returnTarget} onClose={onClose}><p>Details</p></WorkSheet>, host);
  const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
  await act(async () => { draw(); await Promise.resolve(); });
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  const rect = { x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 500, width: 300, height: 400, toJSON: () => ({}) };
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(rect);
  expect(dialog.open).toBe(true);
  expect(showModal).toHaveBeenCalledTimes(1);
  expect(layoutCss).toMatch(/html:has\(dialog:modal\)\{overflow:hidden\}/);
  expect(layoutCss).toMatch(/\.work-sheet\{[^}]*display:flex;flex-direction:column[^}]*max-height:80dvh/);
  expect(layoutCss).toMatch(/\.work-sheet-body\{[^}]*flex:1[^}]*min-height:0;overflow:auto/);
  expect(layoutCss).not.toContain("max-height:65dvh");
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Work");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Details");

  const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 50, clientY: 150 });
  const modifiedPrimary = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true, clientX: 50, clientY: 150 });
  const paddingClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 200 });
  await act(async () => { dialog.dispatchEvent(context); dialog.dispatchEvent(modifiedPrimary); dialog.dispatchEvent(paddingClick); await Promise.resolve(); });
  expect(onClose).not.toHaveBeenCalled();
  expect(dialog.open).toBe(true);

  const backdropClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 150 });
  await act(async () => { dialog.dispatchEvent(backdropClick); await Promise.resolve(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(opener);
  render(null, host); host.remove(); opener.remove();
});

it("looks up the focus target when the sheet is dismissed", async () => {
  const host = document.createElement("div");
  const initial = document.createElement("button");
  const current = document.createElement("button");
  document.body.append(host, initial, current);
  let returnTarget = initial;
  let open = true;
  const getReturnFocusTarget = vi.fn(() => returnTarget);
  const draw = () => render(<WorkSheet open={open} title="Work" closeLabel="Close" getReturnFocusTarget={getReturnFocusTarget} onClose={() => { open = false; draw(); }}><p>Details</p></WorkSheet>, host);
  await act(async () => { draw(); await Promise.resolve(); });
  returnTarget = current;
  await act(async () => { host.querySelector<HTMLButtonElement>(".work-sheet-head button")!.click(); await Promise.resolve(); });
  expect(getReturnFocusTarget).toHaveBeenCalled();
  expect(document.activeElement).toBe(current);
  render(null, host); host.remove(); initial.remove(); current.remove();
});

it("allows Escape to cancel alertdialog while blocking outside dismissal", async () => {
  const host = document.createElement("div");
  const opener = document.createElement("button");
  document.body.append(host, opener); opener.focus();
  let open = true;
  const onClose = vi.fn(() => { open = false; draw(); });
  const draw = () => render(<WorkSheet open={open} role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title="Delete" closeLabel="Cancel" describedBy="delete-summary" getReturnFocusTarget={() => opener} onClose={onClose}><p id="delete-summary">Confirm delete?</p></WorkSheet>, host);
  await act(async () => { draw(); await Promise.resolve(); });
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  const cancel = dialog.querySelector<HTMLButtonElement>(".work-sheet-head button")!;
  expect(dialog.getAttribute("role")).toBe("alertdialog");
  expect(document.activeElement).toBe(cancel);
  const rect = { x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 500, width: 300, height: 400, toJSON: () => ({}) };
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(rect);
  await act(async () => { dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 150 })); await Promise.resolve(); });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { dialog.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(opener);
  render(null, host); host.remove(); opener.remove();
});

it.each([390, 1280])("keeps title and Close outside the single scrolling body at %ipx", async width => {
  const host = document.createElement("div"); host.style.width = `${width}px`; document.body.append(host);
  await act(async () => render(<WorkSheet open title="Long selection" closeLabel="Close" onClose={() => {}} getReturnFocusTarget={() => null}><ul>{Array.from({length: 30}, (_, i) => <li key={i}>Preview row {i}</li>)}</ul></WorkSheet>, host));
  const dialog = host.querySelector("dialog")!;
  expect(dialog.querySelector(".work-sheet-head h2")?.textContent).toBe("Long selection");
  const close = dialog.querySelector(".work-sheet-head button[aria-label='Close']");
  expect(close?.querySelector("svg")).not.toBeNull();
  expect(dialog.querySelectorAll(".work-sheet-body")).toHaveLength(1);
  expect(layoutCss).toMatch(/\.work-sheet\{[^}]*display:flex;flex-direction:column[^}]*max-height:80dvh/);
  expect(layoutCss).toMatch(/\.work-sheet-body\{[^}]*flex:1[^}]*min-height:0;overflow:auto/);
  expect(layoutCss).not.toContain("max-height:65dvh");
  expect(layoutCss).not.toMatch(/\.work-sheet-body \[data-phone-panel\]\{[^}]*overflow:auto/);
  render(null, host); host.remove();
});
