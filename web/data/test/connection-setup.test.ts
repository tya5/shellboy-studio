import { describe, expect, it } from "vitest";
import { decodeStored, decodeTest, encodeCredentialsClear, encodeCredentialsSet, encodeTest } from "../src";

describe("connection setup wire adapter", () => {
  it("encodes a saved connection or a candidate, and only the fields given", () => {
    expect(encodeTest({ connection: "proxy" })).toEqual({ connection: "proxy" });
    expect(encodeTest({ candidate: { baseUrl: "http://x/v1", api: "responses" } })).toEqual({ base_url: "http://x/v1", api: "responses" });
    expect(encodeTest({ candidate: { baseUrl: "http://x/v1", api: "anthropic_messages", apiKeyEnv: "K", apiKeyHeader: "x-api-key", apiKey: "v" } })).toEqual({ base_url: "http://x/v1", api: "anthropic_messages", api_key_env: "K", api_key_header: "x-api-key", api_key: "v" });
    expect(encodeCredentialsSet("c", "v")).toEqual({ connection: "c", value: "v" });
    expect(encodeCredentialsClear("c")).toEqual({ connection: "c" });
  });

  it("decodes facts, reading model ids from strings or objects, and unknown classes as other", () => {
    expect(decodeTest({ http_status: 200, models: ["a", { id: "b" }, 3], api_key_env: { name: "K", set: true }, failure: null })).toEqual({
      ok: true,
      value: { httpStatus: 200, models: ["a", "b"], env: { name: "K", set: true }, failure: undefined },
    });
    const failed = decodeTest({ http_status: 401, models: [], failure: { class: "Unauthorized", message: "no" } });
    expect(failed).toMatchObject({ ok: true, value: { failure: { kind: "auth", message: "no" } } });
    expect(decodeTest({ failure: "brand_new" })).toMatchObject({ value: { failure: { kind: "other" } } });
    expect(decodeTest([])).toMatchObject({ ok: false });
  });

  it("never carries a value back from a store result", () => {
    expect(decodeStored({ path: "/p/credentials.toml", value: "secret" })).toEqual({ ok: true, value: { path: "/p/credentials.toml" } });
    expect(decodeStored(null)).toMatchObject({ ok: false });
  });
});
