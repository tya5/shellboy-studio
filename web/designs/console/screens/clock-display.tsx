import { computed, type ReadonlySignal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import { formatAge, parseTime } from "../../../ui-core/src";

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
