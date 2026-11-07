// Wire adapter for first-run connection setup (Shellboy #269): `credentials.set`,
// `credentials.clear` and `connection.test`. These operations are on a Shellboy branch and in no
// release, so every assumption about their shape is in this one file. When the core reports its
// final shape, correct it here; nothing else in the data layer or above reads the wire.
//
// Assumed shapes (docs/design/connection-setup.md):
//   connection.test  args    {connection} for a saved connection, or a candidate
//                            {base_url, api, api_key_env?, api_key_header?, api_key?}
//                    result  {http_status?, models: string[] | {id}[], api_key_env?: {name, set},
//                             failure?: null | {class, message?}}
//   credentials.set  args    {connection, value}       result {path?}
//   credentials.clear args   {connection}              result {}
// A key travels only inside these arguments. It is never returned, logged or stored here.

export type Dialect = "responses" | "chat_completions" | "anthropic_messages";

/** What a failed test can say, in the owner's classes. Anything unknown becomes `other`. */
export type TestFailureClass = "auth" | "url" | "unreachable" | "timeout" | "tls" | "rate_limit" | "server" | "other";

export interface TestCandidate {
  baseUrl: string;
  api: Dialect;
  apiKeyEnv?: string;
  apiKeyHeader?: string;
  /** Write-only: sent, never read back. */
  apiKey?: string;
}

export type TestTarget = { connection: string } | { candidate: TestCandidate };

export interface TestFacts {
  httpStatus: number | undefined;
  models: string[];
  /** The variable the owner looked at, and whether it has a value there. */
  env: { name: string; set: boolean } | undefined;
  failure: { kind: TestFailureClass; message: string | undefined } | undefined;
}

type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function encodeTest(target: TestTarget): Record<string, unknown> {
  if ("connection" in target) return { connection: target.connection };
  const c = target.candidate;
  return {
    base_url: c.baseUrl,
    api: c.api,
    ...(c.apiKeyEnv !== undefined && { api_key_env: c.apiKeyEnv }),
    ...(c.apiKeyHeader !== undefined && { api_key_header: c.apiKeyHeader }),
    ...(c.apiKey !== undefined && { api_key: c.apiKey }),
  };
}

const CLASSES: Record<string, TestFailureClass> = {
  auth: "auth",
  authentication: "auth",
  unauthorized: "auth",
  forbidden: "auth",
  url: "url",
  not_found: "url",
  unreachable: "unreachable",
  connect: "unreachable",
  connection: "unreachable",
  timeout: "timeout",
  tls: "tls",
  certificate: "tls",
  rate_limit: "rate_limit",
  rate_limited: "rate_limit",
  server: "server",
  server_error: "server",
};

const failureClass = (raw: unknown): TestFailureClass => (typeof raw === "string" ? (CLASSES[raw.toLowerCase()] ?? "other") : "other");

export const decodeTest = (v: unknown): Decoded<TestFacts> => {
  if (!isObject(v)) return { ok: false, reason: "connection.test result is not an object" };
  const list = Array.isArray(v.models) ? v.models : [];
  const models = list.flatMap((m): string[] => (typeof m === "string" ? [m] : isObject(m) && typeof m.id === "string" ? [m.id] : []));
  const env = isObject(v.api_key_env) && typeof v.api_key_env.name === "string" && typeof v.api_key_env.set === "boolean" ? { name: v.api_key_env.name, set: v.api_key_env.set } : undefined;
  let failure: TestFacts["failure"];
  if (typeof v.failure === "string") failure = { kind: failureClass(v.failure), message: undefined };
  else if (isObject(v.failure)) failure = { kind: failureClass(v.failure.class), message: typeof v.failure.message === "string" ? v.failure.message : undefined };
  return { ok: true, value: { httpStatus: typeof v.http_status === "number" ? v.http_status : undefined, models, env, failure } };
};

export const encodeCredentialsSet = (connection: string, value: string): Record<string, unknown> => ({ connection, value });
export const encodeCredentialsClear = (connection: string): Record<string, unknown> => ({ connection });

export interface StoredFacts {
  /** Where the owner says it wrote the key, when it says. */
  path: string | undefined;
}

export const decodeStored = (v: unknown): Decoded<StoredFacts> => (isObject(v) ? { ok: true, value: { path: typeof v.path === "string" ? v.path : undefined } } : { ok: false, reason: "credentials result is not an object" });
