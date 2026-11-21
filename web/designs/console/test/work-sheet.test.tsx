// @vitest-environment happy-dom
import "../system/components.css";
import "../system/tokens/console.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { WorkSheet } from "../system/components/WorkSheet";

it("locks page scroll, dismisses on left backdrop click but not contextmenu, and restores focus", async () => {
  const host = document.createElement("div");
  const opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.append(host, opener);
  opener.focus();
  document.body.style.overflow = "auto";
  let open = true;
  const onClose = vi.fn(() => { open = false; draw(); });
  const draw = () => render(<WorkSheet open={open} title="Work" closeLabel="Close" onClose={onClose}><p>Details</p></WorkSheet>, host);
  await act(async () => { draw(); await Promise.resolve(); });
  const dialog = document.body.querySelector<HTMLDialogElement>("dialog")!;
  expect(dialog.open).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Work");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Details");
  await act(async () => { dialog.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); await Promise.resolve(); });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); await Promise.resolve(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.body.style.overflow).toBe("auto");
  expect(document.activeElement).toBe(opener);
  render(null, host); host.remove(); opener.remove(); document.body.style.overflow = "";
});

it("restores focus to a nearby row when the opener is removed", async () => {
  const host = document.createElement("div");
  const rows = document.createElement("div");
  const first = document.createElement("div"); first.className = "tree-item";
  const opener = document.createElement("button"); first.append(opener);
  const second = document.createElement("div"); second.className = "tree-item";
  const neighbor = document.createElement("a"); neighbor.href = "#next"; neighbor.textContent = "Next"; second.append(neighbor);
  rows.append(first, second); host.append(rows); document.body.append(host);
  opener.focus();
  let open = true;
  const draw = () => render(<WorkSheet open={open} title="Work" closeLabel="Close" onClose={() => { open = false; draw(); }}><p>Details</p></WorkSheet>, host);
  await act(async () => { draw(); await Promise.resolve(); });
  first.remove();
  await act(async () => { document.body.querySelector<HTMLDialogElement>("dialog")!.querySelector("button")!.click(); await Promise.resolve(); });
  expect(document.body.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  expect(document.activeElement).toBe(neighbor);
  render(null, host); host.remove();
});
