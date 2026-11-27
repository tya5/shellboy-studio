import { computed, type ReadonlySignal } from "@preact/signals";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import { formatAge, formatDuration, parseTime } from "../../../ui-core/src";

/** Subscribe to the formatted value, never to the raw clock in a render. */
export function useClockText(clock: ReadonlySignal<number> | undefined, format: (now: number) => string | undefined, inputs: readonly unknown[]): string | undefined {
  return useMemo(() => computed(() => format(clock?.value ?? 0)), [clock, ...inputs]).value;
}

export function ClockAge({ clock, at }: { clock: ReadonlySignal<number>; at: string }) {
  return <>{useClockText(clock, now => formatAge(at, now), [at])}</>;
}

export function clockAge(clock: ReadonlySignal<number> | undefined, at: string | undefined) {
  return clock && at && parseTime(at) !== undefined ? <ClockAge clock={clock} at={at} /> : undefined;
}

/** Follow the actual layout, including an ancestor hidden by a container query. */
export function useClockPane() {
  const [node, ref] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    if (!node) return;
    const publish = () => {
      for (let current: HTMLElement | null = node; current; current = current.parentElement) {
        if (getComputedStyle(current).display === "none") { setVisible(false); return; }
      }
      setVisible(true);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref, visible: node !== null && visible };
}

type ElapsedProps = { clock: ReadonlySignal<number>; started: number };
function useElapsed({ clock, started }: ElapsedProps) {
  return useClockText(clock, now => formatDuration(Math.max(0, now - started)), [started]);
}

export function ClockElapsed(props: ElapsedProps) {
  return <>{useElapsed(props)}</>;
}

export function PanelElapsed(props: ElapsedProps) {
  return <>{useElapsed(props)}</>;
}
