// @vitest-environment happy-dom
import { signal } from "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { formatAge } from "../../../ui-core/src";
import { useClockText } from "../screens/clock-display";

it("does not render a clock label again until its displayed age changes", async () => {
  const host = document.createElement("div");
  const clock = signal(121_000);
  let renders = 0;
  function Label() {
    renders++;
    return <>{useClockText(clock, now => formatAge("1970-01-01T00:00:00Z", now), [])}</>;
  }
  try {
    await act(() => render(<Label />, host));
    const label = host.textContent;
    const initial = renders;
    await act(() => { clock.value = 135_000; });
    expect(renders).toBe(initial);
    await act(() => { clock.value = 181_000; });
    expect(host.textContent).not.toBe(label);
  } finally { render(null, host); }
});
