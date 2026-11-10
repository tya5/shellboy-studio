import { expect, it } from "vitest";
import { TerminalReadSlots, type SelectedCanonicalRequest, type OwnedTerminalReadLease } from "../src/terminal-read";
import { Cancel } from "../src/operations";
const receipt = { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const };
const request = { id: "r", args: { thread_id: "t", items: true, before: 99, after: 100 } } as SelectedCanonicalRequest;
const result = { ok: true as const, value: { thread_id: "t", revision: 1, total: 0, items: [] } };
it("two leases coalesce one bounded read, third denied", async () => {
 const slots = new TerminalReadSlots(), cancel = new Cancel();
 const a = slots.request(receipt, request, () => true, cancel) as OwnedTerminalReadLease;
 const b = slots.request(receipt, request, () => true, cancel) as OwnedTerminalReadLease;
 expect(slots.request(receipt, request, () => true, cancel)).toEqual({ phase: "unavailable", reason: "capacity" });
 let starts = 0; await slots.dispatch(() => { starts++; return true; }, async () => result);
 expect(starts).toBe(1); expect(a.state.peek()).toEqual(b.state.peek());
 expect(a.state.peek().phase).toBe("settled"); await slots.dispatch(() => { starts++; return true; }, async () => result); expect(starts).toBe(1);
});
it("cancel then prepare cannot reset automatic-once even before dispatch", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); const a = slots.request(receipt, request, () => true, parent) as OwnedTerminalReadLease;
 a.cancel(); const b = slots.request(receipt, request, () => true, parent) as OwnedTerminalReadLease;
 expect(b.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" }); let reads = 0;
 await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0);
 expect(slots.request(receipt, { ...request, id: "new" as SelectedCanonicalRequest["id"] }, () => true, parent)).toEqual({ phase: "unavailable", reason: "cancelled" });
});
it("budget denial settles without dispatch and no automatic retry", async () => {
 const slots = new TerminalReadSlots(); const lease = slots.request(receipt, request, () => true, new Cancel()) as OwnedTerminalReadLease;
 let reads = 0; await slots.dispatch(() => false, async () => { reads++; return result; });
 expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "budget-exhausted" });
 await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0);
});
it("invalidated held result cannot publish into its old lease", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); let valid = true;
 const lease = slots.request(receipt, request, () => valid, parent) as OwnedTerminalReadLease;
 let finish!: (value: typeof result) => void; const done = slots.dispatch(() => true, () => new Promise(resolve => { finish = resolve; }));
 valid = false; parent.cancel(); finish(result); await done;
 expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" });
});
it.each([{ items: false, before: 0, after: 0 }, { items: true, before: 100, after: 100 }, { items: true, before: -1, after: 0 }])("rejects invalid typed node request %#", args => {
 expect(new TerminalReadSlots().request(receipt, { ...request, args: { thread_id: "t", ...args } }, () => true, new Cancel())).toEqual({ phase: "unavailable", reason: "capacity" });
});
it("clear invalidates every old lease and keeps no queued work", async () => {
 const slots = new TerminalReadSlots(); const lease = slots.request(receipt, request, () => true, new Cancel()) as OwnedTerminalReadLease;
 slots.clear(); expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" });
 let reads = 0; await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0);
});
it("reading notification revocation prevents dispatch", async () => {
 const slots = new TerminalReadSlots(); let valid = true; const lease = slots.request(receipt, request, () => valid, new Cancel()) as OwnedTerminalReadLease;
 const stop = lease.state.subscribe(state => { if (state.phase === "reading") valid = false; });
 let reads = 0; await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0); stop();
});
it("same ID with changed selected args cannot coalesce", () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); slots.request(receipt, request, () => true, parent);
 expect(slots.request(receipt, { ...request, args: { ...request.args, before: 1 } }, () => true, parent)).toEqual({ phase: "unavailable", reason: "cancelled" });
});
it("only explicit manual owner reset can admit a new automatic marker in a retained receipt scope", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); const old = slots.request(receipt, request, () => true, parent) as OwnedTerminalReadLease;
 old.cancel(); let starts = 0; await slots.dispatch(() => true, async () => { starts++; return result; }); expect(starts).toBe(0);
 // Store invokes clear only after the existing explicit retry invalidates old qualification.
 slots.clear(); const next = slots.request(receipt, request, () => true, parent) as OwnedTerminalReadLease;
 await slots.dispatch(() => true, async () => { starts++; return result; }); expect(starts).toBe(1); expect(next.state.peek().phase).toBe("settled");
});
