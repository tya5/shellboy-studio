// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { CopyButton } from "../system/components";

it("announces only successful clipboard completion and resets the check after 1.5 seconds", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const host = document.createElement("div");
  try {
    act(() => render(<CopyButton text={"echo one\necho two"} label="Copy command" copiedLabel="Copied" failedLabel="Copy failed" />, host));
    const button = host.querySelector("button")!;
    const status = host.querySelector('[role="status"]')!;
    const original = button.querySelector('svg')!.innerHTML;
    act(() => button.click());
    expect(writeText).toHaveBeenCalledWith("echo one\necho two");
    expect(status.textContent).toBe("");
    await act(async () => finish());
    expect(button.dataset.copyState).toBe("copied");
    expect(button.querySelector('svg')!.innerHTML).not.toBe(original);
    expect(button.getAttribute("aria-label")).toBe("Copy command");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Copied");
    act(() => { vi.advanceTimersByTime(1499); });
    expect(status.textContent).toBe("Copied");
    act(() => { vi.advanceTimersByTime(1); });
    expect(status.textContent).toBe("");
    expect(button.querySelector('svg')!.innerHTML).toBe(original);
    writeText.mockRejectedValueOnce(new Error("Clipboard blocked"));
    await act(async () => { button.click(); });
    expect(status.textContent).toBe("Copy failed");
    expect(button.querySelector('svg')!.innerHTML).toBe(original);
  } finally {
    act(() => render(null, host));
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
