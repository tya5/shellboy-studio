import { describe, expect, it } from "vitest";
import { decodeStored, decodeTest, encodeTest } from "../src/connection-setup";

describe("adopted connection setup wire", () => {
  it("reads credential provenance and attempted requests without assuming delivery", () => {
    const result = decodeTest({ request: "GET model catalog only", connection: null, candidate: true, api: "responses", sent: true, ok: false, http_status: null, failure: "unreachable", models: [], model_count: 0, credential: { source: "env", api_key_env: "TEST_KEY", env_set: true, credentials_file_error: null } });
    expect(result.ok && result.value).toMatchObject({ sent: true, ok: false, httpStatus: undefined, env: { name: "TEST_KEY", set: true }, failure: { kind: "unreachable" } });
  });
  it("uses the actual credential path and permits an independent header", () => {
    expect(decodeStored({ connection: "x", stored: true, replaced: false, key_source: "stored", credentials_path: "/tmp/c", permissions_tightened: false, changed_by: null })).toEqual({ ok: true, value: { path: "/tmp/c" } });
    expect(encodeTest({ candidate: { baseUrl: "http://localhost", api: "responses", apiKeyHeader: "x-api-key", sslVerify: false } })).toEqual({ base_url: "http://localhost", api: "responses", api_key_header: "x-api-key", ssl_verify: false });
  });
});
