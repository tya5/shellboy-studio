import { describe, expect, it } from "vitest";
import { decodeCredentialsClear, decodeCredentialsSet, decodeTest, encodeTest } from "../src/connection-setup";

describe("adopted connection setup wire", () => {
  it("reads credential provenance and attempted requests without assuming delivery", () => {
    const result = decodeTest({ request: "GET model catalog only", connection: null, candidate: true, api: "responses", sent: true, ok: false, http_status: null, failure: "unreachable", models: [], model_count: 0, credential: { source: "env", api_key_env: "TEST_KEY", env_set: true, credentials_file_error: null } });
    expect(result.ok && result.value).toMatchObject({ sent: true, ok: false, httpStatus: undefined, env: { name: "TEST_KEY", set: true }, failure: { kind: "unreachable" } });
  });
  it("reads distinct credential results and projects only declared facts", () => {
    const origin = { instance_id: "instance", thread_id: "thread", run_id: "run", turn_id: "turn", execution_id: "execution" };
    const common = { connection: "x", key_source: "stored", credentials_path: "/tmp/c" };
    const stored = { ...common, stored: true, replaced: false, permissions_tightened: true, warning: "synthetic warning", changed_by: origin };
    const cleared = { ...common, cleared: false, key_source: "none", changed_by: null };
    expect(decodeCredentialsSet({ ...stored, value: "synthetic", changed_by: { ...origin, extra: "ignored" } })).toEqual({ ok: true, value: stored });
    expect(decodeCredentialsClear(cleared)).toEqual({ ok: true, value: cleared });
    expect(decodeCredentialsClear(stored).ok).toBe(false);
    expect(decodeCredentialsSet(cleared).ok).toBe(false);
    for (const read of [decodeCredentialsSet, decodeCredentialsClear]) {
      const valid = read === decodeCredentialsSet ? stored : cleared;
      expect(read({ ...valid, credentials_path: undefined, path: "/tmp/legacy" }).ok).toBe(false);
      expect(read({ ...valid, changed_by: undefined }).ok).toBe(false);
      expect(read({ ...valid, changed_by: { ...origin, turn_id: 42 } }).ok).toBe(false);
    }
  });
  it("permits an independent header", () => {
    expect(encodeTest({ candidate: { baseUrl: "http://localhost", api: "responses", apiKeyHeader: "x-api-key", sslVerify: false } })).toEqual({ base_url: "http://localhost", api: "responses", api_key_header: "x-api-key", ssl_verify: false });
  });
});
