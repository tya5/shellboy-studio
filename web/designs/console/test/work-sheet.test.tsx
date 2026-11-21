// @vitest-environment happy-dom
import "../system/components.css";
import "../system/tokens/console.css";
// @ts-expect-error Node reads verify the production scroll-container CSS contract.
import { readFileSync } from "node:fs";
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
  const fallback = vi.fn(() => null);
  const draw = () => render(<WorkSheet open={open} title="Work" closeLabel="Close" returnFocusTo={opener} resolveFocusFallback={fallback} onClose={onClose}><p>Details</p></WorkSheet>, host);
  await act(async () => { draw(); await Promise.resolve(); });
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  const rect = { x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 500, width: 300, height: 400, toJSON: () => ({}) };
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(rect);
  expect(dialog.open).toBe(true);
  expect(document.documentElement.classList.contains("modal-dialog-open")).toBe(true);
  expect(layoutCss).toMatch(/\.modal-dialog-open \.side,\.modal-dialog-open \.scroll,\.modal-dialog-open \.mon,\.modal-dialog-open \.org\{overflow:hidden\}/);
  expect(layoutCss).toMatch(/\.work-sheet-body\{[^}]*overflow:auto/);
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
  expect(document.documentElement.classList.contains("modal-dialog-open")).toBe(false);
  expect(document.activeElement).toBe(opener);
  render(null, host); host.remove(); opener.remove();
});

it("uses the caller's nearby resolver when the supplied opener is removed", async () => {
  const host = document.createElement("div");
  const rows = document.createElement("div");
  const first = document.createElement("div"); first.className = "tree-item";
  const opener = document.createElement("button"); first.append(opener);
  const second = document.createElement("div"); second.className = "tree-item";
  const neighbor = document.createElement("a"); neighbor.href = "#next"; neighbor.textContent = "Next"; second.append(neighbor);
  rows.append(first, second); host.append(rows); document.body.append(host);
  opener.focus();
  let open = true;
  const resolveFocusFallback = vi.fn(() => neighbor.isConnected ? neighbor : null);
  const draw = () => render(<WorkSheet open={open} title="Work" closeLabel="Close" returnFocusTo={opener} resolveFocusFallback={resolveFocusFallback} onClose={() => { open = false; draw(); }}><p>Details</p></WorkSheet>, host);
  await act(async () => { draw(); await Promise.resolve(); });
  first.remove();
  await act(async () => { host.querySelector<HTMLDialogElement>("dialog")!.querySelector("button")!.click(); await Promise.resolve(); });
  expect(resolveFocusFallback).toHaveBeenCalled();
  expect(document.activeElement).toBe(neighbor);
  render(null, host); host.remove();
});

it("allows Escape to cancel alertdialog while blocking outside dismissal", async () => {
  const host = document.createElement("div");
  const opener = document.createElement("button");
  document.body.append(host, opener); opener.focus();
  let open = true;
  const onClose = vi.fn(() => { open = false; draw(); });
  const draw = () => render(<WorkSheet open={open} role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title="Delete" closeLabel="Cancel" describedBy="delete-summary" returnFocusTo={opener} resolveFocusFallback={() => null} onClose={onClose}><p id="delete-summary">Confirm delete?</p></WorkSheet>, host);
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
