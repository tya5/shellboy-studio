// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { translator } from "../../../ui-core/src/i18n";
import { LoginStartup } from "../screens/LoginStartup";

const host = document.createElement("div");
const t = translator("en");
const response = (state: string, refused = false) => ({ ok: true, json: async () => ({ state, refused }) });
const toggle = () => host.querySelector<HTMLButtonElement>("[role=switch]");
afterEach(() => { act(() => render(null, host)); vi.unstubAllGlobals(); });

it.each([
  ["on", "true", "Enabled by the OS."], ["off", "false", "Not registered."],
  ["unknown", null, "Couldn’t verify startup status"],
  ["unavailable", null, "Available only from a supported local Studio launcher"],
  ["no_desktop_launcher", null, "Linux has no Studio desktop launcher"],
])("renders OS startup state %s without inferring Off", async (state, checked, status) => {
  const fetch = vi.fn(async () => response(state));
  vi.stubGlobal("fetch", fetch);
  await act(async () => render(<LoginStartup t={t} />, host));
  await vi.waitFor(() => expect(host.querySelector("[role=status]")?.textContent).toContain(status));
  expect(toggle()?.getAttribute("aria-checked") ?? null).toBe(checked);
  if (checked !== null) {
    expect(toggle()?.querySelector(".setting-switch-track")).not.toBeNull();
    expect(toggle()?.getAttribute("aria-describedby")).toBe(host.querySelector("[role=status]")?.id);
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps the verified setting until mutation readback, and rereads on returning", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const fetch = vi.fn()
    .mockResolvedValueOnce(response("off"))
    .mockImplementationOnce(() => new Promise<ReturnType<typeof response>>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(response("off"));
  vi.stubGlobal("fetch", fetch);
  await act(async () => render(<LoginStartup t={t} />, host));
  await vi.waitFor(() => expect(toggle()?.getAttribute("aria-checked")).toBe("false"));
  act(() => toggle()?.click());
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  expect(toggle()?.disabled).toBe(true);
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: '{"enabled":true}' });
  await act(async () => finish(response("on")));
  await vi.waitFor(() => expect(toggle()?.getAttribute("aria-checked")).toBe("true"));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await vi.waitFor(() => expect(toggle()?.getAttribute("aria-checked")).toBe("false"));
  expect(fetch).toHaveBeenCalledTimes(3);
});


it("does not cancel or restart a pending read on window focus", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise<ReturnType<typeof response>>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => render(<LoginStartup t={t} />, host));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signal = fetch.mock.calls[0]?.[1].signal;
  await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(signal?.aborted).toBe(false);
  await act(async () => finish(response("on")));
  await vi.waitFor(() => expect(toggle()?.getAttribute("aria-checked")).toBe("true"));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(fetch).toHaveBeenCalledTimes(2);
  const pendingSignal = fetch.mock.calls[1]?.[1].signal;
  act(() => render(null, host));
  expect(pendingSignal?.aborted).toBe(true);
});
