import type { ApiError, BridgeError } from "./protocol";

/** Why an operation did not produce a value. Presentation chooses wording; kinds are stable. */
export type OpError =
  /** Nothing was sent: no open socket. Safe to retry, also for mutations. */
  | { kind: "not_connected"; message: string }
  /** A read was sent and the socket closed before the reply. Re-read. */
  | { kind: "connection_lost"; message: string }
  /** A mutation was sent and the reply is lost. Check `operation.get` or retry with the same operationId. */
  | { kind: "unconfirmed"; message: string; operationId: string }
  /** The data layer's own queue bound or the bridge's `busy`; retry on user action. */
  | { kind: "busy"; message: string }
  /** Failure of the bridge itself (not allowed, invalid call, ...). */
  | { kind: "bridge"; code: string; message: string }
  /** The owner answered with an error (or its own call failed, see `code`). */
  | { kind: "owner"; code: string; message: string; hint?: string; details?: unknown }
  /** A reply the data layer cannot decode. Loud on purpose; never papered over. */
  | { kind: "invalid_response"; message: string }
  | { kind: "cancelled"; message: string };

export type Outcome<T> =
  | { ok: true; value: T; operationId?: string }
  | { ok: false; error: OpError; operationId?: string };

export const fromApiError = (e: ApiError): OpError => ({
  kind: "owner",
  code: e.code,
  message: e.message,
  ...(e.hint !== undefined && { hint: e.hint }),
  ...(e.details !== undefined && { details: e.details }),
});

export function fromBridgeError(e: BridgeError): OpError {
  if (e.code === "busy") return { kind: "busy", message: e.message };
  if (e.owner_error) return fromApiError(e.owner_error);
  return { kind: "bridge", code: e.code, message: e.message };
}
