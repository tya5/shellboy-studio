import { afterEach, describe, expect, it, vi } from "vitest";
import { issuePairing, pairingHosts } from "../src/pairing";

afterEach(() => vi.unstubAllGlobals());
describe("phone pairing", () => {
  it("loads permitted hosts and issues a link without persisting it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ hosts: ["mac.tail.ts.net"] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://mac.tail.ts.net/#pair=code", expires_in_seconds: 120 }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await pairingHosts()).toEqual(["mac.tail.ts.net"]);
    expect((await issuePairing("mac.tail.ts.net")).url).toContain("#pair=");
    expect(fetchMock.mock.calls[1]![1].body).toBe(JSON.stringify({ host: "mac.tail.ts.net" }));
  });
  it("does not accept a failed or malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 1 }) }));
    await expect(issuePairing("mac.tail.ts.net")).rejects.toThrow();
  });
});
