import { effect } from "@preact/signals-core";
import { expect, it } from "vitest";
import { ShellboyData } from "../../data/src/store";
import { ConversationWindow } from "../src/window";
import { connected, FakeTransport, flush } from "../../data/test/harness";
for (const action of ["cancel", "pause", "discard"] as const) it(`invalidates original read authority before synchronous pending-clear callbacks: ${action}`, async () => {
  const t = new FakeTransport(); let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `ordering-${++n}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); await flush();
  const h = data.openThread("t");
  let token = h.captureReadQualification()!;
  const capture = h.captureReadQualification.bind(h);
  h.captureReadQualification = () => { const value = capture(); if (value) token = value; return value; };
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "t", revision: 1, total: 1, items: [{ node_id: "n", kind: "summary", selection: { ordinal: 0 }, items: [] }] } }) }); await flush();
  const transition = w.beginSummaryTransition(h, w.acceptedView.peek(), "n", 0)!;
  const accepts: boolean[] = [];
  let armed = false; const results: boolean[] = [], captures: unknown[] = [];
  const stop = effect(() => { h.attemptPresentations.value; if (armed) { results.push(h.isReadQualificationCurrent(token)); accepts.push(w.acceptSummaryCoverage(h, w.acceptedView.peek(), transition, { node_id: "n", kind: "summary", text: "", source_node_ids: ["n"] })); captures.push(w.beginSummaryTransition(h, w.acceptedView.peek(), "n", 0)); } });
  armed = true;
  if (action === "cancel") h.cancelReads(); else if (action === "pause") h.pause(); else {
    // Exercise the owner-internal path in isolation from setOwner's independent generation guard.
    (data as unknown as { discardAllPreviews(reason: string): void }).discardAllPreviews("resync");
  }
  expect(results.length).toBeGreaterThan(0); expect(results.every(current => !current)).toBe(true); expect(accepts.every(value => !value)).toBe(true);
  if (action !== "discard") expect(captures.every(value => value === undefined)).toBe(true);
  stop(); w.dispose(); data.stop();
});
