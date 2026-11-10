import { it, expect } from "vitest";
import { rig } from "./window-owner";
it("tail continuation must not recapture fresh authority after a synchronous publication revoke", async () => {
  const r = await rig(10); await r.settle();
  let revoked = false;
  const stop = r.w.acceptedView.subscribe(ref => {
    if (ref.total === 12 && !revoked) {
      revoked = true;
      r.w.acceptedView.revoke();
      expect(r.w.acceptedView.isCurrent(ref)).toBe(false);
    }
  });
  r.owner.append(2); r.w.changed(); await r.settle();
  const currentAfterContinuation = r.w.acceptedView.isCurrent(r.w.acceptedView.peek());
  stop(); r.w.dispose(); r.data.stop();
  expect(revoked).toBe(true);
  expect(currentAfterContinuation).toBe(false);
});
it("unrevoked tail publication remains eligible", async () => {
  const r = await rig(10); await r.settle();
  r.owner.append(2); r.w.changed(); await r.settle();
  expect(r.w.acceptedView.peek().total).toBe(12);
  expect(r.w.acceptedView.isCurrent(r.w.acceptedView.peek())).toBe(true);
  r.w.dispose(); r.data.stop();
});
