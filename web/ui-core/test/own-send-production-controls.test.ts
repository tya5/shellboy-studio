import { expect, it } from "vitest";
import { ownSendPresentation } from "../src/own-send-presentation";
import type { PendingOwnMessage } from "../src/model";

const row: PendingOwnMessage = { scope: "scope", threadId: "t", operationId: "op", messageId: "own", text: "Original", phase: "accepted", plainMessageSend: true, clientOrdinal: 1 };

it("adopts the exact saved user node even when its body is deferred", () => {
  const result = ownSendPresentation("scope", [row], [{ node_id: "own", kind: "user", provenance: { client_operation_id: "op" }, items: null, items_unavailable_reason: "response_budget" }], []);
  expect(result.retire).toEqual([row]);
  expect(result.tailRows).toEqual([]);
});

it("does not infer adoption from another node or from assistant text", () => {
  const result = ownSendPresentation("scope", [row], [{ node_id: "other", kind: "user", provenance: { client_operation_id: "different" } }, { node_id: "own", kind: "user" }, { node_id: "assistant", kind: "assistant_response", provenance: { client_operation_id: "op" } }], []);
  expect(result.retire).toEqual([]);
  expect(result.localRows).toEqual([row]);
});
